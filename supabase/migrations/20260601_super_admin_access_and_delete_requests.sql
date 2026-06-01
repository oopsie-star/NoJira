CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('task', 'sprint', 'epic')),
  entity_id    uuid NOT NULL,
  entity_label text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_project_member(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_uuid
        AND pm.profile_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_uuid
        AND pm.profile_id = auth.uid()
        AND pm.project_role IN ('owner', 'admin', 'founder', 'ceo')
    );
$$;

CREATE OR REPLACE FUNCTION public.can_invite_to_project(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_uuid
        AND p.created_by = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.list_assignable_profiles(project_uuid uuid)
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE public.can_invite_to_project(project_uuid)
    AND p.approved = true
    AND p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_uuid
        AND pm.profile_id = p.id
    )
  ORDER BY NULLIF(p.full_name, ''), p.email;
$$;

CREATE OR REPLACE FUNCTION public.request_entity_deletion(
  project_uuid uuid,
  request_entity_type text,
  request_entity_uuid uuid,
  request_entity_label text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF request_entity_type NOT IN ('task', 'sprint', 'epic') THEN
    RAISE EXCEPTION 'Invalid entity type';
  END IF;

  IF NOT public.is_project_member(project_uuid) THEN
    RAISE EXCEPTION 'Not allowed to request deletion for this project';
  END IF;

  INSERT INTO public.deletion_requests (
    project_id,
    requested_by,
    entity_type,
    entity_id,
    entity_label
  )
  VALUES (
    project_uuid,
    auth.uid(),
    request_entity_type,
    request_entity_uuid,
    request_entity_label
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_deletion_request(
  request_uuid uuid,
  request_resolution text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request public.deletion_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not allowed to resolve deletion requests';
  END IF;

  IF request_resolution NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid resolution';
  END IF;

  SELECT *
  INTO target_request
  FROM public.deletion_requests
  WHERE id = request_uuid
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deletion request not found';
  END IF;

  IF target_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Deletion request has already been resolved';
  END IF;

  IF request_resolution = 'approved' THEN
    IF target_request.entity_type = 'task' THEN
      DELETE FROM public.tasks WHERE id = target_request.entity_id;
    ELSIF target_request.entity_type = 'sprint' THEN
      DELETE FROM public.sprints WHERE id = target_request.entity_id;
    ELSIF target_request.entity_type = 'epic' THEN
      DELETE FROM public.epics WHERE id = target_request.entity_id;
    END IF;
  END IF;

  UPDATE public.deletion_requests
  SET
    status = request_resolution,
    resolved_at = now(),
    resolved_by = auth.uid()
  WHERE id = request_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_to_project(project_uuid uuid, invite_email text, invite_role text DEFAULT 'member')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email text := lower(trim(invite_email));
  target_profile uuid;
  target_profile_approved boolean := false;
  invite_status text := 'pending';
BEGIN
  IF NOT public.can_invite_to_project(project_uuid) THEN
    RAISE EXCEPTION 'Not allowed to invite users to this project';
  END IF;

  IF invite_role NOT IN ('owner', 'admin', 'founder', 'ceo', 'member', 'viewer') THEN
    RAISE EXCEPTION 'Invalid project role';
  END IF;

  SELECT id, approved
  INTO target_profile, target_profile_approved
  FROM public.profiles
  WHERE lower(email) = normalized_email
  LIMIT 1;

  IF target_profile IS NOT NULL AND target_profile_approved THEN
    invite_status := 'accepted';

    INSERT INTO public.project_members (project_id, profile_id, project_role)
    VALUES (project_uuid, target_profile, invite_role)
    ON CONFLICT (project_id, profile_id)
    DO UPDATE SET project_role = EXCLUDED.project_role;
  END IF;

  INSERT INTO public.project_invites (project_id, email, project_role, status, invited_by)
  VALUES (project_uuid, normalized_email, invite_role, invite_status, auth.uid())
  ON CONFLICT (project_id, email)
  DO UPDATE SET
    project_role = EXCLUDED.project_role,
    status = EXCLUDED.status,
    invited_by = EXCLUDED.invited_by,
    created_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    lower(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_profile_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approved = true AND COALESCE(OLD.approved, false) = false THEN
    INSERT INTO public.project_members (project_id, profile_id, project_role)
    SELECT project_id, NEW.id, project_role
    FROM public.project_invites
    WHERE email = lower(NEW.email)
      AND status = 'pending'
    ON CONFLICT (project_id, profile_id)
    DO UPDATE SET project_role = EXCLUDED.project_role;

    UPDATE public.project_invites
    SET status = 'accepted'
    WHERE email = lower(NEW.email)
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_approved ON public.profiles;
CREATE TRIGGER on_profile_approved
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.approved IS DISTINCT FROM TRUE AND NEW.approved = TRUE)
  EXECUTE FUNCTION public.handle_profile_approval();

DROP POLICY IF EXISTS deletion_requests_select ON public.deletion_requests;
CREATE POLICY deletion_requests_select ON public.deletion_requests
  FOR SELECT USING (requested_by = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS deletion_requests_insert ON public.deletion_requests;
CREATE POLICY deletion_requests_insert ON public.deletion_requests
  FOR INSERT WITH CHECK (
    requested_by = auth.uid()
    AND public.is_project_member(project_id)
  );

DROP POLICY IF EXISTS deletion_requests_update ON public.deletion_requests;
CREATE POLICY deletion_requests_update ON public.deletion_requests
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS deletion_requests_delete ON public.deletion_requests;
CREATE POLICY deletion_requests_delete ON public.deletion_requests
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS epics_delete ON public.epics;
CREATE POLICY epics_delete ON public.epics
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS sprints_delete ON public.sprints;
CREATE POLICY sprints_delete ON public.sprints
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (public.is_admin());

INSERT INTO public.project_members (project_id, profile_id, project_role)
SELECT pi.project_id, p.id, pi.project_role
FROM public.project_invites pi
JOIN public.profiles p
  ON lower(p.email) = pi.email
WHERE pi.status = 'pending'
  AND p.approved = true
ON CONFLICT (project_id, profile_id)
DO UPDATE SET project_role = EXCLUDED.project_role;

UPDATE public.project_invites pi
SET status = 'accepted'
FROM public.profiles p
WHERE pi.email = lower(p.email)
  AND pi.status = 'pending'
  AND p.approved = true;
