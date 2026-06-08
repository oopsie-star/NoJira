import { useMemo } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { KanbanColumn } from './KanbanColumn'
import { useStore } from '@/store'
import { STATUS_COLUMNS, type TaskStatus } from '@/types'

export function KanbanBoard() {
  const tasks = useStore((state) => state.tasks)
  const activeSprintId = useStore((state) => state.activeSprintId)
  const moveTask = useStore((state) => state.moveTask)

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !task.parent_task_id),
    [tasks]
  )

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
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 py-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full gap-5">
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
