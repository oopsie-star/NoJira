// Shared helpers for working with task attachment storage paths.
//
// Two storage buckets are in play:
//   • "attachments"      — user uploads:  projectId/taskId/authorId/timestamp-name
//   • "task-attachments" — Jira imports:  projectId/taskId/filename
// The path shape tells them apart (a real authorId is a UUID).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getFilename(path: string): string {
  return path.split('/').pop() ?? path
}

export function storageBucket(path: string): 'attachments' | 'task-attachments' {
  const parts = path.split('/')
  if (parts.length >= 4 && UUID_RE.test(parts[2])) return 'attachments'
  if (parts.length === 3) return 'task-attachments'
  return 'attachments'
}

export type AttachmentKind = 'image' | 'pdf' | 'archive' | 'file'

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)$/i
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i
const PDF_RE = /\.pdf$/i

export function isImage(nameOrPath: string): boolean {
  return IMAGE_RE.test(nameOrPath)
}

/** Classify an attachment for rendering. Prefers the MIME type when supplied. */
export function classifyAttachment(nameOrPath: string, mime?: string | null): AttachmentKind {
  if (mime) {
    if (mime.startsWith('image/')) return 'image'
    if (mime === 'application/pdf') return 'pdf'
    if (/zip|rar|7z|tar|gzip|x-compress/i.test(mime)) return 'archive'
  }
  if (isImage(nameOrPath)) return 'image'
  if (PDF_RE.test(nameOrPath)) return 'pdf'
  if (ARCHIVE_RE.test(nameOrPath)) return 'archive'
  return 'file'
}
