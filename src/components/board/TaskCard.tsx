import { useMemo, useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { Calendar, ChevronDown, ChevronRight, CircleAlert, CornerDownRight, Flame, ListTree, Paperclip, Users } from 'lucide-react'
import { StatusBadge } from '@/components/common/IssueBadges'
import { AssigneeAvatars } from '@/components/common/AssigneeAvatars'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { isTaskBlocked } from '@/lib/ops'
import { canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import { isTerminalStatus, isUniversalTask, type Task, type TaskStatus } from '@/types'

// A board column is ~250px wide, so the subtask rows carry a status dot with a
// tooltip rather than the full StatusBadge the (much wider) backlog row uses.
const subtaskStatusDot: Record<TaskStatus, string> = {
  todo: 'bg-slate-300',
  in_progress: 'bg-qira-pistachio',
  done: 'bg-emerald-500',
  cancelled: 'bg-amber-400',
  archived: 'bg-slate-300',
  deleted: 'bg-rose-400',
}

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
  const members = useStore((state) => state.members)
  const profileRole = useStore((state) => state.profile?.role)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const blocked = isTaskBlocked(task.id, taskLinks, tasks)
  const highPriority = task.priority === 'high' || task.priority === 'highest'
  const universal = isUniversalTask(task)
  const canManage = canManageProject(activeProjectRole, profileRole === 'admin')
  // Universal tasks: only admins may drag (dragging changes status).
  const dragLocked = universal && !canManage

  // The board used to say nothing about subtasks, so work added under a task was
  // invisible here and the card still read as the task's whole story. Roll them
  // up on the card instead: a done/total tally that expands into the actual
  // list — the same shape the backlog row already uses.
  const subtasks = useMemo(
    () => tasks
      .filter((candidate) => candidate.parent_task_id === task.id && !isTerminalStatus(candidate.status))
      .sort((left, right) => left.position - right.position),
    [tasks, task.id]
  )
  const doneSubtasks = useMemo(
    () => subtasks.filter((subtask) => subtask.status === 'done').length,
    [subtasks]
  )
  const [subtasksExpanded, setSubtasksExpanded] = useState(false)

  // This card may itself be a subtask (a subtask can sit in the sprint while its
  // parent lives in the backlog) — name the parent so the card doesn't read as a
  // stray top-level task.
  const parentTask = useMemo(
    () => (task.parent_task_id ? tasks.find((candidate) => candidate.id === task.parent_task_id) ?? null : null),
    [tasks, task.parent_task_id]
  )

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={dragLocked}>
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

          {task.parent_task_id && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                if (parentTask) setOpenTaskId(parentTask.id)
              }}
              disabled={!parentTask}
              className="mb-1 inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition enabled:hover:bg-slate-200 disabled:cursor-default"
            >
              <CornerDownRight size={10} className="shrink-0" />
              <span className="truncate">
                {t('board.subtaskOf')}{parentTask ? ` ${parentTask.key}` : ''}
              </span>
            </button>
          )}

          {task.epic && (
            <div className="mb-1 flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.epic.color }} />
              <span className="truncate text-[11px] font-semibold" style={{ color: task.epic.color }}>{task.epic.title}</span>
            </div>
          )}

          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{task.title}</h3>

          {subtasks.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setSubtasksExpanded((value) => !value)
              }}
              aria-expanded={subtasksExpanded}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200"
            >
              {subtasksExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <ListTree size={11} />
              {t('board.subtaskProgress', { done: doneSubtasks, total: subtasks.length })}
            </button>
          )}

          {subtasksExpanded && subtasks.length > 0 && (
            <div className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-2">
              {subtasks.map((subtask) => (
                <button
                  key={subtask.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpenTaskId(subtask.id)
                  }}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition hover:bg-slate-50"
                >
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                    {subtask.key}
                  </span>
                  <span className={[
                    'min-w-0 flex-1 truncate text-[11px]',
                    subtask.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700',
                  ].join(' ')}>
                    {subtask.title}
                  </span>
                  <span
                    title={t(`status.${subtask.status}`)}
                    aria-label={t(`status.${subtask.status}`)}
                    className={`h-2 w-2 shrink-0 rounded-full ${subtaskStatusDot[subtask.status]}`}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide text-slate-400">{task.key}</span>
              {universal && (
                <Users size={13} className="shrink-0 text-slate-500" />
              )}
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

            <AssigneeAvatars task={task} members={members} placeholders={placeholders} size={24} />
          </div>
        </div>
      )}
    </Draggable>
  )
}
