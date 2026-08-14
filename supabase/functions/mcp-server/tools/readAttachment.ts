import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { displayFilename, projectIdFromPath } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

interface ReadAttachmentArgs {
  path?: string
}

export async function readAttachment(admin: SupabaseClient, args: ReadAttachmentArgs) {
  const path = args.path?.trim()
  if (!path) throw new ToolError('"path" is required.')

  const projectId = projectIdFromPath(path)
  if (!projectId) throw new ToolError(`"${path}" doesn't look like a valid attachment path.`)

  const { data: blob, error: downloadError } = await admin.storage.from('attachments').download(path)
  if (downloadError) throw new ToolError(`Failed to download attachment: ${downloadError.message}`)

  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ToolError(
      `Attachment is ${Math.round(bytes.length / 1024 / 1024)}MB, which exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit for files returned through MCP.`,
    )
  }

  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const contentBase64 = btoa(binary)

  const { data: note, error: noteError } = await admin
    .from('attachment_notes')
    .select('original_name, mime_type')
    .eq('project_id', projectId)
    .eq('path', path)
    .maybeSingle()
  if (noteError) throw new ToolError(`Failed to look up attachment metadata: ${noteError.message}`)

  return {
    path,
    name: displayFilename(path, note?.original_name),
    mime_type: note?.mime_type ?? blob.type ?? null,
    content_base64: contentBase64,
  }
}
