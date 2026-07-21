import { create } from 'zustand'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { getErrorMessage } from '@/lib/errors'
import { isTaskBlocked } from '@/lib/ops'
import { dedupeRecipients } from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import { EPIC_COLORS } from '@/types'
import type {
  ActivityEvent,
  ActivityEventType,
  AttachmentNote,
  DeletionRequest,
  DeletionRequestEntityType,
  Epic,
  JiraUserPlaceholder,
  Notification,
  NotificationType,
  PortfolioItem,
  Profile,
  Project,
  ProjectAutomationSettings,
  ProjectInvite,
  ProjectMember,
  ProjectRole,
  ProjectWebhook,
  Sprint,
  TaskActivity,
  TaskComment,
  Task,
  TaskLink,
  TaskLinkType,
  TaskStatus,
  WebhookEvent,
} from '@/types'

const TASK_SELECT = `
  *,
  epic:epics(*),
  assignee:profiles!tasks_assignee_id_fkey(*),
  reporter:profiles!tasks_reporter_id_fkey(*)
`

const ACTIVITY_EVENT_SELECT = `
  id, project_id, profile_id, event_type, task_id, detail, created_at,
  profile:profiles(id, full_name, email),
  task:tasks(id, key, title)
`

// PostgREST caps a plain select at its configured max-rows (1000 by default),
// silently hiding rows past that. We page through with a range so there is no
// task limit. The first page reveals the server's real cap (the range is clamped
// to it), which we then use as the page size — robust whatever the cap is set to.
const TASK_PAGE_SIZE = 1000

async function fetchAllTasks(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: Task[] | null }> },
): Promise<Task[]> {
  const all: Task[] = []
  let page = TASK_PAGE_SIZE
  for (let from = 0; ; from += page) {
    const { data } = await makeQuery().range(from, from + page - 1)
    const rows = (data ?? []) as Task[]
    all.push(...rows)
    if (from === 0 && rows.length > 0) page = rows.length
    if (rows.length < page) break
  }
  return all
}

const PROJECT_ACCESS_SELECT = `
  id,
  project_id,
  profile_id,
  project_role,
  created_at,
  project:projects(*)
`

const PROJECT_MEMBER_SELECT = `
  id,
  project_id,
  profile_id,
  project_role,
  created_at,
  profile:profiles(*)
`

const TASK_COMMENT_SELECT = `
  *,
  author:profiles(*)
`

const TASK_ACTIVITY_SELECT = `
  *,
  actor:profiles(*)
`

const TASK_LINK_SELECT = `
  *,
  source_task:tasks!task_links_source_task_id_fkey(id, key, title, status, assignee_id),
  target_task:tasks!task_links_target_task_id_fkey(id, key, title, status, assignee_id)
`

const NOTIFICATION_SELECT = `
  *,
  task:tasks(id, key, title, status, assignee_id)
`

const DELETION_REQUEST_SELECT = `
  *,
  requester:profiles(*),
  project:projects(id, key, name)
`

const ACTIVE_PROJECT_STORAGE_KEY = 'qira-active-project-id'

export interface ApprovalNotificationResponse {
  status: string
  message: string | null
  sentAt: string | null
}

async function getFunctionErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const payload = await error.context.clone().json() as { message?: string | null, error?: string | null }
      if (payload.message) return payload.message
      if (payload.error) return payload.error
    } catch {
      // Fall through to text parsing.
    }

    try {
      const text = (await error.context.clone().text()).trim()
      if (text) return text
    } catch {
      // Fall through to the generic error message.
    }
  }

  if (error instanceof Error) return error.message
  return String(error)
}

function replaceTask(tasks: Task[], nextTask: Task) {
  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
}

function unwrapRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null
  return (value ?? null) as T | null
}

function normalizeProjectAccess(rows: unknown[]) {
  return rows.map((row) => {
    const entry = row as ProjectMember & { project?: Project | Project[] | null }
    return { ...entry, project: unwrapRelation<Project>(entry.project) }
  }) as ProjectMember[]
}

function normalizeProjectMembers(rows: unknown[]) {
  return rows.map((row) => {
    const entry = row as ProjectMember & { profile?: Profile | Profile[] | null }
    return { ...entry, profile: unwrapRelation<Profile>(entry.profile) }
  }) as ProjectMember[]
}

function normalizeTaskLinks(rows: unknown[]) {
  return rows.map((row) => {
    const entry = row as TaskLink & {
      source_task?: TaskLink['source_task'] | TaskLink['source_task'][] | null
      target_task?: TaskLink['target_task'] | TaskLink['target_task'][] | null
    }

    return {
      ...entry,
      source_task: unwrapRelation<TaskLink['source_task']>(entry.source_task),
      target_task: unwrapRelation<TaskLink['target_task']>(entry.target_task),
    }
  }) as TaskLink[]
}

function normalizeNotifications(rows: unknown[]) {
  return rows.map((row) => {
    const entry = row as Notification & { task?: Notification['task'] | Notification['task'][] | null }
    return { ...entry, task: unwrapRelation<Notification['task']>(entry.task) }
  }) as Notification[]
}

function normalizeDeletionRequests(rows: unknown[]) {
  return rows.map((row) => {
    const entry = row as DeletionRequest & {
      requester?: Profile | Profile[] | null
      project?: DeletionRequest['project'] | DeletionRequest['project'][] | null
    }

    return {
      ...entry,
      requester: unwrapRelation<Profile>(entry.requester),
      project: unwrapRelation<DeletionRequest['project']>(entry.project),
    }
  }) as DeletionRequest[]
}

function normalizeTaskHierarchy(
  fields: Partial<Task>,
  sprints: Sprint[],
  currentTask?: Task | null
) {
  const nextFields = { ...fields }
  const hasSprintField = Object.prototype.hasOwnProperty.call(fields, 'sprint_id')
  const sprintId = hasSprintField
    ? (fields.sprint_id ?? null)
    : (currentTask?.sprint_id ?? null)
  const sprint = sprintId
    ? (sprints.find((entry) => entry.id === sprintId) ?? null)
    : null

  if (sprint) {
    nextFields.sprint_id = sprint.id
    nextFields.epic_id = sprint.epic_id ?? null
    return nextFields
  }

  if (hasSprintField) {
    nextFields.sprint_id = null
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'epic_id')) {
    nextFields.epic_id = fields.epic_id ?? null
  }

  return nextFields
}

function uniqueProjects(memberships: ProjectMember[]) {
  return memberships
    .map((membership) => membership.project)
    .filter((project): project is Project => Boolean(project))
}

function buildProjectKey(name: string, projects: Project[]) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6) || 'PRJ'

  let candidate = base
  let index = 2
  const usedKeys = new Set(projects.map((project) => project.key))

  while (usedKeys.has(candidate)) {
    candidate = `${base}${index}`
    index += 1
  }

  return candidate
}

type ProjectAttachmentPathRow = {
  path: string | null
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function readStoredActiveProjectId() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)
}

function storeActiveProjectId(projectId: string | null) {
  if (typeof window === 'undefined') return

  if (projectId) {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId)
    return
  }

  window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
}

function normalizeTextValue(value: unknown) {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined || value === '') return 'none'
  return String(value)
}

function buildTaskUpdateMessages(previousTask: Task, nextTask: Task, changedFields: Partial<Task>) {
  const messages: string[] = []
  const meaningfulChangedFields = Object.keys(changedFields).filter((field) => field !== 'position')

  if (changedFields.status && previousTask.status !== nextTask.status) {
    messages.push(`Status changed from ${normalizeTextValue(previousTask.status)} to ${normalizeTextValue(nextTask.status)}`)
  }

  if ('assignee_id' in changedFields && previousTask.assignee_id !== nextTask.assignee_id) {
    messages.push(`Assignee changed from ${normalizeTextValue(previousTask.assignee?.full_name || previousTask.assignee?.email)} to ${normalizeTextValue(nextTask.assignee?.full_name || nextTask.assignee?.email)}`)
  }

  if (changedFields.priority && previousTask.priority !== nextTask.priority) {
    messages.push(`Priority changed from ${normalizeTextValue(previousTask.priority)} to ${normalizeTextValue(nextTask.priority)}`)
  }

  if ('due_date' in changedFields && previousTask.due_date !== nextTask.due_date) {
    messages.push(`Due date changed from ${normalizeTextValue(previousTask.due_date)} to ${normalizeTextValue(nextTask.due_date)}`)
  }

  if ('sprint_id' in changedFields && previousTask.sprint_id !== nextTask.sprint_id) {
    messages.push(`Sprint changed from ${normalizeTextValue(previousTask.sprint_id)} to ${normalizeTextValue(nextTask.sprint_id)}`)
  }

  if ('epic_id' in changedFields && previousTask.epic_id !== nextTask.epic_id) {
    messages.push(`Epic changed from ${normalizeTextValue(previousTask.epic?.title)} to ${normalizeTextValue(nextTask.epic?.title)}`)
  }

  if (changedFields.title && previousTask.title !== nextTask.title) {
    messages.push('Summary updated')
  }

  if ('description' in changedFields && previousTask.description !== nextTask.description) {
    messages.push('Description updated')
  }

  if ('labels' in changedFields && previousTask.labels.join('|') !== nextTask.labels.join('|')) {
    messages.push(`Labels changed from ${normalizeTextValue(previousTask.labels)} to ${normalizeTextValue(nextTask.labels)}`)
  }

  if (!messages.length && meaningfulChangedFields.length > 0) {
    messages.push('Issue details updated')
  }

  return messages
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function signWebhookPayload(secret: string, body: string) {
  if (!secret.trim() || typeof crypto === 'undefined' || !crypto.subtle) return ''

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return toHex(signature)
}

const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'task.created': '🆕 created',
  'task.updated': '✏️ updated',
  'task.completed': '✅ done',
  'task.unblocked': '🔓 unblocked',
}

/** Short human-readable line for Discord/Slack messages. */
function buildWebhookSummary(event: WebhookEvent, payload: unknown): string {
  const p = (payload ?? {}) as { task?: { key?: string; title?: string }; comment?: string }
  const key = p.task?.key ? `[${p.task.key}] ` : ''
  const title = p.task?.title ?? ''
  let line = `${WEBHOOK_EVENT_LABELS[event] ?? event}: ${key}${title}`.trim()
  if (p.comment) line += `\n💬 ${String(p.comment).slice(0, 300)}`
  return line
}

async function postWebhook(event: WebhookEvent, webhook: ProjectWebhook, payload: unknown) {
  const body = JSON.stringify(payload)
  const signature = await signWebhookPayload(webhook.secret, body)
  const response = await fetch(webhook.endpoint_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Qira-Event': event,
      ...(signature ? { 'X-Qira-Signature': signature } : {}),
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
}

interface AppState {
  profile: Profile | null
  projects: Project[]
  workspaceProjects: Project[]
  assignableProfiles: Profile[]
  projectMemberships: ProjectMember[]
  projectMembers: ProjectMember[]
  projectInvites: ProjectInvite[]
  deletionRequests: DeletionRequest[]
  portfolioItems: PortfolioItem[]
  automationSettings: ProjectAutomationSettings | null
  projectWebhooks: ProjectWebhook[]
  taskLinks: TaskLink[]
  attachmentNotes: Record<string, AttachmentNote>
  activityEvents: ActivityEvent[]
  notifications: Notification[]
  taskComments: TaskComment[]
  taskActivities: TaskActivity[]
  tasks: Task[]
  sprints: Sprint[]
  epics: Epic[]
  members: Profile[]
  placeholders: JiraUserPlaceholder[]
  pendingMembers: Profile[]
  loadingProjects: boolean
  /** Non-terminal task count for the active project (independent of what's loaded). */
  projectTaskCount: number
  loadingBoard: boolean
  loadingBacklog: boolean
  activeProjectId: string | null
  activeProjectRole: ProjectRole | null
  activeSprintId: string | null
  openTaskId: string | null
  selectedTaskIds: string[]
  toggleTaskSelection: (id: string) => void
  clearTaskSelection: () => void
  bulkUpdateTasks: (fields: Partial<Task>) => Promise<void>
  setProfile: (profile: Profile | null) => void
  setOpenTaskId: (id: string | null) => void
  /** Transient toast surfaced to the user (e.g. a save failure and its reason). */
  toast: { id: number; message: string; kind: 'error' | 'success' } | null
  notify: (message: string, kind?: 'error' | 'success') => void
  dismissToast: () => void
  setActiveSprintId: (id: string | null) => void
  setActiveProjectId: (id: string | null) => void
  fetchProjects: () => Promise<void>
  fetchWorkspaceProjects: () => Promise<void>
  fetchAssignableProfiles: () => Promise<void>
  fetchBoard: (sprintId: string) => Promise<void>
  fetchBacklog: () => Promise<void>
  fetchSprints: () => Promise<void>
  fetchEpics: () => Promise<void>
  fetchMembers: () => Promise<void>
  fetchProjectTaskCount: () => Promise<void>
  fetchPlaceholders: () => Promise<void>
  deletePlaceholder: (id: string) => Promise<void>
  fetchProjectInvites: () => Promise<void>
  fetchPortfolioItems: () => Promise<void>
  fetchAutomationSettings: () => Promise<void>
  fetchProjectWebhooks: () => Promise<void>
  fetchTaskLinks: () => Promise<void>
  fetchAttachmentNotes: () => Promise<void>
  updateAttachmentNote: (path: string, body: string) => Promise<void>
  recordAttachmentOriginalName: (projectId: string, path: string, originalName: string, mimeType?: string | null) => Promise<void>
  fetchActivityEvents: () => Promise<void>
  logActivityEvent: (eventType: ActivityEventType, options?: { taskId?: string | null; detail?: string | null }) => Promise<void>
  fetchNotifications: () => Promise<void>
  fetchTaskContext: (taskId: string) => Promise<void>
  clearTaskContext: () => void
  createProject: (fields: Pick<Project, 'name' | 'description'> & { key?: string }) => Promise<Project | null>
  createPortfolioItem: (fields: Partial<PortfolioItem>) => Promise<PortfolioItem | null>
  createTask: (fields: Partial<Task>) => Promise<Task | null>
  createSubtask: (parentTaskId: string, title: string) => Promise<Task | null>
  createTaskComment: (taskId: string, body: string, attachments?: string[], mentionedProfileIds?: string[]) => Promise<void>
  createTaskLink: (sourceTaskId: string, targetTaskId: string, linkType: TaskLinkType) => Promise<TaskLink | null>
  createProjectWebhook: (fields: Pick<ProjectWebhook, 'name' | 'endpoint_url' | 'events' | 'secret' | 'webhook_type'>) => Promise<ProjectWebhook | null>
  testProjectWebhook: (webhook: ProjectWebhook) => Promise<{ ok: boolean; error?: string }>
  deleteTaskComment: (commentId: string) => Promise<void>
  deleteTaskLink: (id: string) => Promise<void>
  updateTask: (id: string, fields: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  moveTask: (taskId: string, toStatus: TaskStatus, toIndex: number) => Promise<void>
  patchTask: (id: string, fields: Partial<Task>) => void
  createSprint: (fields: Partial<Sprint>) => Promise<Sprint | null>
  updateSprint: (id: string, fields: Partial<Sprint>) => Promise<void>
  startSprint: (id: string) => Promise<void>
  completeSprint: (id: string) => Promise<void>
  deleteSprint: (id: string, options?: { withTasks?: boolean }) => Promise<void>
  createEpic: (fields: Partial<Epic>) => Promise<Epic | null>
  updateEpic: (id: string, fields: Partial<Epic>) => Promise<void>
  reassignAuthor: (epicId: string, toProfileId: string) => Promise<void>
  deleteEpic: (id: string, options?: { withTasks?: boolean }) => Promise<void>
  convertSprintToEpic: (sprintId: string) => Promise<Epic | null>
  convertEpicToSprint: (epicId: string) => Promise<Sprint | null>
  updatePortfolioItem: (id: string, fields: Partial<PortfolioItem>) => Promise<void>
  updateAutomationSettings: (fields: Partial<ProjectAutomationSettings>) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  addProfileToProject: (profileId: string, role: ProjectRole) => Promise<void>
  fetchDeletionRequests: () => Promise<void>
  requestEntityDeletion: (entityType: DeletionRequestEntityType, entityId: string, entityLabel: string) => Promise<void>
  resolveDeletionRequest: (requestId: string, resolution: 'approved' | 'rejected') => Promise<void>
  deleteProjectWebhook: (id: string) => Promise<void>
  markNotificationRead: (id: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  updateProfile: (id: string, fields: Partial<Profile>) => Promise<void>
  updateProjectMemberRole: (membershipId: string, role: ProjectRole) => Promise<void>
  removeProjectMember: (profileId: string) => Promise<void>
  inviteToProject: (email: string, role: ProjectRole, message?: string | null) => Promise<{ emailSent: boolean } | null>
  cancelInvite: (inviteId: string) => Promise<void>
  invitePlaceholder: (placeholderId: string, email: string, role: ProjectRole) => Promise<{ emailSent: boolean } | null>
  linkPlaceholder: (placeholderId: string, profileId: string) => Promise<void>
  acceptPlaceholder: (placeholderId: string) => Promise<void>
  updatePlaceholder: (placeholderId: string, fields: Partial<JiraUserPlaceholder>) => Promise<void>
  fetchPendingMembers: () => Promise<void>
  approveMember: (profileId: string) => Promise<void>
  declineMember: (profileId: string) => Promise<void>
  requestAccessAgain: () => Promise<void>
  triggerApprovalNotification: (options?: { profileId?: string, force?: boolean }) => Promise<ApprovalNotificationResponse | null>
}

export const useStore = create<AppState>((set, get) => {
  const deliverProjectWebhooks = async (event: WebhookEvent, payload: unknown, taskId?: string | null) => {
    const activeProjectId = get().activeProjectId
    const profile = get().profile
    const matchingWebhooks = get().projectWebhooks.filter((webhook) => webhook.is_active && webhook.events.includes(event))

    if (!activeProjectId || matchingWebhooks.length === 0) return

    const failures: string[] = []
    for (const webhook of matchingWebhooks) {
      try {
        if (webhook.webhook_type === 'discord' || webhook.webhook_type === 'slack') {
          // Browser can't POST to Discord/Slack (CORS) — relay server-side.
          const { data, error } = await supabase.functions.invoke('notify-webhook', {
            body: { webhook_id: webhook.id, event, summary: buildWebhookSummary(event, payload) },
          })
          if (error) throw error
          const res = data as { ok?: boolean; status?: number; error?: string } | null
          if (res && res.ok === false) throw new Error(res.status ? `HTTP ${res.status}` : (res.error ?? 'delivery failed'))
        } else {
          await postWebhook(event, webhook, payload)
        }
      } catch (error) {
        failures.push(`${webhook.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (!failures.length || !profile) return

    await supabase.from('notifications').insert({
      project_id: activeProjectId,
      profile_id: profile.id,
      task_id: taskId ?? null,
      notification_type: 'system',
      title: 'Webhook delivery failed',
      body: failures.join(' | '),
    })

    await get().fetchNotifications()
  }

  // Fans a notification out to recipients: an in-app row (real-time, via the
  // existing notifications table/bell) plus a best-effort email. Email
  // failures never block the in-app notification, which has already landed
  // by the time the edge function is invoked.
  const notifyRecipients = async (
    recipientIds: string[],
    opts: { projectId: string; taskId: string | null; notificationType: NotificationType; title: string; body: string },
  ) => {
    if (!recipientIds.length) return
    const { projectId, taskId, notificationType, title, body } = opts

    await supabase.from('notifications').insert(
      recipientIds.map((profileId) => ({
        project_id: projectId,
        profile_id: profileId,
        task_id: taskId,
        notification_type: notificationType,
        title,
        body,
      })),
    )

    try {
      await supabase.functions.invoke('send-task-notification', {
        body: { recipient_ids: recipientIds, project_id: projectId, task_id: taskId, subject: title, body_text: body },
      })
    } catch {
      // Best-effort: the in-app notification already landed above.
    }
  }

  return ({
    profile: null,
    projects: [],
    workspaceProjects: [],
    assignableProfiles: [],
    projectMemberships: [],
    projectMembers: [],
    projectInvites: [],
    deletionRequests: [],
    portfolioItems: [],
    automationSettings: null,
    projectWebhooks: [],
    taskLinks: [],
    attachmentNotes: {},
    activityEvents: [],
    notifications: [],
    taskComments: [],
    taskActivities: [],
    tasks: [],
    sprints: [],
    epics: [],
    members: [],
    placeholders: [],
    selectedTaskIds: [],
    pendingMembers: [],
    loadingProjects: false,
    projectTaskCount: 0,
    loadingBoard: false,
    loadingBacklog: false,
    activeProjectId: readStoredActiveProjectId(),
    activeProjectRole: null,
    activeSprintId: null,
    openTaskId: null,

  setProfile: (profile) => set((state) => ({
    profile,
    workspaceProjects: profile?.role === 'admin' ? state.workspaceProjects : [],
    deletionRequests: profile?.role === 'admin' ? state.deletionRequests : [],
  })),
  setOpenTaskId: (openTaskId) => set({ openTaskId }),
  toast: null,
  notify: (message, kind = 'error') => set({ toast: { id: Date.now(), message, kind } }),
  dismissToast: () => set({ toast: null }),
  setActiveSprintId: (activeSprintId) => set({ activeSprintId }),

  toggleTaskSelection: (id) =>
    set((state) => ({
      selectedTaskIds: state.selectedTaskIds.includes(id)
        ? state.selectedTaskIds.filter((value) => value !== id)
        : [...state.selectedTaskIds, id],
    })),

  clearTaskSelection: () => set({ selectedTaskIds: [] }),

  bulkUpdateTasks: async (fields) => {
    const ids = get().selectedTaskIds
    if (!ids.length) return
    const sprints = get().sprints

    // When moving to a sprint, inherit the sprint's epic (mirrors single update).
    const resolved: Partial<Task> = { ...fields }
    if (Object.prototype.hasOwnProperty.call(fields, 'sprint_id')) {
      const sprint = fields.sprint_id ? sprints.find((s) => s.id === fields.sprint_id) ?? null : null
      resolved.epic_id = sprint ? (sprint.epic_id ?? null) : (fields.epic_id ?? null)
    }

    const idSet = new Set(ids)
    set((state) => ({ tasks: state.tasks.map((task) => (idSet.has(task.id) ? { ...task, ...resolved } : task)) }))

    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map((id) => supabase.from('tasks').update(resolved).eq('id', id)))
    }
    // Refetch so joined assignee/reporter reflect bulk changes.
    await get().fetchBacklog()
  },
  setActiveProjectId: (activeProjectId) => {
    const membership = get().projectMemberships.find((item) => item.project_id === activeProjectId)
    storeActiveProjectId(activeProjectId)
    set({
      activeProjectId,
      activeProjectRole: membership?.project_role ?? null,
        activeSprintId: null,
        openTaskId: null,
        tasks: [],
        sprints: [],
        epics: [],
        portfolioItems: [],
        automationSettings: null,
        projectWebhooks: [],
        taskLinks: [],
        attachmentNotes: {},
        activityEvents: [],
        notifications: [],
        members: [],
        placeholders: [],
        selectedTaskIds: [],
        projectMembers: [],
        projectInvites: [],
        assignableProfiles: [],
        taskComments: [],
        taskActivities: [],
    })
  },

  fetchProjects: async () => {
    const profile = get().profile
    const { data: { user } } = await supabase.auth.getUser()
    const profileId = profile?.id ?? user?.id ?? null

    if (!profileId) {
      set({
        projects: [],
        workspaceProjects: [],
        assignableProfiles: [],
        projectMemberships: [],
        activeProjectId: null,
        activeProjectRole: null,
        deletionRequests: profile?.role === 'admin' ? get().deletionRequests : [],
        loadingProjects: false,
      })
      return
    }

    set({ loadingProjects: true })
    let memberships: ProjectMember[] = []
    let projects: Project[] = []

    if (profile?.role === 'admin') {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .order('created_at')

      projects = (data ?? []) as Project[]
      memberships = projects.map((project) => ({
        id: `admin-${project.id}`,
        project_id: project.id,
        profile_id: profileId,
        project_role: 'owner',
        created_at: project.created_at,
        project,
        profile,
      }))
    } else {
      const { data } = await supabase
        .from('project_members')
        .select(PROJECT_ACCESS_SELECT)
        .eq('profile_id', profileId)
        .order('created_at')

      memberships = normalizeProjectAccess((data ?? []) as unknown[])
      projects = uniqueProjects(memberships)
    }

    const storedActiveProjectId = readStoredActiveProjectId()
    const currentProjectExists = projects.some((project) => project.id === get().activeProjectId)
    const storedProjectExists = projects.some((project) => project.id === storedActiveProjectId)
    const nextActiveProjectId = currentProjectExists
      ? get().activeProjectId
      : storedProjectExists
        ? storedActiveProjectId
      : (projects[0]?.id ?? null)
    const nextRole = memberships.find((item) => item.project_id === nextActiveProjectId)?.project_role ?? null
    storeActiveProjectId(nextActiveProjectId)

    set({
      projects,
      workspaceProjects: profile?.role === 'admin' ? projects : [],
      projectMemberships: memberships,
      activeProjectId: nextActiveProjectId,
      activeProjectRole: nextRole,
      loadingProjects: false,
    })
  },

  fetchWorkspaceProjects: async () => {
    const profile = get().profile
    if (profile?.role !== 'admin') {
      set({ workspaceProjects: [] })
      return
    }

    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    set({ workspaceProjects: (data ?? []) as Project[] })
  },

  fetchAssignableProfiles: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ assignableProfiles: [] })
      return
    }

    const { data } = await supabase.rpc('list_assignable_profiles', {
      project_uuid: activeProjectId,
    })

    set({ assignableProfiles: (data ?? []) as Profile[] })
  },

  fetchDeletionRequests: async () => {
    const profile = get().profile
    if (profile?.role !== 'admin') {
      set({ deletionRequests: [] })
      return
    }

    const { data } = await supabase
      .from('deletion_requests')
      .select(DELETION_REQUEST_SELECT)
      .order('created_at', { ascending: false })

    set({ deletionRequests: normalizeDeletionRequests((data ?? []) as unknown[]) })
  },

  fetchBoard: async (sprintId) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ tasks: [], loadingBoard: false })
      return
    }

    set({ loadingBoard: true })
    const tasks = await fetchAllTasks(() =>
      supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('project_id', activeProjectId)
        .eq('sprint_id', sprintId)
        .order('status')
        .order('position'),
    )

    set({ tasks, loadingBoard: false })
  },

  fetchBacklog: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ tasks: [], loadingBacklog: false })
      return
    }

    set({ loadingBacklog: true })
    const tasks = await fetchAllTasks(() =>
      supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('project_id', activeProjectId)
        .order('sprint_id', { ascending: true, nullsFirst: true })
        .order('position')
        .order('created_at'),
    )

    set({ tasks, loadingBacklog: false })
  },

  fetchSprints: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ sprints: [] })
      return
    }

    const { data } = await supabase
      .from('sprints')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('created_at')

    if (data) set({ sprints: data as Sprint[] })
  },

  fetchEpics: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ epics: [] })
      return
    }

    const { data } = await supabase
      .from('epics')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('created_at')

    if (data) set({ epics: data as Epic[] })
  },

  fetchProjectTaskCount: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ projectTaskCount: 0 })
      return
    }
    // Count on the server — the loaded `tasks` list depends on the current page
    // (the board only holds one sprint), so it can't be used for a project total.
    const { count } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', activeProjectId)
      .not('status', 'in', '(cancelled,archived,deleted)')

    set({ projectTaskCount: count ?? 0 })
  },

  fetchMembers: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ members: [], projectMembers: [] })
      return
    }

    const { data } = await supabase
      .from('project_members')
      .select(PROJECT_MEMBER_SELECT)
      .eq('project_id', activeProjectId)
      .order('created_at')

    const projectMembers = normalizeProjectMembers((data ?? []) as unknown[])
    const members = projectMembers
      .map((item) => item.profile)
      .filter((profile): profile is Profile => Boolean(profile))

    set({ projectMembers, members })
  },

  fetchPlaceholders: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ placeholders: [] })
      return
    }
    const { data } = await supabase
      .from('project_member_placeholders')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('display_name')
    set({ placeholders: (data ?? []) as JiraUserPlaceholder[] })
  },

  deletePlaceholder: async (id) => {
    const { error } = await supabase.from('project_member_placeholders').delete().eq('id', id)
    if (error) throw error
    // The FK is ON DELETE SET NULL, so unassign locally to match the DB.
    set((state) => ({
      placeholders: state.placeholders.filter((placeholder) => placeholder.id !== id),
      tasks: state.tasks.map((task) => ({
        ...task,
        assignee_placeholder_id: task.assignee_placeholder_id === id ? null : task.assignee_placeholder_id,
        reporter_placeholder_id: task.reporter_placeholder_id === id ? null : task.reporter_placeholder_id,
      })),
    }))
  },

  fetchProjectInvites: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ projectInvites: [] })
      return
    }

    const { data } = await supabase
      .from('project_invites')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('created_at', { ascending: false })

    if (data) set({ projectInvites: data as ProjectInvite[] })
  },

  fetchPortfolioItems: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ portfolioItems: [] })
      return
    }

    const { data } = await supabase
      .from('portfolio_items')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('position')
      .order('created_at')

    set({ portfolioItems: (data ?? []) as PortfolioItem[] })
  },

  fetchAutomationSettings: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ automationSettings: null })
      return
    }

    const { data } = await supabase
      .from('project_automation_settings')
      .select('*')
      .eq('project_id', activeProjectId)
      .maybeSingle()

    set({ automationSettings: (data ?? null) as ProjectAutomationSettings | null })
  },

  fetchProjectWebhooks: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ projectWebhooks: [] })
      return
    }

    const { data } = await supabase
      .from('project_webhooks')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('created_at', { ascending: false })

    set({ projectWebhooks: (data ?? []) as ProjectWebhook[] })
  },

  fetchTaskLinks: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ taskLinks: [] })
      return
    }

    const { data } = await supabase
      .from('task_links')
      .select(TASK_LINK_SELECT)
      .eq('project_id', activeProjectId)
      .order('created_at', { ascending: false })

    set({ taskLinks: normalizeTaskLinks((data ?? []) as unknown[]) })
  },

  fetchAttachmentNotes: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ attachmentNotes: {} })
      return
    }

    const { data } = await supabase
      .from('attachment_notes')
      .select('*')
      .eq('project_id', activeProjectId)

    const byPath: Record<string, AttachmentNote> = {}
    for (const note of (data ?? []) as AttachmentNote[]) byPath[note.path] = note
    set({ attachmentNotes: byPath })
  },

  updateAttachmentNote: async (path, body) => {
    const profile = get().profile
    const activeProjectId = get().activeProjectId
    if (!profile || !activeProjectId) return

    const trimmed = body.trim()
    // A row also carries original_name (see recordAttachmentOriginalName), so
    // clearing the caption only deletes the row outright when there's no name
    // to preserve — otherwise just blank out the body.
    if (!trimmed && !get().attachmentNotes[path]?.original_name) {
      set((state) => {
        const next = { ...state.attachmentNotes }
        delete next[path]
        return { attachmentNotes: next }
      })
      await supabase.from('attachment_notes').delete().eq('project_id', activeProjectId).eq('path', path)
      return
    }

    const { data, error } = await supabase
      .from('attachment_notes')
      .upsert(
        { project_id: activeProjectId, path, body: trimmed, updated_by: profile.id },
        { onConflict: 'project_id,path' },
      )
      .select('*')
      .single()

    if (error) throw error
    if (!data) return

    set((state) => ({ attachmentNotes: { ...state.attachmentNotes, [path]: data as AttachmentNote } }))
  },

  recordAttachmentOriginalName: async (projectId, path, originalName, mimeType) => {
    const { data, error } = await supabase
      .from('attachment_notes')
      .upsert(
        { project_id: projectId, path, original_name: originalName, mime_type: mimeType ?? null },
        { onConflict: 'project_id,path' },
      )
      .select('*')
      .single()

    if (error || !data) return
    set((state) => ({ attachmentNotes: { ...state.attachmentNotes, [path]: data as AttachmentNote } }))
  },

  fetchActivityEvents: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ activityEvents: [] })
      return
    }

    // 31 days covers the day/week/month breakdown the Ops activity panel
    // shows; bounding by date (rather than a flat row limit) keeps the query
    // cheap while guaranteeing full coverage for that window.
    const sinceIso = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()

    const { data } = await supabase
      .from('activity_events')
      .select(ACTIVITY_EVENT_SELECT)
      .eq('project_id', activeProjectId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(3000)

    set({ activityEvents: (data ?? []) as unknown as ActivityEvent[] })
  },

  logActivityEvent: async (eventType, options) => {
    const activeProjectId = get().activeProjectId
    const profile = get().profile
    if (!activeProjectId || !profile) return

    await supabase.from('activity_events').insert({
      project_id: activeProjectId,
      profile_id: profile.id,
      event_type: eventType,
      task_id: options?.taskId ?? null,
      detail: options?.detail ?? null,
    })
  },

  fetchNotifications: async () => {
    const activeProjectId = get().activeProjectId
    const profile = get().profile
    if (!activeProjectId || !profile) {
      set({ notifications: [] })
      return
    }

    const { data } = await supabase
      .from('notifications')
      .select(NOTIFICATION_SELECT)
      .eq('project_id', activeProjectId)
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20)

    set({ notifications: normalizeNotifications((data ?? []) as unknown[]) })
  },

  fetchTaskContext: async (taskId) => {
    const currentTask = get().tasks.find((task) => task.id === taskId)
    if (!currentTask) {
      set({ taskComments: [], taskActivities: [] })
      return
    }

    const [{ data: comments }, { data: activities }] = await Promise.all([
      supabase
        .from('task_comments')
        .select(TASK_COMMENT_SELECT)
        .eq('task_id', taskId)
        .order('created_at'),
      supabase
        .from('task_activities')
        .select(TASK_ACTIVITY_SELECT)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }),
    ])

    set({
      taskComments: (comments ?? []) as TaskComment[],
      taskActivities: (activities ?? []) as TaskActivity[],
    })
  },

  clearTaskContext: () => {
    set({ taskComments: [], taskActivities: [] })
  },

  createProject: async (fields) => {
    const profile = get().profile
    if (!profile) return null

    const projectKey = fields.key?.trim().toUpperCase() || buildProjectKey(fields.name, get().projects)
    const { data, error } = await supabase
      .from('projects')
      .insert({
        key: projectKey,
        name: fields.name.trim(),
        description: fields.description.trim(),
        created_by: profile.id,
      })
      .select('*')
      .single()

    if (error) throw error
    if (!data) return null

    const nextProject = data as Project
    const optimisticMembership: ProjectMember = {
      id: `local-${nextProject.id}`,
      project_id: nextProject.id,
      profile_id: profile.id,
      project_role: 'owner',
      created_at: nextProject.created_at,
      project: nextProject,
      profile,
    }

    storeActiveProjectId(nextProject.id)
    set((state) => ({
      projects: state.projects.some((project) => project.id === nextProject.id)
        ? state.projects
        : [...state.projects, nextProject],
      projectMemberships: state.projectMemberships.some((membership) => membership.project_id === nextProject.id)
        ? state.projectMemberships
        : [...state.projectMemberships, optimisticMembership],
      activeProjectId: nextProject.id,
      activeProjectRole: optimisticMembership.project_role,
      activeSprintId: null,
      openTaskId: null,
      tasks: [],
      sprints: [],
      epics: [],
      portfolioItems: [],
      automationSettings: null,
      projectWebhooks: [],
      taskLinks: [],
      attachmentNotes: {},
      activityEvents: [],
      notifications: [],
      members: [profile],
      projectMembers: [optimisticMembership],
      projectInvites: [],
      taskComments: [],
      taskActivities: [],
    }))

    void Promise.allSettled([get().fetchProjects(), get().fetchMembers(), get().fetchProjectInvites()])
    return nextProject
  },

  createPortfolioItem: async (fields) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId || !fields.title?.trim()) return null

    const siblings = get().portfolioItems
      .filter((item) => item.parent_id === (fields.parent_id ?? null))
      .sort((left, right) => left.position - right.position)
    const nextPosition = (siblings[siblings.length - 1]?.position ?? 0) + 1000

    const { data, error } = await supabase
      .from('portfolio_items')
      .insert({
        project_id: activeProjectId,
        parent_id: fields.parent_id ?? null,
        item_type: fields.item_type ?? 'initiative',
        title: fields.title.trim(),
        description: fields.description?.trim() ?? '',
        color: fields.color ?? '#6554C0',
        position: fields.position ?? nextPosition,
      })
      .select('*')
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({
      portfolioItems: [...state.portfolioItems, data as PortfolioItem].sort((left, right) => left.position - right.position),
    }))
    return data as PortfolioItem
  },

  createTask: async (fields) => {
    const profile = get().profile
    const activeProjectId = get().activeProjectId
    if (!profile || !activeProjectId) return null

    const normalizedFields = normalizeTaskHierarchy(fields, get().sprints)
    const payload = {
      project_id: activeProjectId,
      status: 'todo',
      issue_type: 'task',
      priority: 'medium',
      labels: [],
      attachments: [],
      ...normalizedFields,
      // Always attribute the creator — default the reporter to the current user
      // when one wasn't explicitly chosen at creation.
      reporter_id: (fields.reporter_id ?? null) || profile.id,
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert(payload)
      .select(TASK_SELECT)
      .single()

    if (error) {
      // Also surface via the global toast so it's visible even outside the modal.
      get().notify(getErrorMessage(error))
      throw error
    }
    if (!data) return null

    set((state) => ({ tasks: [...state.tasks, data as Task] }))

    await supabase.from('task_activities').insert({
      project_id: activeProjectId,
      task_id: (data as Task).id,
      actor_id: profile.id,
      activity_type: fields.parent_task_id ? 'subtask_created' : 'task_created',
      message: fields.parent_task_id ? `Subtask "${(data as Task).title}" created` : 'Issue created',
    })

    await deliverProjectWebhooks('task.created', {
      event: 'task.created',
      project_id: activeProjectId,
      task: data,
    }, (data as Task).id)

    return data as Task
  },

  createSubtask: async (parentTaskId, title) => {
    const profile = get().profile
    const parentTask = get().tasks.find((task) => task.id === parentTaskId)
    if (!profile || !parentTask || !title.trim()) return null

    const siblingSubtasks = get().tasks
      .filter((task) => task.parent_task_id === parentTaskId)
      .sort((left, right) => left.position - right.position)
    const nextPosition = (siblingSubtasks[siblingSubtasks.length - 1]?.position ?? 0) + 1000

    const subtask = await get().createTask({
      title: title.trim(),
      description: '',
      parent_task_id: parentTaskId,
      status: parentTask.status === 'done' ? 'todo' : parentTask.status,
      issue_type: 'task',
      priority: parentTask.priority,
      labels: [],
      assignee_id: parentTask.assignee_id,
      reporter_id: profile.id,
      sprint_id: parentTask.sprint_id,
      epic_id: parentTask.epic_id,
      due_date: parentTask.due_date,
      position: nextPosition,
    })

    if (subtask) {
      await supabase.from('task_activities').insert({
        project_id: parentTask.project_id,
        task_id: parentTaskId,
        actor_id: profile.id,
        activity_type: 'subtask_created',
        message: `Subtask "${subtask.title}" created`,
      })
      await get().fetchTaskContext(parentTaskId)
    }

    return subtask
  },

  createTaskComment: async (taskId, body, attachments, mentionedProfileIds) => {
    const profile = get().profile
    const currentTask = get().tasks.find((task) => task.id === taskId)
    const trimmedBody = body.trim()
    if (!profile || !currentTask || !trimmedBody) return

    const { data } = await supabase
      .from('task_comments')
      .insert({
        project_id: currentTask.project_id,
        task_id: taskId,
        author_id: profile.id,
        body: trimmedBody,
        attachments: attachments ?? [],
      })
      .select(TASK_COMMENT_SELECT)
      .single()

    if (data) {
      set((state) => ({ taskComments: [...state.taskComments, data as TaskComment] }))
    }

    // Notify: whoever was @mentioned, plus the task author, assignee(s), and
    // everyone who has previously commented on this task ("thread
    // participants") — never the commenter themselves, and never doubled up
    // between the two groups.
    const authorName = profile.full_name || profile.email
    const commentBodyPreview = `${currentTask.key}: ${trimmedBody.slice(0, 140)}`

    const mentionedRecipients = dedupeRecipients(mentionedProfileIds ?? [], profile.id)
    if (mentionedRecipients.length) {
      await notifyRecipients(mentionedRecipients, {
        projectId: currentTask.project_id,
        taskId,
        notificationType: 'comment',
        title: `${authorName} mentioned you`,
        body: commentBodyPreview,
      })
    }

    const threadParticipantIds = get().taskComments
      .filter((comment) => comment.task_id === taskId)
      .map((comment) => comment.author_id)
    const otherRecipients = dedupeRecipients(
      [currentTask.reporter_id, currentTask.assignee_id, ...currentTask.assignee_ids, ...threadParticipantIds],
      profile.id,
    ).filter((id) => !mentionedRecipients.includes(id))
    if (otherRecipients.length) {
      await notifyRecipients(otherRecipients, {
        projectId: currentTask.project_id,
        taskId,
        notificationType: 'comment',
        title: `${authorName} commented on ${currentTask.key}`,
        body: commentBodyPreview,
      })
    }

    await supabase.from('task_activities').insert({
      project_id: currentTask.project_id,
      task_id: taskId,
      actor_id: profile.id,
      activity_type: 'comment_added',
      message: `Comment added: ${trimmedBody.slice(0, 120)}`,
    })

    await get().fetchTaskContext(taskId)
    await deliverProjectWebhooks('task.updated', {
      event: 'task.updated',
      project_id: currentTask.project_id,
      task: currentTask,
      comment: trimmedBody,
    }, currentTask.id)
  },

  createTaskLink: async (sourceTaskId, targetTaskId, linkType) => {
    const profile = get().profile
    const activeProjectId = get().activeProjectId
    if (!profile || !activeProjectId || sourceTaskId === targetTaskId) return null

    const { data, error } = await supabase
      .from('task_links')
      .insert({
        project_id: activeProjectId,
        source_task_id: sourceTaskId,
        target_task_id: targetTaskId,
        link_type: linkType,
        created_by: profile.id,
      })
      .select(TASK_LINK_SELECT)
      .single()

    if (error) throw error
    if (!data) return null

    const nextLink = normalizeTaskLinks([data as unknown])[0]
    set((state) => ({ taskLinks: [nextLink, ...state.taskLinks] }))

    const sourceTask = get().tasks.find((task) => task.id === sourceTaskId)
    const targetTask = get().tasks.find((task) => task.id === targetTaskId)
    if (sourceTask && targetTask) {
      await supabase.from('task_activities').insert([
        {
          project_id: activeProjectId,
          task_id: sourceTask.id,
          actor_id: profile.id,
          activity_type: 'task_updated',
          message: `${linkType === 'blocks' ? 'Blocks' : linkType === 'duplicates' ? 'Duplicates' : 'Related to'} ${targetTask.key}`,
        },
        {
          project_id: activeProjectId,
          task_id: targetTask.id,
          actor_id: profile.id,
          activity_type: 'task_updated',
          message: `${linkType === 'blocks' ? 'Blocked by' : linkType === 'duplicates' ? 'Duplicated by' : 'Related to'} ${sourceTask.key}`,
        },
      ])
    }

    return nextLink
  },

  createProjectWebhook: async (fields) => {
    const profile = get().profile
    const activeProjectId = get().activeProjectId
    if (!profile || !activeProjectId) return null

    const { data, error } = await supabase
      .from('project_webhooks')
      .insert({
        project_id: activeProjectId,
        name: fields.name.trim(),
        endpoint_url: fields.endpoint_url.trim(),
        events: fields.events,
        secret: fields.secret.trim(),
        webhook_type: fields.webhook_type,
        created_by: profile.id,
      })
      .select('*')
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({ projectWebhooks: [data as ProjectWebhook, ...state.projectWebhooks] }))
    return data as ProjectWebhook
  },

  testProjectWebhook: async (webhook) => {
    const summary = `🔔 NoJira test — webhook "${webhook.name}" is connected.`
    try {
      if (webhook.webhook_type === 'discord' || webhook.webhook_type === 'slack') {
        const { data, error } = await supabase.functions.invoke('notify-webhook', {
          body: { webhook_id: webhook.id, event: 'task.updated', summary },
        })
        if (error) return { ok: false, error: error.message }
        const res = data as { ok?: boolean; status?: number; error?: string } | null
        if (res && res.ok === false) return { ok: false, error: res.status ? `HTTP ${res.status}` : (res.error ?? 'failed') }
        return { ok: true }
      }
      await postWebhook('task.updated', webhook, { event: 'test', summary, task: { key: 'TEST', title: summary } })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  deleteTaskComment: async (commentId) => {
    const comment = get().taskComments.find((item) => item.id === commentId)
    if (!comment) return

    set((state) => ({
      taskComments: state.taskComments.filter((item) => item.id !== commentId),
    }))

    const { error } = await supabase
      .from('task_comments')
      .delete()
      .eq('id', commentId)

    if (error) {
      set((state) => ({ taskComments: [...state.taskComments, comment].sort((left, right) => left.created_at.localeCompare(right.created_at)) }))
      throw error
    }
  },

  deleteTaskLink: async (id) => {
    const previousLinks = get().taskLinks
    set((state) => ({ taskLinks: state.taskLinks.filter((link) => link.id !== id) }))
    const { error } = await supabase.from('task_links').delete().eq('id', id)
    if (error) {
      set({ taskLinks: previousLinks })
      throw error
    }
  },

  updateTask: async (id, fields) => {
    const profile = get().profile
    const previousTask = get().tasks.find((task) => task.id === id)
    if (!previousTask) return

    const normalizedFields = normalizeTaskHierarchy(fields, get().sprints, previousTask)

    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...normalizedFields } : task)),
    }))

    const { data, error } = await supabase
      .from('tasks')
      .update(normalizedFields)
      .eq('id', id)
      .select(TASK_SELECT)
      .single()

    if (error || !data) {
      // The save was rejected (RLS / trigger / constraint). Roll back the
      // optimistic change and TELL the user why — never fail silently.
      set((state) => ({ tasks: replaceTask(state.tasks, previousTask) }))
      get().notify(getErrorMessage(error))
      return
    }

    {
      const nextTask = data as Task
      set((state) => ({ tasks: replaceTask(state.tasks, nextTask) }))

      const messages = buildTaskUpdateMessages(previousTask, nextTask, normalizedFields)
      if (profile && messages.length > 0) {
        await supabase.from('task_activities').insert(
          messages.map((message) => ({
            project_id: nextTask.project_id,
            task_id: nextTask.id,
            actor_id: profile.id,
            activity_type: 'task_updated',
            message,
          }))
        )
      }

      if (get().openTaskId === id) {
        await get().fetchTaskContext(id)
      }

      const meaningfulChanges = Object.keys(normalizedFields).filter((field) => field !== 'position')
      if (meaningfulChanges.length > 0) {
        await deliverProjectWebhooks('task.updated', {
          event: 'task.updated',
          project_id: nextTask.project_id,
          changes: normalizedFields,
          task: nextTask,
        }, nextTask.id)
      }

      // Notify "the other side" of a status change: if the assignee moved
      // it, tell the author; if the author (or anyone else) moved it, tell
      // the assignee(s). Covers "assignee starts work" and "author/PM
      // updates progress" symmetrically without a special-cased status.
      if (profile && previousTask.status !== nextTask.status) {
        const assigneeIds = nextTask.assignee_ids.length ? nextTask.assignee_ids : [nextTask.assignee_id]
        const actorName = profile.full_name || profile.email
        const statusLabel = nextTask.status.replace('_', ' ')
        const isActorAssignee = assigneeIds.includes(profile.id)
        const statusRecipients = dedupeRecipients(
          isActorAssignee ? [nextTask.reporter_id] : [...assigneeIds, nextTask.reporter_id],
          profile.id,
        )
        await notifyRecipients(statusRecipients, {
          projectId: nextTask.project_id,
          taskId: nextTask.id,
          notificationType: 'automation',
          title: `${actorName} moved ${nextTask.key} to ${statusLabel}`,
          body: nextTask.title,
        })
      }

      if (previousTask.status !== 'done' && nextTask.status === 'done') {
        await deliverProjectWebhooks('task.completed', {
          event: 'task.completed',
          project_id: nextTask.project_id,
          task: nextTask,
        }, nextTask.id)

        const affectedTasks = get().taskLinks
          .filter((link) => link.link_type === 'blocks' && link.source_task_id === nextTask.id)
          .map((link) => link.target_task_id)

        for (const targetTaskId of affectedTasks) {
          if (!isTaskBlocked(targetTaskId, get().taskLinks, get().tasks)) {
            const targetTask = get().tasks.find((task) => task.id === targetTaskId)
            if (targetTask) {
              await deliverProjectWebhooks('task.unblocked', {
                event: 'task.unblocked',
                project_id: targetTask.project_id,
                task: targetTask,
                unblocked_by: nextTask,
              }, targetTask.id)

              if (get().automationSettings?.notify_on_unblock) {
                const unblockedAssigneeIds = targetTask.assignee_ids.length ? targetTask.assignee_ids : [targetTask.assignee_id]
                await notifyRecipients(dedupeRecipients(unblockedAssigneeIds, null), {
                  projectId: targetTask.project_id,
                  taskId: targetTask.id,
                  notificationType: 'unblocked',
                  title: `${targetTask.key} is now unblocked`,
                  body: `${nextTask.key} was completed, unblocking this task.`,
                })
              }
            }
          }
        }
      }
    }
  },

  deleteTask: async (id) => {
    const previousTasks = get().tasks
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }))
    if (get().openTaskId === id) {
      set({ openTaskId: null, taskComments: [], taskActivities: [] })
    }
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) {
      set({ tasks: previousTasks })
      throw error
    }
  },

  patchTask: (id, fields) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...fields } : task)),
    }))
  },

  moveTask: async (taskId, toStatus, toIndex) => {
    const tasks = get().tasks
    const task = tasks.find((item) => item.id === taskId)
    if (!task) return

    const columnTasks = tasks
      .filter((item) => item.status === toStatus && item.id !== taskId)
      .sort((left, right) => left.position - right.position)

    const before = columnTasks[toIndex - 1]?.position ?? 0
    const after = columnTasks[toIndex]?.position ?? (before + 2000)
    let nextPosition = Math.floor((before + after) / 2)

    if (nextPosition === before || nextPosition === after) {
      const rebalanced = [
        ...columnTasks.slice(0, toIndex),
        { ...task, status: toStatus },
        ...columnTasks.slice(toIndex),
      ].map((item, index) => ({
        id: item.id,
        status: item.id === taskId ? toStatus : item.status,
        position: (index + 1) * 1000,
      }))

      for (const update of rebalanced) {
        if (update.id === taskId) continue
        await supabase.from('tasks').update({ status: update.status, position: update.position }).eq('id', update.id)
      }

      const movedTask = rebalanced.find((entry) => entry.id === taskId)
      if (movedTask) {
        await get().updateTask(taskId, { status: movedTask.status, position: movedTask.position })
      }
      return
    }

    await get().updateTask(taskId, { status: toStatus, position: nextPosition })
  },

  createSprint: async (fields) => {
    const activeProjectId = get().activeProjectId
    const profile = get().profile
    if (!activeProjectId) return null

    const normalizedFields = {
      ...fields,
      epic_id: fields.epic_id ?? null,
      created_by: fields.created_by ?? profile?.id ?? null,
    }

    const { data, error } = await supabase
      .from('sprints')
      .insert({ project_id: activeProjectId, goal: '', ...normalizedFields })
      .select()
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({ sprints: [...state.sprints, data as Sprint] }))
    return data as Sprint
  },

  updateSprint: async (id, fields) => {
    const normalizedFields = Object.prototype.hasOwnProperty.call(fields, 'epic_id')
      ? { ...fields, epic_id: fields.epic_id ?? null }
      : fields

    set((state) => ({
      sprints: state.sprints.map((sprint) => (sprint.id === id ? { ...sprint, ...normalizedFields } : sprint)),
      tasks: Object.prototype.hasOwnProperty.call(normalizedFields, 'epic_id')
        ? state.tasks.map((task) => (
            task.sprint_id === id
              ? { ...task, epic_id: (normalizedFields.epic_id as string | null) ?? null }
              : task
          ))
        : state.tasks,
    }))
    await supabase.from('sprints').update(normalizedFields).eq('id', id)

    if (Object.prototype.hasOwnProperty.call(normalizedFields, 'epic_id')) {
      await supabase
        .from('tasks')
        .update({ epic_id: (normalizedFields.epic_id as string | null) ?? null })
        .eq('sprint_id', id)
    }
  },

  startSprint: async (id) => {
    const currentActive = get().sprints.find((sprint) => sprint.status === 'active')
    if (currentActive) await get().updateSprint(currentActive.id, { status: 'planned' })
    await get().updateSprint(id, { status: 'active' })
    set({ activeSprintId: id })
  },

  completeSprint: async (id) => {
    await get().updateSprint(id, { status: 'completed' })
    if (get().activeSprintId === id) set({ activeSprintId: null })
  },

  deleteSprint: async (id, options) => {
    if (options?.withTasks) {
      await supabase.from('tasks').delete().eq('sprint_id', id)
      set((state) => ({ tasks: state.tasks.filter((task) => task.sprint_id !== id) }))
    }
    set((state) => ({ sprints: state.sprints.filter((sprint) => sprint.id !== id) }))
    await supabase.from('sprints').delete().eq('id', id)
  },

  createEpic: async (fields) => {
    const activeProjectId = get().activeProjectId
    const profile = get().profile
    if (!activeProjectId) return null

    const { data, error } = await supabase
      .from('epics')
      .insert({
        project_id: activeProjectId,
        description: '',
        status: 'planned',
        parent_portfolio_item_id: null,
        ...fields,
        created_by: fields.created_by ?? profile?.id ?? null,
      })
      .select()
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({ epics: [...state.epics, data as Epic] }))
    return data as Epic
  },

  reassignAuthor: async (epicId, toProfileId) => {
    const { error: epicError } = await supabase
      .from('epics')
      .update({ created_by: toProfileId })
      .eq('id', epicId)
    if (epicError) throw epicError

    const { error: tasksError } = await supabase
      .from('tasks')
      .update({ reporter_id: toProfileId })
      .eq('epic_id', epicId)
    if (tasksError) throw tasksError

    set((state) => ({
      epics: state.epics.map((epic) => (epic.id === epicId ? { ...epic, created_by: toProfileId } : epic)),
      tasks: state.tasks.map((task) => (task.epic_id === epicId ? { ...task, reporter_id: toProfileId } : task)),
    }))
  },

  updateEpic: async (id, fields) => {
    set((state) => ({
      epics: state.epics.map((epic) => (epic.id === id ? { ...epic, ...fields } : epic)),
    }))

    const { data } = await supabase
      .from('epics')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single()

    if (data) {
      set((state) => ({
        epics: state.epics.map((epic) => (epic.id === id ? data as Epic : epic)),
      }))
    }
  },

  deleteEpic: async (id, options) => {
    if (options?.withTasks) {
      await supabase.from('tasks').delete().eq('epic_id', id)
      set((state) => ({ tasks: state.tasks.filter((task) => task.epic_id !== id) }))
    }
    set((state) => ({ epics: state.epics.filter((epic) => epic.id !== id) }))
    await supabase.from('epics').delete().eq('id', id)
  },

  // Jira imports don't always draw the epic/sprint line consistently (a "sprint"
  // that's really a feature grouping, or vice versa) — these let a project admin
  // fix that after the fact without re-importing.
  convertSprintToEpic: async (sprintId) => {
    const sprint = get().sprints.find((item) => item.id === sprintId)
    if (!sprint) return null

    const statusMap: Record<Sprint['status'], Epic['status']> = {
      planned: 'planned',
      active: 'in_progress',
      completed: 'done',
    }

    const epic = await get().createEpic({
      title: sprint.name,
      description: sprint.goal,
      color: EPIC_COLORS[0],
      status: statusMap[sprint.status],
      parent_portfolio_item_id: null,
      created_by: sprint.created_by,
      attachments: sprint.attachments,
    })
    if (!epic) return null

    // A task whose epic_id already points somewhere else (a messy Jira import can
    // leave it out of sync with its own sprint) keeps that epic — only tasks with
    // no other epic fold into the newly created one.
    const sprintTasks = get().tasks.filter((task) => task.sprint_id === sprintId)
    const tasksToFold = sprintTasks.filter((task) => !task.epic_id || task.epic_id === sprint.epic_id)
    const tasksToDetach = sprintTasks.filter((task) => task.epic_id && task.epic_id !== sprint.epic_id)

    if (tasksToFold.length) {
      await supabase.from('tasks').update({ sprint_id: null, epic_id: epic.id }).in('id', tasksToFold.map((task) => task.id))
    }
    if (tasksToDetach.length) {
      await supabase.from('tasks').update({ sprint_id: null }).in('id', tasksToDetach.map((task) => task.id))
    }

    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.sprint_id !== sprintId) return task
        if (!task.epic_id || task.epic_id === sprint.epic_id) return { ...task, sprint_id: null, epic_id: epic.id }
        return { ...task, sprint_id: null }
      }),
    }))

    await get().deleteSprint(sprintId)
    return epic
  },

  convertEpicToSprint: async (epicId) => {
    const epic = get().epics.find((item) => item.id === epicId)
    if (!epic) return null

    const statusMap: Record<Epic['status'], Sprint['status']> = {
      planned: 'planned',
      in_progress: 'active',
      done: 'completed',
    }

    const sprint = await get().createSprint({
      name: epic.title,
      goal: epic.description,
      epic_id: null,
      start_date: null,
      end_date: null,
      status: statusMap[epic.status],
      created_by: epic.created_by,
      attachments: epic.attachments,
    })
    if (!sprint) return null

    // Sprints nested under this epic become standalone top-level sprints instead
    // of being folded in — reuses updateSprint's own epic_id → task cascade so
    // their tasks' epic_id clears in step with them.
    const nestedSprints = get().sprints.filter((item) => item.epic_id === epicId)
    for (const nested of nestedSprints) {
      await get().updateSprint(nested.id, { epic_id: null })
    }

    // Tasks directly in the epic (no sprint of their own) fold into the new sprint.
    const directTaskIds = get().tasks
      .filter((task) => task.epic_id === epicId && !task.sprint_id)
      .map((task) => task.id)

    if (directTaskIds.length) {
      await supabase.from('tasks').update({ epic_id: null, sprint_id: sprint.id }).in('id', directTaskIds)
      set((state) => ({
        tasks: state.tasks.map((task) => (
          directTaskIds.includes(task.id) ? { ...task, epic_id: null, sprint_id: sprint.id } : task
        )),
      }))
    }

    await get().deleteEpic(epicId)
    return sprint
  },

  updatePortfolioItem: async (id, fields) => {
    set((state) => ({
      portfolioItems: state.portfolioItems.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    }))

    const { data } = await supabase
      .from('portfolio_items')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single()

    if (data) {
      set((state) => ({
        portfolioItems: state.portfolioItems
          .map((item) => (item.id === id ? data as PortfolioItem : item))
          .sort((left, right) => left.position - right.position),
      }))
    }
  },

  updateAutomationSettings: async (fields) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return

    const payload = {
      project_id: activeProjectId,
      ...get().automationSettings,
      ...fields,
      updated_at: new Date().toISOString(),
    }

    set({ automationSettings: payload as ProjectAutomationSettings })

    const { data } = await supabase
      .from('project_automation_settings')
      .upsert(payload)
      .select('*')
      .single()

    if (data) set({ automationSettings: data as ProjectAutomationSettings })
  },

  deleteProject: async (projectId) => {
    const activeProjectId = get().activeProjectId
    const deletingActiveProject = activeProjectId === projectId

    const { data: attachmentRows, error: attachmentError } = await supabase.rpc('project_attachment_paths', {
      project_uuid: projectId,
    })

    if (attachmentError) throw attachmentError

    const attachmentPaths = Array.from(
      new Set(
        ((attachmentRows ?? []) as ProjectAttachmentPathRow[])
          .map((row) => row.path)
          .filter((path): path is string => Boolean(path))
      )
    )

    for (const batch of chunkItems(attachmentPaths, 100)) {
      if (!batch.length) continue
      const { error } = await supabase.storage.from('attachments').remove(batch)
      if (error) throw error
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (error) throw error

    const nextProjects = get().projects.filter((project) => project.id !== projectId)
    const nextMemberships = get().projectMemberships.filter((membership) => membership.project_id !== projectId)
    const nextActiveProjectId = deletingActiveProject
      ? (nextProjects[0]?.id ?? null)
      : activeProjectId
    const nextActiveProjectRole = nextMemberships.find((membership) => membership.project_id === nextActiveProjectId)?.project_role ?? null

    storeActiveProjectId(nextActiveProjectId)
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== projectId),
      workspaceProjects: state.workspaceProjects.filter((project) => project.id !== projectId),
      projectMemberships: nextMemberships,
      activeProjectId: nextActiveProjectId,
      activeProjectRole: nextActiveProjectRole,
      ...(deletingActiveProject ? {
        assignableProfiles: [],
        activeSprintId: null,
        openTaskId: null,
        tasks: [],
        sprints: [],
        epics: [],
        portfolioItems: [],
        automationSettings: null,
        projectWebhooks: [],
        taskLinks: [],
        attachmentNotes: {},
        activityEvents: [],
        notifications: [],
        members: [],
        placeholders: [],
        selectedTaskIds: [],
        projectMembers: [],
        projectInvites: [],
        taskComments: [],
        taskActivities: [],
      } : {}),
    }))

    await Promise.all([get().fetchProjects(), get().fetchWorkspaceProjects()])
  },

  deleteProjectWebhook: async (id) => {
    const previousWebhooks = get().projectWebhooks
    set((state) => ({ projectWebhooks: state.projectWebhooks.filter((webhook) => webhook.id !== id) }))
    const { error } = await supabase.from('project_webhooks').delete().eq('id', id)
    if (error) {
      set({ projectWebhooks: previousWebhooks })
      throw error
    }
  },

  markNotificationRead: async (id) => {
    set((state) => ({
      notifications: state.notifications.map((notification) => (
        notification.id === id ? { ...notification, is_read: true } : notification
      )),
    }))
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
  },

  markAllNotificationsRead: async () => {
    const activeProjectId = get().activeProjectId
    const profile = get().profile
    if (!activeProjectId || !profile) return

    set((state) => ({
      notifications: state.notifications.map((notification) => ({ ...notification, is_read: true })),
    }))

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('project_id', activeProjectId)
      .eq('profile_id', profile.id)
      .eq('is_read', false)
  },

  updateProfile: async (id, fields) => {
    set((state) => ({
      members: state.members.map((member) => (member.id === id ? { ...member, ...fields } : member)),
      projectMembers: state.projectMembers.map((member) => (
        member.profile_id === id
          ? { ...member, profile: member.profile ? { ...member.profile, ...fields } : member.profile }
          : member
      )),
      profile: state.profile?.id === id ? { ...state.profile, ...fields } : state.profile,
    }))

    const { data, error } = await supabase
      .from('profiles')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single()

    // A blocked RLS write returns 0 rows (no thrown error from Postgres itself),
    // which .single() turns into an error — surface it instead of silently
    // keeping the optimistic change, which would otherwise quietly revert on
    // the next fetch with no indication anything went wrong.
    if (error) throw error

    if (data) {
      set((state) => ({
        members: state.members.map((member) => (member.id === id ? data as Profile : member)),
        projectMembers: state.projectMembers.map((member) => (
          member.profile_id === id ? { ...member, profile: data as Profile } : member
        )),
        profile: state.profile?.id === id ? data as Profile : state.profile,
      }))
    }
  },

  updateProjectMemberRole: async (membershipId, role) => {
    set((state) => ({
      projectMembers: state.projectMembers.map((member) => (
        member.id === membershipId ? { ...member, project_role: role } : member
      )),
      projectMemberships: state.projectMemberships.map((member) => (
        member.id === membershipId ? { ...member, project_role: role } : member
      )),
      activeProjectRole: state.projectMemberships.find((item) => item.id === membershipId)?.profile_id === state.profile?.id
        ? role
        : state.activeProjectRole,
    }))

    await supabase
      .from('project_members')
      .update({ project_role: role })
      .eq('id', membershipId)

    await get().fetchProjects()
    await get().fetchMembers()
  },

  inviteToProject: async (email, role, message = null) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return null

    const normalizedEmail = email.trim().toLowerCase()

    const { error: rpcError } = await supabase.rpc('invite_to_project', {
      project_uuid: activeProjectId,
      invite_email: normalizedEmail,
      invite_role: role,
      invite_message: message,
    })
    if (rpcError) throw rpcError

    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        // Include the /NoJira/ base path so the magic link doesn't 404 on the domain root.
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}board`,
        shouldCreateUser: true,
      },
    })

    await Promise.all([
      get().fetchMembers(),
      get().fetchProjectInvites(),
      get().fetchProjects(),
      get().fetchAssignableProfiles(),
    ])
    return { emailSent: !error }
  },

  cancelInvite: async (inviteId) => {
    const { error } = await supabase.from('project_invites').delete().eq('id', inviteId)
    if (error) throw error
    await get().fetchProjectInvites()
  },

  invitePlaceholder: async (placeholderId, email, role) => {
    const result = await get().inviteToProject(email, role)
    // Mark the placeholder as invited (best-effort; ignore if RLS/no-op).
    await supabase.from('project_member_placeholders').update({ status: 'invited' }).eq('id', placeholderId)
    await get().fetchPlaceholders()
    return result
  },

  linkPlaceholder: async (placeholderId, profileId) => {
    const { error } = await supabase.rpc('link_placeholder_to_member', {
      placeholder_uuid: placeholderId,
      target_profile_id: profileId,
    })
    if (error) throw error
    await Promise.all([
      get().fetchPlaceholders(),
      get().fetchMembers(),
    ])
  },

  acceptPlaceholder: async (placeholderId) => {
    // Acknowledge an imported Jira person as a team member. They have no NoJira
    // account (auth.users is never created manually), so they stay a placeholder
    // with status 'accepted' — assignable, and no longer a pending import.
    const { error } = await supabase
      .from('project_member_placeholders')
      .update({ status: 'accepted' })
      .eq('id', placeholderId)
    if (error) throw error
    await get().fetchPlaceholders()
  },

  updatePlaceholder: async (placeholderId, fields) => {
    // Optimistic — placeholder field edits (role/title/department/locale) mirror
    // the member row editors and persist to the placeholder record.
    set((state) => ({
      placeholders: state.placeholders.map((p) => (p.id === placeholderId ? { ...p, ...fields } : p)),
    }))
    const { error } = await supabase.from('project_member_placeholders').update(fields).eq('id', placeholderId)
    if (error) throw error
  },

  removeProjectMember: async (profileId) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return

    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('project_id', activeProjectId)
      .eq('profile_id', profileId)
    if (error) throw error

    await Promise.all([
      get().fetchMembers(),
      get().fetchProjects(),
      get().fetchAssignableProfiles(),
    ])
  },

  addProfileToProject: async (profileId, role) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return

    const { error } = await supabase
      .from('project_members')
      .insert({
        project_id: activeProjectId,
        profile_id: profileId,
        project_role: role,
      })

    if (error) throw error

    await Promise.all([
      get().fetchMembers(),
      get().fetchProjectInvites(),
      get().fetchAssignableProfiles(),
      get().fetchProjects(),
    ])
  },

  fetchPendingMembers: async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('approved', false)
      .eq('access_declined', false)
      .order('created_at', { ascending: false })
    if (data) set({ pendingMembers: data as Profile[] })
  },

  approveMember: async (profileId) => {
    const adminProfile = get().profile
    await supabase
      .from('profiles')
      .update({ approved: true, approved_at: new Date().toISOString(), approved_by: adminProfile?.id })
      .eq('id', profileId)
    await Promise.all([
      get().fetchPendingMembers(),
      get().fetchMembers(),
      get().fetchProjectInvites(),
      get().fetchAssignableProfiles(),
    ])
  },

  declineMember: async (profileId) => {
    const { error } = await supabase.rpc('decline_member', { profile_uuid: profileId })
    if (error) throw error
    // Optimistically drop from the pending list, then reconcile.
    set((state) => ({ pendingMembers: state.pendingMembers.filter((m) => m.id !== profileId) }))
    await get().fetchPendingMembers()
  },

  requestAccessAgain: async () => {
    const { error } = await supabase.rpc('request_access_again')
    if (error) throw error
  },

  requestEntityDeletion: async (entityType, entityId, entityLabel) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return

    const { error } = await supabase.rpc('request_entity_deletion', {
      project_uuid: activeProjectId,
      request_entity_type: entityType,
      request_entity_uuid: entityId,
      request_entity_label: entityLabel,
    })

    if (error) throw error
  },

  resolveDeletionRequest: async (requestId, resolution) => {
    const request = get().deletionRequests.find((item) => item.id === requestId) ?? null

    const { error } = await supabase.rpc('resolve_deletion_request', {
      request_uuid: requestId,
      request_resolution: resolution,
    })

    if (error) throw error

    if (request?.project_id === get().activeProjectId) {
      if (request.entity_type === 'task' && get().openTaskId === request.entity_id) {
        set({ openTaskId: null, taskComments: [], taskActivities: [] })
      }

      await Promise.all([
        get().fetchBacklog(),
        get().fetchSprints(),
        get().fetchEpics(),
      ])
    }

    await get().fetchDeletionRequests()
  },

  triggerApprovalNotification: async (options) => {
    const { data, error } = await supabase.functions.invoke<ApprovalNotificationResponse>('notify-approval-request', {
      body: {
        targetProfileId: options?.profileId ?? null,
        force: options?.force ?? false,
      },
    })

    if (error) {
      return {
        status: 'error',
        message: await getFunctionErrorMessage(error),
        sentAt: null,
      }
    }

    if (options?.profileId) {
      await get().fetchPendingMembers()
    }

    return data ?? {
      status: 'error',
      message: 'Empty function response.',
      sentAt: null,
    }
  },
  })
})
