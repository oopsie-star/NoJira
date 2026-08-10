// Port of src/lib/attachments.ts's pure path/name helpers — that module can't
// be imported directly (Vite/browser module graph, different tsconfig from
// this Deno function), so the logic is duplicated here. Keep in sync if the
// frontend's storage-path convention ever changes.
import { ToolError } from './errors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UPLOAD_TIMESTAMP_PREFIX_RE = /^\d{13}-/

// Supabase Storage rejects object keys containing most non-ASCII characters
// ("Invalid key") — the true name (any script) is recorded separately in
// attachment_notes.original_name for display, same as the frontend does.
export function safeFilename(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, '_')
}

export function getFilename(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(UPLOAD_TIMESTAMP_PREFIX_RE, '')
}

export function displayFilename(path: string, originalName?: string | null): string {
  return originalName || getFilename(path)
}

// Task attachment paths (both the user-upload and Jira-import shapes) put the
// task id at position 1. Epic/sprint paths have a literal 'epics'/'sprints'
// there instead, which never matches the UUID shape, so this returns null.
export function taskIdFromPath(path: string): string | null {
  const taskId = path.split('/')[1]
  return taskId && UUID_RE.test(taskId) ? taskId : null
}

export function projectIdFromPath(path: string): string | null {
  const projectId = path.split('/')[0]
  return projectId && UUID_RE.test(projectId) ? projectId : null
}

// Supabase Edge Functions cap memory at 256MB per invocation; base64 adds
// ~33% on top of the original file size before it's even decoded, plus JSON
// parse overhead for the surrounding tool-call payload. 20MB keeps a wide
// safety margin rather than chasing that ceiling exactly.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function decodeAttachmentBase64(base64: string): Uint8Array {
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    throw new ToolError('content_base64 is not valid base64.')
  }
  if (binary.length > MAX_ATTACHMENT_BYTES) {
    throw new ToolError(
      `Attachment is ${Math.round(binary.length / 1024 / 1024)}MB, which exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit for files sent through MCP.`,
    )
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
