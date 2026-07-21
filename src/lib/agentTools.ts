import type { LLMToolDefinition } from '@/lib/ai'
import type { Epic, IssuePriority, Profile, Sprint, Task } from '@/types'

export interface AgentToolsContext {
  members: Profile[]
  /** Current project's tasks — backs the read-only list_tasks tool so the agent can bulk-edit without being told every id up front. */
  tasks: Task[]
  /** Profile id the agent stamps as reporter/created_by. Null if not provisioned yet. */
  aiAgentProfileId: string | null
  createEpic: (fields: Partial<Epic>) => Promise<Epic | null>
  createSprint: (fields: Partial<Sprint>) => Promise<Sprint | null>
  createTask: (fields: Partial<Task>) => Promise<Task | null>
  updateTask: (id: string, fields: Partial<Task>) => Promise<void>
}

const PRIORITY_VALUES: IssuePriority[] = ['lowest', 'low', 'medium', 'high', 'highest']

// The AI agent's identity is a real profile (see plan doc) resolved by a
// well-known email rather than a hardcoded id, so it survives DB re-seeding.
export const AI_AGENT_EMAIL = 'ai-agent@nojira.internal'

export function findAiAgentProfile(members: Profile[]): Profile | null {
  return members.find((member) => member.email?.toLowerCase() === AI_AGENT_EMAIL) ?? null
}

// Buckets a free-text role (RU/EN) onto the project's standard department
// labels (see DEPARTMENT_OPTIONS in PeoplePage.tsx) so it can be matched
// against a member's `department` field.
const ROLE_KEYWORDS: Array<{ department: string; keywords: string[] }> = [
  { department: 'Frontend', keywords: ['front', 'фронт'] },
  { department: 'Backend', keywords: ['back', 'бэк', 'бек'] },
  { department: 'Design', keywords: ['design', 'дизайн'] },
  { department: 'Quality Assurance', keywords: ['qa', 'quality', 'тест'] },
  { department: 'Product', keywords: ['product', 'продукт'] },
  { department: 'Project Delivery', keywords: ['project', 'проект'] },
]

function memberLabel(member: Profile): string {
  return member.full_name || member.email
}

// A named individual (from the source text) always wins over a department
// bucket — the department is only a fallback for when the source doesn't
// name anyone. Both paths can be ambiguous (two people with similar names,
// or two people sharing a department) — an ambiguous match must NOT silently
// pick the first candidate; it has to come back empty with the candidate
// list so the caller (chat loop or file-import summary) surfaces it instead
// of quietly assigning the wrong person.
export function resolveAssignee(
  identifier: string | undefined,
  role: string | undefined,
  members: Profile[]
): { id: string | null; note: string } {
  if (identifier && identifier.trim()) {
    const normalized = identifier.trim().toLowerCase()
    const exact = members.filter((member) => (
      (member.full_name ?? '').toLowerCase() === normalized || (member.email ?? '').toLowerCase() === normalized
    ))
    const candidates = exact.length
      ? exact
      : normalized.length >= 3
        ? members.filter((member) => (
            (member.full_name ?? '').toLowerCase().includes(normalized) || (member.email ?? '').toLowerCase().includes(normalized)
          ))
        : []

    if (candidates.length === 1) {
      return { id: candidates[0].id, note: ` (исполнитель: ${memberLabel(candidates[0])})` }
    }
    if (candidates.length > 1) {
      const names = candidates.map(memberLabel).join(', ')
      return { id: null, note: ` (имя "${identifier}" неоднозначно — совпало несколько человек: ${names}; исполнитель не назначен)` }
    }
    // Named but nobody matches — fall through to role, but only report the
    // role's own outcome below (the name-not-found case is rare enough not
    // to need its own message, and role may still resolve it correctly).
  }

  if (!role) return { id: null, note: '' }

  const normalizedRole = role.trim().toLowerCase()
  const bucket = ROLE_KEYWORDS.find((entry) => entry.keywords.some((kw) => normalizedRole.includes(kw)))
  if (!bucket) return { id: null, note: ` (роль "${role}" не распознана — исполнитель не назначен)` }

  const matches = members.filter((member) => (member.department ?? '').toLowerCase() === bucket.department.toLowerCase())
  if (matches.length === 0) return { id: null, note: ` (в команде нет участника с ролью "${bucket.department}" — исполнитель не назначен)` }
  if (matches.length > 1) {
    const names = matches.map(memberLabel).join(', ')
    return { id: null, note: ` (в роли "${bucket.department}" несколько человек: ${names} — нужно явно указать имя, исполнитель не назначен)` }
  }

  return { id: matches[0].id, note: ` (исполнитель: ${memberLabel(matches[0])})` }
}

export function getToolDefinitions(): LLMToolDefinition[] {
  return [
    {
      name: 'list_tasks',
      description: 'List existing tasks (id, key, title, description, priority) in the current project, optionally filtered by epic or sprint. Call this before bulk-editing tasks you don\'t already have ids for — do not ask the user to paste ids/titles/descriptions themselves.',
      parameters: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'Only list tasks belonging to this epic (includes tasks in its sprints)' },
          sprint_id: { type: 'string', description: 'Only list tasks in this sprint' },
        },
      },
    },
    {
      name: 'create_epic',
      description: 'Create a new epic in the current project.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Epic title' },
          description: { type: 'string', description: 'Epic description (optional)' },
        },
        required: ['title'],
      },
    },
    {
      name: 'create_sprint',
      description: 'Create a new sprint inside an existing epic.',
      parameters: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'id of the epic this sprint belongs to' },
          name: { type: 'string', description: 'Sprint name' },
          goal: { type: 'string', description: 'Sprint goal (optional)' },
        },
        required: ['epic_id', 'name'],
      },
    },
    {
      name: 'create_task',
      description: 'Create a task, either directly in an epic\'s backlog or inside one of its sprints. Only set due_date if the source material explicitly gives one — never invent one. Only set priority if the source material states it — omit to default to medium.',
      parameters: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'id of the epic this task belongs to' },
          sprint_id: { type: 'string', description: 'id of the sprint this task belongs to (omit to leave it in the epic backlog)' },
          title: { type: 'string', description: 'Task title — preserve any source id/prefix (e.g. "CON-FE-06 - ...") as-is' },
          description: { type: 'string', description: 'Task content/description' },
          priority: { type: 'string', enum: PRIORITY_VALUES, description: 'Only set if explicitly stated in the source' },
          due_date: { type: 'string', description: 'ISO date (YYYY-MM-DD). Only set if explicitly stated in the source' },
          assignee_name: { type: 'string', description: 'Exact name or email of the person to assign, when the source names an individual for this task. Takes priority over role — always prefer this over role when a specific person is named.' },
          role: { type: 'string', description: 'Target role/department for the assignee, e.g. "Frontend", "Backend", "Design" — only use when no specific person is named' },
        },
        required: ['epic_id', 'title'],
      },
    },
    {
      name: 'update_task',
      description: 'Edit an existing task\'s fields.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: PRIORITY_VALUES },
          due_date: { type: 'string' },
          assignee_name: { type: 'string', description: 'Exact name or email of the person to reassign to, when a specific individual is named. Takes priority over role.' },
          role: { type: 'string', description: 'Reassign to whoever holds this role/department — only use when no specific person is named' },
        },
        required: ['task_id'],
      },
    },
  ]
}

// ─── File import ───────────────────────────────────────────────────────────
// .md/.txt files go through the same sequential tool-calling loop as normal
// chat (create_task called once per task, in order) — asking a model to
// echo an entire document's worth of task text into one JSON blob in a
// single generation proved unreliable (truncation, multi-minute stalls).
// .json files are parsed locally (no LLM needed to find the tasks), then
// each item still gets one independent fill_task call to normalize fields.

export interface SplitTasksResult {
  epic?: { existing_epic_id?: string; new_title?: string; new_description?: string }
  sprints?: Array<{ name: string; goal?: string }>
}

export interface FillTaskResult {
  title: string
  description?: string
  priority?: IssuePriority
  due_date?: string
  assignee_name?: string
  role?: string
  sprint_name?: string
}

export function getFillTaskToolDefinition(): LLMToolDefinition {
  return {
    name: 'fill_task',
    description: 'Extract this single task\'s fields from the given block of text. Only use what is literally stated — never invent a priority, due date, or role that isn\'t there.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Preserve any source id/prefix (e.g. "CON-FE-06 - ...") as-is' },
        description: { type: 'string' },
        priority: { type: 'string', enum: PRIORITY_VALUES, description: 'Only if explicitly stated' },
        due_date: { type: 'string', description: 'ISO date (YYYY-MM-DD), only if explicitly stated' },
        assignee_name: { type: 'string', description: 'Exact name or email of the person this block names for the task. Takes priority over role — always prefer this over role when a specific person is named.' },
        role: { type: 'string', description: 'Target role/department for the assignee, e.g. "Frontend", "Backend", "Design" — only use when no specific person is named' },
        sprint_name: { type: 'string', description: 'Must match one of the known sprint names — omit to leave the task in the epic backlog' },
      },
      required: ['title'],
    },
  }
}

/** Runs `fn` over `items` with at most `limit` concurrent in-flight calls. `fn` should not throw — catch internally so one failure doesn't affect the others. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function executeTool(name: string, argsJson: string, ctx: AgentToolsContext): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return `Error: could not parse arguments for ${name}`
  }

  const reporterFields = ctx.aiAgentProfileId ? { reporter_id: ctx.aiAgentProfileId } : {}

  if (name === 'list_tasks') {
    const epicId = typeof args.epic_id === 'string' ? args.epic_id : undefined
    const sprintId = typeof args.sprint_id === 'string' ? args.sprint_id : undefined

    const matches = ctx.tasks.filter((task) => {
      if (sprintId) return task.sprint_id === sprintId
      if (epicId) return task.epic_id === epicId
      return true
    })

    if (!matches.length) return 'No tasks found for that filter.'

    return JSON.stringify(matches.map((task) => ({
      id: task.id,
      key: task.key,
      title: task.title,
      description: task.description,
      priority: task.priority,
    })))
  }

  if (name === 'create_epic') {
    const epic = await ctx.createEpic({
      title: String(args.title ?? ''),
      description: typeof args.description === 'string' ? args.description : '',
      created_by: ctx.aiAgentProfileId ?? undefined,
    })
    if (!epic) return 'Error: failed to create epic'
    return `Created epic "${epic.title}" — id=${epic.id}, key=${epic.key}`
  }

  if (name === 'create_sprint') {
    const sprint = await ctx.createSprint({
      epic_id: String(args.epic_id ?? ''),
      name: String(args.name ?? ''),
      goal: typeof args.goal === 'string' ? args.goal : '',
      created_by: ctx.aiAgentProfileId ?? undefined,
    })
    if (!sprint) return 'Error: failed to create sprint'
    return `Created sprint "${sprint.name}" — id=${sprint.id}`
  }

  if (name === 'create_task') {
    const { id: assigneeId, note } = resolveAssignee(
      typeof args.assignee_name === 'string' ? args.assignee_name : undefined,
      typeof args.role === 'string' ? args.role : undefined,
      ctx.members,
    )
    const priority = PRIORITY_VALUES.includes(args.priority as IssuePriority) ? (args.priority as IssuePriority) : undefined

    const task = await ctx.createTask({
      epic_id: String(args.epic_id ?? ''),
      sprint_id: typeof args.sprint_id === 'string' ? args.sprint_id : null,
      title: String(args.title ?? ''),
      description: typeof args.description === 'string' ? args.description : '',
      priority,
      due_date: typeof args.due_date === 'string' ? args.due_date : null,
      assignee_id: assigneeId,
      ...reporterFields,
    })
    if (!task) return 'Error: failed to create task'
    return `Created task "${task.title}" — id=${task.id}, key=${task.key}${note}`
  }

  if (name === 'update_task') {
    const taskId = String(args.task_id ?? '')
    if (!taskId) return 'Error: task_id is required'

    const fields: Partial<Task> = {}
    if (typeof args.title === 'string') fields.title = args.title
    if (typeof args.description === 'string') fields.description = args.description
    if (PRIORITY_VALUES.includes(args.priority as IssuePriority)) fields.priority = args.priority as IssuePriority
    if (typeof args.due_date === 'string') fields.due_date = args.due_date

    let note = ''
    if (typeof args.assignee_name === 'string' || typeof args.role === 'string') {
      const resolved = resolveAssignee(
        typeof args.assignee_name === 'string' ? args.assignee_name : undefined,
        typeof args.role === 'string' ? args.role : undefined,
        ctx.members,
      )
      if (resolved.id) fields.assignee_id = resolved.id
      note = resolved.note
    }

    await ctx.updateTask(taskId, fields)
    return `Updated task ${taskId}${note}`
  }

  return `Error: unknown tool "${name}"`
}
