-- Two gaps in the Project Map's ask-rights rule, both of which left real
-- branches unusable:
--
-- 1. QA is cross-cutting. A QA block isn't only for testers — it also belongs
--    to whoever's work is being tested: QA of the backend concerns the backend
--    devs, QA of the design concerns the designers. QA blocks now declare what
--    they cover, and that discipline's people may ask there too.
--
-- 2. People hold combined roles. Someone can genuinely be backend *and*
--    frontend, and locking them to one department denied them a branch they
--    legitimately work in. `department` stays the primary (it's what the
--    backlog hierarchy sorts a task by); `additional_departments` carries the
--    rest, and access is the union of all of them.

alter table public.profiles
  add column if not exists additional_departments text[] not null default '{}';

comment on column public.profiles.additional_departments is
  'Secondary departments for people holding combined roles (e.g. backend + frontend). `department` stays the primary one; access checks use the union.';

-- Only meaningful on QA blocks: which discipline''s work this QA material
-- covers. Null on a QA block means "not declared yet" — see the fallback in
-- can_ask_in_map_block below.
alter table public.project_map_blocks
  add column if not exists covers_discipline text
  check (covers_discipline in ('design', 'backend', 'frontend'));

alter table public.project_map_blocks
  drop constraint if exists project_map_blocks_covers_only_qa;
alter table public.project_map_blocks
  add constraint project_map_blocks_covers_only_qa
  check (covers_discipline is null or discipline = 'qa');

-- Every branch a person may act in: their primary department plus any
-- additional ones. Mirrors mapDisciplinesForProfile() in src/lib/discipline.ts.
create or replace function public.map_disciplines_for_profile(profile_uuid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(distinct d) filter (where d is not null),
    '{}'::text[]
  )
  from public.profiles p
  cross join lateral unnest(
    array_prepend(p.department, coalesce(p.additional_departments, '{}'::text[]))
  ) as dept(name)
  cross join lateral public.map_discipline_for_department(dept.name) as d
  where p.id = profile_uuid;
$$;

/**
 * Whether the current user may raise a question on a specific block.
 *
 * Unrestricted: global super admin, and the project's owner/admin/founder/ceo.
 * A normal block: the asker must hold that block's discipline.
 * A QA block: testers may always ask; so may the people whose work it covers.
 *   When coverage isn't declared, anyone holding any discipline may ask —
 *   QA tests everyone's work, so an undeclared QA block is treated as
 *   concerning all of them rather than nobody.
 */
create or replace function public.can_ask_in_map_block(block_uuid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b            record;
  user_domains text[];
begin
  select project_id, discipline, covers_discipline
    into b
    from public.project_map_blocks
   where id = block_uuid;

  if not found then
    return false;
  end if;

  if public.is_admin() or public.can_manage_project(b.project_id) then
    return true;
  end if;

  user_domains := public.map_disciplines_for_profile(auth.uid());

  if b.discipline = 'qa' then
    return 'qa' = any (user_domains)
      or (b.covers_discipline is not null and b.covers_discipline = any (user_domains))
      or (b.covers_discipline is null and cardinality(user_domains) > 0);
  end if;

  return b.discipline = any (user_domains);
end;
$$;

drop policy if exists project_map_qa_insert on public.project_map_qa;
create policy project_map_qa_insert on public.project_map_qa
  for insert to authenticated
  with check (
    public.is_project_member(project_id)
    and author_id = auth.uid()
    and author_agent is null
    -- Answers stay open to everyone: the rule is about raising questions in
    -- the wrong branch, not about helping.
    and (parent_id is not null or public.can_ask_in_map_block(block_id))
  );

-- Superseded by can_ask_in_map_block, which needs the block (for QA coverage)
-- rather than just its discipline.
drop function if exists public.can_ask_in_map_discipline(uuid, text);
