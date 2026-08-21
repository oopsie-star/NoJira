// Generation + storage plumbing for task UI prototypes. The prompt side lives in
// prototypePrompt.ts; this module turns a brief into an HTML document and gets
// that document onto the task as a normal attachment.

import { callLLM, getLLMConfig } from '@/lib/ai'
import type { LLMMessage } from '@/lib/ai'
import { getFilename } from '@/lib/attachments'
import { prototypeSystemPrompt, type PrototypePlatform } from '@/lib/prototypePrompt'

/** Prototype attachments are ordinary files; this suffix is what marks them as ours. */
const PROTOTYPE_FILE_RE = /prototype-v(\d+)\.html$/i

export function isPrototypePath(path: string): boolean {
  return PROTOTYPE_FILE_RE.test(getFilename(path))
}

export function prototypeVersion(path: string): number {
  const match = PROTOTYPE_FILE_RE.exec(getFilename(path))
  return match ? Number(match[1]) : 0
}

/** Prototype attachments on a task, newest version first. */
export function listPrototypes(attachments: string[]): string[] {
  return attachments
    .filter(isPrototypePath)
    .sort((left, right) => prototypeVersion(right) - prototypeVersion(left))
}

export function nextPrototypeFilename(attachments: string[]): string {
  const highest = listPrototypes(attachments).reduce(
    (max, path) => Math.max(max, prototypeVersion(path)),
    0
  )
  return `prototype-v${highest + 1}.html`
}

/**
 * Pull the HTML document out of a model response. Models mostly honour "return
 * only HTML", but some still wrap it in ```html fences or bracket it with a
 * sentence — slicing between the doctype/<html> and the final </html> survives
 * all three shapes.
 */
export function extractHtmlDocument(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const startMatch = /<!doctype html|<html[\s>]/i.exec(text)
  if (!startMatch) return null

  const closeIndex = text.toLowerCase().lastIndexOf('</html>')
  const end = closeIndex === -1 ? text.length : closeIndex + '</html>'.length

  const document = text.slice(startMatch.index, end).trim()
  return document.length > 0 ? document : null
}

export interface PrototypeGenerationResult {
  html: string | null
  error: string | null
  aborted?: boolean
  /** The model hit its output cap — the document is very likely cut off mid-markup. */
  truncated?: boolean
}

/**
 * Big enough for a full single-screen document; providers that cap lower just
 * return less. Kept well short of the 16k ceiling used earlier: this call is
 * non-streaming, so every one of these tokens is dead air on the wire before
 * anything comes back — a lower cap directly shortens typical wait time.
 */
const MAX_OUTPUT_TOKENS = 10000

// callLLM's fetch only aborts when the caller's signal fires (the user hitting
// Stop) — a provider that accepts the connection and then never responds would
// otherwise spin the "Generating…" state forever with no way out but a silent
// manual abort. This bounds that wait and reports it as a distinct, explained
// outcome instead.
//
// The request is non-streaming, so nothing comes back until the model has
// finished the entire document — a slower or rate-limited model can
// legitimately take several minutes here, not just seconds. An earlier version
// of this cap was 120s and it turned out to be shorter than genuine, eventually-
// successful generations were taking: it converted "slow but working" into
// "always fails" for exactly the provider/model this account has configured.
// 5 minutes is long enough to not do that again while still bounding a truly
// dead connection.
const GENERATION_TIMEOUT_MS = 300_000

export async function generatePrototypeHtml(
  brief: string,
  platform: PrototypePlatform,
  options?: { signal?: AbortSignal }
): Promise<PrototypeGenerationResult> {
  if (!getLLMConfig().apiKey) {
    return { html: null, error: 'no-api-key' }
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: prototypeSystemPrompt(platform) },
    { role: 'user', content: brief },
  ]

  // A timeout controller of our own, wired to abort alongside the caller's
  // (the modal's Stop button) — whichever fires first wins.
  const timeoutController = new AbortController()
  const onCallerAbort = () => timeoutController.abort()
  options?.signal?.addEventListener('abort', onCallerAbort)
  const timer = setTimeout(() => timeoutController.abort(), GENERATION_TIMEOUT_MS)

  let result
  try {
    result = await callLLM(messages, {
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: timeoutController.signal,
    })
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onCallerAbort)
  }

  if (result.aborted) {
    // Distinguish "you clicked Stop" from "we gave up waiting" — callLLM only
    // reports AbortError, so the caller's own signal is the tell: if it never
    // fired, the timeout must have.
    if (options?.signal?.aborted) return { html: null, error: null, aborted: true }
    return { html: null, error: 'timeout' }
  }
  if (result.error) return { html: null, error: result.error }

  const html = extractHtmlDocument(result.content ?? '')
  if (!html) return { html: null, error: 'no-html' }

  return { html, error: null, truncated: result.finishReason === 'length' }
}
