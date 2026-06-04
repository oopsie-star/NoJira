// Frontend helpers for Atlassian Document Format (ADF) — the rich body Jira
// stores for issue descriptions. The importer keeps the raw ADF on the task so
// images/files embedded in the description are not lost; these helpers extract
// media references and link them to imported attachments by filename.

import type { AdfNode, JiraMediaRef } from '@/types'
import { getFilename } from './attachments'

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Collect every media / mediaInline reference in the document, at any depth. */
export function extractAdfMediaRefs(adf: unknown): JiraMediaRef[] {
  const refs: JiraMediaRef[] = []

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const n = node as AdfNode
    if (n.type === 'media' || n.type === 'mediaInline') {
      const attrs = n.attrs ?? {}
      refs.push({
        id:         (attrs.id as string | undefined) ?? null,
        type:       (attrs.type as string | undefined) ?? null,
        collection: (attrs.collection as string | undefined) ?? null,
        width:      toNum(attrs.width),
        height:     toNum(attrs.height),
        alt:        (attrs.alt as string | undefined) ?? null,
        url:        (attrs.url as string | undefined) ?? null,
        localId:    (attrs.localId as string | undefined) ?? null,
      })
    }
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }

  try {
    walk(adf)
  } catch {
    /* malformed ADF — return whatever was collected */
  }
  return refs
}

/** True when the ADF carries any media node (image/file) — used to detect that a
 *  visually-empty (no text) description is in fact meaningful. */
export function adfHasMedia(adf: unknown): boolean {
  return extractAdfMediaRefs(adf).length > 0
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)$/i

/**
 * Resolve a media node's attrs to one of the task's imported attachment storage
 * paths. The link between a Jira ADF media id and a REST attachment id is not
 * exposed by the API, so we match on filename, then fall back positionally to an
 * unused image attachment (the common designer case: pasted screenshots).
 *
 * `used` is mutated so each attachment is consumed at most once.
 */
export function matchMediaToAttachment(
  attrs: Record<string, unknown> | undefined,
  attachments: string[],
  used: Set<string>,
): string | null {
  const alt = (attrs?.alt as string | undefined)?.trim()

  // 1. Exact filename match (any file kind).
  if (alt) {
    const target = alt.toLowerCase()
    const hit = attachments.find(
      (p) => !used.has(p) && getFilename(p).toLowerCase() === target,
    )
    if (hit) { used.add(hit); return hit }
  }

  // 2. Positional fallback — next unused image attachment.
  const img = attachments.find((p) => !used.has(p) && IMAGE_RE.test(p))
  if (img) { used.add(img); return img }

  // 3. Any remaining unused attachment (non-image inline file).
  const any = attachments.find((p) => !used.has(p))
  if (any) { used.add(any); return any }

  return null
}
