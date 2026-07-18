import type { Locale, Task, TaskLink } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

function toTimestamp(value?: string | null) {
  return value ? new Date(value).getTime() : NaN
}

export function getStatusAgeDays(task: Pick<Task, 'status_changed_at' | 'updated_at' | 'created_at'>) {
  const baseline = toTimestamp(task.status_changed_at) || toTimestamp(task.updated_at) || toTimestamp(task.created_at)
  if (!baseline) return 0
  return Math.max(0, Math.floor((Date.now() - baseline) / DAY_MS))
}

export const FRESH_TODO_DAYS = 7

/**
 * A task that entered "To do" within the last week. These are pinned to the top
 * of their list and highlighted, so newly added work surfaces immediately.
 * status_changed_at is maintained by the DB whenever the status changes, so this
 * also covers a task moved back to "To do".
 */
export function isFreshTodo(
  task: Pick<Task, 'status' | 'status_changed_at' | 'updated_at' | 'created_at'>,
): boolean {
  if (task.status !== 'todo') return false
  return getStatusAgeDays(task) < FRESH_TODO_DAYS
}

/** Whether `task` has a subtask created within the last week, regardless of either's status. */
export function hasFreshSubtask(
  taskId: string,
  tasks: Pick<Task, 'parent_task_id' | 'created_at'>[],
): boolean {
  return tasks.some((candidate) => (
    candidate.parent_task_id === taskId
    && (Date.now() - toTimestamp(candidate.created_at)) / DAY_MS < FRESH_TODO_DAYS
  ))
}

/**
 * A task counts as "fresh" — pinned to the top and highlighted — either on its
 * own terms (isFreshTodo) or because it just gained a new subtask, so the
 * parent surfaces along with the work added under it.
 */
export function isFreshTask(
  task: Pick<Task, 'id' | 'status' | 'status_changed_at' | 'updated_at' | 'created_at'>,
  tasks: Pick<Task, 'parent_task_id' | 'created_at'>[],
): boolean {
  return isFreshTodo(task) || hasFreshSubtask(task.id, tasks)
}

export function formatStatusAge(locale: Locale, task: Pick<Task, 'status_changed_at' | 'updated_at' | 'created_at'>) {
  const days = getStatusAgeDays(task)
  if (days === 0) return locale === 'ru' ? 'сегодня' : 'today'
  if (days === 1) return locale === 'ru' ? '1 дн' : '1d'
  return locale === 'ru' ? `${days} дн` : `${days}d`
}

export function calculateAverageCycleTimeHours(tasks: Array<Pick<Task, 'started_at' | 'completed_at'>>) {
  const samples = tasks
    .map((task) => {
      const startedAt = toTimestamp(task.started_at)
      const completedAt = toTimestamp(task.completed_at)
      return startedAt && completedAt && completedAt > startedAt
        ? (completedAt - startedAt) / (1000 * 60 * 60)
        : null
    })
    .filter((value): value is number => value !== null)

  if (!samples.length) return null
  return samples.reduce((sum, value) => sum + value, 0) / samples.length
}

export function formatCycleTime(locale: Locale, hours: number | null) {
  if (hours === null) return locale === 'ru' ? 'Нет данных' : 'No data'
  if (hours < 24) return locale === 'ru' ? `${Math.round(hours)} ч` : `${Math.round(hours)}h`
  const days = hours / 24
  return locale === 'ru' ? `${days.toFixed(1)} д` : `${days.toFixed(1)}d`
}

export function getActiveBlockers(taskId: string, taskLinks: TaskLink[], tasks: Pick<Task, 'id' | 'status'>[]) {
  const statusByTaskId = new Map(tasks.map((task) => [task.id, task.status]))
  return taskLinks.filter((link) => (
    link.link_type === 'blocks'
    && link.target_task_id === taskId
    && statusByTaskId.get(link.source_task_id) !== 'done'
  ))
}

export function isTaskBlocked(taskId: string, taskLinks: TaskLink[], tasks: Pick<Task, 'id' | 'status'>[]) {
  return getActiveBlockers(taskId, taskLinks, tasks).length > 0
}
