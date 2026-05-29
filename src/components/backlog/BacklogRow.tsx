import { Draggable } from '@hello-pangea/dnd'
import { Calendar, CircleAlert, Paperclip } from 'lucide-react'
import { IssueTypeBadge, PriorityBadge } from '@/components/common/IssueBadges'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { formatStatusAge, isTaskBlocked } from '@/lib/ops'
import { useStore } from '@/store'
import type { Task } from '@/types'

interface BacklogRowProps {
  task: Task
  index: number
}

export function BacklogRow({ task, index }: BacklogRowProps) {
  const { locale, t } = useI18n()
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const tasks = useStore((state) => state.tasks)
  const taskLinks = useStore((state) => state.taskLinks)
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
            'grid cursor-pointer grid-cols-[minmax(0,1fr)_32px] items-center gap-3 border-b border-slate-200 px-4 py-3 text-sm transition sm:grid-cols-[minmax(0,1.35fr)_110px_110px_110px_70px_40px]',
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
             <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
               {task.labels.length > 0 && <span className="truncate">{task.labels.join(', ')}</span>}
               <span>{t('board.daysInStatus', { days: formatStatusAge(locale, task) })}</span>
               {blocked && (
                 <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700">
                   <CircleAlert size={12} />
                   {t('board.blocked')}
                 </span>
               )}
             </div>
           </div>

          <div className="hidden sm:block">
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

          <div className="hidden sm:block">
            <PriorityBadge priority={task.priority} />
          </div>

          <div className="hidden text-sm text-slate-500 sm:block">
            {task.due_date ? (
              <span className="inline-flex items-center gap-1">
                <Calendar size={14} />
                {formatDate(locale, task.due_date)}
              </span>
            ) : '—'}
          </div>

          <div className="hidden text-sm text-slate-500 sm:block">
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
