-- NoJira / multi-project Jira-inspired workspace schema
-- Run in Supabase SQL Editor on a clean project.

CREATE SEQUENCE IF NOT EXISTS epic_key_seq START 1;
CREATE SEQUENCE IF NOT EXISTS task_key_seq START 1;

CREATE TABLE public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL UNIQUE,
  full_name  text NOT NULL DEFAULT '',
  avatar_url text,
  role       text NOT NULL DEFAULT 'member'
             CHECK (role IN ('admin', 'manager', 'member', 'viewer')),
  job_title  text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  locale     text NOT NULL DEFAULT 'en'
             CHECK (locale IN ('en', 'ru')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved    boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  approval_email_sent_at timestamptz,
  approval_email_last_attempt_at timestamptz,
  approval_email_attempts integer NOT NULL DEFAULT 0,
  approval_email_last_error text
);

CREATE TABLE public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_role text NOT NULL DEFAULT 'member'
               CHECK (project_role IN ('owner', 'admin', 'founder', 'ceo', 'member', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, profile_id)
);

CREATE TABLE public.project_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email        text NOT NULL,
  project_role text NOT NULL DEFAULT 'member'
               CHECK (project_role IN ('owner', 'admin', 'founder', 'ceo', 'member', 'viewer')),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

CREATE TABLE public.deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_type  text NOT NULL
               CHECK (entity_type IN ('task', 'sprint', 'epic')),
  entity_id    uuid NOT NULL,
  entity_label text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.epics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  key         text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  color       text NOT NULL DEFAULT '#0C66E4',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sprints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  epic_id    uuid REFERENCES public.epics(id) ON DELETE SET NULL,
  name       text NOT NULL,
  goal       text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'planned'
             CHECK (status IN ('planned', 'active', 'completed')),
  start_date date,
  end_date   date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  key         text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo', 'in_progress', 'done')),
  issue_type  text NOT NULL DEFAULT 'task'
              CHECK (issue_type IN ('task', 'story', 'bug')),
  priority    text NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('lowest', 'low', 'medium', 'high', 'highest')),
  labels      text[] NOT NULL DEFAULT '{}',
  epic_id     uuid REFERENCES public.epics(id) ON DELETE SET NULL,
  sprint_id   uuid REFERENCES public.sprints(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date    date,
  attachments text[] NOT NULL DEFAULT '{}',
  -- Jira rich-content import: raw Atlassian Document Format body + media refs
  -- extracted from it (images/files embedded in the description). NULL for tasks
  -- not imported from Jira. `description` remains the plain-text fallback.
  jira_description_adf   jsonb,
  description_media_refs jsonb,
  -- 'board' | 'backlog' for board-imported issues; NULL otherwise. Mirrors Jira's
  -- board/backlog split so the NoJira backlog can show the same sections.
  jira_board_placement   text CHECK (jira_board_placement IN ('board', 'backlog')),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL,
  attachments text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.task_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activity_type text NOT NULL
                CHECK (activity_type IN ('task_created', 'task_updated', 'comment_added', 'subtask_created')),
  message       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.internal_heartbeat (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  last_ping_at timestamptz NOT NULL DEFAULT now(),
  environment  text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, environment)
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

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

CREATE OR REPLACE FUNCTION public.can_manage_member_profile(profile_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR auth.uid() = profile_uuid
    OR EXISTS (
      SELECT 1
      FROM public.project_members manager_membership
      JOIN public.project_members target_membership
        ON target_membership.project_id = manager_membership.project_id
      WHERE manager_membership.profile_id = auth.uid()
        AND target_membership.profile_id = profile_uuid
        AND manager_membership.project_role IN ('owner', 'admin', 'founder', 'ceo')
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

CREATE OR REPLACE FUNCTION public.can_delete_task_content(project_uuid uuid, task_uuid uuid, author_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_override_project_delete(project_uuid)
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_uuid
        AND t.project_id = project_uuid
        AND t.status = 'todo'
        AND author_uuid = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.shares_project_with(target_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members mine
    JOIN public.project_members theirs
      ON mine.project_id = theirs.project_id
    WHERE mine.profile_id = auth.uid()
      AND theirs.profile_id = target_profile
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

CREATE OR REPLACE FUNCTION set_epic_key()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_key text;
BEGIN
  SELECT key INTO project_key FROM public.projects WHERE id = NEW.project_id;
  NEW.key := project_key || '-E' || nextval('epic_key_seq')::text;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_epic_key
  BEFORE INSERT ON public.epics
  FOR EACH ROW EXECUTE FUNCTION set_epic_key();

CREATE OR REPLACE FUNCTION set_task_key()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_key text;
BEGIN
  SELECT key INTO project_key FROM public.projects WHERE id = NEW.project_id;
  NEW.key := project_key || '-' || nextval('task_key_seq')::text;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_key
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION set_task_key();

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_task_comment_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER touch_internal_heartbeat_updated_at
  BEFORE UPDATE ON public.internal_heartbeat
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

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

CREATE OR REPLACE FUNCTION public.handle_new_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_members (project_id, profile_id, project_role)
  VALUES (NEW.id, NEW.created_by, 'owner')
  ON CONFLICT (project_id, profile_id)
  DO UPDATE SET project_role = 'owner';
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_project();

CREATE TRIGGER on_profile_approved
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.approved IS DISTINCT FROM TRUE AND NEW.approved = TRUE)
  EXECUTE FUNCTION public.handle_profile_approval();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_heartbeat ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (
    auth.uid() = id OR public.shares_project_with(id) OR public.is_admin()
  );

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY profiles_update_project_manager ON public.profiles
  FOR UPDATE
  USING (public.can_manage_member_profile(id))
  WITH CHECK (public.can_manage_member_profile(id));

CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (public.is_admin() OR created_by = auth.uid() OR public.is_project_member(id));

CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (public.can_delete_project(id));

CREATE POLICY project_members_select ON public.project_members
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT WITH CHECK (public.can_invite_to_project(project_id));

CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY project_invites_select ON public.project_invites
  FOR SELECT USING (public.can_invite_to_project(project_id));

CREATE POLICY project_invites_insert ON public.project_invites
  FOR INSERT WITH CHECK (public.can_invite_to_project(project_id));

CREATE POLICY project_invites_update ON public.project_invites
  FOR UPDATE USING (public.can_invite_to_project(project_id))
  WITH CHECK (public.can_invite_to_project(project_id));

CREATE POLICY project_invites_delete ON public.project_invites
  FOR DELETE USING (public.can_invite_to_project(project_id));

CREATE POLICY deletion_requests_select ON public.deletion_requests
  FOR SELECT USING (requested_by = auth.uid() OR public.is_admin());

CREATE POLICY deletion_requests_insert ON public.deletion_requests
  FOR INSERT WITH CHECK (
    requested_by = auth.uid()
    AND public.is_project_member(project_id)
  );

CREATE POLICY deletion_requests_update ON public.deletion_requests
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY deletion_requests_delete ON public.deletion_requests
  FOR DELETE USING (public.is_admin());

CREATE POLICY epics_select ON public.epics
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY epics_insert ON public.epics
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY epics_update ON public.epics
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY epics_delete ON public.epics
  FOR DELETE USING (public.is_admin());

CREATE POLICY sprints_select ON public.sprints
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY sprints_insert ON public.sprints
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY sprints_update ON public.sprints
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY sprints_delete ON public.sprints
  FOR DELETE USING (public.is_admin());

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (public.is_admin());

CREATE POLICY task_comments_select ON public.task_comments
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY task_comments_insert ON public.task_comments
  FOR INSERT WITH CHECK (
    public.is_project_member(project_id)
    AND author_id = auth.uid()
  );

CREATE POLICY task_comments_update ON public.task_comments
  FOR UPDATE USING (public.can_delete_task_content(project_id, task_id, author_id))
  WITH CHECK (public.can_delete_task_content(project_id, task_id, author_id));

CREATE POLICY task_comments_delete ON public.task_comments
  FOR DELETE USING (public.can_delete_task_content(project_id, task_id, author_id));

CREATE POLICY task_activities_select ON public.task_activities
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY task_activities_insert ON public.task_activities
  FOR INSERT WITH CHECK (
    public.is_project_member(project_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

CREATE POLICY internal_heartbeat_service_role_only ON public.internal_heartbeat
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT DO NOTHING;

CREATE POLICY attachments_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'attachments'
    AND public.is_project_member((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY attachments_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'attachments'
    AND public.is_project_member((storage.foldername(name))[1]::uuid)
  );

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

REVOKE ALL ON public.internal_heartbeat FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.internal_heartbeat TO service_role;
