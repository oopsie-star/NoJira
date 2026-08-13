import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { checkCrossAgentConflict, resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveTaskByKeyOrId } from './resolvers.ts'

interface AddCommentArgs {
  task?: string
  body?: string
  agent_name?: string
  confirmed_cross_agent?: boolean
}

export async function addComment(admin: SupabaseClient, args: AddCommentArgs) {
  const ref = args.task?.trim()
  const body = args.body?.trim()
  const agentName = resolveAgentName(args)
  if (!ref) throw new ToolError('"task" is required.')
  if (!body) throw new ToolError('"body" is required.')

  const task = await resolveTaskByKeyOrId(admin, ref)
  await checkCrossAgentConflict(admin, { type: 'task', id: task.id, label: task.key }, agentName, Boolean(args.confirmed_cross_agent))

  const authorId = await resolveMcpAgentProfileId(admin)

  const { data, error } = await admin
    .from('task_comments')
    .insert({ project_id: task.project_id, task_id: task.id, author_id: authorId, body })
    .select('id, created_at')
    .single()

  if (error) throw new ToolError(`Failed to add comment: ${error.message}`)

  const { error: activityError } = await admin.from('task_activities').insert({
    project_id: task.project_id,
    task_id: task.id,
    actor_id: authorId,
    activity_type: 'comment_added',
    message: `Comment added: ${body.slice(0, 120)}`,
  })
  if (activityError) {
    console.error('[mcp-server] Failed to record comment_added activity', activityError.message)
  }

  const result = { id: data.id, task_key: task.key, created_at: data.created_at }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: authorId,
    project_id: task.project_id,
    task_id: task.id,
    action_type: 'add_comment',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
