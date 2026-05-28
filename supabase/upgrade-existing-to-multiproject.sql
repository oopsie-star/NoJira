-- Upgrade an existing single-project NoJira database to multi-project mode.
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS epic_key_seq START 1;
CREATE SEQUENCE IF NOT EXISTS task_key_seq START 1;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS job_title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('admin', 'manager', 'member', 'viewer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_locale_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_locale_check
      CHECK (locale IN ('en', 'ru'));
  END IF;
END $$;

UPDATE public.profiles
SET email = lower(email);

INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT
  u.id,
  lower(u.email),
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
  avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url);

CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_role text NOT NULL DEFAULT 'member',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.project_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email        text NOT NULL,
  project_role text NOT NULL DEFAULT 'member',
  status       text NOT NULL DEFAULT 'pending',
  invited_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

DO $$
BEGIN
  ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_project_role_check;
  ALTER TABLE public.project_members
    ADD CONSTRAINT project_members_project_role_check
    CHECK (project_role IN ('owner', 'admin', 'founder', 'ceo', 'member', 'viewer'));

  ALTER TABLE public.project_invites DROP CONSTRAINT IF EXISTS project_invites_project_role_check;
  ALTER TABLE public.project_invites
    ADD CONSTRAINT project_invites_project_role_check
    CHECK (project_role IN ('owner', 'admin', 'founder', 'ceo', 'member', 'viewer'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_invites_status_check'
  ) THEN
    ALTER TABLE public.project_invites
      ADD CONSTRAINT project_invites_status_check
      CHECK (status IN ('pending', 'accepted', 'revoked'));
  END IF;
END $$;

ALTER TABLE public.epics
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

ALTER TABLE public.sprints
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS goal text NOT NULL DEFAULT '';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS issue_type text NOT NULL DEFAULT 'task',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date date;

CREATE TABLE IF NOT EXISTS public.task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activity_type text NOT NULL DEFAULT 'task_updated',
  message       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_activities_activity_type_check') THEN
    ALTER TABLE public.task_activities
      ADD CONSTRAINT task_activities_activity_type_check
      CHECK (activity_type IN ('task_created', 'task_updated', 'comment_added', 'subtask_created'));
  END IF;
END $$;

DO $$
DECLARE
  owner_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects) THEN
    SELECT id INTO owner_id
    FROM public.profiles
    ORDER BY created_at, email
    LIMIT 1;

    IF owner_id IS NOT NULL THEN
      INSERT INTO public.projects (id, key, name, description, created_by)
      VALUES (
        gen_random_uuid(),
        'MAIN',
        'Main Project',
        'Migrated from the original single-project workspace',
        owner_id
      )
      ON CONFLICT (key) DO NOTHING;
    END IF;
  END IF;
END $$;

WITH default_project AS (
  SELECT id, created_by FROM public.projects ORDER BY created_at LIMIT 1
)
INSERT INTO public.project_members (project_id, profile_id, project_role)
SELECT
  dp.id,
  p.id,
  CASE WHEN p.id = dp.created_by THEN 'owner' ELSE 'member' END
FROM default_project dp
CROSS JOIN public.profiles p
ON CONFLICT (project_id, profile_id) DO NOTHING;

WITH default_project AS (
  SELECT id FROM public.projects ORDER BY created_at LIMIT 1
)
UPDATE public.epics
SET project_id = (SELECT id FROM default_project)
WHERE project_id IS NULL;

WITH default_project AS (
  SELECT id FROM public.projects ORDER BY created_at LIMIT 1
)
UPDATE public.sprints
SET project_id = (SELECT id FROM default_project)
WHERE project_id IS NULL;

WITH default_project AS (
  SELECT id FROM public.projects ORDER BY created_at LIMIT 1
)
UPDATE public.tasks
SET project_id = (SELECT id FROM default_project)
WHERE project_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'epics_project_id_fkey') THEN
    ALTER TABLE public.epics
      ADD CONSTRAINT epics_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sprints_project_id_fkey') THEN
    ALTER TABLE public.sprints
      ADD CONSTRAINT sprints_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_project_id_fkey') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_reporter_id_fkey') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_reporter_id_fkey
      FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_issue_type_check') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_issue_type_check
      CHECK (issue_type IN ('task', 'story', 'bug'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_priority_check
      CHECK (priority IN ('lowest', 'low', 'medium', 'high', 'highest'));
  END IF;
END $$;

ALTER TABLE public.epics ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.sprints ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN project_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.is_project_member(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
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
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_uuid
      AND pm.profile_id = auth.uid()
      AND pm.project_role IN ('owner', 'admin', 'founder', 'ceo')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_override_project_delete(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
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

CREATE OR REPLACE FUNCTION public.set_epic_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  project_key text;
BEGIN
  IF NEW.key IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT key INTO project_key
  FROM public.projects
  WHERE id = NEW.project_id;

  NEW.key := project_key || '-E' || nextval('epic_key_seq')::text;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  project_key text;
BEGIN
  IF NEW.key IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT key INTO project_key
  FROM public.projects
  WHERE id = NEW.project_id;

  NEW.key := project_key || '-' || nextval('task_key_seq')::text;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
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
  invite_status text := 'pending';
BEGIN
  IF NOT public.can_manage_project(project_uuid) THEN
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
  )
  ON CONFLICT (id) DO NOTHING;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS trg_epic_key ON public.epics;
CREATE TRIGGER trg_epic_key
  BEFORE INSERT ON public.epics
  FOR EACH ROW EXECUTE FUNCTION public.set_epic_key();

DROP TRIGGER IF EXISTS trg_task_key ON public.tasks;
CREATE TRIGGER trg_task_key
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_task_key();

DROP TRIGGER IF EXISTS trg_task_updated_at ON public.tasks;
CREATE TRIGGER trg_task_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_task_comment_updated_at ON public.task_comments;
CREATE TRIGGER trg_task_comment_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS on_project_created ON public.projects;
CREATE TRIGGER on_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_project();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS project_members_select ON public.project_members;
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
DROP POLICY IF EXISTS project_members_update ON public.project_members;
DROP POLICY IF EXISTS project_members_delete ON public.project_members;
DROP POLICY IF EXISTS project_invites_select ON public.project_invites;
DROP POLICY IF EXISTS project_invites_insert ON public.project_invites;
DROP POLICY IF EXISTS project_invites_update ON public.project_invites;
DROP POLICY IF EXISTS project_invites_delete ON public.project_invites;
DROP POLICY IF EXISTS epics_select ON public.epics;
DROP POLICY IF EXISTS epics_insert ON public.epics;
DROP POLICY IF EXISTS epics_update ON public.epics;
DROP POLICY IF EXISTS epics_delete ON public.epics;
DROP POLICY IF EXISTS sprints_select ON public.sprints;
DROP POLICY IF EXISTS sprints_insert ON public.sprints;
DROP POLICY IF EXISTS sprints_update ON public.sprints;
DROP POLICY IF EXISTS sprints_delete ON public.sprints;
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;
DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
DROP POLICY IF EXISTS task_comments_update ON public.task_comments;
DROP POLICY IF EXISTS task_comments_delete ON public.task_comments;
DROP POLICY IF EXISTS task_activities_select ON public.task_activities;
DROP POLICY IF EXISTS task_activities_insert ON public.task_activities;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.shares_project_with(id));

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (created_by = auth.uid() OR public.is_project_member(id));

CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY project_members_select ON public.project_members
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT WITH CHECK (
    (profile_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid()
    ))
    OR public.can_manage_project(project_id)
  );

CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY project_invites_select ON public.project_invites
  FOR SELECT USING (public.can_manage_project(project_id));

CREATE POLICY project_invites_insert ON public.project_invites
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_invites_update ON public.project_invites
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_invites_delete ON public.project_invites
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY epics_select ON public.epics
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY epics_insert ON public.epics
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY epics_update ON public.epics
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY epics_delete ON public.epics
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY sprints_select ON public.sprints
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY sprints_insert ON public.sprints
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY sprints_update ON public.sprints
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY sprints_delete ON public.sprints
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (public.can_delete_task_content(project_id, id, reporter_id));

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

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS attachments_upload ON storage.objects;
DROP POLICY IF EXISTS attachments_read ON storage.objects;
DROP POLICY IF EXISTS attachments_delete ON storage.objects;

CREATE POLICY attachments_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'attachments'
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          THEN public.is_project_member(((storage.foldername(name))[1])::uuid)
        ELSE false
      END
    )
  );

CREATE POLICY attachments_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'attachments'
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          THEN public.is_project_member(((storage.foldername(name))[1])::uuid)
        ELSE auth.role() = 'authenticated'
      END
    )
  );

CREATE POLICY attachments_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'attachments'
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
          AND (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
          AND (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
          THEN public.can_delete_task_content(
            ((storage.foldername(name))[1])::uuid,
            ((storage.foldername(name))[2])::uuid,
            ((storage.foldername(name))[3])::uuid
          )
        ELSE auth.role() = 'authenticated'
      END
    )
  );

NOTIFY pgrst, 'reload schema';
