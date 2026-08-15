import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId } from './resolvers.ts'

interface DeleteProjectMapBlockArgs {
  block_id?: string
  agent_name?: string
}

/** Removes a Project Map block and (by cascade) the Q&A attached to it. */
export async function deleteProjectMapBlock(admin: SupabaseClient, args: DeleteProjectMapBlockArgs) {
  const agentName = resolveAgentName(args)
  const blockId = args.block_id?.trim()
  if (!blockId) throw new ToolError('"block_id" is required.')

  const { data: block, error: lookupError } = await admin
    .from('project_map_blocks')
    .select('id, project_id, discipline, title, last_ai_agent')
    .eq('id', blockId)
    .maybeSingle()
  if (lookupError) throw new ToolError(`Failed to look up block "${blockId}": ${lookupError.message}`)
  if (!block) throw new ToolError(`Project map block "${blockId}" not found.`)

  const agentProfileId = await resolveMcpAgentProfileId(admin)

  const { error } = await admin.from('project_map_blocks').delete().eq('id', block.id)
  if (error) throw new ToolError(`Failed to delete the block: ${error.message}`)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: agentProfileId,
    project_id: block.project_id,
    action_type: 'delete_project_map_block',
    payload: args,
    result: block,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return { deleted: true, title: block.title, discipline: block.discipline }
}
