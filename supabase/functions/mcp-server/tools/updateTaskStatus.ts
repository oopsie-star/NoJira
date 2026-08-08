import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveTaskByKeyOrId } from './resolvers.ts'
import { TASK_STATUSES, type TaskStatus } from '../types.ts'

interface UpdateTaskStatusArgs {
  task?: string
  status?: string
}

export async function updateTaskStatus(admin: SupabaseClient, args: UpdateTaskStatusArgs) {
  const ref = args.task?.trim()
  if (!ref) throw new ToolError('"task" is required.')
  if (!args.status || !TASK_STATUSES.includes(args.status as TaskStatus)) {
    throw new ToolError(`Invalid status "${args.status}" — must be one of: ${TASK_STATUSES.join(', ')}`)
  }

  const task = await resolveTaskByKeyOrId(admin, ref)

  const { data, error } = await admin
    .from('tasks')
    .update({ status: args.status })
    .eq('id', task.id)
    .select('id, key, status')
    .single()

  if (error) {
    // guard_universal_task_status (see 20260704000000_universal_task_multi_assignee.sql)
    // requires is_admin()/can_manage_project(), both of which read auth.uid()
    // — always NULL under this service-role connection, so status changes on
    // tasks with 2+ assignee_ids always fail here. Known v1 limitation.
    if (error.message.includes('universal_task_status')) {
      throw new ToolError(
        `Cannot change status of ${task.key} — it has multiple assignees, and the database blocks non-admin ` +
          'status changes on shared tasks even for this trusted service connection (no authenticated user context).',
      )
    }
    throw new ToolError(`Failed to update task status: ${error.message}`)
  }

  const actorId = await resolveMcpAgentProfileId(admin)
  const { error: activityError } = await admin.from('task_activities').insert({
    project_id: task.project_id,
    task_id: task.id,
    actor_id: actorId,
    activity_type: 'task_updated',
    message: `Status changed to ${args.status}`,
  })
  if (activityError) {
    console.error('[mcp-server] Failed to record task_updated activity', activityError.message)
  }

  return { key: data.key, status: data.status }
}
