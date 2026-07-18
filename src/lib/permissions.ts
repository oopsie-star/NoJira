import type { ProjectRole, TaskStatus } from '@/types'

const MANAGE_PROJECT_ROLES: ProjectRole[] = ['owner', 'admin', 'founder', 'ceo']
const OVERRIDE_DELETE_ROLES: ProjectRole[] = ['owner', 'founder', 'ceo']

export function canManageProject(role: ProjectRole | null) {
  return Boolean(role && MANAGE_PROJECT_ROLES.includes(role))
}

export function canInviteToProject(role: ProjectRole | null) {
  // Project managers (owner/admin/founder/ceo) may invite & manage members,
  // matching the can_invite_to_project / can_manage_project checks on the backend.
  return Boolean(role && MANAGE_PROJECT_ROLES.includes(role))
}

export function canOverrideDelete(role: ProjectRole | null) {
  return Boolean(role && OVERRIDE_DELETE_ROLES.includes(role))
}

/** Renaming an epic/sprint/task: project admins, or whoever authored it. */
export function canEditAuthoredContent(
  role: ProjectRole | null,
  currentUserId: string | null | undefined,
  authorId: string | null | undefined
) {
  if (canManageProject(role)) return true
  return Boolean(currentUserId && authorId && currentUserId === authorId)
}

/** Deleting an epic/sprint attachment: project admin, or whoever uploaded it (matches the storage RLS policy). */
export function canDeleteAttachment(
  role: ProjectRole | null,
  currentUserId: string | null | undefined,
  authorId: string | null | undefined
) {
  if (canManageProject(role)) return true
  return Boolean(currentUserId && authorId && currentUserId === authorId)
}

export function canDeleteAuthoredContent(
  role: ProjectRole | null,
  currentUserId: string | null | undefined,
  authorId: string | null | undefined,
  taskStatus: TaskStatus
) {
  if (canOverrideDelete(role)) return true
  return Boolean(currentUserId && authorId && currentUserId === authorId && taskStatus === 'todo')
}
