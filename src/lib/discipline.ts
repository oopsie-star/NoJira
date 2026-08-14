import { isFreshTask, isSuperseded } from './ops'
import type { JiraUserPlaceholder, Profile, Task, TaskLink } from '@/types'

export type Discipline = 'product' | 'design' | 'backend' | 'frontend' | 'qa'

/** Product frames the work, then it flows design → backend → frontend → QA. */
export const DISCIPLINE_ORDER: Discipline[] = ['product', 'design', 'backend', 'frontend', 'qa']

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  product: 'Product',
  design: 'Design',
  backend: 'Backend',
  frontend: 'Frontend',
  qa: 'QA',
}

/** Maps a Profile/placeholder `department` value (see DEPARTMENT_OPTIONS in PeoplePage.tsx) onto a discipline. */
const DEPARTMENT_TO_DISCIPLINE: Partial<Record<string, Discipline>> = {
  Product: 'product',
  Design: 'design',
  Backend: 'backend',
  Frontend: 'frontend',
  'Quality Assurance': 'qa',
}

function taskAssigneeIds(task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>): string[] {
  if (task.assignee_ids.length > 0) return task.assignee_ids
  if (task.assignee_id) return [task.assignee_id]
  if (task.assignee_placeholder_id) return [task.assignee_placeholder_id]
  return []
}

function departmentOf(id: string, members: Profile[], placeholders: JiraUserPlaceholder[]): string | null {
  return members.find((m) => m.id === id)?.department
    || placeholders.find((p) => p.id === id)?.department
    || null
}

/** Every discipline represented among a task's assignees, highest-ranked first. */
export function taskDisciplines(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
): Discipline[] {
  const found = new Set<Discipline>()
  for (const id of taskAssigneeIds(task)) {
    const discipline = DEPARTMENT_TO_DISCIPLINE[departmentOf(id, members, placeholders) ?? '']
    if (discipline) found.add(discipline)
  }
  return DISCIPLINE_ORDER.filter((discipline) => found.has(discipline))
}

/**
 * The section a task groups into — its highest-ranked discipline (a task with
 * both a designer and a frontend dev sits with Design, since Design outranks
 * Frontend), or null when no assignee maps to a recognized discipline. Tasks
 * with no match sort after every named discipline.
 */
export function primaryDiscipline(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
): Discipline | null {
  return taskDisciplines(task, members, placeholders)[0] ?? null
}

function disciplineRank(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
): number {
  const discipline = primaryDiscipline(task, members, placeholders)
  return discipline ? DISCIPLINE_ORDER.indexOf(discipline) : DISCIPLINE_ORDER.length
}

/**
 * Orders a sprint's or epic's task list into the discipline hierarchy: Product
 * first, then Design → Backend → Frontend → QA, each group keeping the tasks'
 * existing relative order. Freshly added work still floats to the top for its
 * first week (unaffected by discipline) and superseded work still sinks to the
 * bottom — the hierarchy only governs the settled work in between, mirroring
 * the same three-tier priority `filteredTasks` already sorts by.
 */
export function sortTasksByDiscipline(
  tasks: Task[],
  allTasks: Task[],
  taskLinks: TaskLink[],
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
): Task[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftFresh = isFreshTask(left.task, allTasks)
      const rightFresh = isFreshTask(right.task, allTasks)
      if (leftFresh !== rightFresh) return leftFresh ? -1 : 1
      if (leftFresh) return right.task.status_changed_at.localeCompare(left.task.status_changed_at)

      const leftSuperseded = isSuperseded(left.task.id, taskLinks)
      const rightSuperseded = isSuperseded(right.task.id, taskLinks)
      if (leftSuperseded !== rightSuperseded) return leftSuperseded ? 1 : -1

      const leftRank = disciplineRank(left.task, members, placeholders)
      const rightRank = disciplineRank(right.task, members, placeholders)
      if (leftRank !== rightRank) return leftRank - rightRank

      return left.task.position - right.task.position || left.index - right.index
    })
    .map((entry) => entry.task)
}
