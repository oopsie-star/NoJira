import {
  assertEquals,
  assertObjectMatch,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  buildHeartbeatMetadata,
  resolveHeartbeatEnvironment,
  timingSafeEqual,
} from './shared.ts'

Deno.test('resolveHeartbeatEnvironment accepts only supported non-production environments', () => {
  assertEquals(resolveHeartbeatEnvironment('dev'), 'dev')
  assertEquals(resolveHeartbeatEnvironment('development'), 'dev')
  assertEquals(resolveHeartbeatEnvironment('staging'), 'staging')
  assertEquals(resolveHeartbeatEnvironment('stage'), 'staging')
  assertEquals(resolveHeartbeatEnvironment('free'), 'free')
})

Deno.test('resolveHeartbeatEnvironment rejects production and unknown environments', () => {
  assertEquals(resolveHeartbeatEnvironment('production'), null)
  assertEquals(resolveHeartbeatEnvironment('prod'), null)
  assertEquals(resolveHeartbeatEnvironment('preview'), null)
  assertEquals(resolveHeartbeatEnvironment(''), null)
})

Deno.test('timingSafeEqual only passes on exact matches', () => {
  assertEquals(timingSafeEqual('same-secret', 'same-secret'), true)
  assertEquals(timingSafeEqual('same-secret', 'other-secret'), false)
  assertEquals(timingSafeEqual('same-secret', 'same-secret-but-longer'), false)
})

Deno.test('buildHeartbeatMetadata never includes secret-bearing request headers', () => {
  const request = new Request('https://example.com/functions/v1/internal-heartbeat', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer should-not-be-copied',
      'user-agent': 'github-actions-keepalive',
      'x-internal-heartbeat-secret': 'super-secret',
    },
  })

  const metadata = buildHeartbeatMetadata(request)
  assertObjectMatch(metadata, {
    trigger: 'external_cron',
    user_agent: 'github-actions-keepalive',
  })

  const serialized = JSON.stringify(metadata).toLowerCase()
  assertEquals(serialized.includes('super-secret'), false)
  assertEquals(serialized.includes('authorization'), false)
  assertEquals(serialized.includes('x-internal-heartbeat-secret'), false)
})
