-- agent_audit_log's own SELECT policy (agent_audit_log_select) restricts
-- reads to admin/founder/ceo — appropriate for the raw table, which carries
-- payload/result jsonb with task content. But "which AI last touched this
-- task" is safe, low-sensitivity metadata every project member should see
-- (backlog card badge, task drawer) — so it's exposed through a narrow
-- SECURITY DEFINER function instead of loosening the table's own RLS.
create or replace function public.get_task_last_ai_agent(p_project_id uuid)
returns table (task_id uuid, agent_name text, action_type text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (task_id) task_id, agent_name, action_type, created_at
  from public.agent_audit_log
  where project_id = p_project_id
    and task_id is not null
    and agent_name is not null
    and public.is_project_member(p_project_id)
  order by task_id, created_at desc;
$$;

grant execute on function public.get_task_last_ai_agent(uuid) to authenticated;
