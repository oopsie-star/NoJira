-- Internal Supabase keepalive for non-production projects only.
-- This table stores a purely technical heartbeat so dev / staging / free
-- projects do not auto-pause from inactivity. It must never be counted as
-- user activity, task activity, or analytics traffic.

CREATE TABLE IF NOT EXISTS public.internal_heartbeat (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  last_ping_at timestamptz NOT NULL DEFAULT now(),
  environment  text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, environment)
);

DROP TRIGGER IF EXISTS touch_internal_heartbeat_updated_at ON public.internal_heartbeat;

CREATE TRIGGER touch_internal_heartbeat_updated_at
  BEFORE UPDATE ON public.internal_heartbeat
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE public.internal_heartbeat ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy is created on purpose.
-- Only the service role used by internal Edge Functions may access this table.
DROP POLICY IF EXISTS "internal_heartbeat_service_role_only" ON public.internal_heartbeat;

CREATE POLICY "internal_heartbeat_service_role_only"
  ON public.internal_heartbeat
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.internal_heartbeat FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.internal_heartbeat TO service_role;
