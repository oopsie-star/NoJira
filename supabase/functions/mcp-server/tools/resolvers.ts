import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import type { Profile, Project, Task } from '../types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

const TASK_COLUMNS =
  'id, project_id, key, title, description, status, issue_type, priority, epic_id, sprint_id, assignee_id, reporter_id, assignee_ids, due_date, created_at, updated_at'

export async function resolveProjectByKey(admin: SupabaseClient, key: string): Promise<Project> {
  const { data, error } = await admin.from('projects').select('id, key, name').eq('key', key).maybeSingle()
  if (error) throw new ToolError(`Failed to look up project "${key}": ${error.message}`)
  if (!data) throw new ToolError(`Project "${key}" not found.`)
  return data
}

export async function resolveProfileByEmail(admin: SupabaseClient, email: string): Promise<Profile> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .ilike('email', email)
    .maybeSingle()
  if (error) throw new ToolError(`Failed to look up profile "${email}": ${error.message}`)
  if (!data) throw new ToolError(`No profile found for email "${email}".`)
  return data
}

export async function resolveTaskByKeyOrId(admin: SupabaseClient, ref: string): Promise<Task> {
  const column = isUuid(ref) ? 'id' : 'key'
  const { data, error } = await admin.from('tasks').select(TASK_COLUMNS).eq(column, ref).maybeSingle()
  if (error) throw new ToolError(`Failed to look up task "${ref}": ${error.message}`)
  if (!data) throw new ToolError(`Task "${ref}" not found.`)
  return data
}

export async function resolveEpicByKeyOrTitle(
  admin: SupabaseClient,
  projectId: string,
  ref: string,
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('epics')
    .select('id')
    .eq('project_id', projectId)
    .or(`key.eq.${ref},title.eq.${ref}`)
    .maybeSingle()
  if (error) throw new ToolError(`Failed to look up epic "${ref}": ${error.message}`)
  if (!data) throw new ToolError(`Epic "${ref}" not found in this project.`)
  return data
}

export async function resolveSprintByName(
  admin: SupabaseClient,
  projectId: string,
  ref: string,
  epicId?: string,
): Promise<{ id: string }> {
  let query = admin.from('sprints').select('id').eq('project_id', projectId).eq('name', ref)
  if (epicId) query = query.eq('epic_id', epicId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new ToolError(`Failed to look up sprint "${ref}": ${error.message}`)
  if (!data) throw new ToolError(`Sprint "${ref}" not found in this project.`)
  return data
}

// Resolved once per cold start and cached — every write tool attributes its
// action to this profile since MCP callers share one static API key with no
// per-user identity. See CLAUDE.md/the plan for why this profile must exist
// before first use rather than falling back to a null author.
let cachedMcpAgentProfileId: string | null = null

export async function resolveMcpAgentProfileId(admin: SupabaseClient): Promise<string> {
  if (cachedMcpAgentProfileId) return cachedMcpAgentProfileId

  const email = Deno.env.get('MCP_AGENT_EMAIL')?.trim() ?? ''
  if (!email) {
    throw new ToolError('MCP_AGENT_EMAIL is not configured — set it to an existing profiles.email.')
  }

  const { data, error } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle()
  if (error) throw new ToolError(`Failed to resolve MCP agent profile: ${error.message}`)
  if (!data) throw new ToolError(`MCP agent profile "${email}" does not exist — create it before using write tools.`)

  cachedMcpAgentProfileId = data.id
  return cachedMcpAgentProfileId
}
