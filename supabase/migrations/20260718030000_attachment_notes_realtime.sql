-- Live-sync attachment captions the same way tasks/comments/sprints/epics
-- already are (see 20260608000000_realtime.sql for why REPLICA IDENTITY FULL
-- is required for RLS-filtered UPDATE/DELETE events).

ALTER TABLE public.attachment_notes REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'attachment_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attachment_notes;
  END IF;
END $$;
