import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { notifyProjectMapBlock } from './notifyProjectMap.ts'
import { isUuid, resolveMcpAgentProfileId, resolveProjectByKey } from './resolvers.ts'

interface UpsertProjectMapBlockArgs {
  project?: string
  discipline?: string
  title?: string
  body?: string
  block_id?: string
  covers_discipline?: string
  linked_tasks?: unknown
  linked_epics?: unknown
  position?: number
  agent_name?: string
}

const DISCIPLINES = ['backend', 'frontend', 'design', 'qa']

function asStringArray(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw new ToolError(`"${field}" must be an array of strings.`)
  return value.map((item) => String(item).trim()).filter(Boolean)
}

/** Task keys ("PROJ-42") or uuids → task uuids, scoped to the project. */
async function resolveTaskIds(admin: SupabaseClient, projectId: string, refs: string[]): Promise<string[]> {
  if (refs.length === 0) return []
  const keys = refs.filter((ref) => !isUuid(ref))
  const ids = refs.filter((ref) => isUuid(ref))

  const { data, error } = await admin
    .from('tasks')
    .select('id, key')
    .eq('project_id', projectId)
    .or([keys.length ? `key.in.(${keys.join(',')})` : '', ids.length ? `id.in.(${ids.join(',')})` : '']
      .filter(Boolean)
      .join(','))

  if (error) throw new ToolError(`Failed to resolve linked tasks: ${error.message}`)

  const found = new Set((data ?? []).flatMap((row) => [row.id, row.key]))
  const missing = refs.filter((ref) => !found.has(ref))
  if (missing.length) throw new ToolError(`Not found in this project: ${missing.join(', ')}`)

  return (data ?? []).map((row) => row.id)
}

/** Epic keys ("PROJ-E3"), titles, or uuids → epic uuids, scoped to the project. */
async function resolveEpicIds(admin: SupabaseClient, projectId: string, refs: string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const ref of refs) {
    const { data, error } = await admin
      .from('epics')
      .select('id')
      .eq('project_id', projectId)
      .or(isUuid(ref) ? `id.eq.${ref}` : `key.eq.${ref},title.eq.${ref}`)
      .maybeSingle()
    if (error) throw new ToolError(`Failed to resolve epic "${ref}": ${error.message}`)
    if (!data) throw new ToolError(`Epic "${ref}" not found in this project.`)
    resolved.push(data.id)
  }
  return resolved
}

/**
 * Creates or replaces one Project Map block. Identity is (block_id) when given,
 * otherwise (project, discipline, title) — so an agent re-running its analysis
 * updates the same block instead of duplicating it.
 */
export async function upsertProjectMapBlock(admin: SupabaseClient, args: UpsertProjectMapBlockArgs) {
  const agentName = resolveAgentName(args)
  const projectKey = args.project?.trim()
  const title = args.title?.trim()
  const discipline = args.discipline?.trim().toLowerCase()

  if (!projectKey) throw new ToolError('"project" is required.')
  if (!discipline || !DISCIPLINES.includes(discipline)) {
    throw new ToolError(`"discipline" is required and must be one of: ${DISCIPLINES.join(', ')}`)
  }
  if (!title) throw new ToolError('"title" is required.')

  const project = await resolveProjectByKey(admin, projectKey)
  const agentProfileId = await resolveMcpAgentProfileId(admin)

  const taskRefs = asStringArray(args.linked_tasks, 'linked_tasks')
  const epicRefs = asStringArray(args.linked_epics, 'linked_epics')

  const fields: Record<string, unknown> = {
    project_id: project.id,
    discipline,
    title,
    body: args.body ?? '',
    updated_by: agentProfileId,
    last_ai_agent: agentName,
  }
  if (typeof args.position === 'number') fields.position = args.position

  // QA blocks declare whose work they cover — that's what grants those authors
  // (not just testers) the right to ask about the block. Only meaningful on QA.
  if (args.covers_discipline !== undefined) {
    const covers = args.covers_discipline === null ? null : String(args.covers_discipline).trim().toLowerCase()
    if (covers && discipline !== 'qa') {
      throw new ToolError('"covers_discipline" only applies to QA blocks.')
    }
    if (covers && !['design', 'backend', 'frontend'].includes(covers)) {
      throw new ToolError('"covers_discipline" must be one of: design, backend, frontend.')
    }
    fields.covers_discipline = covers || null
  }
  if (taskRefs) fields.linked_task_ids = await resolveTaskIds(admin, project.id, taskRefs)
  if (epicRefs) fields.linked_epic_ids = await resolveEpicIds(admin, project.id, epicRefs)

  const existingQuery = args.block_id
    ? admin.from('project_map_blocks').select('id').eq('id', args.block_id).maybeSingle()
    : admin
        .from('project_map_blocks')
        .select('id')
        .eq('project_id', project.id)
        .eq('discipline', discipline)
        .eq('title', title)
        .maybeSingle()

  const { data: existing, error: lookupError } = await existingQuery
  if (lookupError) throw new ToolError(`Failed to look up the block: ${lookupError.message}`)
  if (args.block_id && !existing) throw new ToolError(`Block "${args.block_id}" not found.`)

  const { data, error } = existing
    ? await admin
        .from('project_map_blocks')
        .update(fields)
        .eq('id', existing.id)
        .select('id, discipline, title, position, updated_at')
        .single()
    : await admin
        .from('project_map_blocks')
        .insert({ ...fields, created_by: agentProfileId })
        .select('id, discipline, title, position, updated_at')
        .single()

  if (error) throw new ToolError(`Failed to save the block: ${error.message}`)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: agentProfileId,
    project_id: project.id,
    action_type: existing ? 'update_project_map_block' : 'create_project_map_block',
    payload: args,
    result: data,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  await notifyProjectMapBlock({
    projectId: project.id,
    discipline,
    title,
    agentName,
    isNew: !existing,
  })

  return data
}
