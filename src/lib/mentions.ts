import type { Profile } from '@/types'

/** Display label used for an @mention (matches the assignee dropdown). */
export function mentionLabel(member: Pick<Profile, 'full_name' | 'email'>): string {
  return (member.full_name || member.email || '').trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Matches "@<member name>" not followed by a word char, longest names first so
// "@Anna Smith" wins over "@Anna". Names can contain spaces/dots.
function buildMentionRegex(members: Profile[]): RegExp | null {
  const names = members
    .map(mentionLabel)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
  if (!names.length) return null
  return new RegExp(`@(${names.join('|')})(?!\\w)`, 'g')
}

/** Profile ids explicitly mentioned in the comment body (deduped). */
export function extractMentionedIds(body: string, members: Profile[]): string[] {
  const regex = buildMentionRegex(members)
  if (!regex) return []
  const idByName = new Map(members.map((m) => [mentionLabel(m), m.id]))
  const ids = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) !== null) {
    const id = idByName.get(match[1])
    if (id) ids.add(id)
  }
  return [...ids]
}

export type MentionPart = { type: 'text'; value: string } | { type: 'mention'; value: string }

/** Split a comment body into plain text and @mention segments for rendering. */
export function splitMentionParts(body: string, members: Profile[]): MentionPart[] {
  const regex = buildMentionRegex(members)
  if (!regex) return [{ type: 'text', value: body }]
  const parts: MentionPart[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', value: body.slice(lastIndex, match.index) })
    parts.push({ type: 'mention', value: `@${match[1]}` })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) parts.push({ type: 'text', value: body.slice(lastIndex) })
  return parts
}

/**
 * Given the text up to the caret, return the active @mention query (the text
 * after the last "@" that's still being typed), or null if not in a mention.
 */
export function activeMentionQuery(textBeforeCaret: string): { query: string; start: number } | null {
  const match = /(?:^|\s)@([\w .\-]{0,40})$/.exec(textBeforeCaret)
  if (!match) return null
  // start = index of the "@"
  return { query: match[1], start: textBeforeCaret.length - match[1].length - 1 }
}
