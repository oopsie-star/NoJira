import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { TOOL_HANDLERS, TOOL_SCHEMAS, ToolError } from './tools/index.ts'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'qira-mcp-server', version: '1.0.0' }

function success(id: JsonRpcId, result: unknown) {
  return { status: 200, body: { jsonrpc: '2.0', id, result } }
}

function failure(id: JsonRpcId, code: number, message: string) {
  return { status: 200, body: { jsonrpc: '2.0', id, error: { code, message } } }
}

function toolResult(text: string, isError: boolean) {
  return { content: [{ type: 'text', text }], isError }
}

export async function handleRequest(admin: SupabaseClient, body: unknown): Promise<{ status: number; body: unknown | null }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return failure(null, -32600, 'Invalid Request')
  }

  const request = body as JsonRpcRequest
  const id = request.id ?? null
  const isNotification = !('id' in request)
  const method = request.method

  if (typeof method !== 'string') {
    return failure(id, -32600, 'Invalid Request — missing method')
  }

  if (isNotification || method.startsWith('notifications/')) {
    // JSON-RPC notifications get no response body at all.
    return { status: 202, body: null }
  }

  if (method === 'initialize') {
    return success(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions:
        'Qira tracks multiple projects. Before creating or modifying anything, confirm with the human operator which project (key) you are acting in — call list_projects if you are not sure what projects exist. Do not silently guess a project.',
    })
  }

  if (method === 'tools/list') {
    return success(id, { tools: TOOL_SCHEMAS })
  }

  if (method === 'tools/call') {
    const params = request.params ?? {}
    const name = params.name
    const args = (params.arguments ?? {}) as Record<string, unknown>

    if (typeof name !== 'string' || !(name in TOOL_HANDLERS)) {
      return failure(id, -32602, `Unknown tool "${String(name)}"`)
    }

    try {
      const result = await TOOL_HANDLERS[name](admin, args)
      return success(id, toolResult(JSON.stringify(result), false))
    } catch (err) {
      if (err instanceof ToolError) {
        return success(id, toolResult(`Error: ${err.message}`, true))
      }
      console.error(`[mcp-server] Uncaught error in tool "${name}"`, err)
      return failure(id, -32603, 'Internal error')
    }
  }

  return failure(id, -32601, `Method not found: ${method}`)
}
