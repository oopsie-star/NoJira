import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveProfileByEmail } from './resolvers.ts'

interface CreateProjectArgs {
  name?: string
  key?: string
  description?: string
  owner_email?: string
  agent_name?: string
}

const KEY_RE = /^[A-Z0-9]+$/

// Ported from src/store/index.ts's buildProjectKey (Deno's module graph is
// separate from the Vite/browser build, so this can't be imported directly).
// Unlike the frontend, which dedupes against the client's own partial project
// list, this checks the full live key set — more accurate for a
// service-role caller.
export function buildProjectKey(name: string, existingKeys: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'PRJ'
  let candidate = base
  let index = 2
  while (existingKeys.has(candidate)) {
    candidate = `${base}${index}`
    index += 1
  }
  return candidate
}

export async function createProject(admin: SupabaseClient, args: CreateProjectArgs) {
  const name = args.name?.trim()
  const ownerEmail = args.owner_email?.trim()
  const agentName = resolveAgentName(args)
  if (!name) throw new ToolError('"name" is required.')
  if (!ownerEmail) throw new ToolError('"owner_email" is required.')

  // Resolve the owner before creating anything — a bad email should fail
  // fast, not leave an orphaned project behind.
  const ownerProfile = await resolveProfileByEmail(admin, ownerEmail)

  const { data: existingProjects, error: existingError } = await admin.from('projects').select('key')
  if (existingError) throw new ToolError(`Failed to check existing project keys: ${existingError.message}`)
  const existingKeys = new Set((existingProjects ?? []).map((p) => p.key as string))

  let key = args.key?.trim().toUpperCase()
  if (key) {
    if (!KEY_RE.test(key)) throw new ToolError(`Invalid key "${key}" — must be uppercase letters/digits only.`)
    if (existingKeys.has(key)) throw new ToolError(`Project key "${key}" is already in use.`)
  } else {
    key = buildProjectKey(name, existingKeys)
  }

  const reporterId = await resolveMcpAgentProfileId(admin)
  const description = args.description ?? ''

  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({ key, name, description, created_by: reporterId })
    .select('id, key, name, description, created_at')
    .single()
  if (projectError) throw new ToolError(`Failed to create project: ${projectError.message}`)

  // Pinned "Product Vision" epic, mirroring the frontend's createProject
  // (src/store/index.ts) so the backlog's existing epic UI stays the edit
  // surface for the project description. Non-fatal — the project itself
  // already exists at this point.
  const { error: visionError } = await admin.from('epics').insert({
    project_id: project.id,
    title: `Продуктовое видение «${project.name}»`,
    description: project.description,
    color: '#0C66E4',
    status: 'planned',
    is_vision: true,
    created_by: reporterId,
  })
  if (visionError) console.error('[mcp-server] Failed to create vision epic', visionError.message)

  const { error: memberError } = await admin
    .from('project_members')
    .upsert({ project_id: project.id, profile_id: ownerProfile.id, project_role: 'owner' }, { onConflict: 'project_id,profile_id' })
  if (memberError) throw new ToolError(`Project was created but failed to assign owner: ${memberError.message}`)

  // The on_project_created trigger auto-added the mcp-agent service profile
  // (created_by) as owner — it isn't a real user and shouldn't show up as a
  // member in the human-facing project UI, unless it happens to be the
  // requested owner itself.
  if (ownerProfile.id !== reporterId) {
    const { error: cleanupError } = await admin
      .from('project_members')
      .delete()
      .eq('project_id', project.id)
      .eq('profile_id', reporterId)
    if (cleanupError) console.error('[mcp-server] Failed to remove mcp-agent membership', cleanupError.message)
  }

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: project.id,
    action_type: 'create_project',
    payload: args,
    result: project,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return { ...project, owner_email: ownerProfile.email }
}
