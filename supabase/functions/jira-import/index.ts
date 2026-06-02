import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const EPIC_COLORS = [
  '#0C66E4', '#6554C0', '#00B8D9', '#36B37E',
  '#FF5630', '#FF8B00', '#4C9AFF', '#57D9A3',
]

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
    .update({ warnings: JSON.stringify(warnings) })
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
      onConflict: 'user_id,external_source,jira_site_url,local_entity_type,external_id',
    })
}

async function getMappedId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  siteUrl: string,
  entityType: string,
  externalId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('jira_external_mappings')
    .select('local_entity_id')
    .eq('user_id', userId)
    .eq('jira_site_url', siteUrl)
    .eq('local_entity_type', entityType)
    .eq('external_id', externalId)
    .maybeSingle()
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
  phase: 'issues' | 'finalize'
  next_cursor?: string
  include_attachments: boolean
  include_completed_sprints: boolean
  max_attachment_size_mb: number
}

type ImportOptions = {
  include_attachments: boolean
  include_completed_sprints: boolean
  include_comments: boolean
  max_attachment_size_mb: number
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
    let sprintStart = 0
    while (true) {
      const { values: sprints, isLast } = await jiraClient.listSprints(boardId, sprintStart)
      for (const sprint of sprints) {
        const sprintState: string = sprint.state ?? 'future'
        if (sprintState === 'closed' && !options.include_completed_sprints) continue
        const existing = await getMappedId(supabase, userId, siteUrl, 'sprint', String(sprint.id))
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
  const jql = `project = ${jiraProjectKey} ORDER BY created ASC`

  try {
    const totalIssues = await jiraClient.countIssues(jql)
    await supabase.from('jira_import_jobs').update({ progress_total: totalIssues }).eq('id', jobId)
  } catch {
    // Non-fatal — progress just won't show percentage
  }

  return {
    local_project_id: localProjectId,
    site_url: siteUrl,
    jql,
    all_fields: allFields,
    field_map: fieldMap,
    issues_processed: 0,
    phase: 'issues',
    next_cursor: undefined,
    include_attachments: options.include_attachments,
    include_completed_sprints: options.include_completed_sprints,
    max_attachment_size_mb: options.max_attachment_size_mb,
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

  const result = await jiraClient.searchIssues(jql, allFields, cursor.next_cursor)
  const issues = result.issues ?? []
  let processedIssues = cursor.issues_processed

  for (const issue of issues) {
    const issueId = issue.id as string
    const issueKey = issue.key as string
    const fields = issue.fields ?? {}
    const issueTypeName: string = fields.issuetype?.name ?? 'Task'
    const isEpic = issueTypeName === 'Epic'

    const existing = isEpic
      ? await getMappedId(supabase, userId, siteUrl, 'epic', issueId)
      : await getMappedId(supabase, userId, siteUrl, 'issue', issueId)
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
    const rawDescription = fields.description
    const description = rawDescription
      ? (typeof rawDescription === 'string' ? rawDescription : JSON.stringify(rawDescription))
      : ''
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
      const { data: newTask, error: taskErr } = await supabase
        .from('tasks')
        .insert({
          project_id: localProjectId,
          title,
          description,
          status: mappedStatus,
          issue_type: localType,
          priority: mappedPriority,
          labels,
          due_date: dueDate,
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

  const nextCursor = result.nextCursor
  const updatedCursor: ImportCursor = {
    ...cursor,
    issues_processed: processedIssues,
    next_cursor: nextCursor,
    phase: nextCursor ? 'issues' : 'finalize',
  }

  return { cursor: updatedCursor, done: !nextCursor }
}

// ── Steps E + G + H: Hierarchy, attachments, validation ──────────────────────

async function runFinalization(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  jobId: string,
  jiraClient: JiraClient,
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

    // ── Step G: Attachments ──────────────────────────────────────────────────
    if (cursor.include_attachments) {
      await updateJobStep(supabase, jobId, 'step_attachments')
      const maxBytes = cursor.max_attachment_size_mb * 1024 * 1024

      const attachmentMappings = issueMappings.filter((m) => {
        const raw = m.raw_json as Record<string, any> | null
        return raw?.attachment && Array.isArray(raw.attachment) && raw.attachment.length > 0
      })

      for (const mapping of attachmentMappings) {
        const raw = mapping.raw_json as Record<string, any>
        const taskId = mapping.local_entity_id
        const attachments: any[] = raw.attachment ?? []

        for (const att of attachments) {
          try {
            const existingAttachment = await getMappedId(supabase, userId, siteUrl, 'attachment', String(att.id))
            if (existingAttachment) continue

            if (att.size && att.size > maxBytes) {
              await addWarning(supabase, jobId, warnings, `Skipped large attachment ${att.filename} (${Math.round(att.size / 1048576)}MB > limit)`)
              continue
            }

            const { buffer, contentType } = await jiraClient.downloadAttachment(att.content)
            const filename = att.filename ?? `attachment-${att.id}`
            const storagePath = `${localProjectId}/${taskId}/${filename}`

            const { error: uploadError } = await supabase.storage
              .from('task-attachments')
              .upload(storagePath, new Uint8Array(buffer), { contentType, upsert: true, duplex: 'half' } as any)

            if (uploadError) {
              await addWarning(supabase, jobId, warnings, `Upload failed for ${filename}: ${sanitizeError(uploadError.message)}`)
              continue
            }

            const { data: taskRow } = await supabase.from('tasks').select('attachments').eq('id', taskId).single()
            const currentAttachments: string[] = taskRow?.attachments ?? []
            await supabase.from('tasks').update({ attachments: [...currentAttachments, storagePath] }).eq('id', taskId)

            await upsertMapping(supabase, {
              userId, localProjectId, localEntityType: 'attachment', localEntityId: storagePath,
              externalId: String(att.id), externalKey: filename, jiraSiteUrl: siteUrl,
            })
          } catch (attError) {
            await addWarning(supabase, jobId, warnings, `Attachment error for ${att?.filename ?? att?.id}: ${sanitizeError(String(attError))}`)
          }
        }
      }
    }

    // ── Step H: Final validation ─────────────────────────────────────────────
    await updateJobStep(supabase, jobId, 'step_validating')

    const { count: taskCount } = await supabase
      .from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', localProjectId)
    const { count: epicCount } = await supabase
      .from('epics').select('id', { count: 'exact', head: true }).eq('project_id', localProjectId)

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

    const finalStatus = warnings.length > 0 ? 'partial' : 'completed'
    await supabase.from('jira_import_jobs').update({
      status: finalStatus,
      progress_done: processedIssues,
      current_step: null,
      warnings: JSON.stringify(warnings),
      finished_at: new Date().toISOString(),
      local_project_id: localProjectId,
      cursor_json: null,
    }).eq('id', jobId)

    void taskCount
    void epicCount
  } catch (err) {
    const message = sanitizeError(err instanceof Error ? err.message : String(err))
    await supabase.from('jira_import_jobs').update({
      status: 'failed',
      error_message: message,
      finished_at: new Date().toISOString(),
      warnings: JSON.stringify(warnings),
      cursor_json: null,
    }).eq('id', jobId)
    throw err
  }
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
        return json(401, { error: 'ops.jira.error.invalidCredentials' })
      }

      const { data: conn, error: connErr } = await adminClient
        .from('jira_connections')
        .upsert(
          {
            user_id: userId,
            jira_site_url: siteUrl,
            auth_type: 'api_token',
            _access_token: apiToken,
            _token_email: email,
            jira_account_id: myself.accountId,
            jira_user_email: myself.emailAddress,
            status: 'active',
            last_sync_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,jira_site_url' },
        )
        .select('id, jira_site_url, jira_user_email, jira_account_id, status')
        .single()

      if (connErr || !conn) return json(500, { error: 'Failed to save connection.' })

      return json(200, {
        connection_id: conn.id,
        jira_site_url: conn.jira_site_url,
        jira_user_email: conn.jira_user_email,
        jira_account_id: conn.jira_account_id,
        status: conn.status,
      })
    }

    // ── list_projects ────────────────────────────────────────────────────────
    if (action === 'list_projects') {
      const connectionId = String(body.connection_id ?? '')
      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, conn._access_token)
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
        .select('jira_site_url, _access_token, _token_email')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, conn._access_token)
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
        .select('jira_site_url, _access_token, _token_email')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found.' })

      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, conn._access_token)

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

      // Count attachments: issues with at least one attachment
      let attachmentsCount = 0
      let estimatedSize = 0
      try {
        attachmentsCount = await jiraClient.countIssues(`project = ${projectKey} AND attachments is not EMPTY`)
      } catch {
        // Non-fatal
      }

      return json(200, {
        epics_count: epicsCount,
        issues_count: issuesCount,
        subtasks_count: subtasksCount,
        sprints_count: sprintsCount,
        attachments_count: attachmentsCount,
        estimated_attachment_size_bytes: estimatedSize,
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
      }

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email')
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

      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, conn._access_token)
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
          finished_at: new Date().toISOString(), warnings: JSON.stringify(warnings),
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
          finished_at: new Date().toISOString(), warnings: JSON.stringify(warnings),
        }).eq('id', job.id)
        return json(200, { id: job.id, status: 'failed', error_message: message })
      }

      if (batchResult.done) {
        // Small project — finalize synchronously within this call
        await runFinalization(adminClient, userId, job.id, jiraClient, batchResult.cursor, warnings)
      } else {
        // Large project — save cursor so frontend can poll resume
        await adminClient.from('jira_import_jobs').update({
          cursor_json: batchResult.cursor as unknown as Record<string, unknown>,
          warnings: JSON.stringify(warnings),
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
        .select('id, status, progress_done, progress_total, current_step, warnings, error_message, local_project_id, cursor_json, connection_id, jira_project_key, finished_at')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single()

      if (!job) return json(404, { error: 'Job not found.' })

      if (job.status !== 'running') {
        // Already done or failed — return current state without cursor
        const { cursor_json: _cursor, ...safeJob } = job as typeof job & { cursor_json: unknown }
        void _cursor
        return json(200, safeJob)
      }

      const cursor = job.cursor_json as unknown as ImportCursor | null
      if (!cursor) {
        await adminClient.from('jira_import_jobs').update({
          status: 'failed',
          error_message: 'Resume failed: no import cursor found.',
          finished_at: new Date().toISOString(),
        }).eq('id', jobId)
        return json(200, { id: jobId, status: 'failed', error_message: 'Resume failed: no import cursor found.' })
      }

      const { data: conn } = await adminClient
        .from('jira_connections')
        .select('jira_site_url, _access_token, _token_email')
        .eq('id', job.connection_id)
        .eq('user_id', userId)
        .single()
      if (!conn) return json(404, { error: 'Connection not found for resume.' })

      const jiraClient = new JiraClient(conn.jira_site_url, conn._token_email, conn._access_token)
      const warnings: string[] = Array.isArray(job.warnings) ? (job.warnings as unknown[]).map(String) : []

      try {
        if (cursor.phase === 'issues') {
          const batchResult = await processIssuesBatch(adminClient, userId, jobId, jiraClient, cursor, warnings)
          if (batchResult.done) {
            await runFinalization(adminClient, userId, jobId, jiraClient, batchResult.cursor, warnings)
          } else {
            await adminClient.from('jira_import_jobs').update({
              cursor_json: batchResult.cursor as unknown as Record<string, unknown>,
              warnings: JSON.stringify(warnings),
            }).eq('id', jobId)
          }
        } else {
          await runFinalization(adminClient, userId, jobId, jiraClient, cursor, warnings)
        }
      } catch (resumeErr) {
        const message = sanitizeError(resumeErr instanceof Error ? resumeErr.message : String(resumeErr))
        await adminClient.from('jira_import_jobs').update({
          status: 'failed', error_message: message,
          finished_at: new Date().toISOString(), warnings: JSON.stringify(warnings), cursor_json: null,
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

    return json(400, { error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[jira-import] Unhandled error', { action, userId })
    return json(500, { error: sanitizeError(err instanceof Error ? err.message : 'Internal error') })
  }
})
