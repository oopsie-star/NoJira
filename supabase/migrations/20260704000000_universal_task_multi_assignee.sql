-- Universal tasks (Notion-style): up to 3 assignees from the team. A task with
-- 2+ assignees is "universal" — highlighted in the backlog, and only an admin /
-- project manager may change its status (its assignees cannot).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assignee_ids uuid[] NOT NULL DEFAULT '{}';

-- Cap at 3 assignees.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignee_ids_max3'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_assignee_ids_max3
      CHECK (coalesce(array_length(assignee_ids, 1), 0) <= 3);
  END IF;
END $$;

-- Block status changes on universal tasks by non-managers. Only the status
-- column is guarded — assignees may still edit everything else.
CREATE OR REPLACE FUNCTION public.guard_universal_task_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(array_length(OLD.assignee_ids, 1), 0) >= 2
     AND NOT (public.is_admin() OR public.can_manage_project(OLD.project_id))
  THEN
    RAISE EXCEPTION 'universal_task_status: only an admin can change the status of a shared task';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_universal_task_status ON public.tasks;
CREATE TRIGGER guard_universal_task_status
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_universal_task_status();
