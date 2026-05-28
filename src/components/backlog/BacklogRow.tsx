import { Draggable } from '@hello-pangea/dnd'
import { Calendar, Paperclip } from 'lucide-react'
import { IssueTypeBadge, PriorityBadge } from '@/components/common/IssueBadges'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { useStore } from '@/store'
import type { Task } from '@/types'

interface BacklogRowProps {
  task: Task
  index: number
}

export function BacklogRow({ task, index }: BacklogRowProps) {
  const { locale, t } = useI18n()
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => setOpenTaskId(task.id)}
          className={[
            'grid cursor-pointer grid-cols-[1.3fr_150px_140px_120px_90px_44px] items-center gap-3 border-b border-slate-200 px-4 py-3 text-sm transition',
            snapshot.isDragging ? 'rounded-2xl border border-slate-200 bg-white shadow-xl' : 'bg-white hover:bg-slate-50',
          ].join(' ')}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <IssueTypeBadge type={task.issue_type} />
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{task.key}</span>
              {task.epic && (
                <span
                  className="rounded-full px-2 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: `${task.epic.color}20`, color: task.epic.color }}
                >
                  {task.epic.title}
                </span>
              )}
            </div>
            <p className="mt-2 truncate font-semibold text-slate-900">{task.title}</p>
            {task.labels.length > 0 && (
              <p className="mt-1 truncate text-xs text-slate-500">{task.labels.join(', ')}</p>
            )}
          </div>

          <div>
            <span
              className={[
                'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                task.status === 'done'
                  ? 'bg-emerald-100 text-emerald-700'
                  : task.status === 'in_progress'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-700',
              ].join(' ')}
            >
              {t(`status.${task.status}`)}
            </span>
          </div>

          <div>
            <PriorityBadge priority={task.priority} />
          </div>

          <div className="text-sm text-slate-500">
            {task.due_date ? (
              <span className="inline-flex items-center gap-1">
                <Calendar size={14} />
                {formatDate(locale, task.due_date)}
              </span>
            ) : '—'}
          </div>

          <div className="text-sm text-slate-500">
            {task.attachments.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip size={14} />
                {task.attachments.length}
              </span>
            ) : '—'}
          </div>

          <div className="justify-self-end">
            <UserAvatar profile={task.assignee} size={28} muted={!task.assignee} />
          </div>
        </div>
      )}
    </Draggable>
  )
}
