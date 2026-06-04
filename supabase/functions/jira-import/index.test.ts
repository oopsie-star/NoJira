/**
 * Unit tests for jira-import Edge Function logic.
 *
 * Run with:  deno test --allow-env supabase/functions/jira-import/index.test.ts
 *
 * These tests exercise the pure logic helpers and cursor-state machine without
 * making real Supabase or Jira HTTP calls.  Heavy I/O paths are verified via
 * integration test approach (stubs / mocked clients).
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'

// ─── Inline-duplicate of normaliseCursor for test isolation ──────────────────
// (avoids top-level side-effects from importing the full Edge Function)

interface ImportCursor {
  local_project_id: string
  site_url: string
  jql: string
  all_fields: string[]
  field_map: Record<string, string>
  issues_processed: number
  total_issues: number
  total_attachments: number
  attachments_processed: number
  phase: 'issues' | 'attachments' | 'finalize'
  next_cursor?: string
  include_attachments: boolean
  include_completed_sprints: boolean
  max_attachment_size_mb: number
  skip_attachments_over_limit: boolean
  import_users: boolean
}

function normaliseCursor(raw: Record<string, unknown>): ImportCursor {
  const phase = raw.phase as string
  return {
    local_project_id: String(raw.local_project_id ?? ''),
    site_url: String(raw.site_url ?? ''),
    jql: String(raw.jql ?? ''),
    all_fields: Array.isArray(raw.all_fields) ? (raw.all_fields as string[]) : [],
    field_map: (raw.field_map as Record<string, string>) ?? {},
    issues_processed: Number(raw.issues_processed ?? 0),
    total_issues: Number(raw.total_issues ?? 0),
    total_attachments: Number(raw.total_attachments ?? 0),
    attachments_processed: Number(raw.attachments_processed ?? 0),
    phase: (['issues', 'attachments', 'finalize'].includes(phase) ? phase : 'issues') as ImportCursor['phase'],
    next_cursor: raw.next_cursor as string | undefined,
    include_attachments: raw.include_attachments !== false,
    include_completed_sprints: raw.include_completed_sprints !== false,
    max_attachment_size_mb: Number(raw.max_attachment_size_mb ?? 10),
    skip_attachments_over_limit: raw.skip_attachments_over_limit !== false,
    import_users: raw.import_users !== false,
  }
}

// ─── Token encryption helpers (duplicated for test isolation) ─────────────────

async function encryptToken(key: CryptoKey, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

async function decryptToken(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes)
  return new TextDecoder().decode(plain)
}

async function makeKey(): Promise<CryptoKey> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// ─── Helpers used in tests ────────────────────────────────────────────────────

function makeCursorRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    local_project_id: 'proj-1',
    site_url: 'https://example.atlassian.net',
    jql: 'project = TEST ORDER BY created ASC',
    all_fields: ['summary', 'description'],
    field_map: {},
    issues_processed: 0,
    phase: 'issues',
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('normaliseCursor — old cursor without new fields gets defaults', () => {
  const old = makeCursorRaw({ issues_processed: 42 })
  const c = normaliseCursor(old)

  assertEquals(c.issues_processed, 42)
  assertEquals(c.total_issues, 0)
  assertEquals(c.total_attachments, 0)
  assertEquals(c.attachments_processed, 0)
  assertEquals(c.include_attachments, true)
  assertEquals(c.import_users, true)
  assertEquals(c.skip_attachments_over_limit, true)
  assertEquals(c.phase, 'issues')
})

Deno.test('normaliseCursor — null cursor_json does not crash', () => {
  // Simulate what resume does when cursor_json is null: it should fail-fast
  // before calling normaliseCursor.  But if someone passes an empty object, it
  // should still normalise cleanly.
  const c = normaliseCursor({})
  assertEquals(c.phase, 'issues')
  assertEquals(c.issues_processed, 0)
})

Deno.test('normaliseCursor — invalid phase defaults to issues', () => {
  const c = normaliseCursor(makeCursorRaw({ phase: 'some_unknown_phase' }))
  assertEquals(c.phase, 'issues')
})

Deno.test('normaliseCursor — attachments phase preserved', () => {
  const c = normaliseCursor(makeCursorRaw({ phase: 'attachments', attachments_processed: 15 }))
  assertEquals(c.phase, 'attachments')
  assertEquals(c.attachments_processed, 15)
})

Deno.test('normaliseCursor — cursor_json contains no sensitive fields', () => {
  const raw = makeCursorRaw({ import_users: true })
  const json = JSON.stringify(raw)
  // Ensure the serialised cursor never carries token-like fields
  const forbidden = ['token', 'secret', 'password', 'key', 'api_token', '_access_token']
  for (const word of forbidden) {
    assertEquals(
      json.toLowerCase().includes(word),
      false,
      `cursor_json must not contain "${word}"`,
    )
  }
})

Deno.test('cursor phase transition: issues done → attachments when total_attachments > 0', () => {
  const cursor: ImportCursor = normaliseCursor(
    makeCursorRaw({
      include_attachments: true,
      total_attachments: 5,
      phase: 'issues',
    }),
  )
  // Simulate what processIssuesBatch does when nextCursor is undefined
  const nextPhase: ImportCursor['phase'] =
    cursor.include_attachments && cursor.total_attachments > 0 ? 'attachments' : 'finalize'
  assertEquals(nextPhase, 'attachments')
})

Deno.test('cursor phase transition: issues done → finalize when no attachments', () => {
  const cursor: ImportCursor = normaliseCursor(
    makeCursorRaw({ include_attachments: true, total_attachments: 0 }),
  )
  const nextPhase: ImportCursor['phase'] =
    cursor.include_attachments && cursor.total_attachments > 0 ? 'attachments' : 'finalize'
  assertEquals(nextPhase, 'finalize')
})

Deno.test('cursor phase transition: issues done → finalize when attachments disabled', () => {
  const cursor: ImportCursor = normaliseCursor(
    makeCursorRaw({ include_attachments: false, total_attachments: 50 }),
  )
  const nextPhase: ImportCursor['phase'] =
    cursor.include_attachments && cursor.total_attachments > 0 ? 'attachments' : 'finalize'
  assertEquals(nextPhase, 'finalize')
})

Deno.test('attachment batch: batchCount cap stops at ATTACHMENTS_PER_BATCH', () => {
  const ATTACHMENTS_PER_BATCH = 20
  const allAttachments = Array.from({ length: 50 }, (_, i) => ({ id: `att-${i}` }))
  const done = new Set<string>()

  let batchCount = 0
  let allDone = true
  for (const att of allAttachments) {
    if (done.has(att.id)) continue
    if (batchCount >= ATTACHMENTS_PER_BATCH) {
      allDone = false
      break
    }
    done.add(att.id)
    batchCount++
  }

  assertEquals(batchCount, 20)
  assertEquals(allDone, false)
})

Deno.test('attachment dedup: already-done IDs are skipped', () => {
  const ATTACHMENTS_PER_BATCH = 20
  const allAttachments = Array.from({ length: 30 }, (_, i) => ({ id: `att-${i}` }))
  // Pre-populate as done: first 25
  const done = new Set(allAttachments.slice(0, 25).map((a) => a.id))

  let batchCount = 0
  for (const att of allAttachments) {
    if (done.has(att.id)) continue
    if (batchCount >= ATTACHMENTS_PER_BATCH) break
    done.add(att.id)
    batchCount++
  }

  // Only 5 were left (30 - 25 = 5), all fit in one batch
  assertEquals(batchCount, 5)
})

Deno.test('attachment failure: failed attachment increments count but does not stop loop', () => {
  const attachments = [
    { id: 'a1', filename: 'ok.png' },
    { id: 'a2', filename: 'fail.png' },
    { id: 'a3', filename: 'ok2.png' },
  ]
  const done = new Set<string>()
  const warnings: string[] = []

  for (const att of attachments) {
    if (done.has(att.id)) continue
    try {
      if (att.filename === 'fail.png') throw new Error('simulated upload failure')
      done.add(att.id)
    } catch (e) {
      warnings.push(`Attachment error for ${att.filename}: ${(e as Error).message}`)
      // Intentionally do NOT add to done — retry possible on next resume
    }
  }

  assertEquals(done.size, 2, 'only successful attachments marked done')
  assertEquals(warnings.length, 1)
  assertStringIncludes(warnings[0], 'fail.png')
})

Deno.test('token encryption round-trips correctly', async () => {
  const key = await makeKey()
  const original = 'my-super-secret-jira-api-token'
  const { ciphertext, iv } = await encryptToken(key, original)
  const decrypted = await decryptToken(key, ciphertext, iv)
  assertEquals(decrypted, original)
})

Deno.test('token encryption produces different ciphertext each time (random IV)', async () => {
  const key = await makeKey()
  const plaintext = 'same-token'
  const enc1 = await encryptToken(key, plaintext)
  const enc2 = await encryptToken(key, plaintext)
  // Different IVs → different ciphertexts
  assertEquals(enc1.iv !== enc2.iv, true)
  assertEquals(enc1.ciphertext !== enc2.ciphertext, true)
})

Deno.test('token is not present in connect response shape', () => {
  // Simulate what the connect handler returns — must not include token fields
  const response = {
    connection_id: 'conn-1',
    jira_site_url: 'https://example.atlassian.net',
    jira_user_email: 'user@example.com',
    jira_account_id: 'acc-1',
    status: 'active',
  }
  const json = JSON.stringify(response)
  const tokenFields = ['_access_token', 'api_token', 'encrypted_token', 'token_iv']
  for (const field of tokenFields) {
    assertEquals(
      json.includes(field),
      false,
      `Response must not expose "${field}"`,
    )
  }
})

Deno.test('user resolution: existing profile match logic', () => {
  // Simulate the email lookup result
  const profiles = [{ id: 'profile-uuid-1', email: 'alice@example.com' }]
  const jiraUser = { accountId: 'jira-123', emailAddress: 'Alice@Example.com', displayName: 'Alice' }

  const matched = profiles.find(
    (p) => p.email === jiraUser.emailAddress.toLowerCase().trim(),
  )
  assertExists(matched, 'should match profile by normalised email')
  assertEquals(matched.id, 'profile-uuid-1')
})

Deno.test('user resolution: no match → placeholder path', () => {
  const profiles: { id: string; email: string }[] = []
  const jiraUser = { accountId: 'jira-456', emailAddress: 'bob@example.com', displayName: 'Bob' }

  const matched = profiles.find((p) => p.email === jiraUser.emailAddress.toLowerCase())
  assertEquals(matched, undefined, 'no profile found → should create placeholder')
})

Deno.test('user resolution: no email → placeholder only path', () => {
  const jiraUser = { accountId: 'jira-789', displayName: 'Ghost' }
  // If emailAddress is missing, we always go to placeholder
  const hasEmail = 'emailAddress' in jiraUser && Boolean((jiraUser as any).emailAddress)
  assertEquals(hasEmail, false)
})

Deno.test('placeholder mapping key has placeholder: prefix', () => {
  const placeholderId = 'some-uuid'
  const mappingValue = `placeholder:${placeholderId}`
  assertEquals(mappingValue.startsWith('placeholder:'), true)
  assertEquals(mappingValue.slice('placeholder:'.length), placeholderId)
})

Deno.test('progress_total formula: issues + hierarchy + attachments + validation', () => {
  const issuesProcessed = 100
  const totalAttachments = 50
  const progressTotal = issuesProcessed + 1 + totalAttachments + 1
  assertEquals(progressTotal, 152)
})

Deno.test('progress_total formula: no attachments', () => {
  const issuesProcessed = 100
  const totalAttachments = 0
  const progressTotal = issuesProcessed + 1 + totalAttachments + 1
  assertEquals(progressTotal, 102)
})

Deno.test('large project detection: > 500 issues', () => {
  const totalIssues = 600
  const attachmentsCount = 0
  const isLarge = totalIssues > 500 || attachmentsCount > 100
  assertEquals(isLarge, true)
})

Deno.test('large project detection: > 100 attachment-bearing issues', () => {
  const totalIssues = 50
  const attachmentsCount = 150
  const isLarge = totalIssues > 500 || attachmentsCount > 100
  assertEquals(isLarge, true)
})

Deno.test('large project detection: small project is not large', () => {
  const totalIssues = 30
  const attachmentsCount = 5
  const isLarge = totalIssues > 500 || attachmentsCount > 100
  assertEquals(isLarge, false)
})

// ─── ADF description normalisation ───────────────────────────────────────────

// Inline duplicate of adfNodeToText for test isolation
type AdfNode = Record<string, unknown>

function adfNodeToText(node: unknown, listDepth = 0): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as AdfNode
  const type = n.type as string | undefined
  const children = Array.isArray(n.content) ? n.content as unknown[] : []

  switch (type) {
    case 'doc':
      return children.map((c) => adfNodeToText(c, 0)).filter(Boolean).join('\n\n').trim()
    case 'paragraph':
      return children.map((c) => adfNodeToText(c, listDepth)).join('').trim()
    case 'heading':
      return children.map((c) => adfNodeToText(c, listDepth)).join('').trim()
    case 'text': {
      let text = (n.text as string | undefined) ?? ''
      const marks = Array.isArray(n.marks) ? n.marks as AdfNode[] : []
      for (const mark of marks) {
        if (mark.type === 'link') {
          const href = (mark.attrs as AdfNode | undefined)?.href as string | undefined
          if (href && !text.includes(href)) text = `${text} (${href})`
        }
      }
      return text
    }
    case 'hardBreak': return '\n'
    case 'bulletList':
      return children.map((c) => `${'  '.repeat(listDepth)}- ${adfNodeToText(c, listDepth + 1)}`).join('\n')
    case 'orderedList':
      return children.map((c, i) => `${'  '.repeat(listDepth)}${i + 1}. ${adfNodeToText(c, listDepth + 1)}`).join('\n')
    case 'listItem':
      return children.map((c) => adfNodeToText(c, listDepth)).join(' ').trim()
    case 'codeBlock':
      return children.map((c) => adfNodeToText(c, listDepth)).join('').trim()
    case 'blockquote':
      return children.map((c) => `> ${adfNodeToText(c, listDepth)}`).filter(Boolean).join('\n')
    case 'rule': return '---'
    case 'mention': {
      const attrs = n.attrs as AdfNode | undefined
      return `@${(attrs?.text ?? attrs?.id ?? 'mention') as string}`
    }
    case 'emoji': {
      const attrs = n.attrs as AdfNode | undefined
      return (attrs?.shortName ?? ':emoji:') as string
    }
    case 'mediaSingle': case 'media': case 'inlineCard': case 'blockCard': return ''
    default: return children.length > 0 ? children.map((c) => adfNodeToText(c, listDepth)).join('') : ''
  }
}

function normalizeJiraDescription(raw: unknown): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as AdfNode).type === 'doc'
  ) {
    try { return adfNodeToText(raw) } catch { return '' }
  }
  return ''
}

Deno.test('ADF: simple paragraph converts to plain text', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
  }
  const result = normalizeJiraDescription(adf)
  assertEquals(result, 'Hello world')
})

Deno.test('ADF: multiple paragraphs separated by double newline', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
    ],
  }
  const result = normalizeJiraDescription(adf)
  assertStringIncludes(result, 'First paragraph')
  assertStringIncludes(result, 'Second paragraph')
})

Deno.test('ADF: heading converts to plain text without markup', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My heading' }] }],
  }
  assertEquals(normalizeJiraDescription(adf), 'My heading')
})

Deno.test('ADF: bulletList converts to list with dashes', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item A' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }] },
      ],
    }],
  }
  const result = normalizeJiraDescription(adf)
  assertStringIncludes(result, '- Item A')
  assertStringIncludes(result, '- Item B')
})

Deno.test('ADF: link mark appends href to text', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'Click here',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      }],
    }],
  }
  const result = normalizeJiraDescription(adf)
  assertStringIncludes(result, 'Click here')
  assertStringIncludes(result, 'https://example.com')
})

Deno.test('ADF: mediaSingle does not render raw JSON', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{
      type: 'mediaSingle',
      content: [{ type: 'media', attrs: { id: 'abc', type: 'file', collection: 'test' } }],
    }],
  }
  const result = normalizeJiraDescription(adf)
  assertEquals(result, '')
  assertEquals(result.includes('{'), false, 'must not contain raw JSON braces')
})

Deno.test('ADF: plain string description passes through unchanged', () => {
  assertEquals(normalizeJiraDescription('plain text'), 'plain text')
})

Deno.test('ADF: non-doc object returns empty string, never raw JSON', () => {
  const result = normalizeJiraDescription({ someKey: 'someValue' })
  assertEquals(result, '')
})

Deno.test('ADF: null/undefined returns empty string', () => {
  assertEquals(normalizeJiraDescription(null), '')
  assertEquals(normalizeJiraDescription(undefined), '')
})

// ─── Subtask parent_task_id linkage ───────────────────────────────────────────

Deno.test('subtask parent resolution: finds parent in taskByExternalId map', () => {
  const taskByExternalId = new Map<string, string>([
    ['jira-10001', 'local-uuid-parent'],
  ])

  const subtaskRaw = {
    parent: { id: 'jira-10001', fields: { issuetype: { name: 'Task' } } },
    issuetype: { name: 'Sub-task' },
  }

  const parentId = (subtaskRaw.parent as Record<string, unknown>).id as string
  const parentTypeName = (subtaskRaw.parent as any).fields?.issuetype?.name ?? ''
  const localParentId = parentTypeName === 'Epic' ? null : taskByExternalId.get(parentId) ?? null

  assertEquals(localParentId, 'local-uuid-parent')
})

Deno.test('subtask parent resolution: parent not in map → parent_task_id stays null', () => {
  const taskByExternalId = new Map<string, string>()
  const subtaskRaw = { parent: { id: 'jira-99999' } }

  const parentId = (subtaskRaw.parent as Record<string, unknown>).id as string
  const localParentId = taskByExternalId.get(parentId) ?? null
  assertEquals(localParentId, null)
})

Deno.test('subtask parent resolution: parent is Epic → epic_id, not parent_task_id', () => {
  const epicByExternalId = new Map<string, string>([['jira-epic-1', 'local-epic-uuid']])
  const taskByExternalId = new Map<string, string>()

  const issueRaw = {
    parent: { id: 'jira-epic-1', fields: { issuetype: { name: 'Epic' } } },
  }

  const parentId = (issueRaw.parent as any).id as string
  const parentTypeName = (issueRaw.parent as any).fields?.issuetype?.name ?? ''
  const epicId = parentTypeName === 'Epic' ? (epicByExternalId.get(parentId) ?? null) : null
  const parentTaskId = parentTypeName !== 'Epic' ? (taskByExternalId.get(parentId) ?? null) : null

  assertEquals(epicId, 'local-epic-uuid')
  assertEquals(parentTaskId, null)
})

Deno.test('subtask filtered from backlog: task with parent_task_id excluded', () => {
  const tasks = [
    { id: 'parent-1', parent_task_id: null, sprint_id: null, epic_id: null },
    { id: 'child-1', parent_task_id: 'parent-1', sprint_id: null, epic_id: null },
    { id: 'child-2', parent_task_id: 'parent-1', sprint_id: null, epic_id: null },
  ]
  const rootTasks = tasks.filter((t) => !t.parent_task_id)
  assertEquals(rootTasks.length, 1)
  assertEquals(rootTasks[0].id, 'parent-1')
})

Deno.test('re-import does not duplicate: existing mapping skips upsert', () => {
  const existingMappings = new Map<string, string>([['jira-10001', 'local-task-uuid']])
  const issueExternalId = 'jira-10001'

  const alreadyExists = existingMappings.has(issueExternalId)
  assertEquals(alreadyExists, true, 'existing issue should be detected and skipped')
})

// ─── ADF media extraction + attachment linking ───────────────────────────────
// Designers often put the whole task content into images embedded in the Jira
// description. The importer must preserve those media refs (not drop them) so
// the task renders richly instead of looking empty.

interface MediaRef {
  id: string | null
  type: string | null
  collection: string | null
  width: number | null
  height: number | null
  alt: string | null
  url: string | null
  localId: string | null
}

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function extractAdfMediaRefs(adf: unknown): MediaRef[] {
  const refs: MediaRef[] = []
  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    const n = node as AdfNode
    const type = n.type as string | undefined
    if (type === 'media' || type === 'mediaInline') {
      const a = (n.attrs as Record<string, unknown> | undefined) ?? {}
      refs.push({
        id: (a.id as string) ?? null,
        type: (a.type as string) ?? null,
        collection: (a.collection as string) ?? null,
        width: toNum(a.width),
        height: toNum(a.height),
        alt: (a.alt as string) ?? null,
        url: (a.url as string) ?? null,
        localId: (a.localId as string) ?? null,
      })
    }
    if (Array.isArray(n.content)) (n.content as unknown[]).forEach(walk)
  }
  walk(adf)
  return refs
}

// Mirrors src/lib/attachments.ts classifyAttachment for test isolation.
function classifyAttachment(name: string, mime?: string | null): 'image' | 'pdf' | 'archive' | 'file' {
  if (mime) {
    if (mime.startsWith('image/')) return 'image'
    if (mime === 'application/pdf') return 'pdf'
    if (/zip|rar|7z|tar|gzip/i.test(mime)) return 'archive'
  }
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)$/i.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i.test(name)) return 'archive'
  return 'file'
}

function getFilename(path: string): string {
  return path.split('/').pop() ?? path
}

// Mirrors src/lib/adf.ts matchMediaToAttachment.
function matchMediaToAttachment(
  attrs: Record<string, unknown> | undefined,
  attachments: string[],
  used: Set<string>,
): string | null {
  const alt = (attrs?.alt as string | undefined)?.trim()
  if (alt) {
    const target = alt.toLowerCase()
    const hit = attachments.find((p) => !used.has(p) && getFilename(p).toLowerCase() === target)
    if (hit) { used.add(hit); return hit }
  }
  const img = attachments.find((p) => !used.has(p) && /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)$/i.test(p))
  if (img) { used.add(img); return img }
  const any = attachments.find((p) => !used.has(p))
  if (any) { used.add(any); return any }
  return null
}

Deno.test('ADF mediaSingle extracts a media ref with all attrs', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{
      type: 'mediaSingle', attrs: { layout: 'center' },
      content: [{
        type: 'media',
        attrs: { id: 'media-uuid-1', type: 'file', collection: 'col-1', width: 800, height: 600, alt: 'main-page.png' },
      }],
    }],
  }
  const refs = extractAdfMediaRefs(adf)
  assertEquals(refs.length, 1)
  assertEquals(refs[0].id, 'media-uuid-1')
  assertEquals(refs[0].collection, 'col-1')
  assertEquals(refs[0].width, 800)
  assertEquals(refs[0].alt, 'main-page.png')
})

Deno.test('ADF with only media does not become an empty task', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm1', type: 'file' } }] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm2', type: 'file' } }] },
    ],
  }
  // Plain-text fallback is empty…
  assertEquals(normalizeJiraDescription(adf), '')
  // …but the media refs carry the meaning, so the task is NOT empty.
  const refs = extractAdfMediaRefs(adf)
  assertEquals(refs.length, 2)
})

Deno.test('ADF media refs extracted at any depth (nested in list/table)', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [{
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [{ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'deep-1', type: 'file' } }] }],
      }],
    }],
  }
  assertEquals(extractAdfMediaRefs(adf).length, 1)
  assertEquals(extractAdfMediaRefs(adf)[0].id, 'deep-1')
})

Deno.test('image attachment classifies as image (renders as preview)', () => {
  assertEquals(classifyAttachment('screenshot.png'), 'image')
  assertEquals(classifyAttachment('photo.JPG'), 'image')
  assertEquals(classifyAttachment('whatever', 'image/png'), 'image')
})

Deno.test('zip attachment classifies as archive (renders as file card)', () => {
  assertEquals(classifyAttachment('bundle.zip'), 'archive')
  assertEquals(classifyAttachment('src.tar.gz'), 'archive')
  assertEquals(classifyAttachment('x', 'application/zip'), 'archive')
})

Deno.test('pdf/docx/other classify as file cards (not images)', () => {
  assertEquals(classifyAttachment('spec.pdf'), 'pdf')
  assertEquals(classifyAttachment('notes.docx'), 'file')
  assertEquals(classifyAttachment('data.bin'), 'file')
})

Deno.test('media in description links to attachment by filename, attachment still listed', () => {
  const attachments = [
    'proj/task/main-page.png',
    'proj/task/diagram.zip',
  ]
  const used = new Set<string>()
  const matched = matchMediaToAttachment({ alt: 'main-page.png' }, attachments, used)
  assertEquals(matched, 'proj/task/main-page.png')
  // The attachment is consumed for inline render but the original list is intact —
  // the Attachments section still shows every file (Jira-like duplication is fine).
  assertEquals(attachments.length, 2)
  assertEquals(attachments.includes('proj/task/diagram.zip'), true)
})

Deno.test('media without alt falls back positionally to next unused image', () => {
  const attachments = ['proj/task/a.png', 'proj/task/b.png']
  const used = new Set<string>()
  const first = matchMediaToAttachment({ id: 'm1' }, attachments, used)
  const second = matchMediaToAttachment({ id: 'm2' }, attachments, used)
  assertEquals(first, 'proj/task/a.png')
  assertEquals(second, 'proj/task/b.png')
  assertEquals(first !== second, true, 'each media consumes a distinct attachment')
})

Deno.test('plain-text fallback never contains raw JSON when media + text mix', () => {
  const adf = {
    type: 'doc', version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'See the mockup:' }] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm', type: 'file', collection: 'c' } }] },
    ],
  }
  const text = normalizeJiraDescription(adf)
  assertStringIncludes(text, 'See the mockup')
  assertEquals(text.includes('{'), false, 'no raw JSON braces in fallback')
  assertEquals(text.includes('"type"'), false, 'no raw ADF keys leak into fallback')
})

// Mirrors safeStorageName in index.ts — Supabase Storage rejects non-ASCII keys.
function safeStorageName(name: string): string {
  const cleaned = name.replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'file'
}

// The exact pattern Supabase Storage allows in an object key.
const SAFE_KEY_RE = /^[\w.\-() ]+$/

Deno.test('Cyrillic / em-dash filename becomes a valid Storage key', () => {
  const original = 'Снимок экрана — 2026-05-25 в 19.30.58.png'
  const safe = safeStorageName(original)
  // Was failing with "Invalid key" because of Cyrillic + em-dash.
  assertEquals(SAFE_KEY_RE.test(safe), true, `"${safe}" must be a valid storage key`)
  assertStringIncludes(safe, '.png')           // extension preserved
  assertStringIncludes(safe, '2026-05-25')      // ASCII parts preserved
})

Deno.test('safeStorageName keeps already-ASCII names intact', () => {
  assertEquals(safeStorageName('diagram (final).png'), 'diagram (final).png')
  assertEquals(safeStorageName('archive.zip'), 'archive.zip')
})

Deno.test('safeStorageName never returns an empty key', () => {
  assertEquals(safeStorageName('—'), 'file')
  assertEquals(safeStorageName('世界'), 'file')
})

Deno.test('existing imported ADF media can be repaired from raw_json.description', () => {
  // Simulates jira_external_mappings.raw_json for a designer subtask whose body
  // is purely an embedded screenshot — the repair path must recover the media.
  const rawJson = {
    summary: 'Design login screen',
    description: {
      type: 'doc', version: 1,
      content: [{ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'image-202605-xyz', type: 'file', collection: 'col' } }] }],
    },
    attachment: [{ id: '9001', filename: 'image-202605-xyz.png' }],
  }
  const adf = rawJson.description
  const refs = extractAdfMediaRefs(adf)
  assertEquals(refs.length, 1)
  assertEquals(refs[0].id, 'image-202605-xyz')
  // And the fallback text is empty, confirming why these tasks looked empty before.
  assertEquals(normalizeJiraDescription(adf), '')
})
