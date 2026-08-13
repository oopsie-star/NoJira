import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { checkCrossAgentConflict, resolveAgentName } from './agentGate.ts'
import { decodeAttachmentBase64, safeFilename } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveEpicByKeyOrTitle, resolveMcpAgentProfileId, resolveProjectByKey } from './resolvers.ts'

interface AttachEpicFileArgs {
  project?: string
  epic?: string
  filename?: string
  content_base64?: string
  mime_type?: string
  agent_name?: string
  confirmed_cross_agent?: boolean
}

export async function attachEpicFile(admin: SupabaseClient, args: AttachEpicFileArgs) {
  const projectKey = args.project?.trim()
  const epicRef = args.epic?.trim()
  const filename = args.filename?.trim()
  const agentName = resolveAgentName(args)
  if (!projectKey) throw new ToolError('"project" is required.')
  if (!epicRef) throw new ToolError('"epic" is required.')
  if (!filename) throw new ToolError('"filename" is required.')
  if (!args.content_base64) throw new ToolError('"content_base64" is required.')

  const project = await resolveProjectByKey(admin, projectKey)
  const epic = await resolveEpicByKeyOrTitle(admin, project.id, epicRef)
  await checkCrossAgentConflict(admin, { type: 'epic', id: epic.id, label: epicRef }, agentName, Boolean(args.confirmed_cross_agent))

  const reporterId = await resolveMcpAgentProfileId(admin)
  const bytes = decodeAttachmentBase64(args.content_base64)

  const path = `${project.id}/epics/${epic.id}/${reporterId}/${Date.now()}-${safeFilename(filename)}`
  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(path, bytes, { contentType: args.mime_type || undefined })
  if (uploadError) throw new ToolError(`Failed to upload file: ${uploadError.message}`)

  const { error: updateError } = await admin
    .from('epics')
    .update({ attachments: [...epic.attachments, path] })
    .eq('id', epic.id)
  if (updateError) throw new ToolError(`Uploaded, but failed to attach to epic: ${updateError.message}`)

  const { error: noteError } = await admin
    .from('attachment_notes')
    .upsert(
      { project_id: project.id, path, original_name: filename, mime_type: args.mime_type ?? null },
      { onConflict: 'project_id,path' },
    )
  if (noteError) console.error('[mcp-server] Failed to record attachment_notes', noteError.message)

  const result = { path, name: filename }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: project.id,
    task_id: null,
    epic_id: epic.id,
    action_type: 'attach_epic_file',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
