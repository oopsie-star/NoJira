-- Add terminal task statuses: cancelled, archived, deleted (soft-delete marker).
-- These take a task off the active board into the "Closed" view; `deleted` is a
-- recoverable marker — the row is NOT removed, so no real task data is lost.

-- Drop any existing CHECK constraint that references tasks.status (name may vary
-- across environments), then recreate it with the full set of allowed values.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'tasks'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled', 'archived', 'deleted'));
