-- Epics gained no author column originally; add one so the AI agent (and
-- humans) can be attributed as the creator, and so authorship can be
-- bulk-reassigned later (mirrors tasks.reporter_id).
alter table public.epics
  add column if not exists created_by uuid references public.profiles(id);
