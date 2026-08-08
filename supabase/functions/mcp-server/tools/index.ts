import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { addComment } from './addComment.ts'
import { createEpic } from './createEpic.ts'
import { createSprint } from './createSprint.ts'
import { createTask } from './createTask.ts'
import { getProject } from './getProject.ts'
import { getTask } from './getTask.ts'
import { listTasks } from './listTasks.ts'
import { searchTasks } from './searchTasks.ts'
import { updateTask } from './updateTask.ts'
import { updateTaskStatus } from './updateTaskStatus.ts'

export { TOOL_SCHEMAS } from './schema.ts'
export { ToolError } from './errors.ts'

export type ToolHandler = (admin: SupabaseClient, args: Record<string, unknown>) => Promise<unknown>

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  list_tasks: listTasks,
  get_task: getTask,
  create_task: createTask,
  update_task_status: updateTaskStatus,
  update_task: updateTask,
  add_comment: addComment,
  search_tasks: searchTasks,
  get_project: getProject,
  create_epic: createEpic,
  create_sprint: createSprint,
}
