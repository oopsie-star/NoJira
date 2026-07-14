import type { JiraUserPlaceholder, Profile, Task } from '@/types'

export type AvatarPerson = Pick<Profile, 'full_name' | 'email' | 'avatar_url'>

/** Render an imported Jira placeholder with the same shape UserAvatar expects. */
export function placeholderAsPerson(placeholder: JiraUserPlaceholder): AvatarPerson {
  return {
    full_name: placeholder.display_name,
    email: placeholder.email ?? '',
    avatar_url: placeholder.avatar_url,
  }
}

function resolve(
  realProfile: Profile | null | undefined,
  placeholderId: string | null | undefined,
  placeholders: JiraUserPlaceholder[],
): { person: AvatarPerson; imported: boolean } | null {
  if (realProfile) return { person: realProfile, imported: false }
  if (placeholderId) {
    const match = placeholders.find((p) => p.id === placeholderId)
    if (match) return { person: placeholderAsPerson(match), imported: true }
  }
  return null
}

export function taskAssigneeDisplay(task: Task, placeholders: JiraUserPlaceholder[]) {
  return resolve(task.assignee, task.assignee_placeholder_id, placeholders)
}

export function taskReporterDisplay(task: Task, placeholders: JiraUserPlaceholder[]) {
  return resolve(task.reporter, task.reporter_placeholder_id, placeholders)
}

/** Resolve a person id (real member or Jira placeholder) to an avatar person. */
export function personById(
  id: string,
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
): { person: AvatarPerson; label: string; imported: boolean } | null {
  const member = members.find((m) => m.id === id)
  if (member) return { person: member, label: member.full_name || member.email, imported: false }
  const placeholder = placeholders.find((p) => p.id === id)
  if (placeholder) return { person: placeholderAsPerson(placeholder), label: placeholder.display_name, imported: true }
  return null
}

/**
 * Split a picked assignee list (real members + Jira placeholders, mixed uuids)
 * into the columns the tasks table expects. assignee_ids holds the full list for
 * a universal task (2+); the primary assignee_id / assignee_placeholder_id keep
 * single-avatar displays and status logic working.
 */
export function resolveAssigneeFields(
  ids: string[],
  members: Profile[],
  placeholders: JiraUserPlaceholder[],
): { assignee_id: string | null; assignee_placeholder_id: string | null; assignee_ids: string[] } {
  const memberIds = ids.filter((id) => members.some((m) => m.id === id))
  const placeholderIds = ids.filter((id) => placeholders.some((p) => p.id === id))
  return {
    assignee_id: memberIds[0] ?? null,
    assignee_placeholder_id: memberIds.length ? null : (placeholderIds[0] ?? null),
    assignee_ids: ids.length >= 2 ? ids : [],
  }
}
