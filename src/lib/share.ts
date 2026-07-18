import { supabase } from '@/lib/supabase'
import { getFilename, storageBucket } from '@/lib/attachments'

// Attachment links shared into a chat must outlive the default 1h preview URLs.
const SHARE_EXPIRY_SECONDS = 60 * 60 * 24 * 7 // 7 days
// Messenger deep links are GET requests — long signed attachment URLs blow past
// the server's URI limit (Telegram/nginx returns 400). Keep the messenger text
// compact; the full links go to the clipboard instead.
const MAX_MESSENGER_TEXT = 1500

export type ShareTarget = 'telegram' | 'whatsapp' | 'viber'

/** Absolute, shareable deep link to a task (opens the task drawer via ?task=). */
export function buildTaskShareUrl(projectKey: string, taskId: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') // e.g. "/NoJira"
  return `${window.location.origin}${base}/projects/${encodeURIComponent(projectKey)}/backlog?task=${taskId}`
}

/** Long-lived signed URLs (name + url) for a task's attachment storage paths. */
export async function signedAttachmentLinks(
  paths: string[],
  nameFor: (path: string) => string = getFilename,
): Promise<{ name: string; url: string }[]> {
  if (!paths.length) return []
  const results = await Promise.all(
    paths.map(async (path) => {
      const { data } = await supabase.storage.from(storageBucket(path)).createSignedUrl(path, SHARE_EXPIRY_SECONDS)
      return data?.signedUrl ? { name: nameFor(path), url: data.signedUrl } : null
    }),
  )
  return results.filter((entry): entry is { name: string; url: string } => Boolean(entry))
}

/** Title + (clipped) description — the message body without attachments/link. */
export function taskShareBase(key: string, title: string, description: string, maxDescription = 1000): string {
  const header = `${key} — ${title}`.trim()
  const desc = (description ?? '').trim()
  const clipped = desc.length > maxDescription ? `${desc.slice(0, maxDescription).trimEnd()}…` : desc
  return clipped ? `${header}\n\n${clipped}` : header
}

/** Appends full attachment links (name + url) — for the clipboard (no length limit). */
export function withAttachments(body: string, attachments: { name: string; url: string }[], label: string): string {
  if (!attachments.length) return body
  const lines = attachments.map((a) => `• ${a.name}: ${a.url}`).join('\n')
  return `${body}\n\n${label}\n${lines}`
}

/** Appends only attachment names — compact, safe for messenger deep links. */
export function withAttachmentNames(body: string, names: string[], label: string): string {
  if (!names.length) return body
  return `${body}\n\n${label} ${names.join(', ')}`
}

/** Builds the deep-link share URL for the chosen messenger (compact body). */
export function shareHref(target: ShareTarget, body: string, taskUrl: string): string {
  const safeBody = body.length > MAX_MESSENGER_TEXT ? `${body.slice(0, MAX_MESSENGER_TEXT).trimEnd()}…` : body
  const full = `${safeBody}\n\n${taskUrl}`
  if (target === 'telegram') {
    return `https://t.me/share/url?url=${encodeURIComponent(taskUrl)}&text=${encodeURIComponent(safeBody)}`
  }
  if (target === 'whatsapp') {
    return `https://wa.me/?text=${encodeURIComponent(full)}`
  }
  return `viber://forward?text=${encodeURIComponent(full)}`
}
