-- Activity log: who logged in, viewed a task, downloaded an attachment, or
-- played an audio attachment. Readable only by the global super admin or a
-- project member with the founder/ceo project role — everyone else can only
-- INSERT their own events (the app logs its own user's actions), never read
-- anyone's.

create table public.activity_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('login', 'view_task', 'download_attachment', 'play_audio')),
  task_id    uuid references public.tasks(id) on delete cascade,
  detail     text,
  created_at timestamptz not null default now()
);

create index activity_events_project_created_idx on public.activity_events (project_id, created_at desc);

alter table public.activity_events enable row level security;

create or replace function public.can_view_activity_log(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = project_uuid
        and pm.profile_id = auth.uid()
        and pm.project_role in ('founder', 'ceo')
    );
$$;

create policy activity_events_select on public.activity_events
  for select using (public.can_view_activity_log(project_id));

create policy activity_events_insert on public.activity_events
  for insert with check (
    profile_id = auth.uid()
    and public.is_project_member(project_id)
  );

create policy activity_events_delete on public.activity_events
  for delete using (public.is_admin());
