import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

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
}

export async function createTask(admin: SupabaseClient, args: CreateTaskArgs) {
  const projectKey = args.project?.trim()
  const title = args.title?.trim()
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

  return data
}
