-- ── Fix jira_external_mappings: project-scoped unique constraint ──────────────
-- Problem: the old 5-column unique key did NOT include local_project_id.
-- Consequence: if the same Jira issue was imported into any local project before,
-- getMappedId would return that OLD mapping and skip creating the task in the NEW
-- project — resulting in "success but 0 tasks" every time the user re-imported.
--
-- Fix: replace with a 6-column key that includes local_project_id so each
-- (Jira issue, local project) pair gets its own independent mapping row.

-- Step 1: Drop all existing unique constraints (auto-named by Postgres).
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.jira_external_mappings'::regclass
      AND contype = 'u'
      AND conname <> 'jira_external_mappings_pkey'
  LOOP
    EXECUTE format('ALTER TABLE public.jira_external_mappings DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

-- Step 2: Add the new project-scoped unique constraint.
-- All entity types used in practice carry a non-null local_project_id:
--   project  → maps to itself
--   board    → the project the board belongs to
--   sprint   → the project the sprint belongs to
--   epic     → the project the epic belongs to
--   issue    → the project the task was created in
--   attachment → same as issue
--   user     → the project context of the import
ALTER TABLE public.jira_external_mappings
  ADD CONSTRAINT jira_external_mappings_scoped_uniq
  UNIQUE (user_id, external_source, jira_site_url, local_entity_type, external_id, local_project_id);

-- Step 3: Replace lookup index to include local_project_id.
DROP INDEX IF EXISTS jira_external_mappings_lookup_idx;

CREATE INDEX jira_external_mappings_lookup_idx
  ON public.jira_external_mappings
  (user_id, jira_site_url, local_entity_type, external_id, local_project_id);
