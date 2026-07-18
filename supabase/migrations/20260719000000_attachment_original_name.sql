-- Supabase Storage keys must stay ASCII-safe, so the true uploaded filename
-- (Cyrillic or any other script) is recorded here instead, keyed by the same
-- (project_id, path) the caption already uses.

alter table public.attachment_notes add column if not exists original_name text;
