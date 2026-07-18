-- ── Jira Import: Large Projects + User Mapping + Encrypted Token Storage ────────
-- Extends the three prior jira-import migrations without replacing any tables.
-- Prior migrations:
--   20260603100000_jira_import.sql
--   20260603110000_jira_connections_rls_hardening.sql
--   20260603120000_jira_import_cursor.sql

-- ── 1. Fix epics.status (required for correct epic import) ───────────────────
-- The Edge Function writes status on epic creation; the column was missing.
ALTER TABLE public.epics
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'done'));

-- ── 2. Placeholder users created during Jira import ──────────────────────────
-- These are NOT auth.users. They live purely in the application layer.
-- A placeholder can later be "claimed" by a real user via invitation.
CREATE TABLE IF NOT EXISTS public.project_member_placeholders (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source       text        NOT NULL DEFAULT 'jira'
                           CHECK (source IN ('jira')),
  external_id  text        NOT NULL,          -- Jira accountId
  email        text,                          -- emailAddress if available; nullable
  display_name text        NOT NULL DEFAULT '',
  avatar_url   text,
  status       text        NOT NULL DEFAULT 'imported_placeholder'
                           CHECK (status IN ('imported_placeholder', 'invited', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source, external_id)
);

ALTER TABLE public.project_member_placeholders ENABLE ROW LEVEL SECURITY;

-- Project members may read placeholders for their project.
-- Service role (Edge Function) may write.
CREATE POLICY "placeholders_read"
  ON public.project_member_placeholders FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "placeholders_manage"
  ON public.project_member_placeholders FOR ALL
  USING (public.can_manage_project(project_id));

CREATE TRIGGER touch_project_member_placeholders_updated_at
  BEFORE UPDATE ON public.project_member_placeholders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 3. Nullable placeholder columns on tasks ──────────────────────────────────
-- When a Jira assignee / reporter has no real profile in this system,
-- we record the placeholder instead. Both columns are NULL for tasks that
-- reference a real profile (assignee_id / reporter_id).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assignee_placeholder_id uuid
    REFERENCES public.project_member_placeholders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reporter_placeholder_id uuid
    REFERENCES public.project_member_placeholders(id) ON DELETE SET NULL;

-- ── 4. Encrypted token storage for jira_connections ──────────────────────────
-- The Edge Function encrypts with AES-GCM (WebCrypto) using the
-- JIRA_TOKEN_ENCRYPTION_KEY environment variable (base64-encoded 32 bytes).
-- Fallback: if the env var is unset, the existing _access_token plaintext
-- field is used (backward-compatible). Set the env var in production.
--
-- TODO BLOCKER: Set JIRA_TOKEN_ENCRYPTION_KEY in your Supabase project secrets
--   before going to production. Without it tokens are stored in plaintext.
ALTER TABLE public.jira_connections
  ADD COLUMN IF NOT EXISTS encrypted_token text,  -- AES-GCM ciphertext (base64)
  ADD COLUMN IF NOT EXISTS token_iv        text;   -- AES-GCM IV (base64, 12 bytes)

-- ── 5. Performance indexes for large-project attachment cursor ────────────────
-- Attachment phase scans all issue mappings for a project in each batch.
CREATE INDEX IF NOT EXISTS jira_ext_map_issue_proj_idx
  ON public.jira_external_mappings (user_id, jira_site_url, local_project_id, local_entity_type)
  WHERE local_entity_type = 'issue';

CREATE INDEX IF NOT EXISTS jira_ext_map_attach_proj_idx
  ON public.jira_external_mappings (user_id, jira_site_url, local_project_id, local_entity_type)
  WHERE local_entity_type = 'attachment';

-- User mapping lookup by accountId (external_id)
CREATE INDEX IF NOT EXISTS jira_ext_map_user_idx
  ON public.jira_external_mappings (user_id, jira_site_url, local_entity_type, external_id)
  WHERE local_entity_type = 'user';

-- ── 6. Grant service role write access for new tables ────────────────────────
-- (RLS is bypassed by service_role; these grants satisfy PostgREST requirements)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.project_member_placeholders TO service_role;
