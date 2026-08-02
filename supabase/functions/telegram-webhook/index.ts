import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Telegram calls this directly (no Supabase JWT — verify_jwt = false, see
// config.toml), so authenticity comes from the secret_token Telegram echoes
// back in a header, set once when the webhook is registered via setWebhook.
//
// Handles /start <code> to link an account (the only self-service action —
// see 20260802010000_telegram_notifications.sql for why unlinking isn't).
// /stop deliberately does NOT unlink: only a super admin/founder/ceo may
// disconnect Telegram, and this function runs as service role, which would
// otherwise sail straight past that permission check.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? ''
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim() ?? ''

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function sendMessage(chatId: number, text: string) {
  if (!botToken) return
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch {
    // Best-effort — nothing useful to do if Telegram itself is unreachable.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!supabaseUrl || !serviceKey || !botToken || !webhookSecret) return json(500, { error: 'Function not configured.' })

  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret) {
    return json(401, { error: 'Invalid secret token.' })
  }

  let update: Record<string, unknown>
  try { update = await req.json() } catch { return json(400, { error: 'Invalid JSON body.' }) }

  const message = update.message as { text?: string; chat?: { id?: number } } | undefined
  const chatId = message?.chat?.id
  const text = message?.text?.trim() ?? ''
  if (!chatId || !text) return json(200, { ok: true, skipped: true })

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  if (text.startsWith('/start')) {
    const code = text.slice('/start'.length).trim()
    if (!code) {
      await sendMessage(chatId, 'Откройте «Подключить Telegram» в Qira и перейдите по ссылке ещё раз — код не найден.')
      return json(200, { ok: true })
    }

    const { data: linkRow } = await admin
      .from('telegram_link_codes')
      .select('profile_id, expires_at')
      .eq('code', code)
      .maybeSingle()

    if (!linkRow || new Date(linkRow.expires_at).getTime() < Date.now()) {
      await sendMessage(chatId, '⚠️ Код недействителен или истёк. Сгенерируйте новую ссылку в Qira.')
      return json(200, { ok: true })
    }

    await admin.from('profiles').update({ telegram_chat_id: chatId }).eq('id', linkRow.profile_id)
    await admin.from('telegram_link_codes').delete().eq('profile_id', linkRow.profile_id)
    await sendMessage(chatId, '✅ Telegram подключён к Qira. Теперь сюда будут приходить уведомления о задачах.')
    return json(200, { ok: true })
  }

  if (text.startsWith('/stop')) {
    await sendMessage(
      chatId,
      'Отключить уведомления самостоятельно нельзя — обратитесь к супер-админу, фаундеру или CEO проекта в Qira.',
    )
    return json(200, { ok: true })
  }

  return json(200, { ok: true })
})
