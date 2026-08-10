import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { decodeAttachmentBase64, safeFilename } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveTaskByKeyOrId } from './resolvers.ts'

interface AttachTaskFileArgs {
  task?: string
  filename?: string
  content_base64?: string
  mime_type?: string
}

export async function attachTaskFile(admin: SupabaseClient, args: AttachTaskFileArgs) {
  const ref = args.task?.trim()
  const filename = args.filename?.trim()
  if (!ref) throw new ToolError('"task" is required.')
  if (!filename) throw new ToolError('"filename" is required.')
  if (!args.content_base64) throw new ToolError('"content_base64" is required.')

  const task = await resolveTaskByKeyOrId(admin, ref)
  const reporterId = await resolveMcpAgentProfileId(admin)
  const bytes = decodeAttachmentBase64(args.content_base64)

  const path = `${task.project_id}/${task.id}/${reporterId}/${Date.now()}-${safeFilename(filename)}`
  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(path, bytes, { contentType: args.mime_type || undefined })
  if (uploadError) throw new ToolError(`Failed to upload file: ${uploadError.message}`)

  const { error: updateError } = await admin
    .from('tasks')
    .update({ attachments: [...task.attachments, path] })
    .eq('id', task.id)
  if (updateError) throw new ToolError(`Uploaded, but failed to attach to task: ${updateError.message}`)

  const { error: noteError } = await admin
    .from('attachment_notes')
    .upsert(
      { project_id: task.project_id, path, original_name: filename, mime_type: args.mime_type ?? null },
      { onConflict: 'project_id,path' },
    )
  if (noteError) console.error('[mcp-server] Failed to record attachment_notes', noteError.message)

  const { error: activityError } = await admin.from('task_activities').insert({
    project_id: task.project_id,
    task_id: task.id,
    actor_id: reporterId,
    activity_type: 'task_updated',
    message: `Attached file: ${filename}`,
  })
  if (activityError) {
    console.error('[mcp-server] Failed to record task_updated activity', activityError.message)
  }

  const result = { path, name: filename, task_key: task.key }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_profile_id: reporterId,
    project_id: task.project_id,
    task_id: task.id,
    action_type: 'attach_task_file',
    payload: args,
    result,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return result
}
