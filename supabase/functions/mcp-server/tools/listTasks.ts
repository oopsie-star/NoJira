import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import { resolveProfileByEmail, resolveProjectByKey } from './resolvers.ts'
import { TASK_STATUSES, type TaskStatus } from '../types.ts'

interface ListTasksArgs {
  project?: string
  status?: string
  assignee_email?: string
}

export async function listTasks(admin: SupabaseClient, args: ListTasksArgs) {
  const projectKey = args.project?.trim()
  if (!projectKey) throw new ToolError('"project" is required.')

  if (args.status && !TASK_STATUSES.includes(args.status as TaskStatus)) {
    throw new ToolError(`Invalid status "${args.status}" — must be one of: ${TASK_STATUSES.join(', ')}`)
  }

  const project = await resolveProjectByKey(admin, projectKey)

  let query = admin
    .from('tasks')
    .select('key, title, status, issue_type, priority, assignee_id, assignee_ids, due_date, updated_at')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })

  if (args.status) query = query.eq('status', args.status)

  if (args.assignee_email) {
    const profile = await resolveProfileByEmail(admin, args.assignee_email)
    query = query.or(`assignee_id.eq.${profile.id},assignee_ids.cs.{${profile.id}}`)
  }

  const { data, error } = await query
  if (error) throw new ToolError(`Failed to list tasks: ${error.message}`)

  const tasks = (data ?? []).map((task) => {
    const assigneeIds = task.assignee_ids?.length ? task.assignee_ids : task.assignee_id ? [task.assignee_id] : []
    return {
      key: task.key,
      title: task.title,
      status: task.status,
      issue_type: task.issue_type,
      priority: task.priority,
      assignee_ids: assigneeIds,
      due_date: task.due_date,
      updated_at: task.updated_at,
    }
  })

  return { tasks }
}
