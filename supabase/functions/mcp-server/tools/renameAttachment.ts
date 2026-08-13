import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { checkCrossAgentConflict, resolveAgentName } from './agentGate.ts'
import { epicIdFromPath, projectIdFromPath, sprintIdFromPath, taskIdFromPath } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId } from './resolvers.ts'

interface RenameAttachmentArgs {
  path?: string
  new_name?: string
  agent_name?: string
  confirmed_cross_agent?: boolean
}

export async function renameAttachment(admin: SupabaseClient, args: RenameAttachmentArgs) {
  const path = args.path?.trim()
  const newName = args.new_name?.trim()
  const agentName = resolveAgentName(args)
  if (!path) throw new ToolError('"path" is required — use the path from get_task/get_project\'s attachments list.')
  if (!newName) throw new ToolError('"new_name" is required.')

  const projectId = projectIdFromPath(path)
  if (!projectId) throw new ToolError(`"${path}" doesn't look like a valid attachment path.`)

  const taskId = taskIdFromPath(path)
  const epicId = epicIdFromPath(path)
  const sprintId = sprintIdFromPath(path)
  const confirmed = Boolean(args.confirmed_cross_agent)
  if (taskId) await checkCrossAgentConflict(admin, { type: 'task', id: taskId, label: path }, agentName, confirmed)
  else if (epicId) await checkCrossAgentConflict(admin, { type: 'epic', id: epicId, label: path }, agentName, confirmed)
  else if (sprintId) await checkCrossAgentConflict(admin, { type: 'sprint', id: sprintId, label: path }, agentName, confirmed)

  const { error } = await admin
    .from('attachment_notes')
    .upsert({ project_id: projectId, path, original_name: newName }, { onConflict: 'project_id,path' })
  if (error) throw new ToolError(`Failed to rename attachment: ${error.message}`)

  const result = { path, name: newName }
  const reporterId = await resolveMcpAgentProfileId(admin)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: projectId,
    task_id: taskId,
    epic_id: epicId,
    sprint_id: sprintId,
    action_type: 'rename_attachment',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
