-- Tracks who changed a task's title/description and when, at the database
-- level via an AFTER UPDATE trigger — not app-level instrumentation like
-- activity_events, which only sees actions taken through Qira's own code
-- paths. A service_role write (e.g. an AI agent editing description directly
-- via PostgREST, bypassing RLS) never goes through the app, so auth.uid()
-- resolves to NULL for it here — changed_by NULL means "external/unattributed
-- change", changed_by set means a normal in-app edit by that person.
--
-- This applies globally to every project (one tasks table), matching "policy
-- across all projects" rather than a per-project opt-in.

create table public.task_field_changes (
  id         uuid        primary key default gen_random_uuid(),
  task_id    uuid        not null references public.tasks(id) on delete cascade,
  project_id uuid        not null references public.projects(id) on delete cascade,
  field_name text        not null check (field_name in ('title', 'description')),
  old_value  text,
  new_value  text,
  changed_by uuid        references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index task_field_changes_task_idx on public.task_field_changes (task_id, changed_at desc);

alter table public.task_field_changes enable row level security;

-- Read access mirrors tasks_select (any project member). No insert/update/
-- delete policy for regular clients at all — the trigger function below is
-- SECURITY DEFINER and is the only writer, so this table is append-only and
-- untouchable even by the project's own admins via the API.
create policy task_field_changes_select on public.task_field_changes
  for select using (public.is_project_member(project_id));

create or replace function public.log_task_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.description is distinct from old.description then
    insert into public.task_field_changes (task_id, project_id, field_name, old_value, new_value, changed_by)
    values (new.id, new.project_id, 'description', old.description, new.description, auth.uid());
  end if;

  if new.title is distinct from old.title then
    insert into public.task_field_changes (task_id, project_id, field_name, old_value, new_value, changed_by)
    values (new.id, new.project_id, 'title', old.title, new.title, auth.uid());
  end if;

  return new;
end;
$$;

create trigger trg_log_task_field_changes
  after update on public.tasks
  for each row execute function public.log_task_field_changes();
