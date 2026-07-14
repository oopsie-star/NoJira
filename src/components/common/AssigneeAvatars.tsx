import { UserAvatar } from './UserAvatar'
import { personById, taskAssigneeDisplay } from '@/lib/people'
import { isUniversalTask, type JiraUserPlaceholder, type Profile, type Task } from '@/types'

interface AssigneeAvatarsProps {
  task: Task
  members: Profile[]
  placeholders: JiraUserPlaceholder[]
  size?: number
}

/** Stacked avatars for a universal task (2+ assignees); single avatar otherwise. */
export function AssigneeAvatars({ task, members, placeholders, size = 24 }: AssigneeAvatarsProps) {
  if (isUniversalTask(task)) {
    const people = task.assignee_ids
      .map((id) => personById(id, members, placeholders))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 3)

    return (
      <div className="flex -space-x-1.5">
        {people.length === 0 ? (
          <UserAvatar profile={null} size={size} muted />
        ) : (
          people.map((entry, idx) => (
            <span key={`${entry.label}-${idx}`} className="rounded-full ring-2 ring-white">
              <UserAvatar profile={entry.person} size={size} />
            </span>
          ))
        )}
      </div>
    )
  }

  const single = taskAssigneeDisplay(task, placeholders)
  return <UserAvatar profile={single?.person} size={size} muted={!single} />
}
