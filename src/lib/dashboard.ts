import type { DashboardBlockLink, DashboardSprint, DashboardTask, Project } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** A task sitting in one status this long is "stuck" — same threshold the board's Aging metric uses. */
export const STALE_DAYS = 3

function timestamp(value?: string | null) {
  return value ? new Date(value).getTime() : NaN
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/** Every profile id a task is assigned to, covering both the single and multi-assignee fields. */
function assigneeIds(task: DashboardTask): string[] {
  if (task.assignee_ids?.length) return task.assignee_ids
  return task.assignee_id ? [task.assignee_id] : []
}

export function isAssignedTo(task: DashboardTask, profileId: string | null): boolean {
  return Boolean(profileId) && assigneeIds(task).includes(profileId as string)
}

/**
 * Ids of tasks blocked by something still unfinished. Mirrors ops.isTaskBlocked,
 * but resolved once for the whole workspace instead of per task — the dashboard
 * asks this question of every task at once, and the per-task helper rebuilds a
 * status map on each call.
 */
export function blockedTaskIds(tasks: DashboardTask[], links: DashboardBlockLink[]): Set<string> {
  const statusById = new Map(tasks.map((task) => [task.id, task.status]))
  const blocked = new Set<string>()
  for (const link of links) {
    // A blocker that is done (or gone from the non-terminal slice entirely)
    // no longer blocks anything.
    const blockerStatus = statusById.get(link.source_task_id)
    if (!blockerStatus || blockerStatus === 'done') continue
    blocked.add(link.target_task_id)
  }
  return blocked
}

export function isOverdue(task: DashboardTask): boolean {
  if (!task.due_date || task.status === 'done') return false
  const due = timestamp(task.due_date)
  return Number.isFinite(due) && due < startOfToday()
}

export function daysInStatus(task: DashboardTask): number {
  const baseline = timestamp(task.status_changed_at) || timestamp(task.updated_at) || timestamp(task.created_at)
  if (!Number.isFinite(baseline)) return 0
  return Math.max(0, Math.floor((Date.now() - baseline) / DAY_MS))
}

/**
 * Work that was STARTED and then stopped moving.
 *
 * Deliberately limited to in_progress. Counting every non-done task made this
 * read 481 of 513 on a real workspace — a backlog item nobody has picked up is
 * not stuck, it is just a backlog item, and burying 27 genuinely stalled tasks
 * inside that number is worse than not showing it at all.
 */
export function isStale(task: DashboardTask): boolean {
  return task.status === 'in_progress' && daysInStatus(task) >= STALE_DAYS
}

/** Whole days from now until `date`; negative once it has passed. */
export function daysUntil(date: string | null): number | null {
  if (!date) return null
  const target = timestamp(date)
  if (!Number.isFinite(target)) return null
  return Math.ceil((target - Date.now()) / DAY_MS)
}

export interface AttentionQueues {
  assignedNotStarted: DashboardTask[]
  myInProgress: DashboardTask[]
  blocked: DashboardTask[]
  overdue: DashboardTask[]
  stale: DashboardTask[]
}

/**
 * The dashboard's triage queues. "Mine" queues are scoped to the viewer; the
 * risk queues (blocked / overdue / stale) deliberately are not — a blocker
 * nobody owns is exactly the kind of thing a workspace view exists to surface.
 */
export function attentionQueues(
  tasks: DashboardTask[],
  links: DashboardBlockLink[],
  profileId: string | null,
): AttentionQueues {
  const blockedIds = blockedTaskIds(tasks, links)
  const open = tasks.filter((task) => task.status !== 'done')

  return {
    assignedNotStarted: tasks.filter((task) => task.status === 'todo' && isAssignedTo(task, profileId)),
    myInProgress: tasks.filter((task) => task.status === 'in_progress' && isAssignedTo(task, profileId)),
    blocked: open.filter((task) => blockedIds.has(task.id)),
    overdue: open.filter(isOverdue),
    stale: tasks.filter(isStale),
  }
}

export interface ProjectSummary {
  project: Project
  total: number
  done: number
  inProgress: number
  todo: number
  progress: number
  blocked: number
  overdue: number
  sprint: DashboardSprint | null
  sprintDaysLeft: number | null
  lastActivity: string | null
}

export function summarizeProjects(
  projects: Project[],
  tasks: DashboardTask[],
  links: DashboardBlockLink[],
  sprints: DashboardSprint[],
): ProjectSummary[] {
  const blockedIds = blockedTaskIds(tasks, links)
  const byProject = new Map<string, DashboardTask[]>()
  for (const task of tasks) {
    const bucket = byProject.get(task.project_id)
    if (bucket) bucket.push(task)
    else byProject.set(task.project_id, [task])
  }

  return projects.map((project) => {
    const own = byProject.get(project.id) ?? []
    const done = own.filter((task) => task.status === 'done').length
    const sprint = sprints.find((entry) => entry.project_id === project.id) ?? null
    // Computed rather than read off own[0]: the query does order by updated_at,
    // but a summary that silently goes wrong if that ORDER BY is ever dropped is
    // not worth the saved loop.
    let lastActivity: string | null = null
    for (const task of own) {
      if (!lastActivity || task.updated_at > lastActivity) lastActivity = task.updated_at
    }

    return {
      project,
      total: own.length,
      done,
      inProgress: own.filter((task) => task.status === 'in_progress').length,
      todo: own.filter((task) => task.status === 'todo').length,
      progress: own.length ? Math.round((done / own.length) * 100) : 0,
      blocked: own.filter((task) => blockedIds.has(task.id)).length,
      overdue: own.filter(isOverdue).length,
      sprint,
      sprintDaysLeft: sprint ? daysUntil(sprint.end_date) : null,
      lastActivity,
    }
  })
}

/** Tasks completed in the last `days` days, workspace-wide. */
export function completedSince(tasks: DashboardTask[], days: number): number {
  const cutoff = Date.now() - days * DAY_MS
  return tasks.filter((task) => {
    if (task.status !== 'done') return false
    const at = timestamp(task.completed_at) || timestamp(task.status_changed_at)
    return Number.isFinite(at) && at >= cutoff
  }).length
}
