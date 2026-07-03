-- Full project-member management: decline join requests (+ re-request), remove
-- members with a last-admin guard, let project managers (not just the creator)
-- invite/manage, and an optional invite message.

-- ── 1. Profiles: track a declined workspace-join request ──────────────────────
-- Pending = approved=false AND access_declined=false. Declining hides the request
-- from the active list without deleting the account; the user can re-request later.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_declined    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_declined_at timestamptz;

-- ── 2. Invites: optional message ─────────────────────────────────────────────
ALTER TABLE public.project_invites
  ADD COLUMN IF NOT EXISTS message text;

-- ── 3. Broaden invite/manage authority beyond the sole project creator ───────
-- Project owners/admins/founders/ceos (and super admins) may now manage members,
-- matching can_manage_project. The creator is always allowed.
CREATE OR REPLACE FUNCTION public.can_invite_to_project(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_project(project_uuid)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_uuid AND p.created_by = auth.uid()
    );
$$;

-- ── 4. invite_to_project gains an optional message ───────────────────────────
CREATE OR REPLACE FUNCTION public.invite_to_project(
  project_uuid uuid,
  invite_email text,
  invite_role text DEFAULT 'member',
  invite_message text DEFAULT NULL
)
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

  INSERT INTO public.project_invites (project_id, email, project_role, status, invited_by, message)
  VALUES (project_uuid, normalized_email, invite_role, invite_status, auth.uid(), invite_message)
  ON CONFLICT (project_id, email)
  DO UPDATE SET
    project_role = EXCLUDED.project_role,
    status = EXCLUDED.status,
    invited_by = EXCLUDED.invited_by,
    message = EXCLUDED.message,
    created_at = now();
END;
$$;

-- ── 5. Let managers update/delete member rows (additive, permissive) ─────────
DROP POLICY IF EXISTS project_members_manage_update ON public.project_members;
CREATE POLICY project_members_manage_update ON public.project_members
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_members_manage_delete ON public.project_members;
CREATE POLICY project_members_manage_delete ON public.project_members
  FOR DELETE USING (public.can_manage_project(project_id));

-- ── 6. Guard: a project must always keep at least one manager ────────────────
-- Prevents removing OR demoting the last owner/admin/founder/ceo of a project,
-- regardless of how the change is attempted.
CREATE OR REPLACE FUNCTION public.guard_last_project_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mgmt_roles text[] := ARRAY['owner', 'admin', 'founder', 'ceo'];
  remaining int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only a demotion out of management can violate the invariant.
    IF NOT (OLD.project_role = ANY(mgmt_roles)) THEN RETURN NEW; END IF;
    IF NEW.project_role = ANY(mgmt_roles) THEN RETURN NEW; END IF;
  ELSE -- DELETE
    IF NOT (OLD.project_role = ANY(mgmt_roles)) THEN RETURN OLD; END IF;
  END IF;

  SELECT count(*) INTO remaining
  FROM public.project_members pm
  WHERE pm.project_id = OLD.project_id
    AND pm.project_role = ANY(mgmt_roles)
    AND pm.profile_id <> OLD.profile_id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'last_project_admin: cannot remove or demote the last project administrator';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS guard_last_project_manager ON public.project_members;
CREATE TRIGGER guard_last_project_manager
  BEFORE UPDATE OR DELETE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_project_manager();

-- ── 7. Decline a pending workspace-join request (admin only) ─────────────────
CREATE OR REPLACE FUNCTION public.decline_member(profile_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not allowed to decline members';
  END IF;

  UPDATE public.profiles
  SET access_declined = true,
      access_declined_at = now()
  WHERE id = profile_uuid
    AND approved = false;
END;
$$;

-- ── 8. Re-request access after a decline (the user themselves) ───────────────
CREATE OR REPLACE FUNCTION public.request_access_again()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET access_declined = false,
      access_declined_at = null
  WHERE id = auth.uid()
    AND approved = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_access_again() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_project(uuid, text, text, text) TO authenticated;
