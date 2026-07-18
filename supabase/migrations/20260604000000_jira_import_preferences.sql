-- ── Jira Import Preferences ───────────────────────────────────────────────────
-- Stores the last-used import settings per user so the wizard restores them on
-- next open. No token or credential data is stored here — tokens stay only in
-- jira_connections (accessible only via service-role Edge Function).

CREATE TABLE public.jira_import_preferences (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- FK to jira_connections; SET NULL if the connection is deleted so the row
  -- stays (user can reconnect and the options are still preserved).
  connection_id               uuid        REFERENCES public.jira_connections(id) ON DELETE SET NULL,
  local_project_id            uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  last_jira_project_key       text,
  last_jira_board_id          text,
  include_attachments         boolean     NOT NULL DEFAULT true,
  include_completed_sprints   boolean     NOT NULL DEFAULT true,
  include_comments            boolean     NOT NULL DEFAULT true,
  max_attachment_size_mb      integer     NOT NULL DEFAULT 10,
  skip_attachments_over_limit boolean     NOT NULL DEFAULT true,
  import_users                boolean     NOT NULL DEFAULT true,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.jira_import_preferences ENABLE ROW LEVEL SECURITY;

-- Users may read and write only their own preferences row.
CREATE POLICY "jira_import_preferences_user_access"
  ON public.jira_import_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER touch_jira_import_preferences_updated_at
  BEFORE UPDATE ON public.jira_import_preferences
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Service role (Edge Function) needs write access for upserts.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.jira_import_preferences TO service_role;
