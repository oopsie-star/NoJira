-- Short caption/note per attachment, shown next to its file card. Keyed by the
-- attachment's storage path (unique within a project) rather than by task/epic/
-- sprint id, so the same AttachmentUpload widget works for every attachment
-- surface (task, task comment, epic, sprint) without extra plumbing.

create table public.attachment_notes (
  id         uuid        primary key default gen_random_uuid(),
  project_id uuid        not null references public.projects(id) on delete cascade,
  path       text        not null,
  body       text        not null default '',
  updated_by uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

alter table public.attachment_notes enable row level security;

create policy attachment_notes_select on public.attachment_notes
  for select using (public.is_project_member(project_id));

create policy attachment_notes_insert on public.attachment_notes
  for insert with check (public.is_project_member(project_id));

create policy attachment_notes_update on public.attachment_notes
  for update using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create policy attachment_notes_delete on public.attachment_notes
  for delete using (public.is_project_member(project_id));

create trigger touch_attachment_notes_updated_at
  before update on public.attachment_notes
  for each row execute function touch_updated_at();
