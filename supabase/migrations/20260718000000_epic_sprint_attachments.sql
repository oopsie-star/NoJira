-- Epics and sprints gain the same file-attachment support tasks already
-- have (Task.attachments) — stored in the same 'attachments' bucket, under
-- a distinct path shape so the delete policy can tell them apart from task
-- paths: {project}/epics/{epic}/{author}/{file} and {project}/sprints/{sprint}/{author}/{file}
-- (task paths are {project}/{task}/{author}/{file} — task uuid in position 2
-- instead of the literal 'epics'/'sprints').

alter table public.epics   add column if not exists attachments text[] not null default '{}';
alter table public.sprints add column if not exists attachments text[] not null default '{}';

create or replace function public.can_delete_epic_content(project_uuid uuid, epic_uuid uuid, author_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_override_project_delete(project_uuid)
    or exists (
      select 1
      from public.epics e
      where e.id = epic_uuid
        and e.project_id = project_uuid
        and author_uuid = auth.uid()
    );
$$;

create or replace function public.can_delete_sprint_content(project_uuid uuid, sprint_uuid uuid, author_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_override_project_delete(project_uuid)
    or exists (
      select 1
      from public.sprints s
      where s.id = sprint_uuid
        and s.project_id = project_uuid
        and author_uuid = auth.uid()
    );
$$;

-- Extend the project-delete cleanup sweep to also catch epic/sprint attachments.
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
  ) attachment_paths
  where public.can_delete_project(project_uuid)
    and attachment_path <> '';
$$;

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and (
      -- task body / task comment attachments (unchanged)
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
    )
  );
