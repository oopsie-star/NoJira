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
  created_at timestamptz NOT NULL DEFAULT now()
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
  );

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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (
    auth.uid() = id OR public.shares_project_with(id)
  );

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
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
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
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
    AND (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
    AND public.can_delete_task_content(
      ((storage.foldername(name))[1])::uuid,
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[3])::uuid
    )
  );
