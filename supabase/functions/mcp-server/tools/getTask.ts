import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { displayFilename } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveTaskByKeyOrId } from './resolvers.ts'

interface GetTaskArgs {
  task?: string
}

interface HistoryEntry {
  source: 'activity' | 'field_change'
  at: string
  [key: string]: unknown
}

export async function getTask(admin: SupabaseClient, args: GetTaskArgs) {
  const ref = args.task?.trim()
  if (!ref) throw new ToolError('"task" is required.')

  const task = await resolveTaskByKeyOrId(admin, ref)

  const [commentsRes, activitiesRes, fieldChangesRes, attachmentNotesRes, lastAgentRes] = await Promise.all([
    admin
      .from('task_comments')
      .select('id, author_id, body, created_at')
      .eq('task_id', task.id)
      .order('created_at'),
    admin
      .from('task_activities')
      .select('id, actor_id, activity_type, message, created_at')
      .eq('task_id', task.id)
      .order('created_at'),
    admin
      .from('task_field_changes')
      .select('id, field_name, old_value, new_value, changed_by, changed_at')
      .eq('task_id', task.id)
      .order('changed_at'),
    task.attachments.length
      ? admin
          .from('attachment_notes')
          .select('path, original_name, mime_type')
          .eq('project_id', task.project_id)
          .in('path', task.attachments)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('agent_audit_log')
      .select('agent_name, action_type, created_at')
      .eq('task_id', task.id)
      .not('agent_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (commentsRes.error) throw new ToolError(`Failed to load comments: ${commentsRes.error.message}`)
  if (activitiesRes.error) throw new ToolError(`Failed to load activity: ${activitiesRes.error.message}`)
  if (fieldChangesRes.error) throw new ToolError(`Failed to load field history: ${fieldChangesRes.error.message}`)
  if (attachmentNotesRes.error) throw new ToolError(`Failed to load attachment names: ${attachmentNotesRes.error.message}`)
  if (lastAgentRes.error) throw new ToolError(`Failed to load last agent: ${lastAgentRes.error.message}`)

  const comments = commentsRes.data ?? []
  const activities = activitiesRes.data ?? []
  const fieldChanges = fieldChangesRes.data ?? []
  const noteByPath = new Map((attachmentNotesRes.data ?? []).map((n) => [n.path, n]))
  const attachments = task.attachments.map((path) => {
    const note = noteByPath.get(path)
    return { path, name: displayFilename(path, note?.original_name), mime_type: note?.mime_type ?? null }
  })

  const profileIds = new Set<string>()
  for (const c of comments) profileIds.add(c.author_id)
  for (const a of activities) if (a.actor_id) profileIds.add(a.actor_id)
  for (const f of fieldChanges) if (f.changed_by) profileIds.add(f.changed_by)
  if (task.assignee_id) profileIds.add(task.assignee_id)
  for (const id of task.assignee_ids ?? []) profileIds.add(id)
  if (task.reporter_id) profileIds.add(task.reporter_id)

  const emailById = new Map<string, string>()
  if (profileIds.size) {
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', [...profileIds])
    if (profilesError) throw new ToolError(`Failed to resolve profiles: ${profilesError.message}`)
    for (const p of profiles ?? []) emailById.set(p.id, p.email)
  }

  const history: HistoryEntry[] = [
    ...activities.map((a) => ({
      source: 'activity' as const,
      type: a.activity_type,
      message: a.message,
      actor_email: a.actor_id ? emailById.get(a.actor_id) ?? null : null,
      at: a.created_at,
    })),
    ...fieldChanges.map((f) => ({
      source: 'field_change' as const,
      field: f.field_name,
      old_value: f.old_value,
      new_value: f.new_value,
      changed_by_email: f.changed_by ? emailById.get(f.changed_by) ?? null : null,
      at: f.changed_at,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return {
    key: task.key,
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    issue_type: task.issue_type,
    priority: task.priority,
    assignee_emails: (task.assignee_ids?.length ? task.assignee_ids : task.assignee_id ? [task.assignee_id] : [])
      .map((id) => emailById.get(id) ?? id),
    reporter_email: task.reporter_id ? emailById.get(task.reporter_id) ?? task.reporter_id : null,
    epic_id: task.epic_id,
    sprint_id: task.sprint_id,
    due_date: task.due_date,
    comments: comments.map((c) => ({
      author_email: emailById.get(c.author_id) ?? c.author_id,
      body: c.body,
      created_at: c.created_at,
    })),
    attachments,
    last_ai_agent: lastAgentRes.data
      ? { agent_name: lastAgentRes.data.agent_name, action_type: lastAgentRes.data.action_type, at: lastAgentRes.data.created_at }
      : null,
    history,
  }
}
