import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type {
  Epic,
  Profile,
  Project,
  ProjectInvite,
  ProjectMember,
  ProjectRole,
  Sprint,
  TaskActivity,
  TaskComment,
  Task,
  TaskStatus,
} from '@/types'

const TASK_SELECT = `
  *,
  epic:epics(*),
  assignee:profiles!tasks_assignee_id_fkey(*),
  reporter:profiles!tasks_reporter_id_fkey(*)
`

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

const ACTIVE_PROJECT_STORAGE_KEY = 'nojira-active-project-id'

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

  if (!messages.length && Object.keys(changedFields).length > 0) {
    messages.push('Issue details updated')
  }

  return messages
}

interface AppState {
  profile: Profile | null
  projects: Project[]
  projectMemberships: ProjectMember[]
  projectMembers: ProjectMember[]
  projectInvites: ProjectInvite[]
  taskComments: TaskComment[]
  taskActivities: TaskActivity[]
  tasks: Task[]
  sprints: Sprint[]
  epics: Epic[]
  members: Profile[]
  loadingProjects: boolean
  loadingBoard: boolean
  loadingBacklog: boolean
  activeProjectId: string | null
  activeProjectRole: ProjectRole | null
  activeSprintId: string | null
  openTaskId: string | null
  setProfile: (profile: Profile | null) => void
  setOpenTaskId: (id: string | null) => void
  setActiveSprintId: (id: string | null) => void
  setActiveProjectId: (id: string | null) => void
  fetchProjects: () => Promise<void>
  fetchBoard: (sprintId: string) => Promise<void>
  fetchBacklog: () => Promise<void>
  fetchSprints: () => Promise<void>
  fetchEpics: () => Promise<void>
  fetchMembers: () => Promise<void>
  fetchProjectInvites: () => Promise<void>
  fetchTaskContext: (taskId: string) => Promise<void>
  clearTaskContext: () => void
  createProject: (fields: Pick<Project, 'name' | 'description'> & { key?: string }) => Promise<Project | null>
  createTask: (fields: Partial<Task>) => Promise<Task | null>
  createSubtask: (parentTaskId: string, title: string) => Promise<Task | null>
  createTaskComment: (taskId: string, body: string) => Promise<void>
  deleteTaskComment: (commentId: string) => Promise<void>
  updateTask: (id: string, fields: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  moveTask: (taskId: string, toStatus: TaskStatus, toIndex: number) => Promise<void>
  patchTask: (id: string, fields: Partial<Task>) => void
  createSprint: (fields: Partial<Sprint>) => Promise<Sprint | null>
  updateSprint: (id: string, fields: Partial<Sprint>) => Promise<void>
  startSprint: (id: string) => Promise<void>
  completeSprint: (id: string) => Promise<void>
  deleteSprint: (id: string) => Promise<void>
  createEpic: (fields: Partial<Epic>) => Promise<Epic | null>
  deleteEpic: (id: string) => Promise<void>
  updateProfile: (id: string, fields: Partial<Profile>) => Promise<void>
  updateProjectMemberRole: (membershipId: string, role: ProjectRole) => Promise<void>
  inviteToProject: (email: string, role: ProjectRole) => Promise<{ emailSent: boolean } | null>
}

export const useStore = create<AppState>((set, get) => ({
  profile: null,
  projects: [],
  projectMemberships: [],
  projectMembers: [],
  projectInvites: [],
  taskComments: [],
  taskActivities: [],
  tasks: [],
  sprints: [],
  epics: [],
  members: [],
  loadingProjects: false,
  loadingBoard: false,
  loadingBacklog: false,
  activeProjectId: null,
  activeProjectRole: null,
  activeSprintId: null,
  openTaskId: null,

  setProfile: (profile) => set({ profile }),
  setOpenTaskId: (openTaskId) => set({ openTaskId }),
  setActiveSprintId: (activeSprintId) => set({ activeSprintId }),
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
      members: [],
      projectMembers: [],
      projectInvites: [],
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
        projectMemberships: [],
        activeProjectId: null,
        activeProjectRole: null,
        loadingProjects: false,
      })
      return
    }

    set({ loadingProjects: true })
    const { data } = await supabase
      .from('project_members')
      .select(PROJECT_ACCESS_SELECT)
      .eq('profile_id', profileId)
      .order('created_at')

    const memberships = normalizeProjectAccess((data ?? []) as unknown[])
    const projects = uniqueProjects(memberships)
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
      projectMemberships: memberships,
      activeProjectId: nextActiveProjectId,
      activeProjectRole: nextRole,
      loadingProjects: false,
    })
  },

  fetchBoard: async (sprintId) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ tasks: [], loadingBoard: false })
      return
    }

    set({ loadingBoard: true })
    const { data } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('project_id', activeProjectId)
      .eq('sprint_id', sprintId)
      .order('status')
      .order('position')

    set({ tasks: (data ?? []) as Task[], loadingBoard: false })
  },

  fetchBacklog: async () => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) {
      set({ tasks: [], loadingBacklog: false })
      return
    }

    set({ loadingBacklog: true })
    const { data } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('project_id', activeProjectId)
      .order('sprint_id', { ascending: true, nullsFirst: true })
      .order('position')
      .order('created_at')

    set({ tasks: (data ?? []) as Task[], loadingBacklog: false })
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

    await get().fetchProjects()
    get().setActiveProjectId(data.id)
    await Promise.all([get().fetchMembers(), get().fetchProjectInvites()])
    return data as Project
  },

  createTask: async (fields) => {
    const profile = get().profile
    const activeProjectId = get().activeProjectId
    if (!profile || !activeProjectId) return null

    const payload = {
      project_id: activeProjectId,
      status: 'todo',
      issue_type: 'task',
      priority: 'medium',
      labels: [],
      attachments: [],
      reporter_id: profile.id,
      ...fields,
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert(payload)
      .select(TASK_SELECT)
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({ tasks: [...state.tasks, data as Task] }))

    await supabase.from('task_activities').insert({
      project_id: activeProjectId,
      task_id: (data as Task).id,
      actor_id: profile.id,
      activity_type: fields.parent_task_id ? 'subtask_created' : 'task_created',
      message: fields.parent_task_id ? `Subtask "${(data as Task).title}" created` : 'Issue created',
    })

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

  createTaskComment: async (taskId, body) => {
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
      })
      .select(TASK_COMMENT_SELECT)
      .single()

    if (data) {
      set((state) => ({ taskComments: [...state.taskComments, data as TaskComment] }))
    }

    await supabase.from('task_activities').insert({
      project_id: currentTask.project_id,
      task_id: taskId,
      actor_id: profile.id,
      activity_type: 'comment_added',
      message: `Comment added: ${trimmedBody.slice(0, 120)}`,
    })

    await get().fetchTaskContext(taskId)
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

  updateTask: async (id, fields) => {
    const profile = get().profile
    const previousTask = get().tasks.find((task) => task.id === id)
    if (!previousTask) return

    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...fields } : task)),
    }))

    const { data } = await supabase
      .from('tasks')
      .update(fields)
      .eq('id', id)
      .select(TASK_SELECT)
      .single()

    if (data) {
      const nextTask = data as Task
      set((state) => ({ tasks: replaceTask(state.tasks, nextTask) }))

      const messages = buildTaskUpdateMessages(previousTask, nextTask, fields)
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

      set((state) => ({
        tasks: state.tasks.map((item) => {
          const update = rebalanced.find((entry) => entry.id === item.id)
          return update ? { ...item, status: update.status, position: update.position } : item
        }),
      }))

      for (const update of rebalanced) {
        await supabase
          .from('tasks')
          .update({ status: update.status, position: update.position })
          .eq('id', update.id)
      }
      return
    }

    set((state) => ({
      tasks: state.tasks.map((item) => (
        item.id === taskId ? { ...item, status: toStatus, position: nextPosition } : item
      )),
    }))

    await supabase
      .from('tasks')
      .update({ status: toStatus, position: nextPosition })
      .eq('id', taskId)
  },

  createSprint: async (fields) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return null

    const { data, error } = await supabase
      .from('sprints')
      .insert({ project_id: activeProjectId, goal: '', ...fields })
      .select()
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({ sprints: [...state.sprints, data as Sprint] }))
    return data as Sprint
  },

  updateSprint: async (id, fields) => {
    set((state) => ({
      sprints: state.sprints.map((sprint) => (sprint.id === id ? { ...sprint, ...fields } : sprint)),
    }))
    await supabase.from('sprints').update(fields).eq('id', id)
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

  deleteSprint: async (id) => {
    set((state) => ({ sprints: state.sprints.filter((sprint) => sprint.id !== id) }))
    await supabase.from('sprints').delete().eq('id', id)
  },

  createEpic: async (fields) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return null

    const { data, error } = await supabase
      .from('epics')
      .insert({ project_id: activeProjectId, description: '', ...fields })
      .select()
      .single()

    if (error) throw error
    if (!data) return null

    set((state) => ({ epics: [...state.epics, data as Epic] }))
    return data as Epic
  },

  deleteEpic: async (id) => {
    set((state) => ({ epics: state.epics.filter((epic) => epic.id !== id) }))
    await supabase.from('epics').delete().eq('id', id)
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

    const { data } = await supabase
      .from('profiles')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single()

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

  inviteToProject: async (email, role) => {
    const activeProjectId = get().activeProjectId
    if (!activeProjectId) return null

    const normalizedEmail = email.trim().toLowerCase()

    await supabase.rpc('invite_to_project', {
      project_uuid: activeProjectId,
      invite_email: normalizedEmail,
      invite_role: role,
    })

    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/board`,
        shouldCreateUser: true,
      },
    })

    await Promise.all([get().fetchMembers(), get().fetchProjectInvites(), get().fetchProjects()])
    return { emailSent: !error }
  },
}))
