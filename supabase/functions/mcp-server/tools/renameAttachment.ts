import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { projectIdFromPath, taskIdFromPath } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId } from './resolvers.ts'

interface RenameAttachmentArgs {
  path?: string
  new_name?: string
}

export async function renameAttachment(admin: SupabaseClient, args: RenameAttachmentArgs) {
  const path = args.path?.trim()
  const newName = args.new_name?.trim()
  if (!path) throw new ToolError('"path" is required — use the path from get_task/get_project\'s attachments list.')
  if (!newName) throw new ToolError('"new_name" is required.')

  const projectId = projectIdFromPath(path)
  if (!projectId) throw new ToolError(`"${path}" doesn't look like a valid attachment path.`)

  const { error } = await admin
    .from('attachment_notes')
    .upsert({ project_id: projectId, path, original_name: newName }, { onConflict: 'project_id,path' })
  if (error) throw new ToolError(`Failed to rename attachment: ${error.message}`)

  const result = { path, name: newName }
  const reporterId = await resolveMcpAgentProfileId(admin)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_profile_id: reporterId,
    project_id: projectId,
    task_id: taskIdFromPath(path),
    action_type: 'rename_attachment',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
