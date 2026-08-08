import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { timingSafeEqual } from './shared.ts'
import { handleRequest } from './rpc.ts'
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

Deno.test('handleRequest: tools/list returns all 6 tool schemas without touching the DB', async () => {
  // deno-lint-ignore no-explicit-any
  const result = await handleRequest(undefined as any, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const body = result.body as { result: { tools: { name: string }[] } }
  assertEquals(body.result.tools.length, 6)
  assertEquals(
    body.result.tools.map((t) => t.name).sort(),
    ['add_comment', 'create_task', 'get_task', 'list_tasks', 'search_tasks', 'update_task_status'],
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
