-- Personal weekly activity digest: each person gets a private popup
-- summarizing their own week (login days, tasks viewed, files
-- downloaded/played) built from the existing activity_events log, which
-- until now only the super admin/founder/ceo could read (see
-- 20260721010000_activity_events.sql). Adds a narrow self-select policy —
-- a user can now read (only) their own rows, nobody else's — plus a
-- profiles column tracking when they last saw the digest.

create policy activity_events_select_own on public.activity_events
  for select using (profile_id = auth.uid());

alter table public.profiles
  add column if not exists weekly_digest_last_shown_at timestamptz;
