import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'

// The three AIs that can touch Qira data: the two MCP clients (Claude, GPT)
// plus the in-app assistant (agentTools.ts), which only ever labels its own
// agent_audit_log rows as 'qira-assistant' — it isn't gated by this module,
// only visible to it, so an MCP call can tell its edits apart from a human's.
export type AgentName = 'claude' | 'chatgpt'
const AGENT_NAMES: AgentName[] = ['claude', 'chatgpt']

// There's no transport-level way to tell Claude and ChatGPT apart — both
// reach this server through the same static MCP_API_KEY / OAuth client.
// Identity is self-declared: every write tool requires this argument, and
// its schema description is the "instruction to the model" that makes the
// self-declaration happen.
export function resolveAgentName(args: Record<string, unknown>): AgentName {
  const value = typeof args.agent_name === 'string' ? args.agent_name : ''
  if (!AGENT_NAMES.includes(value as AgentName)) {
    throw new ToolError(`"agent_name" is required and must be one of: ${AGENT_NAMES.join(', ')}`)
  }
  return value as AgentName
}

interface GatedEntity {
  type: 'task' | 'epic' | 'sprint'
  id: string
  /** Human-readable identifier for the error message, e.g. a task key or epic title. */
  label: string
}

// Throws unless either no other agent has touched this entity before, the
// same agent is calling again, or the caller has already gotten operator
// confirmation (confirmed_cross_agent: true) and is retrying.
export async function checkCrossAgentConflict(
  admin: SupabaseClient,
  entity: GatedEntity,
  agentName: AgentName,
  confirmed: boolean,
): Promise<void> {
  const column = entity.type === 'task' ? 'task_id' : entity.type === 'epic' ? 'epic_id' : 'sprint_id'

  const { data, error } = await admin
    .from('agent_audit_log')
    .select('agent_name, action_type, created_at')
    .eq(column, entity.id)
    .not('agent_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new ToolError(`Failed to check prior agent activity: ${error.message}`)
  if (!data || data.agent_name === agentName || confirmed) return

  throw new ToolError(
    `Cannot proceed: ${entity.label} was last modified by ${data.agent_name} (${data.action_type}) at ${data.created_at}. ` +
      'Get explicit confirmation from the human operator before changing it, then retry this call with confirmed_cross_agent: true.',
  )
}
