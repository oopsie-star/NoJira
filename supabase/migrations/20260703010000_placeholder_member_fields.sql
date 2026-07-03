-- Accepted Jira placeholders are shown in the team roster, so they need the same
-- editable fields as real members: project role, job title, department, language.
-- These live on the placeholder row (the person still has no NoJira account).

ALTER TABLE public.project_member_placeholders
  ADD COLUMN IF NOT EXISTS project_role text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS job_title   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS department  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locale      text NOT NULL DEFAULT 'en';
