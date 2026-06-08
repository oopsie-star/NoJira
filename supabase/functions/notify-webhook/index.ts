import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Server-side relay for Discord / Slack incoming webhooks. The browser can't POST
// to them directly (no CORS), and relaying here also avoids exposing the webhook
// URL to other clients: the caller only sends a webhook_id, we load the URL from
// the DB after verifying the caller is a member of the webhook's project.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Function not configured.' })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'Missing authorization token.' })

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !authData.user) return json(401, { error: 'Unable to validate session.' })
  const userId = authData.user.id

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON body.' }) }

  const webhookId = String(body.webhook_id ?? '')
  const summary = String(body.summary ?? '').slice(0, 1800)
  if (!webhookId || !summary) return json(400, { error: 'webhook_id and summary are required.' })

  const { data: webhook } = await admin
    .from('project_webhooks')
    .select('id, project_id, endpoint_url, webhook_type, is_active')
    .eq('id', webhookId)
    .single()
  if (!webhook) return json(404, { error: 'Webhook not found.' })
  if (!webhook.is_active) return json(200, { ok: true, skipped: true })

  // Only a member of the webhook's project may trigger delivery (anti-abuse).
  const { data: membership } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', webhook.project_id)
    .eq('profile_id', userId)
    .maybeSingle()
  if (!membership) return json(403, { error: 'Not a project member.' })

  const payload = webhook.webhook_type === 'discord' ? { content: summary } : { text: summary }

  try {
    const resp = await fetch(webhook.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return json(200, { ok: false, status: resp.status, body: text.slice(0, 200) })
    }
    return json(200, { ok: true })
  } catch (err) {
    return json(200, { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) })
  }
})
