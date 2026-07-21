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
  approval_email_sent_at:         string | null
  approval_email_last_attempt_at: string | null
  approval_email_attempts:        number
  approval_email_last_error:      string | null
  access_declined:                boolean
  access_declined_at:             string | null
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
  message:      string | null
}

export type DeletionRequestEntityType = 'task' | 'sprint' | 'epic'
export type DeletionRequestStatus = 'pending' | 'approved' | 'rejected'

export interface DeletionRequest {
  id:          string
  project_id:  string
  requested_by: string
  entity_type: DeletionRequestEntityType
  entity_id:   string
  entity_label: string
  status:      DeletionRequestStatus
  created_at:  string
  resolved_at: string | null
  resolved_by: string | null
  requester?:  Profile | null
  project?:    Pick<Project, 'id' | 'key' | 'name'> | null
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
  created_by:               string | null
  attachments:              string[]
  created_at:               string
}

export type SprintStatus = 'planned' | 'active' | 'completed'

export interface Sprint {
  id:         string
  project_id: string
  epic_id:    string | null
  name:       string
  goal:       string
  status:     SprintStatus
  start_date: string | null
  end_date:   string | null
  created_by: string | null
  attachments: string[]
  created_at: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'archived' | 'deleted'
export type IssueType = 'task' | 'story' | 'bug'
export type IssuePriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'

// Raw Atlassian Document Format node (loosely typed — we only read a few attrs).
export interface AdfNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: AdfNode[]
  content?: AdfNode[]
  [key: string]: unknown
}

// A media reference extracted from a Jira description (image / file embedded in
// the ADF body). Linked to an imported attachment by filename at render time.
export interface JiraMediaRef {
  id:         string | null
  type:       string | null
  collection: string | null
  width:      number | null
  height:     number | null
  alt:        string | null
  url:        string | null
  localId:    string | null
}

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
  // Universal (Notion-style) task: up to 3 team assignees. When 2+ are present
  // the task is "universal" — highlighted in the backlog and status is admin-only.
  assignee_ids:   string[]
  // Set when the assignee/reporter is an imported Jira person with no NoJira
  // account (a project_member_placeholders row) instead of a real profile.
  assignee_placeholder_id?: string | null
  reporter_placeholder_id?: string | null
  due_date:       string | null
  attachments:    string[]
  // Jira rich-content import: raw ADF body + media refs extracted from it.
  // Both are null for tasks not imported from Jira (or with no rich body).
  jira_description_adf?:   AdfNode | null
  description_media_refs?: JiraMediaRef[] | null
  // Mirrors Jira's board split: 'board' (on the board) | 'backlog' (in the board
  // backlog) | null (manual task or non-board import).
  jira_board_placement?:   'board' | 'backlog' | null
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
  webhook_type: WebhookType
  is_active:    boolean
  created_by:   string
  created_at:   string
}

export type WebhookType = 'generic' | 'discord' | 'slack'

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

export interface AttachmentNote {
  id:            string
  project_id:    string
  path:          string
  body:          string
  original_name: string | null
  mime_type:     string | null
  updated_by:    string | null
  created_at:    string
  updated_at:    string
}

export type ActivityEventType = 'login' | 'view_task' | 'download_attachment' | 'play_audio'

export interface ActivityEvent {
  id:         string
  project_id: string
  profile_id: string | null
  event_type: ActivityEventType
  task_id:    string | null
  detail:     string | null
  created_at: string
  profile?:   Pick<Profile, 'id' | 'full_name' | 'email'> | null
  task?:      Pick<Task, 'id' | 'key' | 'title'> | null
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
  id:          string
  project_id:  string
  task_id:     string
  author_id:   string
  body:        string
  attachments: string[]
  created_at:  string
  updated_at:  string
  author?:     Profile | null
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

// Active workflow columns shown on the board.
export const STATUS_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'done']
// Terminal statuses: tasks here leave the active board into the "Closed" view.
// `deleted` is a soft-delete marker — the row stays in the DB and is recoverable.
export const TERMINAL_STATUSES: TaskStatus[] = ['cancelled', 'archived', 'deleted']
export const ALL_TASK_STATUSES: TaskStatus[] = [...STATUS_COLUMNS, ...TERMINAL_STATUSES]
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
export const MAX_ASSIGNEES = 3
/** A "universal" task has 2+ assignees (status is admin-only, highlighted in backlog). */
export function isUniversalTask(task: { assignee_ids?: string[] | null }): boolean {
  return (task.assignee_ids?.length ?? 0) >= 2
}
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

// ─── Jira Import ──────────────────────────────────────────────────────────────
export interface JiraConnection {
  id: string
  user_id: string
  jira_site_url: string
  cloud_id: string | null
  auth_type: 'api_token' | 'oauth2'
  jira_account_id: string | null
  jira_user_email: string | null
  status: 'active' | 'expired' | 'revoked'
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface JiraImportJob {
  id: string
  user_id: string
  connection_id: string
  local_project_id: string | null
  jira_project_key: string
  jira_project_name: string | null
  jira_board_id: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial'
  progress_total: number
  progress_done: number
  current_step: string | null
  warnings: string[]
  error_message: string | null
  import_options: JiraImportOptions
  created_at: string
  updated_at: string
  finished_at: string | null
}

export interface JiraImportOptions {
  include_attachments: boolean
  include_completed_sprints: boolean
  include_comments: boolean
  max_attachment_size_mb: number
  skip_attachments_over_limit: boolean
  import_users: boolean
}

export interface JiraImportPreview {
  epics_count: number
  issues_count: number
  subtasks_count: number
  sprints_count: number
  attachments_count: number
  estimated_attachment_size_bytes: number
  total_issues: number
  is_large_project: boolean
}

export interface JiraUserPlaceholder {
  id: string
  project_id: string
  source: 'jira'
  external_id: string
  email: string | null
  display_name: string
  avatar_url: string | null
  status: 'imported_placeholder' | 'invited' | 'accepted'
  project_role: ProjectRole
  job_title: string
  department: string
  locale: Locale
  created_at: string
  updated_at: string
}

export interface JiraProjectInfo {
  id: string
  key: string
  name: string
  description: string
}

export interface JiraBoardInfo {
  id: string
  name: string
  type: string
}

export interface JiraSavedConnection {
  connection_id: string
  jira_site_url: string
  email: string | null
  display_name: string | null
  status: 'active' | 'expired' | 'revoked'
  last_sync_at: string | null
  token_saved: boolean
}

export interface JiraImportPreferences {
  connection_id: string
  local_project_id: string | null
  last_jira_project_key: string | null
  last_jira_board_id: string | null
  include_attachments: boolean
  include_completed_sprints: boolean
  include_comments: boolean
  max_attachment_size_mb: number
  skip_attachments_over_limit: boolean
  import_users: boolean
}
