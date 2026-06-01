ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS attachments text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.can_invite_to_project(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_uuid
      AND p.created_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_project(project_uuid uuid)
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

CREATE OR REPLACE FUNCTION public.can_override_project_delete(project_uuid uuid)
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

CREATE OR REPLACE FUNCTION public.project_attachment_paths(project_uuid uuid)
RETURNS TABLE(path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT attachment_path AS path
  FROM (
    SELECT unnest(t.attachments) AS attachment_path
    FROM public.tasks t
    WHERE t.project_id = project_uuid

    UNION ALL

    SELECT unnest(tc.attachments) AS attachment_path
    FROM public.task_comments tc
    WHERE tc.project_id = project_uuid
  ) attachment_paths
  WHERE public.can_delete_project(project_uuid)
    AND attachment_path <> '';
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
  invite_status text := 'pending';
BEGIN
  IF NOT public.can_invite_to_project(project_uuid) THEN
    RAISE EXCEPTION 'Not allowed to invite users to this project';
  END IF;

  IF invite_role NOT IN ('owner', 'admin', 'founder', 'ceo', 'member', 'viewer') THEN
    RAISE EXCEPTION 'Invalid project role';
  END IF;

  SELECT id INTO target_profile
  FROM public.profiles
  WHERE lower(email) = normalized_email
  LIMIT 1;

  IF target_profile IS NOT NULL THEN
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

DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (public.is_admin() OR created_by = auth.uid() OR public.is_project_member(id));

DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (public.can_delete_project(id));

DROP POLICY IF EXISTS project_members_insert ON public.project_members;
CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT WITH CHECK (public.can_invite_to_project(project_id));

DROP POLICY IF EXISTS project_invites_select ON public.project_invites;
CREATE POLICY project_invites_select ON public.project_invites
  FOR SELECT USING (public.can_invite_to_project(project_id));

DROP POLICY IF EXISTS project_invites_insert ON public.project_invites;
CREATE POLICY project_invites_insert ON public.project_invites
  FOR INSERT WITH CHECK (public.can_invite_to_project(project_id));

DROP POLICY IF EXISTS project_invites_update ON public.project_invites;
CREATE POLICY project_invites_update ON public.project_invites
  FOR UPDATE USING (public.can_invite_to_project(project_id))
  WITH CHECK (public.can_invite_to_project(project_id));

DROP POLICY IF EXISTS project_invites_delete ON public.project_invites;
CREATE POLICY project_invites_delete ON public.project_invites
  FOR DELETE USING (public.can_invite_to_project(project_id));

DROP POLICY IF EXISTS attachments_delete ON storage.objects;
CREATE POLICY attachments_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    AND (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    AND (
      (
        (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
        AND public.can_delete_task_content(
          ((storage.foldername(name))[1])::uuid,
          ((storage.foldername(name))[2])::uuid,
          ((storage.foldername(name))[3])::uuid
        )
      )
      OR (
        (storage.foldername(name))[3] = 'comments'
        AND (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
        AND public.can_delete_task_content(
          ((storage.foldername(name))[1])::uuid,
          ((storage.foldername(name))[2])::uuid,
          ((storage.foldername(name))[4])::uuid
        )
      )
    )
  );
