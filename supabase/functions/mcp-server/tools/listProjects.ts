import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'

export async function listProjects(admin: SupabaseClient, _args: Record<string, unknown>) {
  const [projectsRes, tasksRes, membersRes] = await Promise.all([
    admin.from('projects').select('id, key, name, description, created_at').order('created_at'),
    admin.from('tasks').select('project_id'),
    admin.from('project_members').select('project_id'),
  ])

  if (projectsRes.error) throw new ToolError(`Failed to load projects: ${projectsRes.error.message}`)
  if (tasksRes.error) throw new ToolError(`Failed to count tasks: ${tasksRes.error.message}`)
  if (membersRes.error) throw new ToolError(`Failed to count members: ${membersRes.error.message}`)

  const taskCountByProject = new Map<string, number>()
  for (const row of tasksRes.data ?? []) {
    taskCountByProject.set(row.project_id, (taskCountByProject.get(row.project_id) ?? 0) + 1)
  }
  const memberCountByProject = new Map<string, number>()
  for (const row of membersRes.data ?? []) {
    memberCountByProject.set(row.project_id, (memberCountByProject.get(row.project_id) ?? 0) + 1)
  }

  return (projectsRes.data ?? []).map((project) => ({
    key: project.key,
    name: project.name,
    description: project.description,
    created_at: project.created_at,
    task_count: taskCountByProject.get(project.id) ?? 0,
    member_count: memberCountByProject.get(project.id) ?? 0,
  }))
}
