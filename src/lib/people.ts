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
