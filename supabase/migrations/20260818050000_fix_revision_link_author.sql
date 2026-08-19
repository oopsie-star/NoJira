-- Fixes the supersedes-link author. task_links.created_by is NOT NULL, and the
-- previous coalesce(auth.uid(), reporter_id) resolves to null exactly where it
-- matters most: an MCP agent edits as service_role, where auth.uid() is null.
-- A task with no reporter then failed the whole update — editing broke instead
-- of producing a revision.
--
-- Now: auth.uid() → reporter → assignee → the project's owner/admin. And if
-- even that comes back empty, fall through to the plain "reworded" flag rather
-- than half-applying the revision — a subtask without its supersedes link would
-- leave the parent unmarked and let sync_parent_task_status reopen it.

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
  -- Marking a task done clears the flag: that is the assignee confirming the
  -- reworded task is finished. Checked first so a same-statement text+status
  -- change still settles as "done and acknowledged".
  if new.status = 'done' and (old.status is distinct from 'done' or old.formulation_changed_at is not null) then
    new.formulation_changed_at := null;
    return new;
  end if;

  reworded := (new.title is distinct from old.title) or (new.description is distinct from old.description);
  if not reworded or old.status not in ('done', 'in_progress') then
    return new;
  end if;

  if public.task_is_backend(old.assignee_id, old.assignee_ids) then
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

    -- Three steps, in this order on purpose. Attaching the subtask to its
    -- parent fires the AFTER-INSERT automations, which call
    -- sync_parent_task_status — and its superseded-parent guard can only see a
    -- `supersedes` link that already exists. So: create the subtask detached,
    -- create the link (the FK needs the subtask to exist by now), and only then
    -- attach it. Inserting it attached would reopen the finished original
    -- before the guard had anything to find.
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

    -- Direction mirrors mark_task_superseded: source is the replacement.
    insert into public.task_links (project_id, source_task_id, target_task_id, link_type, created_by)
    values (old.project_id, new_task_id, old.id, 'supersedes', link_author)
    on conflict do nothing;

    update public.tasks set parent_task_id = old.id where id = new_task_id;

    -- The point of the whole mechanism: make sure the person who built it finds
    -- out. The automations only notify on a change of assignee, and this is a
    -- brand-new row carrying the same one.
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

    -- Refuse the in-place edit — the original stands as the record of what was
    -- already built, and the revision lives in the subtask.
    new.title := old.title;
    new.description := old.description;
    new.formulation_changed_at := null;
    return new;
  end if;

  new.formulation_changed_at := now();
  return new;
end;
$$;
