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

const approvalEmailFrom = Deno.env.get('APPROVAL_EMAIL_FROM') ?? 'Qira <onboarding@resend.dev>'
const approvalEmailCooldownSeconds = Number(Deno.env.get('APPROVAL_EMAIL_COOLDOWN_SECONDS') ?? '60')
const adminApprovalEmail = Deno.env.get('ADMIN_APPROVAL_EMAIL') ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? ''
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://oopsie-star.github.io/NoJira/'

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
      message: null,
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

  if (!adminApprovalEmail || !resendApiKey) {
    const message = 'Approval email delivery is not configured yet.'
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

  const safeName = targetProfile.full_name?.trim() || targetProfile.email
  const approvalLink = `${appBaseUrl.replace(/\/$/, '')}/pending-approval`
  const subject = `Qira approval request: ${safeName}`
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e2a35;">
      <h2 style="margin: 0 0 16px;">New Qira access request</h2>
      <p><strong>Name:</strong> ${safeName}</p>
      <p><strong>Email:</strong> ${targetProfile.email}</p>
      <p><strong>Requested at:</strong> ${new Date().toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</p>
      <p>Open Qira People and approve the account when appropriate.</p>
      <p><a href="${approvalLink}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #6B9E6B; color: #ffffff; text-decoration: none;">Open Qira</a></p>
    </div>
  `

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: approvalEmailFrom,
      to: [adminApprovalEmail],
      subject,
      html,
      text: `New Qira access request\n\nName: ${safeName}\nEmail: ${targetProfile.email}\nOpen Qira: ${approvalLink}`,
    }),
  })

  if (!resendResponse.ok) {
    const errorBody = truncateError(await resendResponse.text())
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
    approval_email_last_error: null,
    approval_email_sent_at: attemptAt,
  })

  return json(200, {
    status: 'sent',
    message: null,
    sentAt: attemptAt,
  })
})
