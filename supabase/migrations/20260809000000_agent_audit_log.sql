-- Unified audit log for AI-agent actions across both agent identities:
-- the MCP server (service_role, agent_type='mcp') and the in-app AI
-- assistant (authenticated human session, agent_type='in_app'). Neither
-- task_activities nor task_field_changes can distinguish an agent action
-- from a manual human edit today — this table exists specifically for that.
--
-- project_id is stored directly (not just derived via task_id) because
-- create_epic/create_sprint actions have no task_id, and RLS needs a
-- project to scope against regardless.

create table public.agent_audit_log (
  id                uuid primary key default gen_random_uuid(),
  agent_type        text not null check (agent_type in ('mcp', 'in_app')),
  agent_profile_id  uuid not null references public.profiles(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  task_id           uuid references public.tasks(id) on delete set null,
  action_type       text not null,
  payload           jsonb not null default '{}',
  result            jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

create index agent_audit_log_project_created_idx on public.agent_audit_log (project_id, created_at desc);
create index agent_audit_log_task_idx on public.agent_audit_log (task_id) where task_id is not null;

alter table public.agent_audit_log enable row level security;

-- MCP server (service_role) — full access, same minimal pattern as internal_heartbeat.
create policy agent_audit_log_service_role_all on public.agent_audit_log
  for all to service_role
  using (true)
  with check (true);

-- Readable only by global admin or the project's founder/ceo — same tier
-- that already gates activity_events and the AI management tools.
create policy agent_audit_log_select on public.agent_audit_log
  for select to authenticated
  using (public.can_view_activity_log(project_id));

-- The in-app AI assistant writes directly as the human operating it (it has
-- no service-role path) — gated to the same tier allowed to invoke the AI
-- management tools in the first place, and restricted to agent_type='in_app'
-- so a browser session can never write an 'mcp'-attributed row.
create policy agent_audit_log_in_app_insert on public.agent_audit_log
  for insert to authenticated
  with check (agent_type = 'in_app' and public.can_view_activity_log(project_id));

revoke all on public.agent_audit_log from anon, authenticated;
grant select, insert on public.agent_audit_log to authenticated;
grant select, insert, update, delete on public.agent_audit_log to service_role;
