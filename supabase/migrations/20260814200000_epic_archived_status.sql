-- Adds 'archived' as a valid epics.status value so an epic (and its tasks) can be
-- sent to the archive — reversible, unlike deleteEpic — instead of only deleted.
ALTER TABLE public.epics DROP CONSTRAINT IF EXISTS epics_status_check;
ALTER TABLE public.epics
  ADD CONSTRAINT epics_status_check CHECK (status IN ('planned', 'in_progress', 'done', 'archived'));
