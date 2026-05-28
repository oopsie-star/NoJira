import { useMemo, useState } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { KanbanColumn } from './KanbanColumn'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'
import { STATUS_COLUMNS, type TaskStatus } from '@/types'

export function KanbanBoard() {
  const tasks = useStore((state) => state.tasks)
  const epics = useStore((state) => state.epics)
  const members = useStore((state) => state.members)
  const activeSprintId = useStore((state) => state.activeSprintId)
  const moveTask = useStore((state) => state.moveTask)
  const { t } = useI18n()

  const [search, setSearch] = useState('')
  const [epicFilter, setEpicFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
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
      return matchesQuery && matchesEpic && matchesAssignee
    })
  }, [tasks, search, epicFilter, assigneeFilter])

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
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('board.searchPlaceholder')}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
          />

          <select
            value={epicFilter}
            onChange={(event) => setEpicFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
          >
            <option value="">{t('board.epicFilter')} — {t('common.all')}</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>{epic.title}</option>
            ))}
          </select>

          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
          >
            <option value="">{t('board.assigneeFilter')} — {t('common.all')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto px-6 py-6">
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
