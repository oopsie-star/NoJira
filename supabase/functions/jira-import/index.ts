import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Optional: base64-encoded 32-byte AES-256 key for encrypting Jira API tokens at rest.
// Generate with: openssl rand -base64 32
// TODO BLOCKER: Set JIRA_TOKEN_ENCRYPTION_KEY in Supabase project secrets for production.
//   Without it, tokens fall back to plaintext storage (_access_token column).
const JIRA_TOKEN_KEY_B64 = Deno.env.get('JIRA_TOKEN_ENCRYPTION_KEY') ?? ''

const EPIC_COLORS = [
  '#0C66E4', '#6554C0', '#00B8D9', '#36B37E',
  '#FF5630', '#FF8B00', '#4C9AFF', '#57D9A3',
]

// Attachments processed per resume call (avoids Edge Function timeout).
const ATTACHMENTS_PER_BATCH = 20

// ── Token encryption (AES-GCM via Web Crypto) ─────────────────────────────────

let _cachedEncKey: CryptoKey | null | undefined = undefined

async function getEncryptionKey(): Promise<CryptoKey | null> {
  if (_cachedEncKey !== undefined) return _cachedEncKey
  if (!JIRA_TOKEN_KEY_B64) { _cachedEncKey = null; return null }
  try {
    const rawKey = Uint8Array.from(atob(JIRA_TOKEN_KEY_B64), (c) => c.charCodeAt(0))
    if (rawKey.length !== 32) {
      console.warn('[jira-import] JIRA_TOKEN_ENCRYPTION_KEY must decode to 32 bytes. Using plaintext fallback.')
      _cachedEncKey = null
      return null
    }
    _cachedEncKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    return _cachedEncKey
  } catch {
    _cachedEncKey = null
    return null
  }
}

async function encryptToken(plaintext: string): Promise<{ ciphertext: string; iv: string } | null> {
  const key = await getEncryptionKey()
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

async function decryptToken(ciphertext: string, iv: string): Promise<string | null> {
  const key = await getEncryptionKey()
  if (!key) return null
  try {
    const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

/** Returns the plaintext API token: decrypts if available, falls back to _access_token. */
async function getPlaintextToken(conn: {
  _access_token: string | null
  encrypted_token?: string | null
  token_iv?: string | null
}): Promise<string> {
  if (conn.encrypted_token && conn.token_iv) {
    const decrypted = await decryptToken(conn.encrypted_token, conn.token_iv)
    if (decrypted) return decrypted
  }
  return conn._access_token ?? ''
}

// ── Response helpers ───────────────────────────────────────────────────────────

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitizeError(message: string): string {
  // Never leak tokens — remove anything that looks like a credential
  return message
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .slice(0, 500)
}

// Build a strict, ASCII-only storage key slug. Supabase Storage not only rejects
// non-ASCII keys ("Invalid key") but also fails to produce working signed URLs
// for keys containing spaces — so the slug keeps ONLY [A-Za-z0-9.-] and turns
// everything else (spaces, parens, Cyrillic, em-dashes…) into "-". The extension
// is preserved; the attachment id is prefixed by the caller for uniqueness.
function safeStorageName(name: string): string {
  const dot = name.lastIndexOf('.')
  const rawExt = dot > 0 ? name.slice(dot + 1) : ''
  const ext = /^[A-Za-z0-9]{1,8}$/.test(rawExt) ? `.${rawExt.toLowerCase()}` : ''
  const base = (ext ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (base.length > 0 ? base : 'file') + ext
}

// ── Atlassian Document Format → plain text ────────────────────────────────────

function adfNodeToText(node: unknown, listDepth = 0): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
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
      const marks = Array.isArray(n.marks) ? n.marks as Record<string, unknown>[] : []
      for (const mark of marks) {
        if (mark.type === 'link') {
          const href = (mark.attrs as Record<string, unknown> | undefined)?.href as string | undefined
          if (href && !text.includes(href)) text = `${text} (${href})`
        }
      }
      return text
    }

    case 'hardBreak':
      return '\n'

    case 'bulletList':
      return children
        .map((c) => `${'  '.repeat(listDepth)}- ${adfNodeToText(c, listDepth + 1)}`)
        .join('\n')

    case 'orderedList':
      return children
        .map((c, i) => `${'  '.repeat(listDepth)}${i + 1}. ${adfNodeToText(c, listDepth + 1)}`)
        .join('\n')

    case 'listItem':
      return children.map((c) => adfNodeToText(c, listDepth)).join(' ').trim()

    case 'codeBlock':
      return children.map((c) => adfNodeToText(c, listDepth)).join('').trim()

    case 'blockquote':
      return children.map((c) => `> ${adfNodeToText(c, listDepth)}`).filter(Boolean).join('\n')

    case 'rule':
      return '---'

    case 'mention': {
      const attrs = n.attrs as Record<string, unknown> | undefined
      return `@${(attrs?.text ?? attrs?.id ?? 'mention') as string}`
    }

    case 'emoji': {
      const attrs = n.attrs as Record<string, unknown> | undefined
      return (attrs?.shortName ?? ':emoji:') as string
    }

    // Skip media, embeds, cards — they appear as attachments in the task
    case 'mediaSingle':
    case 'media':
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
    case 'expand':
      return ''

    default:
      return children.length > 0
        ? children.map((c) => adfNodeToText(c, listDepth)).join('')
        : ''
  }
}

/** Convert a Jira ADF document (or plain string) to a plain-text description. */
function normalizeJiraDescription(raw: unknown): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).type === 'doc'
  ) {
    try {
      return adfNodeToText(raw)
    } catch {
      return ''
    }
  }
  return ''
}

// ── ADF media extraction ──────────────────────────────────────────────────────
// Plain text is only a *fallback*. For designer tasks the meaning lives inside
// images embedded in the description, so we must NOT throw media nodes away.
// extractAdfMediaRefs walks the document and records every media reference so the
// UI can render images / file cards inline and link them to imported attachments.

interface JiraMediaRef {
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

function extractAdfMediaRefs(adf: unknown): JiraMediaRef[] {
  const refs: JiraMediaRef[] = []

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const c of node) walk(c)
      return
    }
    const n = node as Record<string, unknown>
    const type = n.type as string | undefined
    if (type === 'media' || type === 'mediaInline') {
      const attrs = (n.attrs as Record<string, unknown> | undefined) ?? {}
      refs.push({
        id: (attrs.id as string | undefined) ?? null,
        type: (attrs.type as string | undefined) ?? null,
        collection: (attrs.collection as string | undefined) ?? null,
        width: toNum(attrs.width),
        height: toNum(attrs.height),
        alt: (attrs.alt as string | undefined) ?? null,
        url: (attrs.url as string | undefined) ?? null,
        localId: (attrs.localId as string | undefined) ?? null,
      })
    }
    if (Array.isArray(n.content)) {
      for (const c of n.content as unknown[]) walk(c)
    }
  }

  try {
    walk(adf)
  } catch {
    // Malformed ADF — return whatever we collected so far (never throw).
  }
  return refs
}

/** Returns the raw ADF document when `raw` is one, else null. */
function adfDocOrNull(raw: unknown): Record<string, unknown> | null {
  if (
    raw && typeof raw === 'object' &&
    (raw as Record<string, unknown>).type === 'doc'
  ) {
    return raw as Record<string, unknown>
  }
  return null
}

// ── Field / status / priority mapping ─────────────────────────────────────────

// Returns null for unrecognised statuses so callers can add a warning.
function mapJiraStatus(jiraStatus: string): 'todo' | 'in_progress' | 'done' | null {
  const s = jiraStatus.toLowerCase().trim()
  if (['to do', 'todo', 'open', 'backlog', 'new', 'created', 'ready', 'selected for development'].includes(s)) return 'todo'
  if (['in progress', 'in_progress', 'in review', 'review', 'testing', 'doing', 'started', 'in development', 'development'].includes(s)) return 'in_progress'
  if (['done', 'closed', 'resolved', 'complete', 'completed', 'fixed', "won't fix", 'wont fix', 'cancelled', 'invalid', 'duplicate'].includes(s)) return 'done'
  return null
}

function mapJiraPriority(p: string): 'lowest' | 'low' | 'medium' | 'high' | 'highest' {
  const priority = (p ?? 'medium').toLowerCase().trim()
  if (['highest', 'critical', 'blocker'].includes(priority)) return 'highest'
  if (['high', 'major'].includes(priority)) return 'high'
  if (['medium', 'normal'].includes(priority)) return 'medium'
  if (['low', 'minor'].includes(priority)) return 'low'
  if (['lowest', 'trivial'].includes(priority)) return 'lowest'
  return 'medium'
}

function mapJiraIssueType(typeName: string): 'task' | 'story' | 'bug' {
  const t = typeName.toLowerCase().trim()
  if (t === 'story' || t === 'user story') return 'story'
  if (t === 'bug' || t === 'defect') return 'bug'
  return 'task'
}

// ── JiraClient ─────────────────────────────────────────────────────────────────

class JiraClient {
  private baseUrl: string
  private authHeader: string

  constructor(siteUrl: string, email: string, apiToken: string) {
    const normalized = siteUrl.trim().replace(/\/$/, '')
    this.baseUrl = normalized.startsWith('http') ? normalized : `https://${normalized}`
    this.authHeader = `Basic ${btoa(`${email}:${apiToken}`)}`
  }

  private async request<T>(path: string, options?: RequestInit, retries = 3): Promise<T> {
    const url = `${this.baseUrl}${path}`

    for (let attempt = 0; attempt <= retries; attempt++) {
      let response: Response
      try {
        response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': this.authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options?.headers ?? {}),
          },
        })
      } catch (networkError) {
        if (attempt < retries) {
          await delay(Math.pow(2, attempt) * 500)
          continue
        }
        throw new Error(`Network error calling Jira API`)
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt + 1) * 1000
        if (attempt < retries) {
          await delay(waitMs)
          continue
        }
        throw new Error('Jira rate limit exceeded')
      }

      if (response.status >= 500 && attempt < retries) {
        await delay(Math.pow(2, attempt) * 1000)
        continue
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        console.error('[jira-import] Jira API error', {
          path: path.split('?')[0],
          status: response.status,
          body: bodyText.slice(0, 400),
        })
        throw new Error(`Jira API error: ${response.status}`)
      }

      return response.json() as Promise<T>
    }

    throw new Error('Jira API request failed after retries')
  }

  async getMyself(): Promise<{ accountId: string; emailAddress: string; displayName: string }> {
    return this.request('/rest/api/3/myself')
  }

  async listProjects(startAt = 0): Promise<{ values: any[]; isLast: boolean }> {
    return this.request(`/rest/api/3/project/search?typeKey=software&maxResults=50&startAt=${startAt}&expand=description`)
  }

  async listBoards(projectKey: string, startAt = 0): Promise<{ values: any[]; isLast: boolean }> {
    return this.request(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50&startAt=${startAt}`)
  }

  async listSprints(boardId: string, startAt = 0): Promise<{ values: any[]; isLast: boolean; total: number }> {
    return this.request(`/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=50`)
  }

  // Issues sitting in the board's *backlog* (not on the board). Used to mirror
  // Jira's Board/Backlog split. Works for Kanban (with backlog) and Scrum boards.
  async listBoardBacklog(boardId: string, startAt = 0): Promise<{ issues: any[]; total: number }> {
    const result = await this.request<{ issues: any[]; total: number; maxResults: number; startAt: number }>(
      `/rest/agile/1.0/board/${boardId}/backlog?startAt=${startAt}&maxResults=50&fields=id`,
    )
    return { issues: result.issues ?? [], total: result.total ?? 0 }
  }

  async discoverFields(): Promise<Record<string, string>> {
    const fields = await this.request<any[]>('/rest/api/3/field')
    const map: Record<string, string> = {}

    for (const field of fields) {
      if (!field.custom) continue
      const name = (field.name ?? '').toLowerCase()
      const id = field.id as string

      if (name.includes('sprint')) map.sprint = id
      if (name === 'epic link' || name.includes('epic link')) map.epicLink = id
      if (name === 'epic name' || name.includes('epic name')) map.epicName = id
      if (name.includes('story point') || name.includes('story_point')) map.storyPoints = id
      if (name === 'rank' || (name.includes('rank') && !name.includes('sprint'))) map.rank = id
    }

    return map
  }

  // Search issues — tries new POST API first; falls back to legacy GET on initial call only.
  // Cursor encoding: undefined = first call; "legacy:N" = legacy startAt pagination.
  async searchIssues(jql: string, fields: string[], cursor?: string): Promise<{ issues: any[]; nextCursor?: string; total?: number }> {
    if (cursor?.startsWith('legacy:')) {
      const startAt = parseInt(cursor.slice(7), 10) || 0
      // GET API has URL length limits — use first 25 fields to be safe
      const safeFields = fields.slice(0, 25)
      const result = await this.request<{ issues: any[]; total: number; startAt: number; maxResults: number }>(
        `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(safeFields.join(','))}&startAt=${startAt}&maxResults=50`,
      )
      const nextStartAt = startAt + (result.issues?.length ?? 0)
      const hasMore = nextStartAt < (result.total ?? 0)
      return { issues: result.issues ?? [], nextCursor: hasMore ? `legacy:${nextStartAt}` : undefined, total: result.total }
    }

    // Try new POST API (supports nextPageToken, no URL length limit)
    try {
      const body: Record<string, unknown> = { jql, maxResults: 50, fields }
      if (cursor) body.nextPageToken = cursor
      const result = await this.request<{ issues: any[]; nextPageToken?: string; total?: number }>(
        '/rest/api/3/search/jql',
        { method: 'POST', body: JSON.stringify(body) },
      )
      return { issues: result.issues ?? [], nextCursor: result.nextPageToken, total: result.total }
    } catch (err) {
      // Only fall back on the initial call (no cursor) and only for 404/400 responses
      if (cursor) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('404') && !msg.includes('400')) throw err

      // Legacy GET fallback
      const safeFields = fields.slice(0, 25)
      const result = await this.request<{ issues: any[]; total: number; startAt: number; maxResults: number }>(
        `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(safeFields.join(','))}&startAt=0&maxResults=50`,
      )
      const nextStartAt = result.issues?.length ?? 0
      const hasMore = nextStartAt < (result.total ?? 0)
      return { issues: result.issues ?? [], nextCursor: hasMore ? `legacy:${nextStartAt}` : undefined, total: result.total }
    }
  }

  // Old API for getting exact count with maxResults=0
  async countIssues(jql: string): Promise<number> {
    const result = await this.request<{ total: number }>(`/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=0`)
    return result.total ?? 0
  }

  async downloadAttachment(contentUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    const response = await fetch(contentUrl, { headers: { 'Authorization': this.authHeader } })
    if (!response.ok) throw new Error(`Attachment download failed: ${response.status}`)
    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    return { buffer, contentType }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function buildProjectKey(supabase: ReturnType<typeof createClient>, name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'PRJ'

  const { data: existing } = await supabase
    .from('projects')
    .select('key')
    .like('key', `${base}%`)

  const usedKeys = new Set<string>((existing ?? []).map((r: any) => r.key))
  let candidate = base
  let index = 2
  while (usedKeys.has(candidate)) {
    candidate = `${base}${index}`
    index++
  }
  return candidate
}

async function updateJobStep(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  step: string,
  progressDone?: number,
  progressTotal?: number,
) {
  const fields: Record<string, unknown> = { current_step: step }
  if (progressDone !== undefined) fields.progress_done = progressDone
  if (progressTotal !== undefined) fields.progress_total = progressTotal
  await supabase.from('jira_import_jobs').update(fields).eq('id', jobId)
}

async function addWarning(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  warnings: string[],
  warning: string,
) {
  warnings.push(warning)
  await supabase
    .from('jira_import_jobs')
    .update({ warnings: warnings as unknown as string })
    .eq('id', jobId)
}

async function upsertMapping(
  supabase: ReturnType<typeof createClient>,
  params: {
    userId: string
    localProjectId: string | null
    localEntityType: string
    localEntityId: string
    externalId: string
    externalKey?: string | null
    jiraSiteUrl: string
    rawJson?: unknown
    jiraUpdatedAt?: string | null
  },
) {
  const row = {
    user_id: params.userId,
    local_project_id: params.localProjectId,
    local_entity_type: params.localEntityType,
    local_entity_id: params.localEntityId,
    external_source: 'jira',
    external_id: params.externalId,
    external_key: params.externalKey ?? null,
    jira_site_url: params.jiraSiteUrl,
    raw_json: params.rawJson ?? null,
    jira_updated_at: params.jiraUpdatedAt ?? null,
  }

  await supabase
    .from('jira_external_mappings')
    .upsert(row, {
      onConflict: 'user_id,external_source,jira_site_url,local_entity_type,external_id,local_project_id',
    })
}

async function getMappedId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  siteUrl: string,
  entityType: string,
  externalId: string,
  localProjectId?: string | null,
): Promise<string | null> {
  let query = supabase
    .from('jira_external_mappings')
    .select('local_entity_id')
    .eq('user_id', userId)
    .eq('jira_site_url', siteUrl)
    .eq('local_entity_type', entityType)
    .eq('external_id', externalId)

  // Scope to the specific local project when provided.
  // Without this, a mapping from a previous import into a *different* local project
  // would be returned and cause issues to be skipped (success-but-empty bug).
  if (localProjectId) {
    query = query.eq('local_project_id', localProjectId)
  }

  const { data } = await query.maybeSingle()
  return data?.local_entity_id ?? null
}

// ── Chunked import types ───────────────────────────────────────────────────────

interface ImportCursor {
  local_project_id: string
  site_url: string
  jql: string
  all_fields: string[]
  field_map: Record<string, string>
  issues_processed: number
  total_issues: number          // set when issues phase completes
  total_attachments: number     // actual file count; set when issues phase completes
  attachments_processed: number
  phase: 'issues' | 'attachments' | 'finalize'
  next_cursor?: string
  include_attachments: boolean
  include_completed_sprints: boolean
  max_attachment_size_mb: number
  skip_attachments_over_limit: boolean
  import_users: boolean
  board_id: string | null            // board used for Board/Backlog placement
  backlog_issue_ids: string[]        // Jira issue ids in the board backlog
}

/** Deserialise cursor from DB, filling in defaults for backward compat with pre-v2 cursors. */
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
    board_id: (raw.board_id as string | null) ?? null,
    backlog_issue_ids: Array.isArray(raw.backlog_issue_ids) ? (raw.backlog_issue_ids as string[]).map(String) : [],
  }
}

type ImportOptions = {
  include_attachments: boolean
  include_completed_sprints: boolean
  include_comments: boolean
  max_attachment_size_mb: number
  skip_attachments_over_limit: boolean
  import_users: boolean
}

// ── Smart user resolution ─────────────────────────────────────────────────────
// Maps a Jira user to a local profile or a project_member_placeholders record.
// Results are cached in jira_external_mappings so re-runs are idempotent.

async function resolveJiraUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  siteUrl: string,
  localProjectId: string,
  jiraUser: {
    accountId?: string
    emailAddress?: string
    displayName?: string
    avatarUrls?: Record<string, string>
  } | null | undefined,
): Promise<{ assigneeId: string | null; placeholderId: string | null }> {
  if (!jiraUser?.accountId) return { assigneeId: null, placeholderId: null }

  // Check existing mapping first (idempotent; scoped to this project)
  const existing = await getMappedId(supabase, userId, siteUrl, 'user', jiraUser.accountId, localProjectId)
  if (existing) {
    if (existing.startsWith('placeholder:')) return { assigneeId: null, placeholderId: existing.slice(12) }
    return { assigneeId: existing, placeholderId: null }
  }

  // Case A: real profile found by email
  if (jiraUser.emailAddress) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', jiraUser.emailAddress.toLowerCase().trim())
      .maybeSingle()
    if (profile) {
      // Ensure they're a project member (idempotent upsert)
      await supabase.from('project_members').upsert(
        { project_id: localProjectId, profile_id: profile.id, project_role: 'member' },
        { onConflict: 'project_id,profile_id', ignoreDuplicates: true },
      )
      await upsertMapping(supabase, {
        userId, localProjectId, localEntityType: 'user',
        localEntityId: profile.id, externalId: jiraUser.accountId, jiraSiteUrl: siteUrl,
      })
      return { assigneeId: profile.id, placeholderId: null }
    }
  }

  // Case B / C: create or find placeholder (no auth.users record created)
  const avatarUrl =
    jiraUser.avatarUrls?.['48x48'] ??
    jiraUser.avatarUrls?.['32x32'] ??
    jiraUser.avatarUrls?.['16x16'] ??
    null

  const { data: placeholder } = await supabase
    .from('project_member_placeholders')
    .upsert(
      {
        project_id: localProjectId,
        source: 'jira',
        external_id: jiraUser.accountId,
        email: jiraUser.emailAddress?.toLowerCase().trim() ?? null,
        display_name: jiraUser.displayName ?? jiraUser.accountId,
        avatar_url: avatarUrl,
        status: 'imported_placeholder',
      },
      { onConflict: 'project_id,source,external_id' },
    )
    .select('id')
    .single()

  if (!placeholder) return { assigneeId: null, placeholderId: null }

  // Cache mapping with 'placeholder:' prefix to distinguish from real profile IDs
  await upsertMapping(supabase, {
    userId, localProjectId, localEntityType: 'user',
    localEntityId: `placeholder:${placeholder.id}`,
    externalId: jiraUser.accountId, jiraSiteUrl: siteUrl,
  })
  return { assigneeId: null, placeholderId: placeholder.id }
}

// ── Stale mapping cleanup ──────────────────────────────────────────────────────
// Removes mappings whose local_entity_id no longer points to a live entity in the
// given local project.  Handles the common case where the user deleted imported tasks
// manually and wants to re-import cleanly.
// Returns counts by entity type.  Pass dryRun=true for a read-only check.

async function cleanStaleMappings(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  siteUrl: string,
  localProjectId: string,
  dryRun = false,
): Promise<{ issue: number; epic: number; sprint: number }> {
  // Batch-load all live entity IDs for this project (2 DB round-trips per type).
  const [tasksRes, epicsRes, sprintsRes] = await Promise.all([
    supabase.from('tasks').select('id').eq('project_id', localProjectId),
    supabase.from('epics').select('id').eq('project_id', localProjectId),
    supabase.from('sprints').select('id').eq('project_id', localProjectId),
  ])
  const taskIds = new Set((tasksRes.data ?? []).map((r: any) => r.id as string))
  const epicIds = new Set((epicsRes.data ?? []).map((r: any) => r.id as string))
  const sprintIds = new Set((sprintsRes.data ?? []).map((r: any) => r.id as string))

  // Load existing mappings for this project by type.
  const baseFilter = (type: string) =>
    supabase
      .from('jira_external_mappings')
      .select('id, local_entity_id')
      .eq('user_id', userId)
      .eq('jira_site_url', siteUrl)
      .eq('local_project_id', localProjectId)
      .eq('local_entity_type', type)

  const [issueMapRes, epicMapRes, sprintMapRes] = await Promise.all([
    baseFilter('issue'),
    baseFilter('epic'),
    baseFilter('sprint'),
  ])

  const stale = (rows: any[] | null, liveSet: Set<string>) =>
    (rows ?? []).filter((r) => !r.local_entity_id || !liveSet.has(r.local_entity_id)).map((r) => r.id as string)

  const staleIssueIds = stale(issueMapRes.data, taskIds)
  const staleEpicIds = stale(epicMapRes.data, epicIds)
  const staleSprintIds = stale(sprintMapRes.data, sprintIds)

  if (!dryRun) {
    const all = [...staleIssueIds, ...staleEpicIds, ...staleSprintIds]
    for (let i = 0; i < all.length; i += 100) {
      await supabase.from('jira_external_mappings').delete().in('id', all.slice(i, i + 100))
    }
  }

  return { issue: staleIssueIds.length, epic: staleEpicIds.length, sprint: staleSprintIds.length }
}

// ── Step A + B + C + field discovery (runs once per import) ───────────────────

async function runSetup(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  jobId: string,
  jiraClient: JiraClient,
  siteUrl: string,
  jiraProjectKey: string,
  boardId: string | null,
  localProjectIdArg: string | null,
  options: ImportOptions,
  warnings: string[],
): Promise<ImportCursor> {
  let localProjectId: string = localProjectIdArg ?? ''

  // ── Step A: Project ──────────────────────────────────────────────────────
  await updateJobStep(supabase, jobId, 'step_project')

  if (localProjectId) {
    const { data: pData } = await supabase.from('projects').select('id').eq('id', localProjectId).single()
    if (!pData) throw new Error('Local project not found')
  } else {
    const existing = await getMappedId(supabase, userId, siteUrl, 'project', jiraProjectKey)
    if (existing) {
      localProjectId = existing
    } else {
      const { values } = await jiraClient.listProjects(0)
      const jiraProject = values.find((p) => p.key === jiraProjectKey)
      const projectName = jiraProject?.name ?? jiraProjectKey
      const key = await buildProjectKey(supabase, projectName)
      const { data: newProject, error: createErr } = await supabase
        .from('projects')
        .insert({ key, name: projectName, description: jiraProject?.description ?? '', created_by: userId })
        .select()
        .single()
      if (createErr || !newProject) throw new Error('Failed to create project')
      localProjectId = newProject.id
      await supabase.from('project_members').insert({ project_id: localProjectId, profile_id: userId, project_role: 'owner' })
      await upsertMapping(supabase, {
        userId, localProjectId, localEntityType: 'project', localEntityId: localProjectId,
        externalId: jiraProjectKey, externalKey: jiraProjectKey, jiraSiteUrl: siteUrl,
      })
    }
  }

  await supabase.from('jira_import_jobs').update({ local_project_id: localProjectId }).eq('id', jobId)

  // ── Step CLEANUP: Remove stale mappings left by previous failed/deleted imports ─
  // This runs before sprints/issues so getMappedId never returns dead entity IDs.
  await updateJobStep(supabase, jobId, 'step_cleaning')
  const staleCounts = await cleanStaleMappings(supabase, userId, siteUrl, localProjectId)
  const totalStale = staleCounts.issue + staleCounts.epic + staleCounts.sprint
  if (totalStale > 0) {
    await addWarning(
      supabase, jobId, warnings,
      `STALE_MAPPINGS_CLEANED: Removed ${totalStale} stale mappings from a previous import (issues: ${staleCounts.issue}, epics: ${staleCounts.epic}, sprints: ${staleCounts.sprint}). Re-importing affected entities.`,
    )
    console.log('[jira-import] Cleaned stale mappings', { localProjectId, ...staleCounts })
  }

  // ── Step B: Board ────────────────────────────────────────────────────────
  if (boardId) {
    await upsertMapping(supabase, {
      userId, localProjectId, localEntityType: 'board', localEntityId: localProjectId,
      externalId: boardId, jiraSiteUrl: siteUrl,
    })
  }

  // ── Step C: Sprints ──────────────────────────────────────────────────────
  await updateJobStep(supabase, jobId, 'step_sprints')

  if (boardId) {
    try {
      let sprintStart = 0
      while (true) {
        const { values: sprints, isLast } = await jiraClient.listSprints(boardId, sprintStart)
        for (const sprint of sprints) {
          const sprintState: string = sprint.state ?? 'future'
          if (sprintState === 'closed' && !options.include_completed_sprints) continue
          const existing = await getMappedId(supabase, userId, siteUrl, 'sprint', String(sprint.id), localProjectId)
          if (existing) continue

          let sprintStatus: 'planned' | 'active' | 'completed' = 'planned'
          if (sprintState === 'active') sprintStatus = 'active'
          else if (sprintState === 'closed') sprintStatus = 'completed'

          const { data: newSprint, error: sprintErr } = await supabase
            .from('sprints')
            .insert({
              project_id: localProjectId,
              name: sprint.name,
              goal: sprint.goal ?? '',
              status: sprintStatus,
              start_date: sprint.startDate ? sprint.startDate.split('T')[0] : null,
              end_date: sprint.endDate ? sprint.endDate.split('T')[0] : null,
            })
            .select()
            .single()
          if (sprintErr || !newSprint) {
            await addWarning(supabase, jobId, warnings, `Failed to create sprint: ${sprint.name}`)
            continue
          }
          await upsertMapping(supabase, {
            userId, localProjectId, localEntityType: 'sprint', localEntityId: newSprint.id,
            externalId: String(sprint.id), externalKey: sprint.name, jiraSiteUrl: siteUrl,
            rawJson: { goal: sprint.goal, startDate: sprint.startDate, endDate: sprint.endDate, completeDate: sprint.completeDate },
          })
        }
        if (isLast || sprints.length === 0) break
        sprintStart += sprints.length
      }
    } catch (sprintErr) {
      const msg = sprintErr instanceof Error ? sprintErr.message : String(sprintErr)
      // Simple/Kanban boards (Jira "simple" board type) do not expose a sprint API.
      // A 400 or 403 here is expected and non-fatal — import continues without sprint metadata.
      if (msg.includes('400') || msg.includes('403') || msg.includes('404')) {
        console.warn('[jira-import] BOARD_SPRINTS_UNSUPPORTED', { boardId, msg })
        await addWarning(supabase, jobId, warnings, `BOARD_SPRINTS_UNSUPPORTED: Board ${boardId} does not support sprint API (${msg}). Tasks will still be imported via project JQL.`)
      } else {
        throw sprintErr
      }
    }
  }

  // ── Field discovery + JQL ────────────────────────────────────────────────
  await updateJobStep(supabase, jobId, 'step_issues')

  const fieldMap = await jiraClient.discoverFields()
  const baseFields = [
    'summary', 'description', 'issuetype', 'status', 'priority',
    'assignee', 'reporter', 'parent', 'subtasks', 'labels',
    'attachment', 'created', 'updated', 'duedate', 'comment',
  ]
  const allFields = [...new Set([...baseFields, ...Object.values(fieldMap)])]

  // ── Board backlog placement ──────────────────────────────────────────────
  // Mirror Jira's Board/Backlog split: fetch the board's backlog issue ids so
  // each task can be tagged 'board' or 'backlog'. Non-fatal — a board without a
  // backlog (or no board) simply leaves placements null.
  const backlogIssueIds: string[] = []
  if (boardId) {
    try {
      let start = 0
      while (true) {
        const { issues, total } = await jiraClient.listBoardBacklog(boardId, start)
        for (const it of issues) if (it?.id != null) backlogIssueIds.push(String(it.id))
        start += issues.length
        if (issues.length === 0 || start >= total) break
      }
      console.log('[jira-import] board backlog fetched', { boardId, backlog: backlogIssueIds.length })
    } catch (backlogErr) {
      const msg = backlogErr instanceof Error ? backlogErr.message : String(backlogErr)
      console.warn('[jira-import] BOARD_BACKLOG_UNSUPPORTED', { boardId, msg })
    }
  }

  // JQL fallback chain: Rank → key ASC → bare project
  // Some Jira instances (especially simple/kanban boards) don't support ORDER BY Rank.
  // A 400 from the search endpoint almost always means invalid JQL, not bad credentials.
  let jql = `project = ${jiraProjectKey} ORDER BY Rank ASC`
  try {
    const totalIssues = await jiraClient.countIssues(jql)
    await supabase.from('jira_import_jobs').update({ progress_total: totalIssues }).eq('id', jobId)
  } catch (jqlErr) {
    const jqlMsg = jqlErr instanceof Error ? jqlErr.message : String(jqlErr)
    if (jqlMsg.includes('400')) {
      // Rank not supported — fall back to key order
      jql = `project = ${jiraProjectKey} ORDER BY key ASC`
      await addWarning(supabase, jobId, warnings, 'RANK_ORDER_UNSUPPORTED: ORDER BY Rank failed (400). Falling back to key order.')
      console.warn('[jira-import] JQL_FALLBACK', { from: 'Rank', to: 'key', projectKey: jiraProjectKey })
      try {
        const totalIssues = await jiraClient.countIssues(jql)
        await supabase.from('jira_import_jobs').update({ progress_total: totalIssues }).eq('id', jobId)
      } catch {
        // key order also failed — use bare project query (no ORDER BY)
        jql = `project = ${jiraProjectKey}`
        await addWarning(supabase, jobId, warnings, 'JQL_FALLBACK_USED: key order also failed. Using bare project query (unordered).')
        console.warn('[jira-import] JQL_FALLBACK', { from: 'key', to: 'bare', projectKey: jiraProjectKey })
      }
    }
    // Non-400 errors (network, auth) are ignored here — countIssues is non-fatal
  }

  return {
    local_project_id: localProjectId,
    site_url: siteUrl,
    jql,
    all_fields: allFields,
    field_map: fieldMap,
    issues_processed: 0,
    total_issues: 0,
    total_attachments: 0,
    attachments_processed: 0,
    phase: 'issues',
    next_cursor: undefined,
    include_attachments: options.include_attachments,
    include_completed_sprints: options.include_completed_sprints,
    max_attachment_size_mb: options.max_attachment_size_mb,
    skip_attachments_over_limit: options.skip_attachments_over_limit,
    import_users: options.import_users,
    board_id: boardId,
    backlog_issue_ids: backlogIssueIds,
  }
}

// ── Step D: Process one batch of issues (called repeatedly until done) ────────

async function processIssuesBatch(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  jobId: string,
  jiraClient: JiraClient,
  cursor: ImportCursor,
  warnings: string[],
): Promise<{ cursor: ImportCursor; done: boolean }> {
  const { local_project_id: localProjectId, site_url: siteUrl, jql, all_fields: allFields, field_map: fieldMap } = cursor

  // Board/Backlog placement lookup (empty when not a board import).
  const backlogIdSet = new Set(cursor.backlog_issue_ids)
  const placementFor = (issueId: string): 'board' | 'backlog' | null =>
    cursor.board_id ? (backlogIdSet.has(issueId) ? 'backlog' : 'board') : null

  const result = await jiraClient.searchIssues(jql, allFields, cursor.next_cursor)
  const issues = result.issues ?? []
  let processedIssues = cursor.issues_processed

  // Per-batch cache to avoid duplicate resolveJiraUser DB calls for the same accountId
  const userResolutionCache = new Map<string, { assigneeId: string | null; placeholderId: string | null }>()

  async function resolveUser(jiraUser: Record<string, any> | null | undefined) {
    if (!cursor.import_users || !jiraUser?.accountId) return { assigneeId: null, placeholderId: null }
    const key = String(jiraUser.accountId)
    if (userResolutionCache.has(key)) return userResolutionCache.get(key)!
    const resolved = await resolveJiraUser(supabase, userId, siteUrl, localProjectId, jiraUser)
    userResolutionCache.set(key, resolved)
    return resolved
  }

  for (const issue of issues) {
    const issueId = issue.id as string
    const issueKey = issue.key as string
    const fields = issue.fields ?? {}
    const issueTypeName: string = fields.issuetype?.name ?? 'Task'
    const isEpic = issueTypeName === 'Epic'

    const existing = isEpic
      ? await getMappedId(supabase, userId, siteUrl, 'epic', issueId, localProjectId)
      : await getMappedId(supabase, userId, siteUrl, 'issue', issueId, localProjectId)
    if (existing) {
      processedIssues++
      continue
    }

    const statusName: string = fields.status?.name ?? 'To Do'
    const priorityName: string = fields.priority?.name ?? 'Medium'
    const mappedStatusOrNull = mapJiraStatus(statusName)
    if (mappedStatusOrNull === null) {
      await addWarning(supabase, jobId, warnings, `Unknown Jira status "${statusName}" on ${issueKey} — mapped to "todo"`)
    }
    const mappedStatus = mappedStatusOrNull ?? 'todo'
    const mappedPriority = mapJiraPriority(priorityName)
    const title: string = fields.summary ?? '(no summary)'
    const description = normalizeJiraDescription(fields.description)
    // Preserve the rich ADF + extracted media refs so designer tasks (where the
    // content is an embedded image, not text) don't import as empty.
    const descriptionAdf = adfDocOrNull(fields.description)
    const mediaRefs = descriptionAdf ? extractAdfMediaRefs(descriptionAdf) : []
    const labels: string[] = (fields.labels ?? []).filter(Boolean)
    const dueDate: string | null = fields.duedate ?? null

    if (isEpic) {
      const epicColor = EPIC_COLORS[processedIssues % EPIC_COLORS.length]
      const epicStatus = mappedStatus === 'done' ? 'done' : mappedStatus === 'in_progress' ? 'in_progress' : 'planned'
      const { data: newEpic, error: epicErr } = await supabase
        .from('epics')
        .insert({ project_id: localProjectId, title, description, color: epicColor, status: epicStatus })
        .select()
        .single()
      if (epicErr || !newEpic) {
        await addWarning(supabase, jobId, warnings, `Failed to create epic ${issueKey}: ${sanitizeError(epicErr?.message ?? 'unknown')}`)
        processedIssues++
        continue
      }
      await upsertMapping(supabase, {
        userId, localProjectId, localEntityType: 'epic', localEntityId: newEpic.id,
        externalId: issueId, externalKey: issueKey, jiraSiteUrl: siteUrl,
        rawJson: fields, jiraUpdatedAt: fields.updated ?? null,
      })
    } else {
      const localType = mapJiraIssueType(issueTypeName)

      // Resolve assignee and reporter to local profiles or placeholders
      const [assignee, reporter] = await Promise.all([
        resolveUser(fields.assignee),
        resolveUser(fields.reporter),
      ])

      const { data: newTask, error: taskErr } = await supabase
        .from('tasks')
        .insert({
          project_id: localProjectId,
          title,
          description,
          jira_description_adf: descriptionAdf,
          description_media_refs: descriptionAdf ? mediaRefs : null,
          jira_board_placement: placementFor(issueId),
          status: mappedStatus,
          issue_type: localType,
          priority: mappedPriority,
          labels,
          due_date: dueDate,
          assignee_id: assignee.assigneeId,
          assignee_placeholder_id: assignee.placeholderId,
          reporter_placeholder_id: reporter.placeholderId ?? assignee.placeholderId ?? null,
          // parent_task_id, epic_id, sprint_id resolved in finalization
        })
        .select()
        .single()
      if (taskErr || !newTask) {
        await addWarning(supabase, jobId, warnings, `Failed to create task ${issueKey}: ${sanitizeError(taskErr?.message ?? 'unknown')}`)
        processedIssues++
        continue
      }
      await upsertMapping(supabase, {
        userId, localProjectId, localEntityType: 'issue', localEntityId: newTask.id,
        externalId: issueId, externalKey: issueKey, jiraSiteUrl: siteUrl,
        rawJson: { ...fields, _discoveredFields: fieldMap }, jiraUpdatedAt: fields.updated ?? null,
      })
    }

    processedIssues++
  }

  await supabase.from('jira_import_jobs').update({ progress_done: processedIssues }).eq('id', jobId)

  if (result.nextCursor) {
    // More issues remain — stay in issues phase
    const updatedCursor: ImportCursor = {
      ...cursor,
      issues_processed: processedIssues,
      next_cursor: result.nextCursor,
      phase: 'issues',
    }
    return { cursor: updatedCursor, done: false }
  }

  // Issues phase complete — count attachments to determine next phase and accurate progress_total
  let totalAttachments = 0
  if (cursor.include_attachments) {
    const { data: issueMappings } = await supabase
      .from('jira_external_mappings')
      .select('raw_json')
      .eq('user_id', userId)
      .eq('jira_site_url', siteUrl)
      .eq('local_project_id', localProjectId)
      .eq('local_entity_type', 'issue')
    for (const m of issueMappings ?? []) {
      const raw = m.raw_json as Record<string, any> | null
      if (Array.isArray(raw?.attachment)) totalAttachments += raw.attachment.length
    }
  }

  // progress_total = issues + 1 (hierarchy) + attachments + 1 (validation)
  const progressTotal = processedIssues + 1 + totalAttachments + 1
  await supabase.from('jira_import_jobs').update({ progress_total: progressTotal }).eq('id', jobId)

  const nextPhase: ImportCursor['phase'] =
    cursor.include_attachments && totalAttachments > 0 ? 'attachments' : 'finalize'

  const updatedCursor: ImportCursor = {
    ...cursor,
    issues_processed: processedIssues,
    total_issues: processedIssues,
    total_attachments: totalAttachments,
    attachments_processed: 0,
    next_cursor: undefined,
    phase: nextPhase,
  }

  return { cursor: updatedCursor, done: true }
}

// ── Step F: Attachment batch (cursor-driven, ATTACHMENTS_PER_BATCH per resume) ─

async function processAttachmentsBatch(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  jobId: string,
  jiraClient: JiraClient,
  cursor: ImportCursor,
  warnings: string[],
): Promise<{ cursor: ImportCursor; done: boolean }> {
  const { local_project_id: localProjectId, site_url: siteUrl } = cursor
  const maxBytes = cursor.max_attachment_size_mb * 1024 * 1024

  await updateJobStep(supabase, jobId, 'step_attachments')

  // Load all issue mappings that have attachments
  const { data: issueMappings } = await supabase
    .from('jira_external_mappings')
    .select('local_entity_id, raw_json')
    .eq('user_id', userId)
    .eq('jira_site_url', siteUrl)
    .eq('local_project_id', localProjectId)
    .eq('local_entity_type', 'issue')

  // Bulk-load already-processed attachment IDs to avoid N+1 queries
  const { data: doneMappings } = await supabase
    .from('jira_external_mappings')
    .select('external_id')
    .eq('user_id', userId)
    .eq('jira_site_url', siteUrl)
    .eq('local_project_id', localProjectId)
    .eq('local_entity_type', 'attachment')

  const doneAttachIds = new Set((doneMappings ?? []).map((m) => m.external_id))

  let batchCount = 0
  let totalProcessed = cursor.attachments_processed
  let allDone = true

  outerLoop: for (const mapping of issueMappings ?? []) {
    const raw = mapping.raw_json as Record<string, any> | null
    if (!raw?.attachment || !Array.isArray(raw.attachment)) continue
    const taskId = mapping.local_entity_id

    for (const att of raw.attachment as any[]) {
      const attId = String(att.id)
      if (doneAttachIds.has(attId)) {
        // already done (including skipped-by-size)
        continue
      }

      if (batchCount >= ATTACHMENTS_PER_BATCH) {
        allDone = false
        break outerLoop
      }

      try {
        if (att.size && att.size > maxBytes) {
          if (cursor.skip_attachments_over_limit) {
            await addWarning(supabase, jobId, warnings, `Skipped large attachment ${att.filename} (${Math.round(att.size / 1048576)}MB > ${cursor.max_attachment_size_mb}MB limit)`)
            // Record as skipped so we don't warn again on re-run
            await upsertMapping(supabase, {
              userId, localProjectId, localEntityType: 'attachment',
              localEntityId: `skipped:size:${attId}`,
              externalId: attId, externalKey: att.filename ?? attId,
              jiraSiteUrl: siteUrl,
            })
            doneAttachIds.add(attId)
            totalProcessed++
            batchCount++
            continue
          }
        }

        const { buffer, contentType } = await jiraClient.downloadAttachment(att.content)
        const filename = att.filename ?? `attachment-${attId}`
        // Sanitise to an ASCII-safe storage key and prefix with the attachment id
        // so non-ASCII / duplicate filenames can't collide or be rejected.
        const storagePath = `${localProjectId}/${taskId}/${attId}-${safeStorageName(filename)}`

        const { error: uploadError } = await supabase.storage
          .from('task-attachments')
          .upload(storagePath, new Uint8Array(buffer), { contentType, upsert: true, duplex: 'half' } as any)

        if (uploadError) {
          await addWarning(supabase, jobId, warnings, `Upload failed for ${filename}: ${sanitizeError(uploadError.message)}`)
          // Don't add to doneAttachIds — allow retry on next resume
          totalProcessed++
          batchCount++
          continue
        }

        const { data: taskRow } = await supabase.from('tasks').select('attachments').eq('id', taskId).single()
        const currentAttachments: string[] = taskRow?.attachments ?? []
        if (!currentAttachments.includes(storagePath)) {
          await supabase.from('tasks').update({ attachments: [...currentAttachments, storagePath] }).eq('id', taskId)
        }

        await upsertMapping(supabase, {
          userId, localProjectId, localEntityType: 'attachment', localEntityId: storagePath,
          externalId: attId, externalKey: filename, jiraSiteUrl: siteUrl,
        })
        doneAttachIds.add(attId)
        totalProcessed++
        batchCount++
      } catch (attError) {
        await addWarning(supabase, jobId, warnings, `Attachment error for ${att?.filename ?? att?.id}: ${sanitizeError(String(attError))}`)
        totalProcessed++
        batchCount++
      }
    }
  }

  const progressDone = cursor.issues_processed + 1 + totalProcessed
  await supabase.from('jira_import_jobs').update({
    progress_done: progressDone,
    warnings: warnings as unknown as string,
  }).eq('id', jobId)

  if (!allDone) {
    const updatedCursor: ImportCursor = {
      ...cursor,
      attachments_processed: totalProcessed,
      phase: 'attachments',
    }
    return { cursor: updatedCursor, done: false }
  }

  const updatedCursor: ImportCursor = {
    ...cursor,
    attachments_processed: totalProcessed,
    phase: 'finalize',
  }
  return { cursor: updatedCursor, done: true }
}

// ── Steps E + H: Hierarchy + validation (attachments now in separate phase) ───

async function runFinalization(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  jobId: string,
  _jiraClient: JiraClient,
  cursor: ImportCursor,
  warnings: string[],
): Promise<void> {
  const { local_project_id: localProjectId, site_url: siteUrl, issues_processed: processedIssues } = cursor

  try {
    // ── Step E: Hierarchy resolution ─────────────────────────────────────────
    await updateJobStep(supabase, jobId, 'step_hierarchy')

    const { data: allMappings } = await supabase
      .from('jira_external_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('jira_site_url', siteUrl)
      .eq('local_project_id', localProjectId)
      .limit(20000)

    const epicByExternalId = new Map<string, string>()
    const epicByExternalKey = new Map<string, string>()
    const taskByExternalId = new Map<string, string>()
    const sprintByExternalId = new Map<string, string>()

    for (const m of allMappings ?? []) {
      if (m.local_entity_type === 'epic') {
        epicByExternalId.set(m.external_id, m.local_entity_id)
        if (m.external_key) epicByExternalKey.set(m.external_key, m.local_entity_id)
      } else if (m.local_entity_type === 'issue') {
        taskByExternalId.set(m.external_id, m.local_entity_id)
      } else if (m.local_entity_type === 'sprint') {
        sprintByExternalId.set(m.external_id, m.local_entity_id)
      }
    }

    const issueMappings = (allMappings ?? []).filter((m) => m.local_entity_type === 'issue')
    // Board/Backlog placement — applied here too so re-imports (which skip existing
    // issues at insert) still populate placement on already-imported tasks.
    const backlogIdSet = new Set(cursor.backlog_issue_ids)
    const batchUpdates: Array<{ id: string; parent_task_id?: string | null; epic_id?: string | null; sprint_id?: string | null }> = []

    for (const mapping of issueMappings) {
      const raw = mapping.raw_json as Record<string, any> | null
      if (!raw) continue

      const discovered: Record<string, string> = raw._discoveredFields ?? {}
      const taskId = mapping.local_entity_id
      const update: Record<string, string | null> = {}

      const parent = raw.parent
      if (parent?.id) {
        const parentId = parent.id as string
        const parentTypeName: string = parent.fields?.issuetype?.name ?? ''
        if (parentTypeName === 'Epic') {
          const epicLocalId = epicByExternalId.get(parentId)
          if (epicLocalId) update.epic_id = epicLocalId
        } else {
          const parentLocalId = taskByExternalId.get(parentId)
          if (parentLocalId) update.parent_task_id = parentLocalId
        }
      }

      if (discovered.epicLink) {
        const epicKey = raw[discovered.epicLink]
        if (epicKey && typeof epicKey === 'string') {
          const epicLocalId = epicByExternalKey.get(epicKey)
          if (epicLocalId && !update.epic_id) update.epic_id = epicLocalId
        }
      }

      if (discovered.sprint) {
        const sprintValues = raw[discovered.sprint]
        if (Array.isArray(sprintValues) && sprintValues.length > 0) {
          const activeSprint = sprintValues.find((s: any) => s.state === 'active') ?? sprintValues[sprintValues.length - 1]
          if (activeSprint?.id) {
            const sprintLocalId = sprintByExternalId.get(String(activeSprint.id))
            if (sprintLocalId) update.sprint_id = sprintLocalId
          }
        }
      }

      // Also repair ADF descriptions that slipped through as raw JSON, and make
      // sure the rich ADF + media refs are populated for older imports.
      const rawDesc = raw.description
      const repairAdf = adfDocOrNull(rawDesc)
      if (repairAdf) {
        update.description = normalizeJiraDescription(rawDesc)
        update.jira_description_adf = repairAdf as unknown as string
        update.description_media_refs = extractAdfMediaRefs(repairAdf) as unknown as string
      }

      if (cursor.board_id) {
        update.jira_board_placement = backlogIdSet.has(mapping.external_id) ? 'backlog' : 'board'
      }

      if (Object.keys(update).length > 0) {
        batchUpdates.push({ id: taskId, ...update } as any)
      }
    }

    const chunkSize = 20
    for (let i = 0; i < batchUpdates.length; i += chunkSize) {
      const chunk = batchUpdates.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(({ id, ...fields }) =>
          supabase.from('tasks').update(fields).eq('id', id).eq('project_id', localProjectId),
        ),
      )
    }

    // Increment progress for hierarchy step
    const progressAfterHierarchy = processedIssues + 1
    await supabase.from('jira_import_jobs').update({ progress_done: progressAfterHierarchy }).eq('id', jobId)

    // ── Step H: Final validation ─────────────────────────────────────────────
    await updateJobStep(supabase, jobId, 'step_validating')

    const { count: taskCount } = await supabase
      .from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', localProjectId)
    const { count: epicCount } = await supabase
      .from('epics').select('id', { count: 'exact', head: true }).eq('project_id', localProjectId)

    void epicCount

    // Detect "success but empty": Jira had issues to import but 0 tasks landed in the local project.
    // This prevents false-positive "completed" status when the import silently produced nothing.
    if (processedIssues > 0 && (taskCount ?? 0) === 0) {
      const emptyMsg = `IMPORT_EMPTY_RESULT: ${processedIssues} Jira issues were processed but 0 tasks were created in the local project (id=${localProjectId}). A previous import may have orphaned mappings pointing to a different project.`
      console.error('[jira-import]', emptyMsg, { localProjectId, processedIssues, siteUrl })
      await supabase.from('jira_import_jobs').update({
        status: 'failed',
        error_message: emptyMsg,
        finished_at: new Date().toISOString(),
        warnings: warnings as unknown as string,
        cursor_json: null,
      }).eq('id', jobId)
      return
    }

    const { data: orphanCheck } = await supabase
      .from('tasks').select('id, key, parent_task_id').eq('project_id', localProjectId)
      .not('parent_task_id', 'is', null).limit(20)

    if (orphanCheck) {
      for (const t of orphanCheck) {
        const { data: parentCheck } = await supabase
          .from('tasks').select('id').eq('id', t.parent_task_id).maybeSingle()
        if (!parentCheck) {
          await addWarning(supabase, jobId, warnings, `Orphan subtask detected: ${t.key}`)
        }
      }
    }

    console.log('[jira-import] Finalization complete', {
      localProjectId, siteUrl,
      tasksCreated: taskCount ?? 0,
      epicsCreated: epicCount ?? 0,
      processedIssues,
      warnings: warnings.length,
    })

    const finalStatus = warnings.length > 0 ? 'partial' : 'completed'
    // Set progress_done = progress_total to guarantee 100%
    const { data: currentJob } = await supabase
      .from('jira_import_jobs').select('progress_total').eq('id', jobId).single()
    const progressTotal = currentJob?.progress_total ?? progressAfterHierarchy + 1

    await supabase.from('jira_import_jobs').update({
      status: finalStatus,
      progress_done: progressTotal,
      current_step: null,
      warnings: warnings as unknown as string,
      finished_at: new Date().toISOString(),
      local_project_id: localProjectId,
      cursor_json: null,
    }).eq('id', jobId)
  } catch (err) {
    const message = sanitizeError(err instanceof Error ? err.message : String(err))
    await supabase.from('jira_import_jobs').update({
      status: 'failed',
      error_message: message,
      finished_at: new Date().toISOString(),
      warnings: warnings as unknown as string,
      cursor_json: null,
    }).eq('id', jobId)
    throw err
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, { error: 'Function is not configured.' })
  }

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'Missing authorization token.' })

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !authData.user) return json(401, { error: 'Unable to validate session.' })

  const userId = authData.user.id

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Invalid JSON body.' })
  }

  const action = body.action as string

  try {
    // ── connect ──────────────────────────────────────────────────────────────
    if (action === 'connect') {
      const siteUrl = String(body.site_url ?? '').trim()
      const email = String(body.email ?? '').trim()
      const apiToken = String(body.api_token ?? '').trim()

      if (!siteUrl || !email || !apiToken) {
        return json(400, { error: 'site_url, email and api_token are required.' })
      }

      const jiraClient = new JiraClient(siteUrl, email, apiToken)
      let myself: { accountId: string; emailAddress: string; displayName: string }
      try {
        myself = await jiraClient.getMyself()
      } catch {
        // Return 200 so supabase.functions.invoke passes error_code through data (not as FunctionsHttpError)
        return json(200, { error: 'ops.jira.error.invalidCredentials', error_code: 'JIRA_AUTH_FAILED' })
      }

      // Encrypt token at rest if key is configured; fall back to plaintext
      const encrypted = await encryptToken(apiToken)
      const upsertPayload: Record<string, unknown> = {
        user_id: userId,
        jira_site_url: siteUrl,
        auth_type: 'api_token',
        _token_email: email,
        jira_account_id: myself.accountId,
        jira_user_email: myself.emailAddress,
        status: 'active',
        last_sync_at: new Date().toISOString(),
      }
      if (encrypted) {
        upsertPayload.encrypted_token = encrypted.ciphertext
        upsertPayload.token_iv = encrypted.iv
        upsertPayload._access_token = null
      } else {
        // TODO BLOCKER: Set JIRA_TOKEN_ENCRYPTION_KEY in Supabase secrets to encrypt tokens at rest.
        upsertPayload._access_token = apiToken
      }

      const { data: conn, error: connErr } = await adminClient
        .from('jira_connections')
        .upsert(upsertPayload, { onConflict: 'user_id,jira_site_url' })
        .select('id, jira_site_url, jira_user_email, jira_account_id, status')
        .single()

      if (connErr || !conn) return json(200, { error: 'Failed to save connection.', error_code: 'DB_SAVE_FAILED' })

      return json(200, {
        connection_id: conn.id,
        jira_site_url: conn.jira_site_url,
        jira_user_email: conn.jira_user_email,
        jira_account_id: conn.jira_account_id,
        status: conn.status,
        // token is intentionally NOT returned
      })
    }

    // ── list_projects ────────────────────────────────────────────────────────
    if (action === 'list_projects') {
      const connectionId = String(body.connection_id ?? '')
      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email, encrypted_token, token_iv')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const plainToken = await getPlaintextToken(conn)
      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, plainToken)
      const projects: any[] = []
      let startAt = 0

      while (true) {
        const { values, isLast } = await jiraClient.listProjects(startAt)
        for (const p of values) {
          projects.push({ id: p.id, key: p.key, name: p.name, description: p.description ?? '' })
        }
        if (isLast || values.length === 0) break
        startAt += values.length
      }

      return json(200, { projects })
    }

    // ── list_boards ──────────────────────────────────────────────────────────
    if (action === 'list_boards') {
      const connectionId = String(body.connection_id ?? '')
      const projectKey = String(body.project_key ?? '')
      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email, encrypted_token, token_iv')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const plainToken = await getPlaintextToken(conn)
      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, plainToken)
      const boards: any[] = []
      let startAt = 0

      while (true) {
        const { values, isLast } = await jiraClient.listBoards(projectKey, startAt)
        for (const b of values) {
          boards.push({ id: String(b.id), name: b.name, type: b.type })
        }
        if (isLast || values.length === 0) break
        startAt += values.length
      }

      return json(200, { boards })
    }

    // ── preview ──────────────────────────────────────────────────────────────
    if (action === 'preview') {
      const connectionId = String(body.connection_id ?? '')
      const projectKey = String(body.project_key ?? '')
      const boardId = body.board_id ? String(body.board_id) : null

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email, encrypted_token, token_iv')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const plainToken = await getPlaintextToken(conn)
      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, plainToken)

      const [epicsCount, issuesCount, subtasksCount] = await Promise.all([
        jiraClient.countIssues(`project = ${projectKey} AND issuetype = Epic`).catch(() => 0),
        jiraClient.countIssues(`project = ${projectKey} AND issuetype != Epic AND issuetype not in ("Sub-task", Subtask, subtask)`).catch(() => 0),
        jiraClient.countIssues(`project = ${projectKey} AND issuetype in ("Sub-task", Subtask, subtask)`).catch(() => 0),
      ])

      let sprintsCount = 0
      if (boardId) {
        try {
          const result = await jiraClient.listSprints(boardId, 0)
          sprintsCount = result.total ?? result.values?.length ?? 0
        } catch {
          // Non-fatal
        }
      }

      // Count issues with attachments (lightweight — just total, not file count)
      let attachmentsCount = 0
      try {
        attachmentsCount = await jiraClient.countIssues(`project = ${projectKey} AND attachments is not EMPTY`)
      } catch {
        // Non-fatal
      }

      const totalIssues = epicsCount + issuesCount + subtasksCount
      const isLargeProject = totalIssues > 500 || attachmentsCount > 100

      return json(200, {
        epics_count: epicsCount,
        issues_count: issuesCount,
        subtasks_count: subtasksCount,
        sprints_count: sprintsCount,
        attachments_count: attachmentsCount,
        estimated_attachment_size_bytes: 0,
        total_issues: totalIssues,
        is_large_project: isLargeProject,
      })
    }

    // ── start ────────────────────────────────────────────────────────────────
    if (action === 'start') {
      const connectionId = String(body.connection_id ?? '')
      const projectKey = String(body.project_key ?? '')
      const boardId = body.board_id ? String(body.board_id) : null
      const localProjectId = body.local_project_id ? String(body.local_project_id) : null
      const rawOptions = (body.options ?? {}) as Record<string, unknown>
      const importOptions: ImportOptions = {
        include_attachments: rawOptions.include_attachments !== false,
        include_completed_sprints: rawOptions.include_completed_sprints !== false,
        include_comments: rawOptions.include_comments !== false,
        max_attachment_size_mb: Number(rawOptions.max_attachment_size_mb ?? 10),
        skip_attachments_over_limit: rawOptions.skip_attachments_over_limit !== false,
        import_users: rawOptions.import_users !== false,
      }

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email, encrypted_token, token_iv')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const { data: job, error: jobErr } = await adminClient
        .from('jira_import_jobs')
        .insert({
          user_id: userId,
          connection_id: connectionId,
          local_project_id: localProjectId,
          jira_project_key: projectKey,
          jira_board_id: boardId,
          status: 'running',
          current_step: 'step_preparing',
          import_options: importOptions,
        })
        .select()
        .single()
      if (jobErr || !job) return json(500, { error: 'Failed to create import job.' })

      const plainToken = await getPlaintextToken(conn)
      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, plainToken)
      const warnings: string[] = []

      // Run setup (project, board, sprints, field discovery)
      let cursor: ImportCursor
      try {
        cursor = await runSetup(
          adminClient, userId, job.id, jiraClient,
          conn.jira_site_url, projectKey, boardId, localProjectId, importOptions, warnings,
        )
      } catch (setupErr) {
        const message = sanitizeError(setupErr instanceof Error ? setupErr.message : String(setupErr))
        await adminClient.from('jira_import_jobs').update({
          status: 'failed', error_message: message,
          finished_at: new Date().toISOString(), warnings: warnings as unknown as string,
        }).eq('id', job.id)
        return json(200, { id: job.id, status: 'failed', error_message: message })
      }

      // Process first batch of issues
      let batchResult: { cursor: ImportCursor; done: boolean }
      try {
        batchResult = await processIssuesBatch(adminClient, userId, job.id, jiraClient, cursor, warnings)
      } catch (batchErr) {
        const message = sanitizeError(batchErr instanceof Error ? batchErr.message : String(batchErr))
        await adminClient.from('jira_import_jobs').update({
          status: 'failed', error_message: message,
          finished_at: new Date().toISOString(), warnings: warnings as unknown as string,
        }).eq('id', job.id)
        return json(200, { id: job.id, status: 'failed', error_message: message })
      }

      if (batchResult.done) {
        if (batchResult.cursor.phase === 'finalize') {
          // Small project with no attachments — finalize synchronously
          await runFinalization(adminClient, userId, job.id, jiraClient, batchResult.cursor, warnings)
        } else {
          // Has attachments — save cursor and let frontend resume
          await adminClient.from('jira_import_jobs').update({
            cursor_json: batchResult.cursor as unknown as Record<string, unknown>,
            warnings: warnings as unknown as string,
          }).eq('id', job.id)
        }
      } else {
        // Large project — save cursor so frontend can poll resume
        await adminClient.from('jira_import_jobs').update({
          cursor_json: batchResult.cursor as unknown as Record<string, unknown>,
          warnings: warnings as unknown as string,
        }).eq('id', job.id)
      }

      const { data: finalJob } = await adminClient
        .from('jira_import_jobs')
        .select('id, status, progress_done, progress_total, current_step, warnings, error_message, local_project_id, finished_at')
        .eq('id', job.id)
        .single()

      return json(200, finalJob ?? { id: job.id, status: batchResult.done ? 'completed' : 'running' })
    }

    // ── resume ───────────────────────────────────────────────────────────────
    if (action === 'resume') {
      const jobId = String(body.job_id ?? '')
      const { data: job } = await adminClient
        .from('jira_import_jobs')
        .select('id, status, progress_done, progress_total, current_step, warnings, error_message, local_project_id, cursor_json, connection_id, jira_project_key, finished_at, updated_at')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single()

      if (!job) return json(404, { error: 'Job not found.' })

      if (job.status !== 'running') {
        // Already done or failed — return current state, strip internal fields
        const { cursor_json: _cursor, connection_id: _conn, updated_at: _ts, ...safeJob } =
          job as typeof job & { cursor_json: unknown; connection_id: unknown; updated_at: unknown }
        void _cursor; void _conn; void _ts
        return json(200, safeJob)
      }

      const rawCursor = job.cursor_json as unknown as Record<string, unknown> | null
      if (!rawCursor) {
        await adminClient.from('jira_import_jobs').update({
          status: 'failed',
          error_message: 'Resume failed: no import cursor found.',
          finished_at: new Date().toISOString(),
        }).eq('id', jobId)
        return json(200, { id: jobId, status: 'failed', error_message: 'Resume failed: no import cursor found.' })
      }
      // Normalise handles both old (pre-v2) and new cursor shapes
      const cursor = normaliseCursor(rawCursor)

      // ── Server-side optimistic lock ─────────────────────────────────────────
      // Atomically claim this batch by bumping updated_at (via trigger) using the
      // last-known updated_at as a compare-and-swap token.  If another concurrent
      // resume call already claimed the row (its UPDATE changed updated_at before
      // ours), our WHERE clause won't match and we return without processing.
      const { data: claimed } = await adminClient
        .from('jira_import_jobs')
        .update({ current_step: 'step_processing' })
        .eq('id', jobId)
        .eq('updated_at', (job as any).updated_at)
        .select('id')

      if (!claimed || claimed.length === 0) {
        // Lost the race — another resume is already processing this batch
        return json(200, {
          id: jobId, status: 'running',
          progress_done: job.progress_done, progress_total: job.progress_total,
          current_step: job.current_step,
        })
      }

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email, encrypted_token, token_iv')
        .eq('id', (job as any).connection_id)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found for resume.' })

      const plainToken = await getPlaintextToken(conn)
      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, plainToken)
      // Handle both array (jsonb array, correct) and JSON string (legacy pre-fix rows)
      const warnings: string[] = Array.isArray(job.warnings)
        ? (job.warnings as unknown[]).map(String)
        : typeof job.warnings === 'string' && (job.warnings as string).length > 2
          ? (JSON.parse(job.warnings as string) as unknown[]).map(String)
          : []

      try {
        if (cursor.phase === 'issues') {
          const batchResult = await processIssuesBatch(adminClient, userId, jobId, jiraClient, cursor, warnings)
          if (batchResult.done) {
            if (batchResult.cursor.phase === 'attachments') {
              // Move to attachment phase — save cursor and continue next resume
              await adminClient.from('jira_import_jobs').update({
                cursor_json: batchResult.cursor as unknown as Record<string, unknown>,
                warnings: warnings as unknown as string,
              }).eq('id', jobId)
            } else {
              await runFinalization(adminClient, userId, jobId, jiraClient, batchResult.cursor, warnings)
            }
          } else {
            await adminClient.from('jira_import_jobs').update({
              cursor_json: batchResult.cursor as unknown as Record<string, unknown>,
              warnings: warnings as unknown as string,
            }).eq('id', jobId)
          }
        } else if (cursor.phase === 'attachments') {
          const attResult = await processAttachmentsBatch(adminClient, userId, jobId, jiraClient, cursor, warnings)
          if (attResult.done) {
            await runFinalization(adminClient, userId, jobId, jiraClient, attResult.cursor, warnings)
          } else {
            await adminClient.from('jira_import_jobs').update({
              cursor_json: attResult.cursor as unknown as Record<string, unknown>,
              warnings: warnings as unknown as string,
            }).eq('id', jobId)
          }
        } else {
          // phase === 'finalize' (legacy cursors or direct jump)
          await runFinalization(adminClient, userId, jobId, jiraClient, cursor, warnings)
        }
      } catch (resumeErr) {
        const message = sanitizeError(resumeErr instanceof Error ? resumeErr.message : String(resumeErr))
        await adminClient.from('jira_import_jobs').update({
          status: 'failed', error_message: message,
          finished_at: new Date().toISOString(), warnings: warnings as unknown as string, cursor_json: null,
        }).eq('id', jobId)
        return json(200, { id: jobId, status: 'failed', error_message: message })
      }

      const { data: updatedJob } = await adminClient
        .from('jira_import_jobs')
        .select('id, status, progress_done, progress_total, current_step, warnings, error_message, local_project_id, finished_at')
        .eq('id', jobId)
        .single()

      return json(200, updatedJob ?? { id: jobId, status: 'running' })
    }

    // ── status ───────────────────────────────────────────────────────────────
    if (action === 'status') {
      const jobId = String(body.job_id ?? '')
      const { data: job, error: jobErr } = await adminClient
        .from('jira_import_jobs')
        .select('id, status, progress_done, progress_total, current_step, warnings, error_message, local_project_id, jira_project_key, finished_at, created_at, updated_at')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single()

      if (jobErr || !job) return json(404, { error: 'Job not found.' })

      return json(200, job)
    }

    // ── get_last_connection ──────────────────────────────────────────────────
    if (action === 'get_last_connection') {
      const { data: prefs } = await adminClient
        .from('jira_import_preferences')
        .select('connection_id, local_project_id, last_jira_project_key, last_jira_board_id, include_attachments, include_completed_sprints, include_comments, max_attachment_size_mb, skip_attachments_over_limit, import_users')
        .eq('user_id', userId)
        .single()

      if (!prefs?.connection_id) {
        return json(200, { connection: null, preferences: null })
      }

      // Fetch safe connection metadata; service role bypasses RLS but we
      // intentionally only SELECT and return non-secret columns.
      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('id, jira_site_url, jira_user_email, status, last_sync_at, encrypted_token, _access_token')
        .eq('id', prefs.connection_id)
        .eq('user_id', userId)
        .single()

      if (!conn) {
        return json(200, { connection: null, preferences: null })
      }

      // token_saved tells the frontend there is a usable token on record.
      const tokenSaved = !!(conn.encrypted_token || conn._access_token)

      return json(200, {
        connection: {
          connection_id: conn.id,
          jira_site_url: conn.jira_site_url,
          email: conn.jira_user_email ?? null,
          status: conn.status,
          last_sync_at: conn.last_sync_at ?? null,
          token_saved: tokenSaved,
        },
        preferences: {
          connection_id: prefs.connection_id,
          local_project_id: prefs.local_project_id ?? null,
          last_jira_project_key: prefs.last_jira_project_key ?? null,
          last_jira_board_id: prefs.last_jira_board_id ?? null,
          include_attachments: prefs.include_attachments,
          include_completed_sprints: prefs.include_completed_sprints,
          include_comments: prefs.include_comments,
          max_attachment_size_mb: prefs.max_attachment_size_mb,
          skip_attachments_over_limit: prefs.skip_attachments_over_limit,
          import_users: prefs.import_users,
        },
      })
    }

    // ── save_preferences ─────────────────────────────────────────────────────
    if (action === 'save_preferences') {
      const connectionId = String(body.connection_id ?? '').trim()
      if (!connectionId) return json(400, { error: 'connection_id is required.' })

      // Verify the connection belongs to this user before saving reference to it.
      const { data: connCheck } = await adminClient
        .from('jira_connections')
        .select('id')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()

      if (!connCheck) return json(404, { error: 'Connection not found.' })

      const localProjectId = body.local_project_id ? String(body.local_project_id) : null
      const jiraProjectKey = body.jira_project_key ? String(body.jira_project_key) : null
      const jiraBoardId = body.jira_board_id ? String(body.jira_board_id) : null
      const rawOptions = (body.options ?? {}) as Record<string, unknown>

      await adminClient
        .from('jira_import_preferences')
        .upsert({
          user_id: userId,
          connection_id: connectionId,
          local_project_id: localProjectId,
          last_jira_project_key: jiraProjectKey,
          last_jira_board_id: jiraBoardId,
          include_attachments: rawOptions.include_attachments !== false,
          include_completed_sprints: rawOptions.include_completed_sprints !== false,
          include_comments: rawOptions.include_comments !== false,
          max_attachment_size_mb: Number(rawOptions.max_attachment_size_mb ?? 10),
          skip_attachments_over_limit: rawOptions.skip_attachments_over_limit !== false,
          import_users: rawOptions.import_users !== false,
        }, { onConflict: 'user_id' })

      return json(200, { ok: true })
    }

    // ── check_stale_mappings ─────────────────────────────────────────────────
    // Read-only scan: counts existing and stale mappings for a local project.
    // Used by the wizard to show a warning before re-importing into an existing project.
    if (action === 'check_stale_mappings') {
      const connectionId = String(body.connection_id ?? '').trim()
      const localProjectId = String(body.local_project_id ?? '').trim()
      if (!localProjectId) return json(400, { error: 'local_project_id is required.' })

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const siteUrl = conn.jira_site_url
      const baseQ = (type: string) =>
        adminClient
          .from('jira_external_mappings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('jira_site_url', siteUrl)
          .eq('local_project_id', localProjectId)
          .eq('local_entity_type', type)

      const [im, em, sm] = await Promise.all([baseQ('issue'), baseQ('epic'), baseQ('sprint')])
      const total =
        (im.count ?? 0) + (em.count ?? 0) + (sm.count ?? 0)

      if (total === 0) {
        return json(200, {
          has_mappings: false,
          total_issue_mappings: 0, total_epic_mappings: 0, total_sprint_mappings: 0,
          stale_issue_mappings: 0, stale_epic_mappings: 0, stale_sprint_mappings: 0,
        })
      }

      const stale = await cleanStaleMappings(adminClient, userId, siteUrl, localProjectId, true)
      return json(200, {
        has_mappings: total > 0,
        total_issue_mappings: im.count ?? 0,
        total_epic_mappings: em.count ?? 0,
        total_sprint_mappings: sm.count ?? 0,
        stale_issue_mappings: stale.issue,
        stale_epic_mappings: stale.epic,
        stale_sprint_mappings: stale.sprint,
      })
    }

    // ── repair_stale_mappings ────────────────────────────────────────────────
    // Deletes stale mappings for a local project (where local_entity_id points to
    // a non-existent or wrong-project entity).  Safe: never deletes real tasks.
    if (action === 'repair_stale_mappings') {
      const connectionId = String(body.connection_id ?? '').trim()
      const localProjectId = String(body.local_project_id ?? '').trim()
      if (!localProjectId) return json(400, { error: 'local_project_id is required.' })

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const removed = await cleanStaleMappings(adminClient, userId, conn.jira_site_url, localProjectId, false)
      return json(200, {
        removed_issue_mappings: removed.issue,
        removed_epic_mappings: removed.epic,
        removed_sprint_mappings: removed.sprint,
        total_removed: removed.issue + removed.epic + removed.sprint,
      })
    }

    return json(400, { error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[jira-import] Unhandled error', { action, userId })
    return json(500, { error: sanitizeError(err instanceof Error ? err.message : 'Internal error') })
  }
})
