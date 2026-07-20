import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Sends the email half of a task notification (the in-app half is already
// written to the `notifications` table by the caller before this runs).
// Mirrors notify-webhook's auth/membership skeleton and
// notify-approval-request's Resend-sending + sandbox-mode handling.

type RequestPayload = {
  recipient_ids?: string[]
  project_id?: string
  task_id?: string | null
  subject?: string
  body_text?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const emailFrom = Deno.env.get('APPROVAL_EMAIL_FROM')?.trim() ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://oopsie-star.github.io/NoJira/'
const resendUserAgent = 'qira-task-notifier/1.0'

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function usesResendDevSender(address: string) {
  return address.toLowerCase().includes('@resend.dev')
}

function buildSandboxRecipient(profileId: string) {
  const label = profileId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'task'
  return `delivered+task-${label}@resend.dev`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!supabaseUrl || !supabaseServiceRoleKey) return json(500, { error: 'Function not configured.' })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'Missing authorization token.' })

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !authData.user) return json(401, { error: 'Unable to validate session.' })

  let body: RequestPayload
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON body.' }) }

  const recipientIds = [...new Set((body.recipient_ids ?? []).filter(Boolean))]
  const projectId = String(body.project_id ?? '')
  const taskId = body.task_id ?? null
  const subject = String(body.subject ?? '').slice(0, 200)
  const bodyText = String(body.body_text ?? '').slice(0, 2000)
  if (!recipientIds.length || !projectId || !subject) {
    return json(400, { error: 'recipient_ids, project_id, and subject are required.' })
  }

  // Only a member of the project may trigger delivery (anti-abuse), same guard as notify-webhook.
  const { data: membership } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', authData.user.id)
    .maybeSingle()
  if (!membership) return json(403, { error: 'Not a project member.' })

  if (!emailFrom || !resendApiKey) {
    return json(200, { sent: 0, failed: recipientIds.length, skipped: 'Email delivery is not configured.' })
  }

  const { data: project } = await admin.from('projects').select('key').eq('id', projectId).single()
  const taskLink = project?.key && taskId
    ? `${appBaseUrl.replace(/\/$/, '')}/projects/${encodeURIComponent(project.key)}/backlog?task=${taskId}`
    : appBaseUrl

  const { data: recipients } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .in('id', recipientIds)

  const sandboxMode = usesResendDevSender(emailFrom)
  let sent = 0
  let failed = 0

  for (const recipient of recipients ?? []) {
    const to = sandboxMode ? buildSandboxRecipient(recipient.id) : recipient.email
    if (!to) { failed += 1; continue }

    const safeName = recipient.full_name?.trim() || recipient.email
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e2a35;">
        <p>Hi ${safeName},</p>
        <p><strong>${subject}</strong></p>
        <p>${bodyText}</p>
        <p><a href="${taskLink}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #6B9E6B; color: #ffffff; text-decoration: none;">Open in Qira</a></p>
      </div>
    `
    const text = `${subject}\n\n${bodyText}\n\nOpen in Qira: ${taskLink}`

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': resendUserAgent,
        },
        body: JSON.stringify({ from: emailFrom, to: [to], subject, html, text }),
      })
      if (resendResponse.ok) sent += 1
      else failed += 1
    } catch {
      failed += 1
    }
  }

  return json(200, { sent, failed })
})
