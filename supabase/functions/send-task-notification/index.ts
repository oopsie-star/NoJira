import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Sends the email + Telegram halves of a task notification (the in-app half
// is already written to the `notifications` table by the caller before this
// runs). Mirrors notify-webhook's auth/membership skeleton and
// notify-approval-request's Resend-sending + sandbox-mode handling.
// recipient_ids (email, in-app) and telegram_recipient_ids (Telegram) are
// independent lists — Telegram is meant to broadcast wider (all project
// members) than email's narrowly-targeted set, and each channel degrades
// gracefully if unconfigured or a recipient hasn't linked/isn't reachable.

type RequestPayload = {
  recipient_ids?: string[]
  telegram_recipient_ids?: string[]
  project_id?: string
  task_id?: string | null
  subject?: string
  body_text?: string
  /** Project-relative deep link (e.g. "map") when the notification isn't about a task. */
  link_path?: string
  /**
   * Resolve the audience here instead of listing ids. Needed when the caller
   * can't see it: a browser can't enumerate global super admins (no RLS path
   * to profiles outside its own projects), and the MCP server shouldn't have
   * to duplicate the query. Implies writing the in-app rows here too, since
   * the caller has no ids to write them against.
   */
  recipient_group?: 'super_admins' | 'project_members'
  /** Excluded from a resolved group — normally the actor, who doesn't need telling. */
  exclude_profile_id?: string | null
  /** In-app notification_type used when this function writes the rows itself. */
  notification_type?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const emailFrom = Deno.env.get('APPROVAL_EMAIL_FROM')?.trim() ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? ''
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

/** Constant-time compare so the service-role check below can't be probed byte by byte. */
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
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

  // Trusted internal caller: another edge function (the MCP server, when an AI
  // agent writes the Project Map) presenting the service-role key. It has no
  // human session to validate, and the project-membership guard below doesn't
  // apply to it — it already acts with full privileges by definition.
  const isInternalCaller = timingSafeEqual(token, supabaseServiceRoleKey)

  let actorId: string | null = null
  if (!isInternalCaller) {
    const { data: authData, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !authData.user) return json(401, { error: 'Unable to validate session.' })
    actorId = authData.user.id
  }

  let body: RequestPayload
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON body.' }) }

  let recipientIds = [...new Set((body.recipient_ids ?? []).filter(Boolean))]
  let telegramRecipientIds = [...new Set((body.telegram_recipient_ids ?? []).filter(Boolean))]
  const projectId = String(body.project_id ?? '')
  const taskId = body.task_id ?? null
  const subject = String(body.subject ?? '').slice(0, 200)
  const bodyText = String(body.body_text ?? '').slice(0, 2000)
  const recipientGroup = body.recipient_group
  if (!projectId || !subject) {
    return json(400, { error: 'project_id and subject are required.' })
  }
  if (!recipientIds.length && !telegramRecipientIds.length && !recipientGroup) {
    return json(400, { error: 'One of recipient_ids, telegram_recipient_ids, or recipient_group is required.' })
  }

  // Only a member of the project may trigger delivery (anti-abuse), same guard as notify-webhook.
  // A global super admin frequently has no project_members row at all for a
  // given project — they reach it via the is_admin() RLS bypass instead
  // (see fetchProjects in store/index.ts for the same gotcha) — so an
  // admin-authored task/comment/status-change silently 403'd here and never
  // reached Telegram, with the client swallowing the error.
  if (!isInternalCaller && actorId) {
    const { data: membership } = await admin
      .from('project_members')
      .select('profile_id')
      .eq('project_id', projectId)
      .eq('profile_id', actorId)
      .maybeSingle()

    if (!membership) {
      const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', actorId).single()
      if (callerProfile?.role !== 'admin') return json(403, { error: 'Not a project member.' })
    }
  }

  // Resolving a group also owns writing the in-app rows for it — the caller
  // never learns the ids, so it couldn't have written them itself.
  if (recipientGroup) {
    const { data: groupRows } = recipientGroup === 'super_admins'
      ? await admin.from('profiles').select('id').eq('role', 'admin')
      : await admin.from('project_members').select('id:profile_id').eq('project_id', projectId)

    const excluded = body.exclude_profile_id ?? null
    const groupIds = [...new Set(
      (groupRows ?? [])
        .map((row) => (row as { id: string }).id)
        .filter((id) => Boolean(id) && id !== excluded),
    )]

    if (groupIds.length) {
      const notificationType = String(body.notification_type ?? 'system')
      const { error: inAppError } = await admin.from('notifications').insert(
        groupIds.map((profileId) => ({
          project_id: projectId,
          profile_id: profileId,
          task_id: taskId,
          notification_type: notificationType,
          title: subject,
          body: bodyText,
        })),
      )
      if (inAppError) console.error('[send-task-notification] in-app insert failed', inAppError.message)
    }

    recipientIds = [...new Set([...recipientIds, ...groupIds])]
    telegramRecipientIds = [...new Set([...telegramRecipientIds, ...groupIds])]
  }

  if (!recipientIds.length && !telegramRecipientIds.length) {
    return json(200, { email: { sent: 0, failed: 0 }, telegram: { sent: 0, failed: 0 } })
  }

  const { data: project } = await admin.from('projects').select('key').eq('id', projectId).single()
  const projectBase = project?.key
    ? `${appBaseUrl.replace(/\/$/, '')}/projects/${encodeURIComponent(project.key)}`
    : null
  // link_path points at a non-task section (e.g. the Project Map); a task_id
  // still wins the default backlog deep link when no path is given.
  const linkPath = String(body.link_path ?? '').replace(/^\/+/, '').slice(0, 100)
  const taskLink = projectBase && linkPath
    ? `${projectBase}/${linkPath}`
    : projectBase && taskId
      ? `${projectBase}/backlog?task=${taskId}`
      : appBaseUrl

  const email = { sent: 0, failed: 0 }
  if (recipientIds.length && emailFrom && resendApiKey) {
    const { data: recipients } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', recipientIds)

    const sandboxMode = usesResendDevSender(emailFrom)

    for (const recipient of recipients ?? []) {
      const to = sandboxMode ? buildSandboxRecipient(recipient.id) : recipient.email
      if (!to) { email.failed += 1; continue }

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
        if (resendResponse.ok) email.sent += 1
        else email.failed += 1
      } catch {
        email.failed += 1
      }
    }
  }

  const telegram = { sent: 0, failed: 0 }
  if (telegramRecipientIds.length && telegramBotToken) {
    const { data: recipients } = await admin
      .from('profiles')
      .select('id, telegram_chat_id')
      .in('id', telegramRecipientIds)
      .not('telegram_chat_id', 'is', null)

    const text = `${subject}\n\n${bodyText}\n\n${taskLink}`

    for (const recipient of recipients ?? []) {
      try {
        const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: recipient.telegram_chat_id, text }),
        })
        if (telegramResponse.ok) telegram.sent += 1
        else telegram.failed += 1
      } catch {
        telegram.failed += 1
      }
    }
  }

  return json(200, { email, telegram })
})
