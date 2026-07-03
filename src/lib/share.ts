import { supabase } from '@/lib/supabase'
import { getFilename, storageBucket } from '@/lib/attachments'

// Attachment links shared into a chat must outlive the default 1h preview URLs.
const SHARE_EXPIRY_SECONDS = 60 * 60 * 24 * 7 // 7 days
const MAX_DESCRIPTION_CHARS = 1000

export type ShareTarget = 'telegram' | 'whatsapp' | 'viber'

/** Absolute, shareable deep link to a task (opens the task drawer via ?task=). */
export function buildTaskShareUrl(projectKey: string, taskId: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') // e.g. "/NoJira"
  return `${window.location.origin}${base}/projects/${encodeURIComponent(projectKey)}/backlog?task=${taskId}`
}

/** Long-lived signed URLs (name + url) for a task's attachment storage paths. */
export async function signedAttachmentLinks(paths: string[]): Promise<{ name: string; url: string }[]> {
  if (!paths.length) return []
  const results = await Promise.all(
    paths.map(async (path) => {
      const { data } = await supabase.storage.from(storageBucket(path)).createSignedUrl(path, SHARE_EXPIRY_SECONDS)
      return data?.signedUrl ? { name: getFilename(path), url: data.signedUrl } : null
    }),
  )
  return results.filter((entry): entry is { name: string; url: string } => Boolean(entry))
}

/** Title + (clipped) description — the message body without attachments/link. */
export function taskShareBase(key: string, title: string, description: string): string {
  const header = `${key} — ${title}`.trim()
  const desc = (description ?? '').trim()
  const clipped = desc.length > MAX_DESCRIPTION_CHARS ? `${desc.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…` : desc
  return clipped ? `${header}\n\n${clipped}` : header
}

/** Appends an attachment list (name + link) to a message body. */
export function withAttachments(body: string, attachments: { name: string; url: string }[], label: string): string {
  if (!attachments.length) return body
  const lines = attachments.map((a) => `• ${a.name}: ${a.url}`).join('\n')
  return `${body}\n\n${label}\n${lines}`
}

/** Builds the deep-link share URL for the chosen messenger. */
export function shareHref(target: ShareTarget, body: string, taskUrl: string): string {
  const full = `${body}\n\n${taskUrl}`
  if (target === 'telegram') {
    return `https://t.me/share/url?url=${encodeURIComponent(taskUrl)}&text=${encodeURIComponent(body)}`
  }
  if (target === 'whatsapp') {
    return `https://wa.me/?text=${encodeURIComponent(full)}`
  }
  return `viber://forward?text=${encodeURIComponent(full)}`
}
