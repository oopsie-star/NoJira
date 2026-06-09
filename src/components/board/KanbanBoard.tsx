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
  const taskLinks = useStore((state) => state.taskLinks)
  const profileId = useStore((state) => state.profile?.id ?? null)
  const activeSprintId = useStore((state) => state.activeSprintId)
  const moveTask = useStore((state) => state.moveTask)
  const { t } = useI18n()

  const [quickFilters, setQuickFilters] = useState<string[]>([])

  const quickFilterOptions = [
    { id: 'blocked', label: t('board.quick.blocked') },
    { id: 'mine', label: t('board.quick.me') },
    { id: 'high', label: t('board.quick.high') },
    { id: 'bugs', label: t('board.quick.bugs') },
    { id: 'dueSoon', label: t('board.quick.dueSoon') },
    { id: 'unassigned', label: t('board.quick.unassigned') },
  ] as const

  const visibleTasks = useMemo(() => {
    // In a specific sprint: show ALL sprint tasks — subtasks are valid work items
    // and their parent may be in the backlog or a different sprint.
    // In all-sprints / kanban mode: show only top-level tasks to avoid duplication.
    const isSpecificSprint = activeSprintId && activeSprintId !== 'all'
    let result = tasks.filter((task) => isSpecificSprint || !task.parent_task_id)

    for (const filterId of quickFilters) {
      if (filterId === 'blocked') result = result.filter((t) => isTaskBlocked(t.id, taskLinks, tasks))
      else if (filterId === 'mine') result = result.filter((t) => Boolean(profileId && t.assignee_id === profileId))
      else if (filterId === 'high') result = result.filter((t) => t.priority === 'high' || t.priority === 'highest')
      else if (filterId === 'bugs') result = result.filter((t) => t.issue_type === 'bug')
      else if (filterId === 'dueSoon') result = result.filter((t) => Boolean(
        t.due_date && t.status !== 'done' && new Date(t.due_date).getTime() - Date.now() <= DUE_SOON_MS
      ))
      else if (filterId === 'unassigned') result = result.filter((t) => !t.assignee_id)
    }

    return result
  }, [tasks, taskLinks, profileId, activeSprintId, quickFilters])

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
      map[status] = map[status].slice().sort((a, b) => a.position - b.position)
    }

    return map
  }, [visibleTasks])

  function toggleFilter(id: string) {
    setQuickFilters((prev) => prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id])
  }

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return
    moveTask(draggableId, destination.droppableId as TaskStatus, destination.index)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Compact quick-filter strip */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-100 px-4 py-2">
        {quickFilterOptions.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => toggleFilter(filter.id)}
            className={[
              'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition',
              quickFilters.includes(filter.id)
                ? 'bg-qira-pistachio text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ].join(' ')}
          >
            {filter.label}
          </button>
        ))}
        {quickFilters.length > 0 && (
          <button
            type="button"
            onClick={() => setQuickFilters([])}
            className="shrink-0 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-700"
          >
            {t('board.quick.clear')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 snap-x snap-proximity overflow-x-auto overflow-y-hidden px-3 py-3 sm:snap-none sm:px-4 sm:py-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full gap-3 sm:gap-4">
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
