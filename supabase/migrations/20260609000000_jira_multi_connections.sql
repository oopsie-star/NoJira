-- ── Phase 1: Multiple Jira connections per user ───────────────────────────────
--
-- 1. jira_connections: replace UNIQUE(user_id, jira_site_url) with
--    UNIQUE(user_id, jira_site_url, jira_account_id) so two different Jira
--    accounts on the same site can coexist.  Also add display_name so the UI
--    can label connections without calling Jira.
--
-- 2. jira_import_preferences: replace UNIQUE(user_id) with
--    UNIQUE(user_id, connection_id) so each connection retains its own last-
--    used project / board / import options.

-- ── jira_connections ──────────────────────────────────────────────────────────

-- Drop old 2-column unique (auto-named by PG or explicitly named).
ALTER TABLE public.jira_connections
  DROP CONSTRAINT IF EXISTS jira_connections_user_id_jira_site_url_key;

-- Also try the name used by the original DO-block migration just in case.
DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.jira_connections'::regclass
    AND contype = 'u'
    AND conname <> 'jira_connections_pkey';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jira_connections DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

-- Add display_name so the UI can show "Company Jira / ivan@..." labels.
ALTER TABLE public.jira_connections
  ADD COLUMN IF NOT EXISTS display_name text;

-- New 3-column unique: one row per (user, site, jira-account).
ALTER TABLE public.jira_connections
  ADD CONSTRAINT jira_connections_user_site_account_uniq
  UNIQUE (user_id, jira_site_url, jira_account_id);

-- ── jira_import_preferences ───────────────────────────────────────────────────

-- Drop old single-user unique constraint.
ALTER TABLE public.jira_import_preferences
  DROP CONSTRAINT IF EXISTS jira_import_preferences_user_id_key;

-- New constraint: one preferences row per (user, connection).
ALTER TABLE public.jira_import_preferences
  ADD CONSTRAINT jira_import_preferences_user_connection_uniq
  UNIQUE (user_id, connection_id);
