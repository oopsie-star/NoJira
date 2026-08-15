import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { resolveAgentName } from './agentGate.ts'
import { ToolError } from './errors.ts'
import { resolveMcpAgentProfileId } from './resolvers.ts'

interface PostProjectMapQaArgs {
  block_id?: string
  answer_to?: string
  body?: string
  agent_name?: string
}

/**
 * Posts a question on a Project Map block, or an answer to an existing question
 * (answer_to). Q&A is always bound to one block, so a question always carries
 * the concrete piece of content it is about.
 */
export async function postProjectMapQa(admin: SupabaseClient, args: PostProjectMapQaArgs) {
  const agentName = resolveAgentName(args)
  const body = args.body?.trim()
  if (!body) throw new ToolError('"body" is required.')

  const answerTo = args.answer_to?.trim()
  let blockId = args.block_id?.trim()

  if (answerTo) {
    // An answer inherits its question's block — no need for the caller to
    // repeat it, and it can't drift onto the wrong block this way.
    const { data, error } = await admin
      .from('project_map_qa')
      .select('id, block_id, parent_id')
      .eq('id', answerTo)
      .maybeSingle()
    if (error) throw new ToolError(`Failed to look up question "${answerTo}": ${error.message}`)
    if (!data) throw new ToolError(`Question "${answerTo}" not found.`)
    if (data.parent_id) throw new ToolError('"answer_to" must be a question, not another answer.')
    blockId = data.block_id
  }

  if (!blockId) throw new ToolError('Either "block_id" or "answer_to" is required.')

  const { data: block, error: blockError } = await admin
    .from('project_map_blocks')
    .select('id, project_id, title')
    .eq('id', blockId)
    .maybeSingle()
  if (blockError) throw new ToolError(`Failed to look up block "${blockId}": ${blockError.message}`)
  if (!block) throw new ToolError(`Project map block "${blockId}" not found.`)

  const agentProfileId = await resolveMcpAgentProfileId(admin)

  const { data, error } = await admin
    .from('project_map_qa')
    .insert({
      block_id: block.id,
      project_id: block.project_id,
      parent_id: answerTo ?? null,
      body,
      // author_id stays null: the row is attributed to the AI, not to the
      // shared MCP service profile a human might be confused for.
      author_agent: agentName,
    })
    .select('id, block_id, parent_id, body, author_agent, created_at')
    .single()

  if (error) throw new ToolError(`Failed to post: ${error.message}`)

  const { error: auditError } = await admin.from('agent_audit_log').insert({
    agent_type: 'mcp',
    agent_name: agentName,
    agent_profile_id: agentProfileId,
    project_id: block.project_id,
    action_type: answerTo ? 'answer_project_map_question' : 'ask_project_map_question',
    payload: args,
    result: data,
  })
  if (auditError) console.error('[mcp-server] Failed to record agent_audit_log', auditError.message)

  return data
}
