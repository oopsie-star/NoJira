// Shared helpers for working with task attachment storage paths.
//
// Two storage buckets are in play:
//   • "attachments"      — user uploads:  projectId/taskId/authorId/timestamp-name
//   • "task-attachments" — Jira imports:  projectId/taskId/filename
// The path shape tells them apart (a real authorId is a UUID).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// User uploads get a `${Date.now()}-` prefix (13 digits) to avoid name collisions
// in storage — see AttachmentUpload.tsx / TaskDrawer.tsx. Strip it for display.
const UPLOAD_TIMESTAMP_PREFIX_RE = /^\d{13}-/

export function getFilename(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(UPLOAD_TIMESTAMP_PREFIX_RE, '')
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

// ── In-browser preview classification ──────────────────────────────────────────

export type PreviewKind = 'image' | 'pdf' | 'office' | 'markdown' | 'text' | 'video' | 'audio' | 'none'

const OFFICE_RE = /\.(docx?|xlsx?|pptx?)$/i
const MARKDOWN_RE = /\.(md|markdown)$/i
const TEXT_RE = /\.(txt|json|csv|tsv|log|ya?ml|xml|ini|conf|env|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|html?|sh|sql|php|toml)$/i
const VIDEO_RE = /\.(mp4|webm|ogv|mov|m4v)$/i
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|aac|flac)$/i

/** How an attachment should be previewed in the browser. */
export function previewKind(nameOrPath: string): PreviewKind {
  if (isImage(nameOrPath)) return 'image'
  if (PDF_RE.test(nameOrPath)) return 'pdf'
  if (OFFICE_RE.test(nameOrPath)) return 'office'
  if (MARKDOWN_RE.test(nameOrPath)) return 'markdown'
  if (TEXT_RE.test(nameOrPath)) return 'text'
  if (VIDEO_RE.test(nameOrPath)) return 'video'
  if (AUDIO_RE.test(nameOrPath)) return 'audio'
  return 'none'
}

/**
 * Embed URL for the Microsoft Office Online viewer. Renders doc(x)/xls(x)/ppt(x)
 * in an iframe. The file must be reachable over public HTTPS — Supabase signed
 * URLs are. NOTE: this sends the file to Microsoft's servers.
 */
export function officeViewerUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`
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
