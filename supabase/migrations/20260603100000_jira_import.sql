-- ── Jira Import Tables ────────────────────────────────────────────────────────

-- Stores Jira connections; sensitive token columns (_access_token, _token_email)
-- are readable only by the Edge Function (service role bypasses RLS).
CREATE TABLE public.jira_connections (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jira_site_url      text        NOT NULL,
  cloud_id           text,
  auth_type          text        NOT NULL DEFAULT 'api_token'
                                 CHECK (auth_type IN ('api_token', 'oauth2')),
  _access_token      text,
  _token_email       text,
  token_expires_at   timestamptz,
  jira_account_id    text,
  jira_user_email    text,
  status             text        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'expired', 'revoked')),
  last_sync_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, jira_site_url)
);

ALTER TABLE public.jira_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jira_connections_user_access"
  ON public.jira_connections FOR ALL
  USING (user_id = auth.uid());

CREATE TRIGGER touch_jira_connections_updated_at
  BEFORE UPDATE ON public.jira_connections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.jira_import_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id     uuid        NOT NULL REFERENCES public.jira_connections(id) ON DELETE CASCADE,
  local_project_id  uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  jira_project_key  text        NOT NULL,
  jira_project_name text,
  jira_board_id     text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial')),
  progress_total    integer     NOT NULL DEFAULT 0,
  progress_done     integer     NOT NULL DEFAULT 0,
  current_step      text,
  warnings          jsonb       NOT NULL DEFAULT '[]',
  error_message     text,
  import_options    jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

ALTER TABLE public.jira_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jira_import_jobs_user_access"
  ON public.jira_import_jobs FOR ALL
  USING (user_id = auth.uid());

CREATE TRIGGER touch_jira_import_jobs_updated_at
  BEFORE UPDATE ON public.jira_import_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────

-- Idempotency: maps Jira entities to local entities so re-runs skip existing items.
CREATE TABLE public.jira_external_mappings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_project_id  uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  local_entity_type text        NOT NULL
                                CHECK (local_entity_type IN ('project', 'board', 'sprint', 'epic', 'issue', 'attachment', 'user')),
  local_entity_id   text,
  external_source   text        NOT NULL DEFAULT 'jira',
  external_id       text        NOT NULL,
  external_key      text,
  jira_site_url     text        NOT NULL,
  raw_json          jsonb,
  jira_updated_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_source, jira_site_url, local_entity_type, external_id)
);

ALTER TABLE public.jira_external_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jira_external_mappings_user_access"
  ON public.jira_external_mappings FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX jira_external_mappings_lookup_idx
  ON public.jira_external_mappings (user_id, jira_site_url, local_entity_type, external_id);

CREATE TRIGGER touch_jira_external_mappings_updated_at
  BEFORE UPDATE ON public.jira_external_mappings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Storage bucket for Jira-imported attachments ──────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task-attachments', 'task-attachments', false, 104857600)  -- 100 MB max file
ON CONFLICT DO NOTHING;

-- Service role (Edge Function) can upload. Authenticated users can read/delete
-- their own project's attachments; path format: {project_id}/{task_id}/{filename}

CREATE POLICY "task_attachments_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'task-attachments'
    AND auth.role() IN ('authenticated', 'service_role')
  );

CREATE POLICY "task_attachments_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR public.is_project_member((storage.foldername(name))[1]::uuid)
    )
  );

CREATE POLICY "task_attachments_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR public.is_project_member((storage.foldername(name))[1]::uuid)
    )
  );
