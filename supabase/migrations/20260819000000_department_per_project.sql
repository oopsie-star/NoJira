-- Department belongs to a project membership, not to a person.
--
-- It lived on `profiles`, which made it global: the same person is a designer
-- on one project and only a participant on another, but setting the department
-- anywhere set it everywhere — and clearing it anywhere cleared it everywhere.
-- That is what left people alternately over- and under-privileged in the
-- Project Map, since branch access is derived from it.
--
-- `profiles.department` / `profiles.additional_departments` are kept but are no
-- longer read for any discipline decision; every current value is copied onto
-- that person's memberships first, so nothing is lost and today's behaviour is
-- preserved project by project.

alter table public.project_members
  add column if not exists department text not null default '',
  add column if not exists additional_departments text[] not null default '{}';

comment on column public.project_members.department is
  'This person''s primary department on THIS project. Superseded profiles.department, which was global.';

-- Preserve the current state everywhere before anything starts reading the new
-- columns. Only fills blanks, so re-running is harmless.
update public.project_members pm
set department = coalesce(p.department, ''),
    additional_departments = coalesce(p.additional_departments, '{}'::text[])
from public.profiles p
where p.id = pm.profile_id
  and pm.department = ''
  and cardinality(pm.additional_departments) = 0;

/** Every branch a person may act in ON THIS PROJECT — primary plus combined roles. */
create or replace function public.map_disciplines_in_project(project_uuid uuid, profile_uuid uuid)
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
  from public.project_members pm
  cross join lateral unnest(
    array_prepend(pm.department, coalesce(pm.additional_departments, '{}'::text[]))
  ) as dept(name)
  cross join lateral public.map_discipline_for_department(dept.name) as d
  where pm.project_id = project_uuid
    and pm.profile_id = profile_uuid;
$$;

-- Now project-scoped: the same assignee can be backend here and not there.
create or replace function public.task_is_backend(
  project_uuid uuid,
  assignee_id uuid,
  assignee_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from unnest(
      case
        when coalesce(array_length(assignee_ids, 1), 0) > 0 then assignee_ids
        when assignee_id is not null then array[assignee_id]
        else '{}'::uuid[]
      end
    ) as a(id)
    where 'backend' = any (public.map_disciplines_in_project(project_uuid, a.id))
  );
$$;

drop function if exists public.task_is_backend(uuid, uuid[]);

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

  user_domains := public.map_disciplines_in_project(b.project_id, auth.uid());

  if b.discipline = 'qa' then
    return 'qa' = any (user_domains)
      or (b.covers_discipline is not null and b.covers_discipline = any (user_domains))
      or (b.covers_discipline is null and cardinality(user_domains) > 0);
  end if;

  return b.discipline = any (user_domains);
end;
$$;

-- Point the revision trigger at the project-scoped check.
create or replace function public.handle_task_formulation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reworded     boolean;
  new_task_id  uuid;
  merged_body  text;
  merged_title text;
  link_author  uuid;
begin
  if new.status = 'done' and (old.status is distinct from 'done' or old.formulation_changed_at is not null) then
    new.formulation_changed_at := null;
    return new;
  end if;

  reworded := (new.title is distinct from old.title) or (new.description is distinct from old.description);
  if not reworded or old.status not in ('done', 'in_progress') then
    return new;
  end if;

  if public.task_is_backend(old.project_id, old.assignee_id, old.assignee_ids) then
    select coalesce(
      auth.uid(),
      old.reporter_id,
      old.assignee_id,
      (
        select pm.profile_id
        from public.project_members pm
        where pm.project_id = old.project_id
        order by case pm.project_role
                   when 'owner' then 0
                   when 'admin' then 1
                   when 'founder' then 2
                   when 'ceo' then 3
                   else 4
                 end
        limit 1
      )
    ) into link_author;

    if link_author is null then
      new.formulation_changed_at := now();
      return new;
    end if;

    merged_body := public.merge_formulation_revision(old.description, new.description);
    merged_title := case
      when new.title is distinct from old.title then new.title
      else old.title
    end;

    -- Detached insert → link → attach. Attaching first would fire
    -- sync_parent_task_status before its superseded-parent guard has a link to
    -- find, reopening the finished original.
    insert into public.tasks (
      project_id, parent_task_id, title, description, status, issue_type, priority,
      labels, epic_id, sprint_id, assignee_id, assignee_ids, reporter_id,
      assignee_placeholder_id, reporter_placeholder_id, due_date,
      implements_screen_task_id
    )
    values (
      old.project_id, null, merged_title, merged_body, 'todo', old.issue_type, old.priority,
      old.labels, old.epic_id, old.sprint_id, old.assignee_id, old.assignee_ids, old.reporter_id,
      old.assignee_placeholder_id, old.reporter_placeholder_id, old.due_date,
      old.implements_screen_task_id
    )
    returning id into new_task_id;

    insert into public.task_links (project_id, source_task_id, target_task_id, link_type, created_by)
    values (old.project_id, new_task_id, old.id, 'supersedes', link_author)
    on conflict do nothing;

    update public.tasks set parent_task_id = old.id where id = new_task_id;

    insert into public.notifications (project_id, profile_id, task_id, notification_type, title, body)
    select distinct old.project_id, recipient.id, new_task_id, 'system',
           'Изменилась формулировка выполненной задачи',
           old.key || ' признана устаревшей — новая редакция в подзадаче.'
    from unnest(
      case
        when coalesce(array_length(old.assignee_ids, 1), 0) > 0 then old.assignee_ids
        when old.assignee_id is not null then array[old.assignee_id]
        else '{}'::uuid[]
      end
    ) as recipient(id)
    where recipient.id is not null;

    new.title := old.title;
    new.description := old.description;
    new.formulation_changed_at := null;
    return new;
  end if;

  new.formulation_changed_at := now();
  return new;
end;
$$;

-- Superseded by the project-scoped version.
drop function if exists public.map_disciplines_for_profile(uuid);
