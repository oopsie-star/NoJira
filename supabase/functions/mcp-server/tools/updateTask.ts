import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import {
  resolveEpicByKeyOrTitle,
  resolveMcpAgentProfileId,
  resolveProfileByEmail,
  resolveSprintByName,
  resolveTaskByKeyOrId,
} from './resolvers.ts'
import { ISSUE_PRIORITIES, type IssuePriority } from '../types.ts'

interface UpdateTaskArgs {
  task?: string
  title?: string
  description?: string
  priority?: string
  due_date?: string
  assignee_email?: string
  epic?: string
  sprint?: string
  labels?: string[]
}

export async function updateTask(admin: SupabaseClient, args: UpdateTaskArgs) {
  const ref = args.task?.trim()
  if (!ref) throw new ToolError('"task" is required.')

  if (args.priority && !ISSUE_PRIORITIES.includes(args.priority as IssuePriority)) {
    throw new ToolError(`Invalid priority "${args.priority}" — must be one of: ${ISSUE_PRIORITIES.join(', ')}`)
  }

  const task = await resolveTaskByKeyOrId(admin, ref)

  const fields: Record<string, unknown> = {}
  if (args.title !== undefined) fields.title = args.title
  if (args.description !== undefined) fields.description = args.description
  if (args.priority !== undefined) fields.priority = args.priority
  if (args.due_date !== undefined) fields.due_date = args.due_date
  if (args.labels !== undefined) fields.labels = args.labels
  if (args.assignee_email !== undefined) {
    fields.assignee_id = (await resolveProfileByEmail(admin, args.assignee_email)).id
  }
  if (args.epic !== undefined) {
    fields.epic_id = args.epic ? (await resolveEpicByKeyOrTitle(admin, task.project_id, args.epic)).id : null
  }
  if (args.sprint !== undefined) {
    fields.sprint_id = args.sprint ? (await resolveSprintByName(admin, task.project_id, args.sprint)).id : null
  }

  if (Object.keys(fields).length === 0) {
    throw new ToolError('No fields to update — provide at least one of: title, description, priority, due_date, assignee_email, epic, sprint, labels.')
  }

  const { data, error } = await admin
    .from('tasks')
    .update(fields)
    .eq('id', task.id)
    .select('id, key, title, status, priority')
    .single()

  if (error) throw new ToolError(`Failed to update task: ${error.message}`)

  const reporterId = await resolveMcpAgentProfileId(admin)
  const { error: activityError } = await admin.from('task_activities').insert({
    project_id: task.project_id,
    task_id: task.id,
    actor_id: reporterId,
    activity_type: 'task_updated',
    message: `Updated: ${Object.keys(fields).join(', ')}`,
  })
  if (activityError) {
    console.error('[mcp-server] Failed to record task_updated activity', activityError.message)
  }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_profile_id: reporterId,
    project_id: task.project_id,
    task_id: task.id,
    action_type: 'update_task',
    payload: args,
    result: data,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return data
}
