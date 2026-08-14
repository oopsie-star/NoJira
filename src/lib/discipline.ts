import { isFreshTask, isSuperseded } from './ops'
import type { JiraUserPlaceholder, Profile, ProjectMember, Task, TaskLink } from '@/types'

export type Discipline = 'product' | 'design' | 'backend' | 'frontend' | 'qa'

/** Product frames the work, then it flows design → backend → frontend. QA is
 *  deliberately excluded here — see `disciplinesOf` for why. */
export const DISCIPLINE_ORDER: Discipline[] = ['product', 'design', 'backend', 'frontend']

/** Display order for badges — QA still gets shown, just never ranked. */
const DISCIPLINE_BADGE_ORDER: Discipline[] = [...DISCIPLINE_ORDER, 'qa']

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

/** CEO, founder, and (global) super admin are always Product, regardless of their `department`. */
function isProductByRole(id: string, members: Profile[], projectMembers: ProjectMember[]): boolean {
  if (members.find((m) => m.id === id)?.role === 'admin') return true
  const membership = projectMembers.find((pm) => pm.profile_id === id)
  return membership?.project_role === 'ceo' || membership?.project_role === 'founder'
}

function disciplinesOf(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
  projectMembers: ProjectMember[],
): Set<Discipline> {
  const found = new Set<Discipline>()
  for (const id of taskAssigneeIds(task)) {
    if (isProductByRole(id, members, projectMembers)) {
      found.add('product')
      continue
    }
    const discipline = DEPARTMENT_TO_DISCIPLINE[departmentOf(id, members, placeholders) ?? '']
    if (discipline) found.add(discipline)
  }
  return found
}

/** Every discipline represented among a task's assignees, for badges — includes QA. */
export function taskDisciplines(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
  projectMembers: ProjectMember[],
): Discipline[] {
  const found = disciplinesOf(task, members, placeholders, projectMembers)
  return DISCIPLINE_BADGE_ORDER.filter((discipline) => found.has(discipline))
}

/**
 * The section a task groups into — its highest-ranked discipline (a task with
 * both a designer and a frontend dev sits with Design, since Design outranks
 * Frontend), or null when no assignee maps to a ranked discipline.
 *
 * QA never wins placement on its own — a QA task is testing someone else's
 * work, so it belongs with whichever discipline that is (a QA+Backend task
 * places under Backend). A QA-only task has no such signal yet, so — for now
 * — it falls after every named discipline, same as unassigned work.
 */
export function primaryDiscipline(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
  projectMembers: ProjectMember[],
): Discipline | null {
  const found = disciplinesOf(task, members, placeholders, projectMembers)
  return DISCIPLINE_ORDER.find((discipline) => found.has(discipline)) ?? null
}

function disciplineRank(
  task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
  projectMembers: ProjectMember[],
): number {
  const discipline = primaryDiscipline(task, members, placeholders, projectMembers)
  return discipline ? DISCIPLINE_ORDER.indexOf(discipline) : DISCIPLINE_ORDER.length
}

/**
 * Orders a sprint's or epic's task list into the discipline hierarchy: Product
 * first, then Design → Backend → Frontend, each group keeping the tasks'
 * existing relative order. Superseded work still sinks to the bottom.
 *
 * Freshly added work normally floats above the hierarchy for its first week,
 * oldest-of-the-batch first (so a run of tasks added together reads in
 * creation order) — that's meant to spotlight new work against an otherwise
 * settled list. When the *entire* list is fresh (a whole new epic/sprint
 * created at once, spanning every discipline), that contrast doesn't exist —
 * so the hierarchy applies immediately instead.
 */
export function sortTasksByDiscipline(
  tasks: Task[],
  allTasks: Task[],
  taskLinks: TaskLink[],
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
  projectMembers: ProjectMember[],
): Task[] {
  const allFresh = tasks.length > 0 && tasks.every((task) => isFreshTask(task, allTasks))

  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      if (!allFresh) {
        const leftFresh = isFreshTask(left.task, allTasks)
        const rightFresh = isFreshTask(right.task, allTasks)
        if (leftFresh !== rightFresh) return leftFresh ? -1 : 1
        if (leftFresh) return left.task.position - right.task.position
      }

      const leftSuperseded = isSuperseded(left.task.id, taskLinks)
      const rightSuperseded = isSuperseded(right.task.id, taskLinks)
      if (leftSuperseded !== rightSuperseded) return leftSuperseded ? 1 : -1

      const leftRank = disciplineRank(left.task, members, placeholders, projectMembers)
      const rightRank = disciplineRank(right.task, members, placeholders, projectMembers)
      if (leftRank !== rightRank) return leftRank - rightRank

      return left.task.position - right.task.position || left.index - right.index
    })
    .map((entry) => entry.task)
}
