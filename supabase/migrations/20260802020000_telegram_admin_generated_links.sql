-- Team members won't reliably self-serve the "Connect Telegram" button, so
-- a super admin/founder/ceo needs to be able to generate a person's link
-- code themselves and hand them the t.me/... link directly (Telegram still
-- requires that person to click it — bots can't message first — but the
-- admin now drives who gets asked). Adds a second, permissive RLS policy
-- alongside the existing self-only one (Postgres ORs multiple permissive
-- policies for the same command), reusing can_manage_telegram_link from
-- 20260802010000_telegram_notifications.sql.

create policy telegram_link_codes_manage on public.telegram_link_codes
  for all
  using (public.can_manage_telegram_link(profile_id))
  with check (public.can_manage_telegram_link(profile_id));
