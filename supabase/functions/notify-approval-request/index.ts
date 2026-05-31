import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

type RequestPayload = {
  targetProfileId?: string | null
  force?: boolean
}

type ProfileRow = {
  id: string
  email: string
  full_name: string
  role: string
  approved: boolean
  approval_email_sent_at: string | null
  approval_email_last_attempt_at: string | null
  approval_email_attempts: number
  approval_email_last_error: string | null
}

type FunctionResult = {
  status: string
  message: string | null
  sentAt: string | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const approvalEmailFrom = Deno.env.get('APPROVAL_EMAIL_FROM')?.trim() ?? ''
const approvalEmailCooldownSeconds = Number(Deno.env.get('APPROVAL_EMAIL_COOLDOWN_SECONDS') ?? '60')
const adminApprovalEmail = Deno.env.get('ADMIN_APPROVAL_EMAIL')?.trim() ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://oopsie-star.github.io/NoJira/'
const resendUserAgent = 'qira-approval-notifier/1.0'
const sandboxNotePrefix = 'sandbox:'

function json(status: number, payload: FunctionResult) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function truncateError(message: string) {
  return message.slice(0, 500)
}

function isAdminRole(role: string | null | undefined) {
  return role === 'admin'
}

function usesResendDevSender(address: string) {
  return address.toLowerCase().includes('@resend.dev')
}

function buildSandboxRecipient(profileId: string) {
  const label = profileId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'approval'
  return `delivered+approval-${label}@resend.dev`
}

function buildSandboxNote(deliveredTo: string, intendedRecipient: string) {
  return `${sandboxNotePrefix}${deliveredTo}|${intendedRecipient}`
}

function secondsSince(timestamp: string | null) {
  if (!timestamp) return Number.POSITIVE_INFINITY
  return (Date.now() - new Date(timestamp).getTime()) / 1000
}

async function updateApprovalEmailState(
  adminClient: ReturnType<typeof createClient>,
  profileId: string,
  fields: Partial<Pick<ProfileRow, 'approval_email_sent_at' | 'approval_email_last_attempt_at' | 'approval_email_attempts' | 'approval_email_last_error'>>
) {
  await adminClient
    .from('profiles')
    .update(fields)
    .eq('id', profileId)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, {
      status: 'misconfigured',
      message: 'Supabase function secrets are incomplete.',
      sentAt: null,
    })
  }

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace('Bearer ', '').trim()
  if (!token) {
    return json(401, {
      status: 'forbidden',
      message: 'Missing authorization token.',
      sentAt: null,
    })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !authData.user) {
    return json(401, {
      status: 'forbidden',
      message: 'Unable to validate session.',
      sentAt: null,
    })
  }

  const { data: requesterProfile, error: requesterError } = await adminClient
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', authData.user.id)
    .single()

  if (requesterError || !requesterProfile) {
    return json(403, {
      status: 'forbidden',
      message: 'Requester profile is not available.',
      sentAt: null,
    })
  }

  const payload = await request.json().catch(() => ({})) as RequestPayload
  const targetProfileId = payload.targetProfileId ?? authData.user.id
  const isAdminRequest = isAdminRole(requesterProfile.role)

  if (!isAdminRequest && targetProfileId !== authData.user.id) {
    return json(403, {
      status: 'forbidden',
      message: 'Only workspace admins can retry notifications for other users.',
      sentAt: null,
    })
  }

  const { data: targetProfile, error: targetError } = await adminClient
    .from('profiles')
    .select(`
      id,
      email,
      full_name,
      role,
      approved,
      approval_email_sent_at,
      approval_email_last_attempt_at,
      approval_email_attempts,
      approval_email_last_error
    `)
    .eq('id', targetProfileId)
    .single<ProfileRow>()

  if (targetError || !targetProfile) {
    return json(404, {
      status: 'not_pending',
      message: 'Target profile was not found.',
      sentAt: null,
    })
  }

  if (targetProfile.approved) {
    return json(200, {
      status: 'not_pending',
      message: 'This account is already approved.',
      sentAt: targetProfile.approval_email_sent_at,
    })
  }

  if (!payload.force && targetProfile.approval_email_sent_at) {
    return json(200, {
      status: 'already_sent',
      message: targetProfile.approval_email_last_error,
      sentAt: targetProfile.approval_email_sent_at,
    })
  }

  if (!payload.force && secondsSince(targetProfile.approval_email_last_attempt_at) < approvalEmailCooldownSeconds) {
    return json(200, {
      status: 'cooldown',
      message: targetProfile.approval_email_last_error,
      sentAt: targetProfile.approval_email_sent_at,
    })
  }

  const attemptAt = new Date().toISOString()
  const nextAttempts = (targetProfile.approval_email_attempts ?? 0) + 1

  if (!approvalEmailFrom || !adminApprovalEmail || !resendApiKey) {
    const missing = [
      !approvalEmailFrom ? 'APPROVAL_EMAIL_FROM' : null,
      !adminApprovalEmail ? 'ADMIN_APPROVAL_EMAIL' : null,
      !resendApiKey ? 'RESEND_API_KEY' : null,
    ].filter(Boolean).join(', ')
    const message = `Approval email delivery is not configured yet. Missing: ${missing}.`
    console.error('[notify-approval-request] Missing email configuration', { missing })
    await updateApprovalEmailState(adminClient, targetProfile.id, {
      approval_email_last_attempt_at: attemptAt,
      approval_email_attempts: nextAttempts,
      approval_email_last_error: message,
    })

    return json(500, {
      status: 'misconfigured',
      message,
      sentAt: null,
    })
  }

  const sandboxMode = usesResendDevSender(approvalEmailFrom)

  if (sandboxMode) {
    console.warn(
      '[notify-approval-request] APPROVAL_EMAIL_FROM uses resend.dev. Redirecting this approval request to a Resend sandbox inbox.',
      { approvalEmailFrom, adminApprovalEmail }
    )
  }

  const safeName = targetProfile.full_name?.trim() || targetProfile.email
  const approvalLink = `${appBaseUrl.replace(/\/$/, '')}/people`
  const sandboxRecipient = sandboxMode ? buildSandboxRecipient(targetProfile.id) : adminApprovalEmail
  const sandboxNote = sandboxMode ? buildSandboxNote(sandboxRecipient, adminApprovalEmail) : null
  const subject = sandboxMode
    ? 'Qira approval request (sandbox)'
    : `Qira approval request: ${safeName}`
  const html = sandboxMode
    ? `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e2a35;">
        <h2 style="margin: 0 0 16px;">Qira approval request captured in sandbox mode</h2>
        <p>This test message was redirected to a Resend sandbox inbox because <strong>${approvalEmailFrom}</strong> uses the <strong>resend.dev</strong> test domain.</p>
        <p><strong>Sandbox inbox:</strong> ${sandboxRecipient}</p>
        <p>Open Qira People and review pending approvals there.</p>
        <p><a href="${approvalLink}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #6B9E6B; color: #ffffff; text-decoration: none;">Review pending approvals</a></p>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e2a35;">
        <h2 style="margin: 0 0 16px;">New Qira access request</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${targetProfile.email}</p>
        <p><strong>Requested at:</strong> ${new Date().toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</p>
        <p>Open Qira People and approve the account when appropriate.</p>
        <p><a href="${approvalLink}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #6B9E6B; color: #ffffff; text-decoration: none;">Review pending approvals</a></p>
      </div>
    `
  const text = sandboxMode
    ? `Qira approval request captured in sandbox mode.\n\nSandbox inbox: ${sandboxRecipient}\nOpen Qira People: ${approvalLink}`
    : `New Qira access request\n\nName: ${safeName}\nEmail: ${targetProfile.email}\nOpen Qira People: ${approvalLink}`

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': resendUserAgent,
    },
    body: JSON.stringify({
      from: approvalEmailFrom,
      to: [sandboxRecipient],
      subject,
      html,
      text,
    }),
  })

  if (!resendResponse.ok) {
    const errorBody = truncateError(await resendResponse.text())
    console.error('[notify-approval-request] Resend send failed', {
      status: resendResponse.status,
      approvalEmailFrom,
      adminApprovalEmail,
      errorBody,
    })
    await updateApprovalEmailState(adminClient, targetProfile.id, {
      approval_email_last_attempt_at: attemptAt,
      approval_email_attempts: nextAttempts,
      approval_email_last_error: errorBody,
    })

    return json(502, {
      status: 'error',
      message: errorBody,
      sentAt: null,
    })
  }

  await updateApprovalEmailState(adminClient, targetProfile.id, {
    approval_email_last_attempt_at: attemptAt,
    approval_email_attempts: nextAttempts,
    approval_email_last_error: sandboxNote,
    approval_email_sent_at: attemptAt,
  })

  console.info('[notify-approval-request] Approval email sent', {
    profileId: targetProfile.id,
    adminApprovalEmail,
    deliveredTo: sandboxRecipient,
    sandboxMode,
    sentAt: attemptAt,
  })

  return json(200, {
    status: sandboxMode ? 'sandbox_sent' : 'sent',
    message: sandboxNote,
    sentAt: attemptAt,
  })
})
