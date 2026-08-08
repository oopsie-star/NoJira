import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { handleOAuthRoute, protectedResourceMetadataUrl } from './oauth.ts'
import { handleRequest } from './rpc.ts'
import { json, timingSafeEqual } from './shared.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const mcpApiKey = Deno.env.get('MCP_API_KEY')?.trim() ?? ''

Deno.serve(async (request) => {
  if (!supabaseUrl || !supabaseServiceRoleKey || !mcpApiKey) {
    return json(500, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Server misconfigured' } })
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // OAuth shim routes (/.well-known/*, /authorize, /token) — see oauth.ts.
  // Only the root JSON-RPC endpoint below falls through past this.
  const oauthResponse = await handleOAuthRoute(request, admin)
  if (oauthResponse) return oauthResponse

  if (request.method !== 'POST') {
    return json(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } })
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!presented || !timingSafeEqual(presented, mcpApiKey)) {
    return json(
      401,
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
      { 'WWW-Authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl()}"` },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }

  const { status, body: responseBody } = await handleRequest(admin, body)
  if (responseBody === null) {
    return new Response(null, { status })
  }
  return json(status, responseBody)
})
