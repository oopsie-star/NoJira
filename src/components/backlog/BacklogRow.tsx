import { useMemo, useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { AlertTriangle, BookOpenText, Calendar, CheckSquare, ChevronDown, ChevronRight, CircleAlert, Code2, FlaskConical, GripVertical, History, ListTree, MoreHorizontal, Music, Paperclip, Palette, Server, Sparkles, Target } from 'lucide-react'
import { PriorityBadge, StatusBadge } from '@/components/common/IssueBadges'
import { AssigneeAvatars } from '@/components/common/AssigneeAvatars'
import { previewKind } from '@/lib/attachments'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { DISCIPLINE_LABELS, taskDisciplines, type Discipline } from '@/lib/discipline'
import { getSupersededByLink, isFreshTask, isSuperseded, isTaskBlocked } from '@/lib/ops'
import { useStore } from '@/store'
import { isUniversalTask, type IssueType, type Task } from '@/types'

const disciplineIconAndClasses: Record<Discipline, { icon: typeof Target; className: string }> = {
  product: { icon: Target, className: 'bg-violet-100 text-violet-700' },
  design: { icon: Palette, className: 'bg-pink-100 text-pink-700' },
  backend: { icon: Server, className: 'bg-amber-100 text-amber-700' },
  frontend: { icon: Code2, className: 'bg-blue-100 text-blue-700' },
  qa: { icon: FlaskConical, className: 'bg-emerald-100 text-emerald-700' },
}

function DisciplineBadges({ disciplines }: { disciplines: Discipline[] }) {
  if (disciplines.length === 0) return null
  return (
    <>
      {disciplines.map((discipline) => {
        const { icon: Icon, className } = disciplineIconAndClasses[discipline]
        return (
          <span
            key={discipline}
            title={DISCIPLINE_LABELS[discipline]}
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${className}`}
          >
            <Icon size={11} />
          </span>
        )
      })}
    </>
  )
}

interface BacklogRowProps {
  task: Task
  index: number
  mobile?: boolean
  dragDisabled?: boolean
  /** Active backlog search text — when set, only subtasks matching it are shown (instead of all of them). */
  searchQuery?: string
}

function matchesSearchText(task: Task, query: string) {
  return [task.key, task.title, task.description, ...task.labels].join(' ').toLowerCase().includes(query)
}

const issueTypeClasses: Record<IssueType, string> = {
  task: 'bg-slate-100 text-slate-700',
  story: 'bg-indigo-100 text-indigo-700',
  bug: 'bg-rose-100 text-rose-700',
}

const agentBadgeClasses: Record<string, string> = {
  claude: 'bg-indigo-100 text-indigo-700',
  chatgpt: 'bg-emerald-100 text-emerald-700',
  'qira-assistant': 'bg-qira-pistachio-lt text-qira-pistachio-dk',
}

function IssueTypeIcon({ type }: { type: IssueType }) {
  if (type === 'story') return <BookOpenText size={14} />
  if (type === 'bug') return <AlertTriangle size={14} />
  return <CheckSquare size={14} />
}

export function BacklogRow({ task, index, mobile = false, dragDisabled = false, searchQuery }: BacklogRowProps) {
  const { locale, t } = useI18n()
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const openTaskId = useStore((state) => state.openTaskId)
  const tasks = useStore((state) => state.tasks)
  const taskLinks = useStore((state) => state.taskLinks)
  const placeholders = useStore((state) => state.placeholders)
  const selectedTaskIds = useStore((state) => state.selectedTaskIds)
  const toggleTaskSelection = useStore((state) => state.toggleTaskSelection)
  const members = useStore((state) => state.members)
  const projectMembers = useStore((state) => state.projectMembers)
  const attachmentNotes = useStore((state) => state.attachmentNotes)
  const taskLastAiAgent = useStore((state) => state.taskLastAiAgent)
  const universal = isUniversalTask(task)
  const audioAttachmentCount = useMemo(
    () => task.attachments.filter((path) => previewKind(path, attachmentNotes[path]?.mime_type) === 'audio').length,
    [task.attachments, attachmentNotes],
  )
  const otherAttachmentCount = task.attachments.length - audioAttachmentCount
  // Newly added "To do" work stays highlighted (and pinned to the top) for a week;
  // a task also counts as fresh while it has a subtask created within that window.
  const fresh = isFreshTask(task, tasks)
  const blocked = isTaskBlocked(task.id, taskLinks, tasks)
  const disciplines = useMemo(
    () => taskDisciplines(task, members, placeholders, projectMembers),
    [task, members, placeholders, projectMembers]
  )
  const supersededByLink = getSupersededByLink(task.id, taskLinks)
  const lastAgent = taskLastAiAgent[task.id]
  const isOpen = task.id === openTaskId
  const isSelected = selectedTaskIds.includes(task.id)
  const bulkActive = selectedTaskIds.length > 0
  const searchText = (searchQuery ?? '').trim().toLowerCase()
  const subtasks = useMemo(() => {
    const all = tasks
      .filter((t) => t.parent_task_id === task.id)
      .sort((left, right) => {
        const leftSuperseded = isSuperseded(left.id, taskLinks)
        const rightSuperseded = isSuperseded(right.id, taskLinks)
        if (leftSuperseded !== rightSuperseded) return leftSuperseded ? 1 : -1
        return left.position - right.position
      })
    // A subtask that matched the query is what pulled this parent row into
    // view in the first place — only show the ones that actually match
    // instead of dumping every sibling subtask alongside it.
    return searchText ? all.filter((t) => matchesSearchText(t, searchText)) : all
  }, [tasks, task.id, searchText, taskLinks])
  const subtaskCount = subtasks.length
  const [subtasksExpanded, setSubtasksExpanded] = useState(true)

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={dragDisabled}>
      {(provided, snapshot) => {
        const dragHandleProps = dragDisabled ? undefined : provided.dragHandleProps

        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            className={[
              'group rounded-xl border transition',
              isSelected
                ? 'border-qira-pistachio bg-qira-pistachio-lt/40 ring-1 ring-qira-pistachio/30'
                : isOpen
                  ? 'border-qira-pistachio bg-qira-pistachio-lt/50 ring-1 ring-qira-pistachio/40'
                  : snapshot.isDragging
                    ? 'border-slate-200 bg-white shadow-xl ring-2 ring-qira-pistachio/20'
                    : task.status === 'done'
                      ? 'border-sky-200 bg-sky-50 hover:bg-sky-100/70'
                      : fresh
                        ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100/70'
                        : universal
                          ? 'border-slate-300 bg-slate-100 hover:bg-slate-200/70'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80',
            ].join(' ')}
          >
          <div className={['flex items-start gap-3 px-3 py-2.5', mobile ? 'min-h-[68px]' : 'min-h-[52px]'].join(' ')}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleTaskSelection(task.id)}
              onClick={(event) => event.stopPropagation()}
              aria-label={t('bulk.select')}
              className={[
                'mt-2 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-qira-pistachio focus:ring-qira-pistachio',
                isSelected || bulkActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              ].join(' ')}
            />
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${issueTypeClasses[task.issue_type]}`}>
              <IssueTypeIcon type={task.issue_type} />
            </div>

            <button
              type="button"
              onClick={() => setOpenTaskId(task.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {task.key}
                    </span>
                    <DisciplineBadges disciplines={disciplines} />
                    {!mobile && task.epic && (
                      <span
                        className="truncate rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: `${task.epic.color}20`, color: task.epic.color }}
                      >
                        {task.epic.title}
                      </span>
                    )}
                    <p className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900">
                      {task.title}
                    </p>
                  </div>

                  <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${mobile ? '' : 'pr-2'}`}>
                    {mobile && task.epic && (
                      <span
                        className="truncate rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: `${task.epic.color}20`, color: task.epic.color }}
                      >
                        {task.epic.title}
                      </span>
                    )}
                    <StatusBadge status={task.status} />
                    <PriorityBadge priority={task.priority} />
                    {task.due_date && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                        <Calendar size={11} />
                        {formatDate(locale, task.due_date)}
                      </span>
                    )}
                    {audioAttachmentCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-qira-pistachio-lt px-2 py-1 text-[11px] font-medium text-qira-pistachio-dk">
                        <Music size={11} />
                        {audioAttachmentCount}
                      </span>
                    )}
                    {otherAttachmentCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                        <Paperclip size={11} />
                        {otherAttachmentCount}
                      </span>
                    )}
                    {subtaskCount > 0 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSubtasksExpanded((value) => !value)
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-600 transition hover:bg-indigo-100"
                      >
                        {subtasksExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        <ListTree size={11} />
                        {subtaskCount}
                      </button>
                    )}
                    {blocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700">
                        <CircleAlert size={11} />
                        {t('board.blocked')}
                      </span>
                    )}
                    {supersededByLink && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setOpenTaskId(supersededByLink.source_task_id)
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200"
                      >
                        <History size={11} />
                        {t('board.superseded')}
                        {supersededByLink.source_task && ` → ${supersededByLink.source_task.key}`}
                      </button>
                    )}
                    {lastAgent && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${agentBadgeClasses[lastAgent.agent_name] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        <Sparkles size={11} />
                        {t(`ai.agent.${lastAgent.agent_name}`)}
                      </span>
                    )}
                  </div>
                </div>

                {mobile && (
                  <div className="flex shrink-0 items-center gap-2">
                    <AssigneeAvatars task={task} members={members} placeholders={placeholders} size={28} />
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400">
                      <MoreHorizontal size={15} />
                    </span>
                  </div>
                )}
              </div>
            </button>

            {!mobile && (
              <div className="flex shrink-0 items-center gap-2 pl-2">
                <AssigneeAvatars task={task} members={members} placeholders={placeholders} size={28} />
                {!dragDisabled && (
                  <button
                    type="button"
                    {...(dragHandleProps ?? {})}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-white hover:text-slate-600"
                    aria-label={t('backlog.dragIssue')}
                  >
                    <GripVertical size={16} />
                  </button>
                )}
              </div>
            )}
          </div>

          {subtaskCount > 0 && subtasksExpanded && (
            <div className="space-y-1.5 border-t border-slate-100 px-3 py-2 pl-11">
              {subtasks.map((subtask) => {
                const subtaskSupersededByLink = getSupersededByLink(subtask.id, taskLinks)
                const subtaskLastAgent = taskLastAiAgent[subtask.id]
                return (
                  <button
                    key={subtask.id}
                    type="button"
                    onClick={() => setOpenTaskId(subtask.id)}
                    className={[
                      'flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-100',
                      subtask.id === openTaskId ? 'bg-qira-pistachio-lt/50' : '',
                    ].join(' ')}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                      <IssueTypeIcon type={subtask.issue_type} />
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {subtask.key}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{subtask.title}</span>
                    {subtaskSupersededByLink && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        <History size={10} />
                        {t('board.superseded')}
                      </span>
                    )}
                    {subtaskLastAgent && (
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${agentBadgeClasses[subtaskLastAgent.agent_name] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        <Sparkles size={10} />
                        {t(`ai.agent.${subtaskLastAgent.agent_name}`)}
                      </span>
                    )}
                    <StatusBadge status={subtask.status} />
                  </button>
                )
              })}
            </div>
          )}
          </div>
        )
      }}
    </Draggable>
  )
}
