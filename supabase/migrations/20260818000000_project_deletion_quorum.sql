-- Deleting a project now requires approval from at least two distinct
-- super-admins (profiles.role = 'admin'). Direct DELETE on public.projects
-- is closed off entirely; the only path to an actual delete is
-- approve_project_deletion() reaching a quorum of 2.

CREATE TABLE IF NOT EXISTS public.project_deletion_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Intentionally not a FK to projects(id): the project row is gone once
  -- this resolves, and the request is the audit trail of that deletion.
  project_id       uuid NOT NULL,
  project_name     text NOT NULL,
  requested_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'cancelled')),
  attachment_paths text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);

ALTER TABLE public.project_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Only one open request per project at a time.
CREATE UNIQUE INDEX IF NOT EXISTS project_deletion_requests_pending_unique
  ON public.project_deletion_requests (project_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.project_deletion_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.project_deletion_requests(id) ON DELETE CASCADE,
  admin_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, admin_id)
);

ALTER TABLE public.project_deletion_approvals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.request_project_deletion(project_uuid uuid)
RETURNS public.project_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_request public.project_deletion_requests%ROWTYPE;
  new_request public.project_deletion_requests%ROWTYPE;
  target_project_name text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only super-admins can request project deletion';
  END IF;

  SELECT * INTO existing_request
  FROM public.project_deletion_requests
  WHERE project_id = project_uuid AND status = 'pending'
  LIMIT 1;

  IF FOUND THEN
    RETURN existing_request;
  END IF;

  SELECT name INTO target_project_name FROM public.projects WHERE id = project_uuid;
  IF target_project_name IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  INSERT INTO public.project_deletion_requests (project_id, project_name, requested_by)
  VALUES (project_uuid, target_project_name, auth.uid())
  RETURNING * INTO new_request;

  -- The requester's own vote counts as the first of the two approvals.
  INSERT INTO public.project_deletion_approvals (request_id, admin_id)
  VALUES (new_request.id, auth.uid());

  RETURN new_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_project_deletion(request_uuid uuid)
RETURNS public.project_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request public.project_deletion_requests%ROWTYPE;
  approval_count integer;
  purge_paths text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only super-admins can approve project deletion';
  END IF;

  SELECT * INTO target_request
  FROM public.project_deletion_requests
  WHERE id = request_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deletion request not found';
  END IF;

  IF target_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Deletion request is no longer pending';
  END IF;

  INSERT INTO public.project_deletion_approvals (request_id, admin_id)
  VALUES (request_uuid, auth.uid())
  ON CONFLICT (request_id, admin_id) DO NOTHING;

  SELECT count(DISTINCT admin_id) INTO approval_count
  FROM public.project_deletion_approvals
  WHERE request_id = request_uuid;

  IF approval_count >= 2 THEN
    SELECT array_agg(DISTINCT attachment_path) INTO purge_paths
    FROM (
      SELECT unnest(t.attachments) AS attachment_path
      FROM public.tasks t
      WHERE t.project_id = target_request.project_id

      UNION ALL

      SELECT unnest(tc.attachments) AS attachment_path
      FROM public.task_comments tc
      WHERE tc.project_id = target_request.project_id
    ) paths
    WHERE attachment_path <> '';

    -- Resolve the request (and capture the final row) before the project
    -- row disappears, since nothing FKs this table to projects.
    UPDATE public.project_deletion_requests
    SET status = 'approved', resolved_at = now(), attachment_paths = COALESCE(purge_paths, '{}')
    WHERE id = request_uuid
    RETURNING * INTO target_request;

    DELETE FROM public.projects WHERE id = target_request.project_id;
  END IF;

  RETURN target_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_project_deletion(request_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only super-admins can cancel a project deletion request';
  END IF;

  UPDATE public.project_deletion_requests
  SET status = 'cancelled', resolved_at = now()
  WHERE id = request_uuid AND status = 'pending';
END;
$$;

-- Close the direct delete path: is_admin() OR created_by is no longer
-- enough on its own. Every project delete must go through the quorum RPC.
DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (false);

DROP POLICY IF EXISTS project_deletion_requests_select ON public.project_deletion_requests;
CREATE POLICY project_deletion_requests_select ON public.project_deletion_requests
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS project_deletion_approvals_select ON public.project_deletion_approvals;
CREATE POLICY project_deletion_approvals_select ON public.project_deletion_approvals
  FOR SELECT USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.project_deletion_requests r
      WHERE r.id = request_id
    )
  );
