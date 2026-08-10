// Local row shapes for the columns this function actually reads/writes.
// Not imported from src/types — that's the Vite/browser build's module
// graph, a different tsconfig from this Deno function.

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'archived' | 'deleted'
export type IssueType = 'task' | 'story' | 'bug'
export type IssuePriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled', 'archived', 'deleted']
export const ISSUE_TYPES: IssueType[] = ['task', 'story', 'bug']
export const ISSUE_PRIORITIES: IssuePriority[] = ['lowest', 'low', 'medium', 'high', 'highest']

export interface Task {
  id: string
  project_id: string
  key: string
  title: string
  description: string
  status: TaskStatus
  issue_type: IssueType
  priority: IssuePriority
  epic_id: string | null
  sprint_id: string | null
  assignee_id: string | null
  reporter_id: string | null
  assignee_ids: string[]
  due_date: string | null
  attachments: string[]
  created_at: string
  updated_at: string
}

export interface AttachmentNote {
  project_id: string
  path: string
  original_name: string | null
  mime_type: string | null
}

export interface TaskComment {
  id: string
  project_id: string
  task_id: string
  author_id: string
  body: string
  created_at: string
}

export type TaskActivityType = 'task_created' | 'task_updated' | 'comment_added' | 'subtask_created'

export interface TaskActivity {
  id: string
  task_id: string
  actor_id: string | null
  activity_type: TaskActivityType
  message: string
  created_at: string
}

export type TaskFieldChangeName = 'title' | 'description'

export interface TaskFieldChange {
  id: string
  task_id: string
  field_name: TaskFieldChangeName
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string
}

export interface Project {
  id: string
  key: string
  name: string
}
