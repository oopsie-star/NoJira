-- Add cursor_json column to jira_import_jobs for chunked/resumable import.
-- This stores the current pagination state so a large import can be resumed
-- across multiple Edge Function calls without a timeout.

ALTER TABLE public.jira_import_jobs
  ADD COLUMN IF NOT EXISTS cursor_json jsonb;
