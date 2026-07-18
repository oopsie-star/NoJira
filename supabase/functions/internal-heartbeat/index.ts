import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import {
  buildHeartbeatMetadata,
  resolveHeartbeatEnvironment,
  timingSafeEqual,
} from './shared.ts'

type FunctionResponse = {
  ok: boolean
  error?: string
}

const heartbeatSource = 'supabase_keepalive'
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const heartbeatSecret = Deno.env.get('INTERNAL_HEARTBEAT_SECRET')?.trim() ?? ''
const heartbeatEnvironmentRaw = Deno.env.get('INTERNAL_HEARTBEAT_ENVIRONMENT') ?? ''

function json(status: number, payload: FunctionResponse) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey || !heartbeatSecret) {
    return json(500, { ok: false, error: 'misconfigured' })
  }

  const heartbeatEnvironment = resolveHeartbeatEnvironment(heartbeatEnvironmentRaw)
  if (!heartbeatEnvironmentRaw.trim()) {
    return json(500, { ok: false, error: 'heartbeat_environment_missing' })
  }

  if (!heartbeatEnvironment) {
    return json(403, { ok: false, error: 'heartbeat_disabled_for_environment' })
  }

  const requestSecret = request.headers.get('x-internal-heartbeat-secret')?.trim() ?? ''
  if (!requestSecret || !timingSafeEqual(requestSecret, heartbeatSecret)) {
    return json(401, { ok: false, error: 'unauthorized' })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = new Date().toISOString()
  const { error } = await adminClient.from('internal_heartbeat').upsert(
    {
      source: heartbeatSource,
      environment: heartbeatEnvironment,
      last_ping_at: now,
      updated_at: now,
      metadata: buildHeartbeatMetadata(request),
    },
    { onConflict: 'source,environment' },
  )

  if (error) {
    console.error('[internal-heartbeat] Failed to upsert heartbeat row', {
      code: error.code,
      message: error.message,
    })
    return json(500, { ok: false, error: 'heartbeat_upsert_failed' })
  }

  return json(200, { ok: true })
})
