import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { timingSafeEqual } from './shared.ts'
import { handleRequest } from './rpc.ts'
import { handleOAuthRoute, sha256Base64Url } from './oauth.ts'
import { isUuid } from './tools/resolvers.ts'
import { TASK_STATUSES } from './types.ts'

Deno.test('timingSafeEqual only passes on exact matches', () => {
  assertEquals(timingSafeEqual('same-key', 'same-key'), true)
  assertEquals(timingSafeEqual('same-key', 'other-key'), false)
  assertEquals(timingSafeEqual('same-key', 'same-key-but-longer'), false)
})

Deno.test('isUuid recognizes uuids and rejects task keys', () => {
  assertEquals(isUuid('11111111-2222-3333-4444-555555555555'), true)
  assertEquals(isUuid('PROJ-42'), false)
  assertEquals(isUuid(''), false)
})

Deno.test('TASK_STATUSES enum matches the tasks.status CHECK constraint', () => {
  assertEquals(TASK_STATUSES, ['todo', 'in_progress', 'done', 'cancelled', 'archived', 'deleted'])
})

Deno.test('handleRequest: initialize returns protocol/server info without touching the DB', async () => {
  // deno-lint-ignore no-explicit-any
  const result = await handleRequest(undefined as any, { jsonrpc: '2.0', id: 1, method: 'initialize' })
  assertEquals(result.status, 200)
  const body = result.body as { result: { protocolVersion: string; serverInfo: { name: string } } }
  assertEquals(body.result.serverInfo.name, 'qira-mcp-server')
})

Deno.test('handleRequest: tools/list returns all 10 tool schemas without touching the DB', async () => {
  // deno-lint-ignore no-explicit-any
  const result = await handleRequest(undefined as any, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const body = result.body as { result: { tools: { name: string }[] } }
  assertEquals(body.result.tools.length, 10)
  assertEquals(
    body.result.tools.map((t) => t.name).sort(),
    [
      'add_comment',
      'create_epic',
      'create_sprint',
      'create_task',
      'get_project',
      'get_task',
      'list_tasks',
      'search_tasks',
      'update_task',
      'update_task_status',
    ],
  )
})

Deno.test('handleRequest: unknown method returns -32601 without touching the DB', async () => {
  // deno-lint-ignore no-explicit-any
  const result = await handleRequest(undefined as any, { jsonrpc: '2.0', id: 3, method: 'bogus/method' })
  const body = result.body as { error: { code: number } }
  assertEquals(body.error.code, -32601)
})

Deno.test('handleRequest: tools/call with unknown tool name returns -32602 without touching the DB', async () => {
  const result = await handleRequest(
    // deno-lint-ignore no-explicit-any
    undefined as any,
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } },
  )
  const body = result.body as { error: { code: number } }
  assertEquals(body.error.code, -32602)
})

Deno.test('handleRequest: notifications get a 202 with no body and are not dispatched', async () => {
  const result = await handleRequest(
    // deno-lint-ignore no-explicit-any
    undefined as any,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  )
  assertEquals(result.status, 202)
  assertEquals(result.body, null)
})

Deno.test('handleRequest: malformed request body returns -32600', async () => {
  // deno-lint-ignore no-explicit-any
  const result = await handleRequest(undefined as any, 'not an object')
  const body = result.body as { error: { code: number } }
  assertEquals(body.error.code, -32600)
})

Deno.test('sha256Base64Url matches the RFC 7636 PKCE test vector', async () => {
  const challenge = await sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  assertEquals(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

Deno.test('handleOAuthRoute: non-oauth path returns null so index.ts falls through to JSON-RPC', async () => {
  const request = new Request('https://example.com/functions/v1/mcp-server', { method: 'POST' })
  // deno-lint-ignore no-explicit-any
  const result = await handleOAuthRoute(request, undefined as any)
  assertEquals(result, null)
})

Deno.test('handleOAuthRoute: /authorize hit with the wrong method returns 405, never falls through', async () => {
  const request = new Request('https://example.com/functions/v1/mcp-server/authorize', { method: 'POST' })
  // deno-lint-ignore no-explicit-any
  const result = await handleOAuthRoute(request, undefined as any)
  assertEquals(result?.status, 405)
})

Deno.test('handleOAuthRoute: /token hit with the wrong method returns 405, never falls through', async () => {
  const request = new Request('https://example.com/functions/v1/mcp-server/token', { method: 'GET' })
  // deno-lint-ignore no-explicit-any
  const result = await handleOAuthRoute(request, undefined as any)
  assertEquals(result?.status, 405)
})

Deno.test('handleOAuthRoute: protected resource metadata is served without touching the DB', async () => {
  // Metadata URLs are built from the SUPABASE_URL env var, not request.url's
  // origin (the Edge Runtime's proxy reports request.url as http:// even
  // though the function is only reachable over https://) — so these
  // assertions check path structure, not a specific origin.
  const request = new Request('https://example.com/functions/v1/mcp-server/.well-known/oauth-protected-resource', {
    method: 'GET',
  })
  // deno-lint-ignore no-explicit-any
  const result = await handleOAuthRoute(request, undefined as any)
  assertEquals(result?.status, 200)
  const body = await result!.json()
  assertEquals(body.resource.endsWith('/functions/v1/mcp-server'), true)
  assertEquals(body.authorization_servers, [body.resource])
})

Deno.test('handleOAuthRoute: authorization server metadata is served without touching the DB', async () => {
  const request = new Request('https://example.com/functions/v1/mcp-server/.well-known/oauth-authorization-server', {
    method: 'GET',
  })
  // deno-lint-ignore no-explicit-any
  const result = await handleOAuthRoute(request, undefined as any)
  assertEquals(result?.status, 200)
  const body = await result!.json()
  assertEquals(body.authorization_endpoint.endsWith('/functions/v1/mcp-server/authorize'), true)
  assertEquals(body.token_endpoint.endsWith('/functions/v1/mcp-server/token'), true)
  assertEquals(body.code_challenge_methods_supported, ['S256'])
})
