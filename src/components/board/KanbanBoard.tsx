import { useMemo, useState } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { KanbanColumn } from './KanbanColumn'
import { useI18n } from '@/lib/i18n'
import { isTaskBlocked } from '@/lib/ops'
import { useStore } from '@/store'
import { STATUS_COLUMNS, type TaskStatus } from '@/types'

const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000

export function KanbanBoard() {
  const tasks = useStore((state) => state.tasks)
  const epics = useStore((state) => state.epics)
  const members = useStore((state) => state.members)
  const profileId = useStore((state) => state.profile?.id ?? null)
  const taskLinks = useStore((state) => state.taskLinks)
  const activeSprintId = useStore((state) => state.activeSprintId)
  const moveTask = useStore((state) => state.moveTask)
  const { t } = useI18n()

  const [search, setSearch] = useState('')
  const [epicFilter, setEpicFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [quickFilters, setQuickFilters] = useState<string[]>([])

  const quickFilterMap = useMemo(() => ({
    mine: (task: typeof tasks[number]) => Boolean(profileId && task.assignee_id === profileId),
    blocked: (task: typeof tasks[number]) => isTaskBlocked(task.id, taskLinks, tasks),
    bugs: (task: typeof tasks[number]) => task.issue_type === 'bug',
    high: (task: typeof tasks[number]) => task.priority === 'high' || task.priority === 'highest',
    dueSoon: (task: typeof tasks[number]) => Boolean(
      task.due_date
      && task.status !== 'done'
      && new Date(task.due_date).getTime() - Date.now() <= DUE_SOON_MS
    ),
    unassigned: (task: typeof tasks[number]) => !task.assignee_id,
  }), [profileId, taskLinks, tasks])

  const quickFilterOptions = [
    { id: 'mine', label: t('board.quick.me') },
    { id: 'blocked', label: t('board.quick.blocked') },
    { id: 'bugs', label: t('board.quick.bugs') },
    { id: 'high', label: t('board.quick.high') },
    { id: 'dueSoon', label: t('board.quick.dueSoon') },
    { id: 'unassigned', label: t('board.quick.unassigned') },
  ] as const

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    const activeQuickFilters = quickFilters.map((filterId) => quickFilterMap[filterId as keyof typeof quickFilterMap]).filter(Boolean)

    return tasks.filter((task) => {
      if (task.parent_task_id) return false

      const matchesQuery = !query || [
        task.key,
        task.title,
        task.description,
        ...task.labels,
      ].join(' ').toLowerCase().includes(query)

      const matchesEpic = !epicFilter || task.epic_id === epicFilter
      const matchesAssignee = !assigneeFilter || task.assignee_id === assigneeFilter
      const matchesQuickFilters = activeQuickFilters.every((predicate) => predicate(task))
      return matchesQuery && matchesEpic && matchesAssignee && matchesQuickFilters
    })
  }, [assigneeFilter, epicFilter, quickFilterMap, quickFilters, search, tasks])

  const columns = useMemo(() => {
    const map: Record<TaskStatus, typeof visibleTasks> = {
      todo: [],
      in_progress: [],
      done: [],
    }

    for (const task of visibleTasks) {
      map[task.status].push(task)
    }

    for (const status of STATUS_COLUMNS) {
      map[status] = map[status].slice().sort((left, right) => left.position - right.position)
    }

    return map
  }, [visibleTasks])

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return
    }

    moveTask(draggableId, destination.droppableId as TaskStatus, destination.index)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex gap-2 sm:grid sm:grid-cols-[1.4fr_1fr_1fr]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('board.searchPlaceholder')}
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-jira-blue sm:px-4 sm:py-3"
          />

          <select
            value={epicFilter}
            onChange={(event) => setEpicFilter(event.target.value)}
            className="hidden rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue sm:block"
          >
            <option value="">{t('board.epicFilter')} — {t('common.all')}</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>{epic.title}</option>
            ))}
          </select>

          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="hidden rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue sm:block"
          >
            <option value="">{t('board.assigneeFilter')} — {t('common.all')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5 sm:mt-3 sm:flex-wrap">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('board.quickFilters')}</span>
          {quickFilterOptions.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setQuickFilters((current) => (
                current.includes(filter.id)
                  ? current.filter((value) => value !== filter.id)
                  : [...current, filter.id]
              ))}
              className={[
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                quickFilters.includes(filter.id) ? 'bg-jira-blue text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
              ].join(' ')}
            >
              {filter.label}
            </button>
          ))}
          {quickFilters.length > 0 && (
            <button
              type="button"
              onClick={() => setQuickFilters([])}
              className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
            >
              {t('board.quick.clear')}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto px-4 py-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex min-h-full gap-5">
            {STATUS_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={columns[status]}
                sprintId={activeSprintId}
              />
            ))}
          </div>
        </DragDropContext>
      </div>
    </div>
  )
}
