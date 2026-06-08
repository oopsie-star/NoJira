-- ── Webhooks: first-class Discord / Slack delivery ────────────────────────────
-- Generic webhooks are posted client-side (with an HMAC signature). Discord and
-- Slack incoming webhooks don't allow browser delivery (CORS), so those are
-- relayed server-side by the notify-webhook Edge Function, which formats the
-- payload per provider ({content} for Discord, {text} for Slack).

ALTER TABLE public.project_webhooks
  ADD COLUMN IF NOT EXISTS webhook_type text NOT NULL DEFAULT 'generic'
    CHECK (webhook_type IN ('generic', 'discord', 'slack'));
