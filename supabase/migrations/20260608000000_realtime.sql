-- ── Realtime: live updates for the core collaborative tables ──────────────────
-- Adds tasks/comments/sprints/epics/notifications to the supabase_realtime
-- publication so the client receives postgres_changes. REPLICA IDENTITY FULL is
-- required for RLS-filtered UPDATE/DELETE events to be delivered (the default
-- replica identity only ships the primary key in the old row, so a filter on a
-- non-PK column like project_id can't be evaluated on delete).
--
-- Idempotent: safe to re-run; only adds a table to the publication if missing.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tasks', 'task_comments', 'sprints', 'epics', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;
