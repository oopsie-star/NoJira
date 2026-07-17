-- Sprints had no author column either (see epics.created_by from the
-- previous migration) — needed so a sprint's own creator, not just project
-- admins, can rename it.
alter table public.sprints
  add column if not exists created_by uuid references public.profiles(id);
