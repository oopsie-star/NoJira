-- Harden jira_connections RLS so that authenticated users cannot SELECT
-- the sensitive _access_token / _token_email columns via direct table queries.
--
-- The Edge Function (service role key) bypasses RLS entirely, so it is
-- unaffected. The Wizard frontend only ever calls supabase.functions.invoke
-- and never queries jira_connections directly.
--
-- Row-level policies in Postgres cannot restrict individual columns, so the
-- safest approach for MVP is to remove the user-level SELECT policy and only
-- expose a safe view. Full Vault integration is the production target.

-- 1. Drop the permissive FOR ALL policy
DROP POLICY IF EXISTS "jira_connections_user_access" ON public.jira_connections;

-- 2. Re-add scoped policies: write access (INSERT/UPDATE/DELETE) stays user-owned.
--    No SELECT policy is added — users cannot read the table directly via the
--    Supabase client. The Edge Function uses the service-role client which
--    bypasses RLS.

CREATE POLICY "jira_connections_insert"
  ON public.jira_connections FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "jira_connections_update"
  ON public.jira_connections FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "jira_connections_delete"
  ON public.jira_connections FOR DELETE
  USING (user_id = auth.uid());

-- 3. Provide a safe read view that omits token columns.
--    The frontend can query this view via the Supabase client to show the
--    user their connected sites (without exposing credentials).
CREATE OR REPLACE VIEW public.jira_connections_safe
  WITH (security_invoker = true)
  AS
  SELECT
    id,
    user_id,
    jira_site_url,
    auth_type,
    jira_account_id,
    jira_user_email,
    status,
    last_sync_at,
    created_at,
    updated_at
  FROM public.jira_connections
  WHERE user_id = auth.uid();

GRANT SELECT ON public.jira_connections_safe TO authenticated;
