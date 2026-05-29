import { useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import { Plus } from 'lucide-react'
import { TaskCard } from './TaskCard'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useI18n } from '@/lib/i18n'
import type { Task, TaskStatus } from '@/types'

interface KanbanColumnProps {
  status: TaskStatus
  tasks: Task[]
  sprintId: string | null
}

export function KanbanColumn({ status, tasks, sprintId }: KanbanColumnProps) {
  const { t } = useI18n()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <section className="flex min-h-0 w-[80vw] max-w-[320px] flex-shrink-0 flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm sm:w-[300px] lg:w-[340px] lg:max-w-none">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t(`status.${status}`)}</p>
            <p className="text-xs text-slate-500">{t('kanban.issues', { count: tasks.length })}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-xl bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
          >
            <Plus size={16} />
          </button>
        </div>

        <Droppable droppableId={status}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={[
                'min-h-0 flex-1 space-y-3 overflow-y-auto p-4 transition',
                snapshot.isDraggingOver ? 'bg-qira-pistachio-lt/60' : 'bg-slate-50/80',
              ].join(' ')}
            >
              {tasks.map((task, index) => (
                <TaskCard key={task.id} task={task} index={index} />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </section>

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          initialValues={{ sprint_id: sprintId, status }}
        />
      )}
    </>
  )
}
