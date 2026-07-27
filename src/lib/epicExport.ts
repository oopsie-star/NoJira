import { supabase } from '@/lib/supabase'
import { displayFilename, storageBucket } from '@/lib/attachments'
import { personById } from '@/lib/people'
import type { Epic, JiraUserPlaceholder, Profile, Sprint, Task, TaskComment } from '@/types'

const TASK_SELECT = `
  *,
  epic:epics(*),
  assignee:profiles!tasks_assignee_id_fkey(*),
  reporter:profiles!tasks_reporter_id_fkey(*)
`
const COMMENT_SELECT = `*, author:profiles(*)`
const PAGE = 1000
const IN_CHUNK = 100

export interface EpicExportCtx {
  members: Profile[]
  placeholders: JiraUserPlaceholder[]
  attachmentNotes: Record<string, { original_name?: string | null } | undefined>
  sprints: Sprint[]
}

async function fetchAllTasks(makeQuery: () => { range: (a: number, b: number) => PromiseLike<{ data: Task[] | null }> }): Promise<Task[]> {
  const all: Task[] = []
  let page = PAGE
  for (let from = 0; ; from += page) {
    const { data } = await makeQuery().range(from, from + page - 1)
    const rows = (data ?? []) as Task[]
    all.push(...rows)
    if (from === 0 && rows.length > 0) page = rows.length
    if (rows.length < page) break
  }
  return all
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function assigneeNames(task: Task, ctx: EpicExportCtx): string {
  if (task.assignee_ids?.length) {
    return task.assignee_ids
      .map((id) => personById(id, ctx.members, ctx.placeholders)?.label ?? id)
      .join(', ')
  }
  if (task.assignee) return task.assignee.full_name || task.assignee.email
  if (task.assignee_placeholder_id) {
    return ctx.placeholders.find((p) => p.id === task.assignee_placeholder_id)?.display_name ?? '—'
  }
  return '—'
}

function reporterName(task: Task, ctx: EpicExportCtx): string {
  if (task.reporter) return task.reporter.full_name || task.reporter.email
  if (task.reporter_placeholder_id) {
    return ctx.placeholders.find((p) => p.id === task.reporter_placeholder_id)?.display_name ?? '—'
  }
  return '—'
}

function buildMarkdown(epic: Epic, tasks: Task[], comments: TaskComment[], ctx: EpicExportCtx): string {
  const sprintName = (id: string | null) => (id ? ctx.sprints.find((s) => s.id === id)?.name ?? '—' : '—')
  const byParent = new Map<string, Task[]>()
  const roots: Task[] = []
  for (const task of tasks) {
    if (task.parent_task_id && tasks.some((t) => t.id === task.parent_task_id)) {
      const bucket = byParent.get(task.parent_task_id)
      if (bucket) bucket.push(task)
      else byParent.set(task.parent_task_id, [task])
    } else {
      roots.push(task)
    }
  }
  const commentsByTask = new Map<string, TaskComment[]>()
  for (const c of comments) {
    const bucket = commentsByTask.get(c.task_id)
    if (bucket) bucket.push(c)
    else commentsByTask.set(c.task_id, [c])
  }

  const lines: string[] = []
  lines.push(`# Epic ${epic.key} — ${epic.title}`, '')
  lines.push(`- Status: ${epic.status}`)
  lines.push(`- Tasks: ${tasks.length}`)
  lines.push('')
  if (epic.description?.trim()) {
    lines.push('## Description', '', epic.description.trim(), '')
  }
  lines.push('---', '')

  const renderTask = (task: Task, depth: number) => {
    const h = '#'.repeat(Math.min(6, 3 + depth))
    lines.push(`${h} ${task.key} — ${task.title}`, '')
    lines.push(`- Status: ${task.status}`)
    lines.push(`- Type: ${task.issue_type}`)
    lines.push(`- Priority: ${task.priority}`)
    lines.push(`- Assignee(s): ${assigneeNames(task, ctx)}`)
    lines.push(`- Reporter: ${reporterName(task, ctx)}`)
    if (task.sprint_id) lines.push(`- Sprint: ${sprintName(task.sprint_id)}`)
    if (task.labels.length) lines.push(`- Labels: ${task.labels.join(', ')}`)
    if (task.due_date) lines.push(`- Due: ${task.due_date}`)
    if (task.attachments.length) {
      const names = task.attachments.map((p) => displayFilename(p, ctx.attachmentNotes[p]?.original_name))
      lines.push(`- Attachments (see attachments/${task.key}/): ${names.join(', ')}`)
    }
    lines.push('')
    if (task.description?.trim()) {
      lines.push('Description:', '', task.description.trim(), '')
    }
    const taskComments = commentsByTask.get(task.id) ?? []
    if (taskComments.length) {
      lines.push('Comments:')
      for (const c of taskComments) {
        const who = c.author?.full_name || c.author?.email || 'unknown'
        lines.push(`- [${who} · ${c.created_at.slice(0, 10)}] ${c.body.replace(/\n/g, ' ')}`)
      }
      lines.push('')
    }
    for (const child of (byParent.get(task.id) ?? [])) renderTask(child, depth + 1)
    lines.push('---', '')
  }

  lines.push(`## Tasks (${tasks.length})`, '')
  for (const task of roots) renderTask(task, 0)

  return lines.join('\n')
}

function buildJson(epic: Epic, tasks: Task[], comments: TaskComment[], ctx: EpicExportCtx) {
  const commentsByTask = new Map<string, TaskComment[]>()
  for (const c of comments) {
    const bucket = commentsByTask.get(c.task_id)
    if (bucket) bucket.push(c)
    else commentsByTask.set(c.task_id, [c])
  }
  return {
    epic: { key: epic.key, title: epic.title, status: epic.status, description: epic.description },
    tasks: tasks.map((task) => ({
      key: task.key,
      title: task.title,
      status: task.status,
      issue_type: task.issue_type,
      priority: task.priority,
      parent: tasks.find((t) => t.id === task.parent_task_id)?.key ?? null,
      sprint: task.sprint_id ? ctx.sprints.find((s) => s.id === task.sprint_id)?.name ?? null : null,
      assignees: assigneeNames(task, ctx),
      reporter: reporterName(task, ctx),
      labels: task.labels,
      due_date: task.due_date,
      description: task.description,
      attachments: task.attachments.map((p) => displayFilename(p, ctx.attachmentNotes[p]?.original_name)),
      comments: (commentsByTask.get(task.id) ?? []).map((c) => ({
        author: c.author?.full_name || c.author?.email || 'unknown',
        at: c.created_at,
        body: c.body,
      })),
    })),
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Fetch an epic's tasks + subtasks + comments + attachment files and download it all as a ZIP. */
export async function exportEpicToZip(epic: Epic, ctx: EpicExportCtx): Promise<void> {
  const epicTasks = await fetchAllTasks(() =>
    supabase.from('tasks').select(TASK_SELECT).eq('project_id', epic.project_id).eq('epic_id', epic.id).order('sprint_id').order('position'),
  )

  // Subtasks whose parent is one of the epic's tasks (subtasks don't inherit epic_id).
  const subtasks: Task[] = []
  for (const ids of chunk(epicTasks.map((t) => t.id), IN_CHUNK)) {
    const { data } = await supabase.from('tasks').select(TASK_SELECT).in('parent_task_id', ids).order('position')
    subtasks.push(...((data ?? []) as Task[]))
  }

  const seen = new Set<string>()
  const tasks: Task[] = []
  for (const task of [...epicTasks, ...subtasks]) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    tasks.push(task)
  }

  const comments: TaskComment[] = []
  for (const ids of chunk(tasks.map((t) => t.id), IN_CHUNK)) {
    const { data } = await supabase.from('task_comments').select(COMMENT_SELECT).in('task_id', ids).order('created_at')
    comments.push(...((data ?? []) as TaskComment[]))
  }

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const safeKey = epic.key.replace(/[^\w.-]+/g, '_') || 'epic'
  zip.file(`${safeKey}.md`, buildMarkdown(epic, tasks, comments, ctx))
  zip.file(`${safeKey}.json`, JSON.stringify(buildJson(epic, tasks, comments, ctx), null, 2))

  for (const task of tasks) {
    const usedNames = new Set<string>()
    for (const path of task.attachments) {
      try {
        const { data } = await supabase.storage.from(storageBucket(path)).download(path)
        if (!data) continue
        let name = displayFilename(path, ctx.attachmentNotes[path]?.original_name)
        // De-dupe filenames within a task folder.
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.')
          const stem = dot > 0 ? name.slice(0, dot) : name
          const ext = dot > 0 ? name.slice(dot) : ''
          let n = 2
          while (usedNames.has(`${stem} (${n})${ext}`)) n += 1
          name = `${stem} (${n})${ext}`
        }
        usedNames.add(name)
        zip.file(`attachments/${task.key}/${name}`, data)
      } catch {
        // Skip a file that fails to download; the rest of the archive still builds.
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(blob, `epic-${safeKey}.zip`)
}
