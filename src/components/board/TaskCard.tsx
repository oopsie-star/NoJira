import { Draggable } from '@hello-pangea/dnd'
import { Calendar, CircleAlert, Paperclip } from 'lucide-react'
import { IssueTypeBadge, PriorityBadge } from '@/components/common/IssueBadges'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { formatStatusAge, isTaskBlocked } from '@/lib/ops'
import { taskAssigneeDisplay } from '@/lib/people'
import { useStore } from '@/store'
import type { Task } from '@/types'

interface TaskCardProps {
  task: Task
  index: number
}

export function TaskCard({ task, index }: TaskCardProps) {
  const { locale, t } = useI18n()
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const tasks = useStore((state) => state.tasks)
  const taskLinks = useStore((state) => state.taskLinks)
  const placeholders = useStore((state) => state.placeholders)
  const assignee = taskAssigneeDisplay(task, placeholders)
  const blocked = isTaskBlocked(task.id, taskLinks, tasks)

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => setOpenTaskId(task.id)}
          className={[
            'cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition',
            snapshot.isDragging ? 'rotate-[1deg] shadow-xl' : 'hover:-translate-y-0.5 hover:shadow-md',
          ].join(' ')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <IssueTypeBadge type={task.issue_type} />
            <PriorityBadge priority={task.priority} />
            {task.epic && (
              <span
                className="inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                style={{ backgroundColor: `${task.epic.color}20`, color: task.epic.color }}
              >
                {task.epic.title}
              </span>
            )}
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
              {t('board.daysInStatus', { days: formatStatusAge(locale, task) })}
            </span>
            {blocked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">
                <CircleAlert size={12} />
                {t('board.blocked')}
              </span>
            )}
          </div>

          <h3 className="mt-3 text-[15px] font-semibold leading-6 text-slate-900 sm:text-sm">{task.title}</h3>
          {task.description && (
            <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-500">{task.description}</p>
          )}

          {task.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.labels.slice(0, 3).map((label) => (
                <span key={label} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  {label}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[13px] text-slate-500 sm:text-xs">
              <span className="font-semibold uppercase tracking-[0.12em]">{task.key}</span>
              {task.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Paperclip size={12} />
                  {task.attachments.length}
                </span>
              )}
              {task.due_date && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(locale, task.due_date)}
                </span>
              )}
            </div>

            <UserAvatar profile={assignee?.person} size={28} muted={!assignee} />
          </div>
        </div>
      )}
    </Draggable>
  )
}
