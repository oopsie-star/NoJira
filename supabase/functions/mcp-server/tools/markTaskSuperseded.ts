import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveTaskByKeyOrId } from './resolvers.ts'

interface MarkTaskSupersededArgs {
  task?: string
  superseded_by?: string
  agent_name?: string
}

export async function markTaskSuperseded(admin: SupabaseClient, args: MarkTaskSupersededArgs) {
  const ref = args.task?.trim()
  const supersededByRef = args.superseded_by?.trim()
  const agentName = resolveAgentName(args)
  if (!ref) throw new ToolError('"task" is required.')
  if (!supersededByRef) throw new ToolError('"superseded_by" is required.')

  const oldTask = await resolveTaskByKeyOrId(admin, ref)
  const newTask = await resolveTaskByKeyOrId(admin, supersededByRef)

  if (oldTask.id === newTask.id) throw new ToolError('A task cannot supersede itself.')
  if (oldTask.project_id !== newTask.project_id) {
    throw new ToolError(`"${ref}" and "${supersededByRef}" are in different projects.`)
  }

  const reporterId = await resolveMcpAgentProfileId(admin)

  const { error } = await admin.from('task_links').upsert(
    {
      project_id: oldTask.project_id,
      source_task_id: newTask.id,
      target_task_id: oldTask.id,
      link_type: 'supersedes',
      created_by: reporterId,
    },
    { onConflict: 'project_id,source_task_id,target_task_id,link_type' },
  )
  if (error) throw new ToolError(`Failed to link tasks: ${error.message}`)

  const { error: activityError } = await admin.from('task_activities').insert({
    project_id: oldTask.project_id,
    task_id: oldTask.id,
    actor_id: reporterId,
    activity_type: 'task_updated',
    message: `Marked as superseded by ${newTask.key}`,
  })
  if (activityError) console.error('[mcp-server] Failed to record task_updated activity', activityError.message)

  const result = { task_key: oldTask.key, superseded_by: newTask.key }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: oldTask.project_id,
    task_id: oldTask.id,
    action_type: 'mark_task_superseded',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
