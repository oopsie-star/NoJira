-- Merge a Jira import placeholder into a real project member.
-- Jira often hides user emails (privacy setting), so imported people come in as
-- placeholders even when the same person is later added by email — producing a
-- duplicate. This links the placeholder to a chosen member: reassigns their
-- tasks, repoints the Jira user-mapping to the real profile (so a future import
-- resolves the account to the user instead of recreating the placeholder), then
-- removes the placeholder. No task data is lost.

CREATE OR REPLACE FUNCTION public.link_placeholder_to_member(
  placeholder_uuid uuid,
  target_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ph public.project_member_placeholders;
BEGIN
  SELECT * INTO ph FROM public.project_member_placeholders WHERE id = placeholder_uuid;
  IF ph.id IS NULL THEN
    RAISE EXCEPTION 'Placeholder not found';
  END IF;

  IF NOT public.can_manage_project(ph.project_id) THEN
    RAISE EXCEPTION 'Not allowed to manage this project';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_profile_id) THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  -- Ensure the linked person is a member of the project.
  INSERT INTO public.project_members (project_id, profile_id, project_role)
  VALUES (ph.project_id, target_profile_id, 'member')
  ON CONFLICT (project_id, profile_id) DO NOTHING;

  -- Reassign tasks that pointed at the placeholder to the real profile.
  UPDATE public.tasks
  SET assignee_id = target_profile_id, assignee_placeholder_id = NULL
  WHERE project_id = ph.project_id AND assignee_placeholder_id = placeholder_uuid;

  UPDATE public.tasks
  SET reporter_id = target_profile_id, reporter_placeholder_id = NULL
  WHERE project_id = ph.project_id AND reporter_placeholder_id = placeholder_uuid;

  -- Make re-import durable: point the Jira user-mapping(s) for this account at
  -- the real profile so future imports resolve to the user, not a placeholder.
  UPDATE public.jira_external_mappings
  SET local_entity_id = target_profile_id::text
  WHERE local_entity_type = 'user'
    AND external_id = ph.external_id
    AND local_project_id = ph.project_id;

  -- Remove the merged placeholder (task columns are already nulled above).
  DELETE FROM public.project_member_placeholders WHERE id = placeholder_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_placeholder_to_member(uuid, uuid) TO authenticated;
