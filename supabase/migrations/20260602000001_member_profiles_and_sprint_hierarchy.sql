ALTER TABLE public.sprints
  ADD COLUMN IF NOT EXISTS epic_id uuid REFERENCES public.epics(id) ON DELETE SET NULL;

WITH consistent_sprints AS (
  SELECT
    sprint_id
  FROM public.tasks
  WHERE sprint_id IS NOT NULL
    AND epic_id IS NOT NULL
  GROUP BY sprint_id
  HAVING COUNT(DISTINCT epic_id) = 1
),
sprint_epic_candidates AS (
  SELECT DISTINCT ON (task.sprint_id)
    task.sprint_id,
    task.epic_id
  FROM public.tasks AS task
  INNER JOIN consistent_sprints AS consistent
    ON consistent.sprint_id = task.sprint_id
  WHERE task.epic_id IS NOT NULL
  ORDER BY task.sprint_id, task.epic_id::text
)
UPDATE public.sprints AS sprint
SET epic_id = candidate.epic_id
FROM sprint_epic_candidates AS candidate
WHERE sprint.id = candidate.sprint_id
  AND sprint.epic_id IS NULL;

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

DROP POLICY IF EXISTS profiles_update_project_manager ON public.profiles;

CREATE POLICY profiles_update_project_manager ON public.profiles
  FOR UPDATE
  USING (public.can_manage_member_profile(id))
  WITH CHECK (public.can_manage_member_profile(id));
