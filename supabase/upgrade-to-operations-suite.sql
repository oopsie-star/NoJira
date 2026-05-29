-- Upgrade NoJira with roadmap hierarchy, automations, integrations,
-- blockers, notifications, and task timing metadata.
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS portfolio_key_seq START 1;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.epics
  ADD COLUMN IF NOT EXISTS parent_portfolio_item_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';

DO $$
BEGIN
  ALTER TABLE public.epics DROP CONSTRAINT IF EXISTS epics_status_check;
  ALTER TABLE public.epics
    ADD CONSTRAINT epics_status_check
    CHECK (status IN ('planned', 'in_progress', 'done'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epics_parent_portfolio_item_id_fkey'
  ) THEN
    ALTER TABLE public.epics
      ADD CONSTRAINT epics_parent_portfolio_item_id_fkey
      FOREIGN KEY (parent_portfolio_item_id) REFERENCES public.portfolio_items(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.portfolio_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES public.portfolio_items(id) ON DELETE CASCADE,
  key        text NOT NULL UNIQUE,
  item_type  text NOT NULL DEFAULT 'initiative',
  title      text NOT NULL,
  description text NOT NULL DEFAULT '',
  color      text NOT NULL DEFAULT '#6554C0',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.portfolio_items DROP CONSTRAINT IF EXISTS portfolio_items_item_type_check;
  ALTER TABLE public.portfolio_items
    ADD CONSTRAINT portfolio_items_item_type_check
    CHECK (item_type IN ('initiative', 'milestone'));
END $$;

ALTER TABLE public.epics
  ADD COLUMN IF NOT EXISTS parent_portfolio_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epics_parent_portfolio_item_id_fkey'
  ) THEN
    ALTER TABLE public.epics
      ADD CONSTRAINT epics_parent_portfolio_item_id_fkey
      FOREIGN KEY (parent_portfolio_item_id) REFERENCES public.portfolio_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.project_automation_settings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  auto_assign_on_start boolean NOT NULL DEFAULT true,
  auto_close_parent_tasks boolean NOT NULL DEFAULT true,
  auto_close_epics boolean NOT NULL DEFAULT true,
  notify_on_unblock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  endpoint_url text NOT NULL,
  events      text[] NOT NULL DEFAULT '{"task.created","task.updated","task.completed","task.unblocked"}',
  secret      text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  target_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  link_type      text NOT NULL DEFAULT 'blocks',
  created_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_task_id, target_task_id, link_type)
);

DO $$
BEGIN
  ALTER TABLE public.task_links DROP CONSTRAINT IF EXISTS task_links_link_type_check;
  ALTER TABLE public.task_links
    ADD CONSTRAINT task_links_link_type_check
    CHECK (link_type IN ('blocks', 'relates_to', 'duplicates'));

  ALTER TABLE public.task_links DROP CONSTRAINT IF EXISTS task_links_source_target_check;
  ALTER TABLE public.task_links
    ADD CONSTRAINT task_links_source_target_check
    CHECK (source_task_id <> target_task_id);
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id           uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  notification_type text NOT NULL DEFAULT 'system',
  title             text NOT NULL,
  body              text NOT NULL DEFAULT '',
  is_read           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (notification_type IN ('assigned', 'unblocked', 'comment', 'automation', 'system'));
END $$;

CREATE INDEX IF NOT EXISTS portfolio_items_project_parent_idx
  ON public.portfolio_items(project_id, parent_id, position);

CREATE INDEX IF NOT EXISTS project_webhooks_project_idx
  ON public.project_webhooks(project_id, is_active);

CREATE INDEX IF NOT EXISTS task_links_project_target_idx
  ON public.task_links(project_id, target_task_id, source_task_id);

CREATE INDEX IF NOT EXISTS notifications_profile_read_idx
  ON public.notifications(profile_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS tasks_project_status_changed_idx
  ON public.tasks(project_id, status, status_changed_at DESC);

CREATE INDEX IF NOT EXISTS tasks_epic_parent_idx
  ON public.tasks(epic_id, parent_task_id);

UPDATE public.tasks
SET
  status_changed_at = COALESCE(status_changed_at, updated_at, created_at, now()),
  started_at = COALESCE(
    started_at,
    CASE WHEN status IN ('in_progress', 'done') THEN created_at END
  ),
  completed_at = COALESCE(
    completed_at,
    CASE WHEN status = 'done' THEN COALESCE(updated_at, created_at, now()) END
  );

INSERT INTO public.project_automation_settings (project_id)
SELECT id
FROM public.projects
ON CONFLICT (project_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_portfolio_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  project_key text;
  suffix text;
BEGIN
  IF NEW.key IS NOT NULL AND NEW.key <> '' THEN
    RETURN NEW;
  END IF;

  SELECT key INTO project_key
  FROM public.projects
  WHERE id = NEW.project_id;

  suffix := CASE WHEN NEW.item_type = 'milestone' THEN 'M' ELSE 'I' END;
  NEW.key := project_key || '-' || suffix || nextval('portfolio_key_seq')::text;
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

  INSERT INTO public.project_automation_settings (project_id)
  VALUES (NEW.id)
  ON CONFLICT (project_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_epic_status(epic_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_count integer;
  done_count integer;
  todo_count integer;
BEGIN
  IF epic_uuid IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'done'),
    COUNT(*) FILTER (WHERE status = 'todo')
  INTO total_count, done_count, todo_count
  FROM public.tasks
  WHERE epic_id = epic_uuid
    AND parent_task_id IS NULL;

  UPDATE public.epics
  SET status = CASE
    WHEN total_count = 0 OR todo_count = total_count THEN 'planned'
    WHEN done_count = total_count THEN 'done'
    ELSE 'in_progress'
  END
  WHERE id = epic_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_parent_task_status(parent_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_count integer;
  done_count integer;
  current_status text;
BEGIN
  IF parent_uuid IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'done')
  INTO total_count, done_count
  FROM public.tasks
  WHERE parent_task_id = parent_uuid;

  IF total_count = 0 THEN
    RETURN;
  END IF;

  SELECT status INTO current_status
  FROM public.tasks
  WHERE id = parent_uuid;

  IF done_count = total_count THEN
    UPDATE public.tasks
    SET status = 'done'
    WHERE id = parent_uuid
      AND status <> 'done';
  ELSIF current_status = 'done' THEN
    UPDATE public.tasks
    SET status = 'in_progress'
    WHERE id = parent_uuid;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_task_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.project_automation_settings%ROWTYPE;
BEGIN
  SELECT *
  INTO settings
  FROM public.project_automation_settings
  WHERE project_id = NEW.project_id;

  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, NEW.created_at, now());

    IF NEW.status IN ('in_progress', 'done') AND NEW.started_at IS NULL THEN
      NEW.started_at := COALESCE(NEW.created_at, now());
    END IF;

    IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := COALESCE(NEW.updated_at, NEW.created_at, now());
    END IF;

    IF COALESCE(settings.auto_assign_on_start, true)
      AND NEW.status = 'in_progress'
      AND NEW.assignee_id IS NULL
      AND auth.uid() IS NOT NULL THEN
      NEW.assignee_id := auth.uid();
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();

    IF NEW.status IN ('in_progress', 'done') AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;

    IF NEW.status = 'done' THEN
      NEW.completed_at := now();
    ELSIF OLD.status = 'done' AND NEW.status <> 'done' THEN
      NEW.completed_at := NULL;
    END IF;

    IF COALESCE(settings.auto_assign_on_start, true)
      AND NEW.status = 'in_progress'
      AND NEW.assignee_id IS NULL
      AND auth.uid() IS NOT NULL THEN
      NEW.assignee_id := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_task_automations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.project_automation_settings%ROWTYPE;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO settings
  FROM public.project_automation_settings
  WHERE project_id = NEW.project_id;

  IF COALESCE(settings.auto_close_epics, true) THEN
    PERFORM public.sync_epic_status(NEW.epic_id);
    IF TG_OP = 'UPDATE' AND OLD.epic_id IS DISTINCT FROM NEW.epic_id THEN
      PERFORM public.sync_epic_status(OLD.epic_id);
    END IF;
  END IF;

  IF COALESCE(settings.auto_close_parent_tasks, true) THEN
    PERFORM public.sync_parent_task_status(NEW.parent_task_id);
    IF TG_OP = 'UPDATE' AND OLD.parent_task_id IS DISTINCT FROM NEW.parent_task_id THEN
      PERFORM public.sync_parent_task_status(OLD.parent_task_id);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
    AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      project_id,
      profile_id,
      task_id,
      notification_type,
      title,
      body
    )
    VALUES (
      NEW.project_id,
      NEW.assignee_id,
      NEW.id,
      'assigned',
      'Issue assigned to you',
      NEW.key || ' • ' || NEW.title
    );
  END IF;

  IF COALESCE(settings.notify_on_unblock, true)
    AND TG_OP = 'UPDATE'
    AND NEW.status = 'done'
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (
      project_id,
      profile_id,
      task_id,
      notification_type,
      title,
      body
    )
    SELECT DISTINCT
      NEW.project_id,
      candidate.profile_id,
      linked.target_task_id,
      'unblocked',
      'Blocked issue is ready again',
      blocker.key || ' is done. ' || target_task.key || ' is no longer blocked.'
    FROM public.task_links linked
    JOIN public.tasks blocker
      ON blocker.id = linked.source_task_id
    JOIN public.tasks target_task
      ON target_task.id = linked.target_task_id
    CROSS JOIN LATERAL (
      VALUES (target_task.assignee_id), (target_task.reporter_id)
    ) AS candidate(profile_id)
    WHERE linked.project_id = NEW.project_id
      AND linked.link_type = 'blocks'
      AND linked.source_task_id = NEW.id
      AND candidate.profile_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.task_links remaining
        JOIN public.tasks remaining_blocker
          ON remaining_blocker.id = remaining.source_task_id
        WHERE remaining.project_id = linked.project_id
          AND remaining.target_task_id = linked.target_task_id
          AND remaining.link_type = 'blocks'
          AND remaining_blocker.status <> 'done'
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portfolio_key ON public.portfolio_items;
CREATE TRIGGER trg_portfolio_key
  BEFORE INSERT ON public.portfolio_items
  FOR EACH ROW EXECUTE FUNCTION public.set_portfolio_key();

DROP TRIGGER IF EXISTS trg_project_automation_settings_updated_at ON public.project_automation_settings;
CREATE TRIGGER trg_project_automation_settings_updated_at
  BEFORE UPDATE ON public.project_automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_task_lifecycle ON public.tasks;
CREATE TRIGGER trg_task_lifecycle
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_lifecycle();

DROP TRIGGER IF EXISTS trg_task_automations ON public.tasks;
CREATE TRIGGER trg_task_automations
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_automations();

ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolio_items_select ON public.portfolio_items;
DROP POLICY IF EXISTS portfolio_items_insert ON public.portfolio_items;
DROP POLICY IF EXISTS portfolio_items_update ON public.portfolio_items;
DROP POLICY IF EXISTS portfolio_items_delete ON public.portfolio_items;
DROP POLICY IF EXISTS project_automation_settings_select ON public.project_automation_settings;
DROP POLICY IF EXISTS project_automation_settings_insert ON public.project_automation_settings;
DROP POLICY IF EXISTS project_automation_settings_update ON public.project_automation_settings;
DROP POLICY IF EXISTS project_webhooks_select ON public.project_webhooks;
DROP POLICY IF EXISTS project_webhooks_insert ON public.project_webhooks;
DROP POLICY IF EXISTS project_webhooks_update ON public.project_webhooks;
DROP POLICY IF EXISTS project_webhooks_delete ON public.project_webhooks;
DROP POLICY IF EXISTS task_links_select ON public.task_links;
DROP POLICY IF EXISTS task_links_insert ON public.task_links;
DROP POLICY IF EXISTS task_links_update ON public.task_links;
DROP POLICY IF EXISTS task_links_delete ON public.task_links;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_delete ON public.notifications;

CREATE POLICY portfolio_items_select ON public.portfolio_items
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY portfolio_items_insert ON public.portfolio_items
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY portfolio_items_update ON public.portfolio_items
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY portfolio_items_delete ON public.portfolio_items
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY project_automation_settings_select ON public.project_automation_settings
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY project_automation_settings_insert ON public.project_automation_settings
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_automation_settings_update ON public.project_automation_settings
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_webhooks_select ON public.project_webhooks
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY project_webhooks_insert ON public.project_webhooks
  FOR INSERT WITH CHECK (
    public.can_manage_project(project_id)
    AND created_by = auth.uid()
  );

CREATE POLICY project_webhooks_update ON public.project_webhooks
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

CREATE POLICY project_webhooks_delete ON public.project_webhooks
  FOR DELETE USING (public.can_manage_project(project_id));

CREATE POLICY task_links_select ON public.task_links
  FOR SELECT USING (public.is_project_member(project_id));

CREATE POLICY task_links_insert ON public.task_links
  FOR INSERT WITH CHECK (
    public.is_project_member(project_id)
    AND created_by = auth.uid()
  );

CREATE POLICY task_links_update ON public.task_links
  FOR UPDATE USING (public.is_project_member(project_id))
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY task_links_delete ON public.task_links
  FOR DELETE USING (public.is_project_member(project_id));

CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (
    public.is_project_member(project_id)
    AND profile_id = auth.uid()
  );

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (
    public.is_project_member(project_id)
    AND profile_id = auth.uid()
  )
  WITH CHECK (
    public.is_project_member(project_id)
    AND profile_id = auth.uid()
  );

CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE USING (
    public.is_project_member(project_id)
    AND profile_id = auth.uid()
  );

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT id FROM public.epics LOOP
    PERFORM public.sync_epic_status(item.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
