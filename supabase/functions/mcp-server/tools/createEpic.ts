import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId, resolveProjectByKey } from './resolvers.ts'

interface CreateEpicArgs {
  project?: string
  title?: string
  description?: string
  agent_name?: string
}

export async function createEpic(admin: SupabaseClient, args: CreateEpicArgs) {
  const projectKey = args.project?.trim()
  const title = args.title?.trim()
  const agentName = resolveAgentName(args)
  if (!projectKey) throw new ToolError('"project" is required.')
  if (!title) throw new ToolError('"title" is required.')

  const project = await resolveProjectByKey(admin, projectKey)
  const reporterId = await resolveMcpAgentProfileId(admin)

  const { data, error } = await admin
    .from('epics')
    .insert({ project_id: project.id, title, description: args.description ?? '', created_by: reporterId })
    .select('id, key, title, status')
    .single()

  if (error) throw new ToolError(`Failed to create epic: ${error.message}`)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: reporterId,
    project_id: project.id,
    task_id: null,
    epic_id: data.id,
    action_type: 'create_epic',
    payload: args,
    result: data,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return data
}
