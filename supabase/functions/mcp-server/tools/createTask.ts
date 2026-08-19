import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import {
  resolveEpicByKeyOrTitle,
  resolveMcpAgentProfileId,
  resolveProfileByEmail,
  resolveProjectByKey,
  resolveSprintByName,
} from './resolvers.ts'
import { ISSUE_PRIORITIES, ISSUE_TYPES, type IssuePriority, type IssueType } from '../types.ts'

interface CreateTaskArgs {
  project?: string
  title?: string
  description?: string
  issue_type?: string
  priority?: string
  assignee_email?: string
  epic?: string
  sprint?: string
  implements_screen?: string
  agent_name?: string
}

/**
 * A screen reference (task key or id) → its task id, checked to be a real
 * screen: a task inside the project's screen-registry epic. Anything else is
 * rejected rather than silently linked, so the registry stays meaningful.
 */
async function resolveScreenTaskId(admin: SupabaseClient, projectId: string, ref: string): Promise<string> {
  const { data: epic, error: epicError } = await admin
    .from('epics')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_screen_registry', true)
    .maybeSingle()
  if (epicError) throw new ToolError(`Failed to look up the screen registry: ${epicError.message}`)
  if (!epic) throw new ToolError('This project has no screen registry epic, so there are no screens to implement.')

  const trimmed = ref.trim()
  const { data, error } = await admin
    .from('tasks')
    .select('id, status')
    .eq('project_id', projectId)
    .eq('epic_id', epic.id)
    .or(`key.eq.${trimmed},id.eq.${trimmed}`)
    .maybeSingle()
  if (error) throw new ToolError(`Failed to resolve screen "${ref}": ${error.message}`)
  if (!data) throw new ToolError(`"${ref}" is not a screen in this project's screen registry.`)
  return data.id
}

export async function createTask(admin: SupabaseClient, args: CreateTaskArgs) {
  const projectKey = args.project?.trim()
  const title = args.title?.trim()
  const agentName = resolveAgentName(args)
  if (!projectKey) throw new ToolError('"project" is required.')
  if (!title) throw new ToolError('"title" is required.')

  if (args.issue_type && !ISSUE_TYPES.includes(args.issue_type as IssueType)) {
    throw new ToolError(`Invalid issue_type "${args.issue_type}" — must be one of: ${ISSUE_TYPES.join(', ')}`)
  }
  if (args.priority && !ISSUE_PRIORITIES.includes(args.priority as IssuePriority)) {
    throw new ToolError(`Invalid priority "${args.priority}" — must be one of: ${ISSUE_PRIORITIES.join(', ')}`)
  }

  const project = await resolveProjectByKey(admin, projectKey)
  const reporterId = await resolveMcpAgentProfileId(admin)

  const assigneeId = args.assignee_email ? (await resolveProfileByEmail(admin, args.assignee_email)).id : null
  const epic = args.epic ? await resolveEpicByKeyOrTitle(admin, project.id, args.epic) : null
  const sprint = args.sprint ? await resolveSprintByName(admin, project.id, args.sprint, epic?.id) : null
  const screenId = args.implements_screen
    ? await resolveScreenTaskId(admin, project.id, args.implements_screen)
    : null

  const { data, error } = await admin
    .from('tasks')
    .insert({
      project_id: project.id,
      title,
      description: args.description ?? '',
      issue_type: args.issue_type ?? 'task',
      priority: args.priority ?? 'medium',
      assignee_id: assigneeId,
      reporter_id: reporterId,
      epic_id: epic?.id ?? null,
      sprint_id: sprint?.id ?? null,
      implements_screen_task_id: screenId,
    })
    .select('id, key, title, status')
    .single()

  if (error) throw new ToolError(`Failed to create task: ${error.message}`)

  const { error: activityError } = await admin.from('task_activities').insert({
    project_id: project.id,
    task_id: data.id,
    actor_id: reporterId,
    activity_type: 'task_created',
    message: 'Issue created',
  })
  if (activityError) {
    console.error('[mcp-server] Failed to record task_created activity', activityError.message)
  }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: project.id,
    task_id: data.id,
    action_type: 'create_task',
    payload: args,
    result: data,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return data
}
