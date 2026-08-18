import { isFreshTask, isSuperseded } from './ops'
import { canManageProject } from './permissions'
import { MAP_DISCIPLINES } from '@/types'
import type { JiraUserPlaceholder, MapDiscipline, Profile, ProjectMapBlock, ProjectMember, Task, TaskLink } from '@/types'

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

/**
 * A person's own Project Map branch, or null when their department maps to no
 * branch (unset, Product, Executive Leadership, Project Delivery). Mirrors
 * map_discipline_for_department() in the DB — keep both in step.
 */
export function mapDisciplineForDepartment(department: string | null | undefined): MapDiscipline | null {
  switch ((department ?? '').trim()) {
    case 'Design': return 'design'
    case 'Backend': return 'backend'
    case 'Frontend': return 'frontend'
    case 'Quality Assurance': return 'qa'
    default: return null
  }
}

/**
 * Every branch a person may act in — their primary department plus any
 * additional ones, for people holding combined roles (backend + frontend, say).
 * Mirrors map_disciplines_for_profile() in the DB.
 */
export function mapDisciplinesForProfile(
  profile: Pick<Profile, 'department' | 'additional_departments'> | null | undefined,
): MapDiscipline[] {
  if (!profile) return []
  const found = new Set<MapDiscipline>()
  for (const department of [profile.department, ...(profile.additional_departments ?? [])]) {
    const discipline = mapDisciplineForDepartment(department)
    if (discipline) found.add(discipline)
  }
  return MAP_DISCIPLINES.filter((discipline) => found.has(discipline))
}

/**
 * Whether someone may raise a question on a specific block.
 *
 * Unrestricted: the global super admin and the project's owner/admin/founder/ceo
 * — the tier that curates the map's blocks, none of whom has a branch of their
 * own. A normal block needs the matching discipline.
 *
 * QA is cross-cutting: a QA block belongs to testers *and* to whoever's work it
 * covers, since QA of the backend concerns the backend devs. A QA block that
 * hasn't declared its coverage is open to anyone holding any discipline —
 * undeclared means "we don't know whose work yet", which is closer to everyone
 * than to nobody.
 *
 * Mirrors can_ask_in_map_block() in the DB, which is the real enforcement; this
 * is the UI-gating half. AI agents pass through neither — they write over MCP
 * as service_role.
 */
export function canAskInMapBlock(
  block: Pick<ProjectMapBlock, 'discipline' | 'covers_discipline'>,
  profile: Pick<Profile, 'role' | 'department' | 'additional_departments'> | null | undefined,
  projectRole: ProjectMember['project_role'] | null,
): boolean {
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (canManageProject(projectRole)) return true

  const own = mapDisciplinesForProfile(profile)
  if (block.discipline === 'qa') {
    if (own.includes('qa')) return true
    if (block.covers_discipline) return own.includes(block.covers_discipline)
    return own.length > 0
  }
  return own.includes(block.discipline)
}

function taskAssigneeIds(task: Pick<Task, 'assignee_ids' | 'assignee_id' | 'assignee_placeholder_id'>): string[] {
  if (task.assignee_ids.length > 0) return task.assignee_ids
  if (task.assignee_id) return [task.assignee_id]
  if (task.assignee_placeholder_id) return [task.assignee_placeholder_id]
  return []
}

/** Every department a person holds — combined roles included. Placeholders only ever have one. */
function departmentsOf(id: string, members: Profile[], placeholders: JiraUserPlaceholder[]): string[] {
  const member = members.find((m) => m.id === id)
  if (member) return [member.department, ...(member.additional_departments ?? [])].filter(Boolean)
  const placeholder = placeholders.find((p) => p.id === id)
  return placeholder?.department ? [placeholder.department] : []
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
    for (const department of departmentsOf(id, members, placeholders)) {
      const discipline = DEPARTMENT_TO_DISCIPLINE[department]
      if (discipline) found.add(discipline)
    }
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
