import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { decodeAttachmentBase64, safeFilename } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveProjectByKey, resolveSprintByName } from './resolvers.ts'

interface AttachSprintFileArgs {
  project?: string
  sprint?: string
  filename?: string
  content_base64?: string
  mime_type?: string
}

export async function attachSprintFile(admin: SupabaseClient, args: AttachSprintFileArgs) {
  const projectKey = args.project?.trim()
  const sprintRef = args.sprint?.trim()
  const filename = args.filename?.trim()
  if (!projectKey) throw new ToolError('"project" is required.')
  if (!sprintRef) throw new ToolError('"sprint" is required.')
  if (!filename) throw new ToolError('"filename" is required.')
  if (!args.content_base64) throw new ToolError('"content_base64" is required.')

  const project = await resolveProjectByKey(admin, projectKey)
  const sprint = await resolveSprintByName(admin, project.id, sprintRef)
  const reporterId = await resolveMcpAgentProfileId(admin)
  const bytes = decodeAttachmentBase64(args.content_base64)

  const path = `${project.id}/sprints/${sprint.id}/${reporterId}/${Date.now()}-${safeFilename(filename)}`
  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(path, bytes, { contentType: args.mime_type || undefined })
  if (uploadError) throw new ToolError(`Failed to upload file: ${uploadError.message}`)

  const { error: updateError } = await admin
    .from('sprints')
    .update({ attachments: [...sprint.attachments, path] })
    .eq('id', sprint.id)
  if (updateError) throw new ToolError(`Uploaded, but failed to attach to sprint: ${updateError.message}`)

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
    agent_profile_id: reporterId,
    project_id: project.id,
    task_id: null,
    action_type: 'attach_sprint_file',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
