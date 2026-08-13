import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveEpicByKeyOrTitle, resolveMcpAgentProfileId, resolveProjectByKey } from './resolvers.ts'

interface CreateSprintArgs {
  project?: string
  name?: string
  goal?: string
  epic?: string
  agent_name?: string
}

export async function createSprint(admin: SupabaseClient, args: CreateSprintArgs) {
  const projectKey = args.project?.trim()
  const name = args.name?.trim()
  const agentName = resolveAgentName(args)
  if (!projectKey) throw new ToolError('"project" is required.')
  if (!name) throw new ToolError('"name" is required.')

  const project = await resolveProjectByKey(admin, projectKey)
  const reporterId = await resolveMcpAgentProfileId(admin)
  const epic = args.epic ? await resolveEpicByKeyOrTitle(admin, project.id, args.epic) : null

  const { data, error } = await admin
    .from('sprints')
    .insert({
      project_id: project.id,
      epic_id: epic?.id ?? null,
      name,
      goal: args.goal ?? '',
      created_by: reporterId,
    })
    .select('id, name, status')
    .single()

  if (error) throw new ToolError(`Failed to create sprint: ${error.message}`)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: project.id,
    task_id: null,
    sprint_id: data.id,
    action_type: 'create_sprint',
    payload: args,
    result: data,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return data
}
