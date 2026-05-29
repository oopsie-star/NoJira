export type Locale = 'en' | 'ru'

// ─── Auth ─────────────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'
export type ProjectRole = 'owner' | 'admin' | 'founder' | 'ceo' | 'member' | 'viewer'

export interface Profile {
  id:          string
  email:       string
  full_name:   string
  avatar_url:  string | null
  role:        UserRole
  job_title:   string
  department:  string
  locale:      Locale
  created_at:  string
  approved:    boolean
  approved_at: string | null
  approved_by: string | null
}

// ─── Domain ───────────────────────────────────────────────────────────────────
export interface Project {
  id:          string
  key:         string
  name:        string
  description: string
  created_by:  string
  created_at:  string
}

export interface ProjectMember {
  id:           string
  project_id:   string
  profile_id:   string
  project_role: ProjectRole
  created_at:   string
  project?:     Project | null
  profile?:     Profile | null
}

export type ProjectInviteStatus = 'pending' | 'accepted' | 'revoked'

export interface ProjectInvite {
  id:           string
  project_id:   string
  email:        string
  project_role: ProjectRole
  status:       ProjectInviteStatus
  invited_by:   string
  created_at:   string
}

export type PortfolioItemType = 'initiative' | 'milestone'

export interface PortfolioItem {
  id:         string
  project_id: string
  parent_id:  string | null
  key:        string
  item_type:  PortfolioItemType
  title:      string
  description: string
  color:      string
  position:   number
  created_at: string
}

export type EpicStatus = 'planned' | 'in_progress' | 'done'

export interface Epic {
  id:                       string
  project_id:               string
  key:                      string
  title:                    string
  description:              string
  color:                    string
  status:                   EpicStatus
  parent_portfolio_item_id: string | null
  created_at:               string
}

export type SprintStatus = 'planned' | 'active' | 'completed'

export interface Sprint {
  id:         string
  project_id: string
  name:       string
  goal:       string
  status:     SprintStatus
  start_date: string | null
  end_date:   string | null
  created_at: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type IssueType = 'task' | 'story' | 'bug'
export type IssuePriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'

export interface Task {
  id:             string
  project_id:     string
  key:            string
  title:          string
  description:    string
  parent_task_id: string | null
  status:         TaskStatus
  issue_type:     IssueType
  priority:       IssuePriority
  labels:         string[]
  epic_id:        string | null
  sprint_id:      string | null
  assignee_id:    string | null
  reporter_id:    string | null
  due_date:       string | null
  attachments:    string[]
  position:       number
  status_changed_at: string
  started_at:     string | null
  completed_at:   string | null
  created_at:     string
  updated_at:     string
  epic?:          Epic | null
  assignee?:      Profile | null
  reporter?:      Profile | null
}

export interface ProjectAutomationSettings {
  project_id:               string
  auto_assign_on_start:     boolean
  auto_close_parent_tasks:  boolean
  auto_close_epics:         boolean
  notify_on_unblock:        boolean
  created_at:               string
  updated_at:               string
}

export type WebhookEvent =
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.unblocked'

export interface ProjectWebhook {
  id:           string
  project_id:   string
  name:         string
  endpoint_url: string
  events:       WebhookEvent[]
  secret:       string
  is_active:    boolean
  created_by:   string
  created_at:   string
}

export type TaskLinkType = 'blocks' | 'relates_to' | 'duplicates'

export interface LinkedTaskSummary {
  id:          string
  key:         string
  title:       string
  status:      TaskStatus
  assignee_id?: string | null
}

export interface TaskLink {
  id:             string
  project_id:     string
  source_task_id: string
  target_task_id: string
  link_type:      TaskLinkType
  created_by:     string
  created_at:     string
  source_task?:   LinkedTaskSummary | null
  target_task?:   LinkedTaskSummary | null
}

export type NotificationType = 'assigned' | 'unblocked' | 'comment' | 'automation' | 'system'

export interface Notification {
  id:                string
  project_id:        string
  profile_id:        string
  task_id:           string | null
  notification_type: NotificationType
  title:             string
  body:              string
  is_read:           boolean
  created_at:        string
  task?:             LinkedTaskSummary | null
}

export interface TaskComment {
  id:         string
  project_id: string
  task_id:    string
  author_id:  string
  body:       string
  created_at: string
  updated_at: string
  author?:    Profile | null
}

export type TaskActivityType =
  | 'task_created'
  | 'task_updated'
  | 'comment_added'
  | 'subtask_created'

export interface TaskActivity {
  id:            string
  project_id:    string
  task_id:       string
  actor_id:      string | null
  activity_type: TaskActivityType
  message:       string
  created_at:    string
  actor?:        Profile | null
}

export const STATUS_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'done']
export const ISSUE_TYPE_OPTIONS: IssueType[] = ['task', 'story', 'bug']
export const PRIORITY_OPTIONS: IssuePriority[] = ['lowest', 'low', 'medium', 'high', 'highest']
export const ROLE_OPTIONS: UserRole[] = ['admin', 'manager', 'member', 'viewer']
export const PROJECT_ROLE_OPTIONS: ProjectRole[] = ['owner', 'admin', 'founder', 'ceo', 'member', 'viewer']
export const PORTFOLIO_ITEM_OPTIONS: PortfolioItemType[] = ['initiative', 'milestone']
export const EPIC_STATUS_OPTIONS: EpicStatus[] = ['planned', 'in_progress', 'done']
export const TASK_LINK_OPTIONS: TaskLinkType[] = ['blocks', 'relates_to', 'duplicates']
export const WEBHOOK_EVENT_OPTIONS: WebhookEvent[] = ['task.created', 'task.updated', 'task.completed', 'task.unblocked']

export const EPIC_COLORS = [
  '#0C66E4', '#6554C0', '#00B8D9', '#36B37E',
  '#FF5630', '#FF8B00', '#4C9AFF', '#57D9A3',
]
