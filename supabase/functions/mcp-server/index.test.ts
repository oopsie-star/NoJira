import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { timingSafeEqual } from './shared.ts'
import { handleRequest } from './rpc.ts'
import { handleOAuthRoute, sha256Base64Url } from './oauth.ts'
import { isUuid } from './tools/resolvers.ts'
import {
  decodeAttachmentBase64,
  displayFilename,
  epicIdFromPath,
  getFilename,
  projectIdFromPath,
  safeFilename,
  sprintIdFromPath,
  taskIdFromPath,
} from './tools/attachmentPaths.ts'
import { resolveAgentName } from './tools/agentGate.ts'
import { ToolError } from './tools/errors.ts'
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

Deno.test('handleRequest: tools/list returns all 14 tool schemas without touching the DB', async () => {
  // deno-lint-ignore no-explicit-any
  const result = await handleRequest(undefined as any, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const body = result.body as { result: { tools: { name: string }[] } }
  assertEquals(body.result.tools.length, 14)
  assertEquals(
    body.result.tools.map((t) => t.name).sort(),
    [
      'add_comment',
      'attach_epic_file',
      'attach_sprint_file',
      'attach_task_file',
      'create_epic',
      'create_sprint',
      'create_task',
      'get_project',
      'get_task',
      'list_tasks',
      'rename_attachment',
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
  assertEquals(body.registration_endpoint.endsWith('/functions/v1/mcp-server/register'), true)
})

Deno.test('handleOAuthRoute: /register hit with the wrong method returns 405, never falls through', async () => {
  const request = new Request('https://example.com/functions/v1/mcp-server/register', { method: 'GET' })
  // deno-lint-ignore no-explicit-any
  const result = await handleOAuthRoute(request, undefined as any)
  assertEquals(result?.status, 405)
})

Deno.test('safeFilename replaces characters Supabase Storage rejects in object keys', () => {
  assertEquals(safeFilename('spec (final).pdf'), 'spec (final).pdf')
  assertEquals(safeFilename('тест.pdf'), '____.pdf')
  assertEquals(safeFilename('a/b\\c'), 'a_b_c')
})

Deno.test('getFilename strips the upload timestamp prefix', () => {
  assertEquals(getFilename('proj/task/author/1712345678901-spec.pdf'), 'spec.pdf')
  assertEquals(getFilename('proj/epics/e1/author/report.pdf'), 'report.pdf')
})

Deno.test('displayFilename prefers the recorded original_name over the derived path name', () => {
  assertEquals(displayFilename('proj/task/author/1712345678901-spec.pdf', 'Спецификация.pdf'), 'Спецификация.pdf')
  assertEquals(displayFilename('proj/task/author/1712345678901-spec.pdf', null), 'spec.pdf')
})

Deno.test('taskIdFromPath returns the task id for task paths, null for epic/sprint paths', () => {
  const taskId = '11111111-2222-3333-4444-555555555555'
  assertEquals(taskIdFromPath(`proj/${taskId}/author/file.pdf`), taskId)
  assertEquals(taskIdFromPath('proj/epics/e1/author/file.pdf'), null)
  assertEquals(taskIdFromPath('proj/sprints/s1/author/file.pdf'), null)
})

Deno.test('projectIdFromPath returns the leading uuid segment', () => {
  const projectId = '11111111-2222-3333-4444-555555555555'
  assertEquals(projectIdFromPath(`${projectId}/epics/e1/author/file.pdf`), projectId)
  assertEquals(projectIdFromPath('not-a-uuid/epics/e1/author/file.pdf'), null)
})

Deno.test('epicIdFromPath / sprintIdFromPath extract the entity id, null for other shapes', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  assertEquals(epicIdFromPath(`proj/epics/${id}/author/file.pdf`), id)
  assertEquals(epicIdFromPath(`proj/sprints/${id}/author/file.pdf`), null)
  assertEquals(epicIdFromPath(`proj/${id}/author/file.pdf`), null)
  assertEquals(sprintIdFromPath(`proj/sprints/${id}/author/file.pdf`), id)
  assertEquals(sprintIdFromPath(`proj/epics/${id}/author/file.pdf`), null)
})

Deno.test('resolveAgentName accepts claude/chatgpt and rejects anything else', () => {
  assertEquals(resolveAgentName({ agent_name: 'claude' }), 'claude')
  assertEquals(resolveAgentName({ agent_name: 'chatgpt' }), 'chatgpt')
  for (const bad of [{ agent_name: 'gpt' }, { agent_name: '' }, {}]) {
    let threw = false
    try {
      resolveAgentName(bad)
    } catch (err) {
      threw = err instanceof ToolError
    }
    assertEquals(threw, true)
  }
})

Deno.test('decodeAttachmentBase64 rejects invalid base64 and oversized files', () => {
  let threw = false
  try {
    decodeAttachmentBase64('not valid base64 !!!')
  } catch {
    threw = true
  }
  assertEquals(threw, true)

  const oversized = btoa('x'.repeat(21 * 1024 * 1024))
  let oversizedThrew = false
  try {
    decodeAttachmentBase64(oversized)
  } catch {
    oversizedThrew = true
  }
  assertEquals(oversizedThrew, true)

  const small = btoa('hello world')
  const decoded = decodeAttachmentBase64(small)
  assertEquals(new TextDecoder().decode(decoded), 'hello world')
})
