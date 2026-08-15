-- Project Map: a per-project, per-discipline (backend/frontend/design/qa) view of
-- structured project knowledge, meant to be written and kept current by AI agents
-- over MCP (from tasks, epics, canon docs) rather than hand-authored here.
--
-- Two tables:
--   project_map_blocks — one unit of structured content (title + markdown body),
--     with its own attachments and explicit links back to Qira tasks/epics.
--   project_map_qa     — questions and answers bound to ONE block, so a Q&A always
--     has the concrete piece of content it's about. A row with parent_id = null is
--     a question; a row with parent_id set is an answer to that question. Either
--     can be authored by a human (author_id) or an AI agent (author_agent).

create table public.project_map_blocks (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  discipline      text not null check (discipline in ('backend', 'frontend', 'design', 'qa')),
  title           text not null,
  body            text not null default '',
  attachments     text[] not null default '{}',
  -- Denormalized link arrays rather than a join table: the page always renders a
  -- block together with its links, and agents set the whole set at once.
  linked_task_ids uuid[] not null default '{}',
  linked_epic_ids uuid[] not null default '{}',
  position        integer not null default 0,
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null,
  -- Which AI last wrote this block, mirroring agent_audit_log.agent_name.
  last_ai_agent   text check (last_ai_agent in ('claude', 'chatgpt', 'qira-assistant')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index project_map_blocks_project_discipline_idx
  on public.project_map_blocks (project_id, discipline, position, created_at);

create trigger project_map_blocks_touch_updated_at
  before update on public.project_map_blocks
  for each row execute function public.touch_updated_at();

create table public.project_map_qa (
  id           uuid primary key default gen_random_uuid(),
  block_id     uuid not null references public.project_map_blocks(id) on delete cascade,
  -- Denormalized so RLS can scope without joining through the block on every row.
  project_id   uuid not null references public.projects(id) on delete cascade,
  parent_id    uuid references public.project_map_qa(id) on delete cascade,
  body         text not null,
  author_id    uuid references public.profiles(id) on delete set null,
  author_agent text check (author_agent in ('claude', 'chatgpt', 'qira-assistant')),
  created_at   timestamptz not null default now()
);

create index project_map_qa_block_created_idx on public.project_map_qa (block_id, created_at);
create index project_map_qa_parent_idx on public.project_map_qa (parent_id) where parent_id is not null;

alter table public.project_map_blocks enable row level security;
alter table public.project_map_qa     enable row level security;

-- Blocks: every project member reads; only project managers curate by hand
-- (the normal write path is an AI agent over MCP, which uses service_role).
create policy project_map_blocks_select on public.project_map_blocks
  for select to authenticated
  using (public.is_project_member(project_id));

create policy project_map_blocks_insert on public.project_map_blocks
  for insert to authenticated
  with check (public.can_manage_project(project_id));

create policy project_map_blocks_update on public.project_map_blocks
  for update to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy project_map_blocks_delete on public.project_map_blocks
  for delete to authenticated
  using (public.can_manage_project(project_id));

create policy project_map_blocks_service_role_all on public.project_map_blocks
  for all to service_role using (true) with check (true);

-- Q&A: any project member may ask or answer, but only as themselves. Deleting
-- is the author's own call, or a project override-delete role's.
create policy project_map_qa_select on public.project_map_qa
  for select to authenticated
  using (public.is_project_member(project_id));

create policy project_map_qa_insert on public.project_map_qa
  for insert to authenticated
  with check (
    public.is_project_member(project_id)
    and author_id = auth.uid()
    and author_agent is null
  );

create policy project_map_qa_delete on public.project_map_qa
  for delete to authenticated
  using (author_id = auth.uid() or public.can_override_project_delete(project_id));

create policy project_map_qa_service_role_all on public.project_map_qa
  for all to service_role using (true) with check (true);

revoke all on public.project_map_blocks from anon, authenticated;
revoke all on public.project_map_qa     from anon, authenticated;
grant select, insert, update, delete on public.project_map_blocks to authenticated;
grant select, insert, delete          on public.project_map_qa     to authenticated;
grant select, insert, update, delete on public.project_map_blocks to service_role;
grant select, insert, update, delete on public.project_map_qa     to service_role;

-- Block attachments live in the same 'attachments' bucket under
-- {project}/project-map/{block}/{author}/{file} — the same shape epics/sprints
-- use, so the existing project-scoped upload/read policies already cover them.
-- Only the delete policy enumerates path shapes, so it needs the new branch.
create or replace function public.can_delete_project_map_content(
  project_uuid uuid,
  block_uuid uuid,
  author_uuid uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_override_project_delete(project_uuid)
    or exists (
      select 1
      from public.project_map_blocks b
      where b.id = block_uuid
        and b.project_id = project_uuid
        and author_uuid = auth.uid()
    );
$$;

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and (
      -- task body / task comment attachments
      (
        (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
        and (
          (
            (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
            and public.can_delete_task_content(
              ((storage.foldername(name))[1])::uuid,
              ((storage.foldername(name))[2])::uuid,
              ((storage.foldername(name))[3])::uuid
            )
          )
          or (
            (storage.foldername(name))[3] = 'comments'
            and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
            and public.can_delete_task_content(
              ((storage.foldername(name))[1])::uuid,
              ((storage.foldername(name))[2])::uuid,
              ((storage.foldername(name))[4])::uuid
            )
          )
        )
      )
      -- epic attachments
      or (
        (storage.foldername(name))[2] = 'epics'
        and (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
        and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
        and public.can_delete_epic_content(
          ((storage.foldername(name))[1])::uuid,
          ((storage.foldername(name))[3])::uuid,
          ((storage.foldername(name))[4])::uuid
        )
      )
      -- sprint attachments
      or (
        (storage.foldername(name))[2] = 'sprints'
        and (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
        and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
        and public.can_delete_sprint_content(
          ((storage.foldername(name))[1])::uuid,
          ((storage.foldername(name))[3])::uuid,
          ((storage.foldername(name))[4])::uuid
        )
      )
      -- project map block attachments
      or (
        (storage.foldername(name))[2] = 'project-map'
        and (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
        and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
        and public.can_delete_project_map_content(
          ((storage.foldername(name))[1])::uuid,
          ((storage.foldername(name))[3])::uuid,
          ((storage.foldername(name))[4])::uuid
        )
      )
    )
  );

-- Keep the project-delete attachment sweep aware of the new paths.
create or replace function public.project_attachment_paths(project_uuid uuid)
returns table(path text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct attachment_path as path
  from (
    select unnest(t.attachments) as attachment_path
    from public.tasks t
    where t.project_id = project_uuid

    union all

    select unnest(tc.attachments) as attachment_path
    from public.task_comments tc
    where tc.project_id = project_uuid

    union all

    select unnest(e.attachments) as attachment_path
    from public.epics e
    where e.project_id = project_uuid

    union all

    select unnest(s.attachments) as attachment_path
    from public.sprints s
    where s.project_id = project_uuid

    union all

    select unnest(b.attachments) as attachment_path
    from public.project_map_blocks b
    where b.project_id = project_uuid
  ) attachment_paths
  where public.can_delete_project(project_uuid)
    and attachment_path <> '';
$$;
