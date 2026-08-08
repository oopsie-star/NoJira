import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import { resolveProjectByKey } from './resolvers.ts'

interface GetProjectArgs {
  project?: string
}

export async function getProject(admin: SupabaseClient, args: GetProjectArgs) {
  const projectKey = args.project?.trim()
  if (!projectKey) throw new ToolError('"project" is required.')

  const project = await resolveProjectByKey(admin, projectKey)

  const [epicsRes, sprintsRes, membersRes] = await Promise.all([
    admin.from('epics').select('id, key, title, status, is_vision').eq('project_id', project.id).order('created_at'),
    admin
      .from('sprints')
      .select('id, name, status, epic_id, start_date, end_date')
      .eq('project_id', project.id)
      .order('created_at'),
    admin
      .from('project_members')
      .select('project_role, profiles(email, full_name)')
      .eq('project_id', project.id),
  ])

  if (epicsRes.error) throw new ToolError(`Failed to load epics: ${epicsRes.error.message}`)
  if (sprintsRes.error) throw new ToolError(`Failed to load sprints: ${sprintsRes.error.message}`)
  if (membersRes.error) throw new ToolError(`Failed to load members: ${membersRes.error.message}`)

  const members = (membersRes.data ?? []).map((m) => {
    const profile = m.profiles as unknown as { email: string; full_name: string } | null
    return { email: profile?.email ?? null, full_name: profile?.full_name ?? null, project_role: m.project_role }
  })

  return {
    key: project.key,
    name: project.name,
    epics: epicsRes.data ?? [],
    sprints: sprintsRes.data ?? [],
    members,
  }
}
