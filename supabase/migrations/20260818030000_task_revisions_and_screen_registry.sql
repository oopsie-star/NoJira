-- Three related changes, all about work that changes after someone already
-- started or finished it.
--
-- 1. Any task that is `done` or `in_progress` and has its wording edited gets
--    flagged. The flag clears only when the assignee marks it done again, so a
--    silent late edit can't pass for finished work.
--
-- 2. Backend tasks go further. A backend dev — increasingly an AI working from
--    the task text — cannot notice that a finished task was reworded in place.
--    So for backend, the edit is not applied in place at all: the original is
--    marked obsolete and a subtask carrying a full copy takes over, with the
--    superseded lines struck through and the new ones added.
--
-- 3. A project may nominate one epic as its screen registry: each task in it is
--    a screen, and the designer marking that task done means the screen is
--    drawn and ready to be built. Frontend tasks link to the screen they
--    implement.
--
-- All of this lives in the database rather than the client because MCP agents
-- edit tasks too, and the whole point is that an agent's edit can't slip past.

-- ─── 1. Reworded-after-start flag ────────────────────────────────────────────

alter table public.tasks
  add column if not exists formulation_changed_at timestamptz;

comment on column public.tasks.formulation_changed_at is
  'Set when a done/in_progress task is reworded; cleared when it is marked done again. Drives the orange "re-check this" highlight.';

-- ─── 3. Screen registry epic ─────────────────────────────────────────────────

alter table public.epics
  add column if not exists is_screen_registry boolean not null default false;

create unique index if not exists epics_one_screen_registry_per_project
  on public.epics (project_id) where is_screen_registry;

-- Which screen a frontend task implements. Self-referencing: the screen is
-- itself a task, living in the registry epic.
alter table public.tasks
  add column if not exists implements_screen_task_id uuid
  references public.tasks(id) on delete set null;

create index if not exists tasks_implements_screen_idx
  on public.tasks (implements_screen_task_id) where implements_screen_task_id is not null;

-- ─── 2. Backend supersede-by-subtask ─────────────────────────────────────────

/** Whether any of a task's assignees works backend (primary or combined role). */
create or replace function public.task_is_backend(
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
    where 'backend' = any (public.map_disciplines_for_profile(a.id))
  );
$$;

/**
 * Old text with superseded lines struck through, then the added lines.
 *
 * A set-difference rather than a real LCS diff: for task wording that reads
 * correctly (removed lines stay in place, struck; genuinely new lines follow),
 * and it has no pathological cases the way a hand-rolled LCS would.
 */
create or replace function public.merge_formulation_revision(old_text text, new_text text)
returns text
language plpgsql
immutable
as $$
declare
  old_lines text[] := string_to_array(coalesce(old_text, ''), E'\n');
  new_lines text[] := string_to_array(coalesce(new_text, ''), E'\n');
  result    text[] := '{}';
  line      text;
  added     text[] := '{}';
begin
  foreach line in array old_lines loop
    if btrim(line) = '' then
      result := result || line;
    elsif line = any (new_lines) then
      result := result || line;
    else
      -- Superseded: struck through, kept in place so the change reads in context.
      result := result || ('~~' || line || '~~');
    end if;
  end loop;

  foreach line in array new_lines loop
    if btrim(line) <> '' and not (line = any (old_lines)) then
      added := added || line;
    end if;
  end loop;

  if coalesce(array_length(added, 1), 0) > 0 then
    result := result || '' || added;
  end if;

  return array_to_string(result, E'\n');
end;
$$;

/**
 * An obsolete task's status is frozen — its replacement carries the work.
 *
 * Without this guard the revision mechanism below defeats itself: attaching the
 * replacement subtask to a `done` parent makes "not all subtasks are done"
 * true, and the existing reopen branch flips the finished original back to
 * in_progress. The original is meant to stand as the record of what was already
 * built, so a superseded parent is now left alone entirely.
 *
 * Otherwise identical to the original function.
 */
create or replace function public.sync_parent_task_status(parent_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
DECLARE
  total_count integer;
  done_count integer;
  current_status text;
BEGIN
  IF parent_uuid IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_links
    WHERE link_type = 'supersedes' AND target_task_id = parent_uuid
  ) THEN
    RETURN;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'done')
  INTO total_count, done_count
  FROM public.tasks
  WHERE parent_task_id = parent_uuid;

  IF total_count = 0 THEN
    RETURN;
  END IF;

  SELECT status INTO current_status
  FROM public.tasks
  WHERE id = parent_uuid;

  IF done_count = total_count THEN
    UPDATE public.tasks
    SET status = 'done'
    WHERE id = parent_uuid
      AND status <> 'done';
  ELSIF current_status = 'done' THEN
    UPDATE public.tasks
    SET status = 'in_progress'
    WHERE id = parent_uuid;
  END IF;
END;
$function$;

/**
 * Fires when a task's wording changes.
 *
 * Backend + done/in_progress: the edit is refused in place. The original keeps
 * its text and is marked obsolete (a `supersedes` link from the new subtask,
 * the same mechanism mark_task_superseded already uses), and a subtask carries
 * the full copy with the revision merged in.
 *
 * Everything else that is done/in_progress: the edit applies, and the task is
 * flagged for re-check until it is marked done again.
 */
create or replace function public.handle_task_formulation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reworded    boolean;
  new_task_id uuid;
  merged_body text;
  merged_title text;
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
    values (old.project_id, new_task_id, old.id, 'supersedes', coalesce(auth.uid(), old.reporter_id))
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

drop trigger if exists tasks_formulation_change on public.tasks;
create trigger tasks_formulation_change
  before update on public.tasks
  for each row
  execute function public.handle_task_formulation_change();
