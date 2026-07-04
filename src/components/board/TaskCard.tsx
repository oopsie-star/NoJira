import { Draggable } from '@hello-pangea/dnd'
import { Calendar, CircleAlert, Flame, Paperclip } from 'lucide-react'
import { StatusBadge } from '@/components/common/IssueBadges'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { isTaskBlocked } from '@/lib/ops'
import { taskAssigneeDisplay } from '@/lib/people'
import { useStore } from '@/store'
import { isTerminalStatus, type Task } from '@/types'

interface TaskCardProps {
  task: Task
  index: number
}

export function TaskCard({ task, index }: TaskCardProps) {
  const { locale } = useI18n()
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const tasks = useStore((state) => state.tasks)
  const taskLinks = useStore((state) => state.taskLinks)
  const placeholders = useStore((state) => state.placeholders)
  const assignee = taskAssigneeDisplay(task, placeholders)
  const blocked = isTaskBlocked(task.id, taskLinks, tasks)
  const highPriority = task.priority === 'high' || task.priority === 'highest'

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => setOpenTaskId(task.id)}
          className={[
            'cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition',
            snapshot.isDragging ? 'rotate-[1deg] shadow-xl' : 'hover:border-slate-300 hover:shadow-md',
          ].join(' ')}
        >
          {isTerminalStatus(task.status) && (
            <div className="mb-1.5"><StatusBadge status={task.status} /></div>
          )}

          {task.epic && (
            <div className="mb-1 flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.epic.color }} />
              <span className="truncate text-[11px] font-semibold" style={{ color: task.epic.color }}>{task.epic.title}</span>
            </div>
          )}

          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{task.title}</h3>

          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide text-slate-400">{task.key}</span>
              {highPriority && (
                <Flame size={13} className="shrink-0 text-orange-500" />
              )}
              {blocked && (
                <CircleAlert size={13} className="shrink-0 text-rose-500" />
              )}
              {task.due_date && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(locale, task.due_date)}
                </span>
              )}
              {task.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Paperclip size={12} />
                  {task.attachments.length}
                </span>
              )}
            </div>

            <UserAvatar profile={assignee?.person} size={24} muted={!assignee} />
          </div>
        </div>
      )}
    </Draggable>
  )
}
