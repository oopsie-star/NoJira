-- The weekly digest popup moves from one combined window per person to one
-- per project (people can be on several projects, and a single mixed-in
-- digest made it unclear which project a task belonged to). "Last shown"
-- gating can no longer be a single profiles.weekly_digest_last_shown_at
-- scalar — it needs one row per (profile, project). The old column is left
-- in place, just unused, to avoid touching anything else that might
-- reference it.

create table public.weekly_digest_views (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  shown_at   timestamptz not null default now(),
  primary key (profile_id, project_id)
);

alter table public.weekly_digest_views enable row level security;

create policy weekly_digest_views_self on public.weekly_digest_views
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
