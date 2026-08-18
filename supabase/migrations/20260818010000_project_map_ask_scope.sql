-- Project Map: a person may only ask questions in their own discipline's branch.
-- A designer asks in Design, a backend dev in Backend, and so on.
--
-- Unrestricted (may ask in any branch): the global super admin, and a project's
-- owner / admin / founder / ceo — i.e. is_admin() plus the existing
-- can_manage_project() tier that already curates the map's blocks. Someone
-- trusted to create and delete a block is certainly trusted to ask a question
-- in one, and none of these roles has a branch of their own.
--
-- AI agents need no carve-out here: they write over MCP as service_role, which
-- goes through project_map_qa_service_role_all and bypasses this policy
-- entirely. The `author_agent is null` clause below keeps a browser session
-- from *posing* as an AI, which is a separate concern.
--
-- Someone whose department maps to no branch (unset, Product, Executive
-- Leadership, Project Delivery) and who holds none of those roles can't ask
-- anywhere — deliberately, so the gap shows up and gets fixed on the People
-- page rather than being silently papered over. The UI says exactly that.
--
-- Answering is NOT scoped: anyone who can see a thread may answer it. The rule
-- is about raising questions in the wrong branch, not about helping.

create or replace function public.map_discipline_for_department(department text)
returns text
language sql
immutable
as $$
  -- Mirrors DEPARTMENT_TO_MAP_DISCIPLINE in src/lib/discipline.ts. Product is
  -- absent on purpose: the map has no Product branch.
  select case btrim(coalesce(department, ''))
    when 'Design'            then 'design'
    when 'Backend'           then 'backend'
    when 'Frontend'          then 'frontend'
    when 'Quality Assurance' then 'qa'
    else null
  end;
$$;

create or replace function public.can_ask_in_map_discipline(project_uuid uuid, target_discipline text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or public.can_manage_project(project_uuid)
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and public.map_discipline_for_department(p.department) = target_discipline
    );
$$;

-- Questions (parent_id is null) are branch-scoped; answers are not.
drop policy if exists project_map_qa_insert on public.project_map_qa;
create policy project_map_qa_insert on public.project_map_qa
  for insert to authenticated
  with check (
    public.is_project_member(project_id)
    and author_id = auth.uid()
    and author_agent is null
    and (
      parent_id is not null
      or public.can_ask_in_map_discipline(
        project_id,
        (select b.discipline from public.project_map_blocks b where b.id = block_id)
      )
    )
  );
