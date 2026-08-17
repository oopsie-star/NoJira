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

/** Big enough for a full single-screen document; providers that cap lower just return less. */
const MAX_OUTPUT_TOKENS = 16000

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

  const result = await callLLM(messages, {
    maxTokens: MAX_OUTPUT_TOKENS,
    signal: options?.signal,
  })

  if (result.aborted) return { html: null, error: null, aborted: true }
  if (result.error) return { html: null, error: result.error }

  const html = extractHtmlDocument(result.content ?? '')
  if (!html) return { html: null, error: 'no-html' }

  return { html, error: null, truncated: result.finishReason === 'length' }
}
