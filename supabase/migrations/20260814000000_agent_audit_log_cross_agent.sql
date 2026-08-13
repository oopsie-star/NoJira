-- Lets agent_audit_log identify WHICH ai (not just mcp vs in_app) touched an
-- entity, and extends entity linkage to epics/sprints (previously only
-- task_id) so a cross-agent conflict check can be scoped to any of the three
-- entity types the MCP write-tools mutate.

alter table public.agent_audit_log
  add column if not exists epic_id uuid references public.epics(id) on delete set null,
  add column if not exists sprint_id uuid references public.sprints(id) on delete set null,
  add column if not exists agent_name text check (agent_name in ('claude', 'chatgpt', 'qira-assistant'));

create index if not exists agent_audit_log_epic_idx on public.agent_audit_log (epic_id) where epic_id is not null;
create index if not exists agent_audit_log_sprint_idx on public.agent_audit_log (sprint_id) where sprint_id is not null;
