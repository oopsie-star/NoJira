import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Droppable } from '@hello-pangea/dnd'
import { BacklogRow } from './BacklogRow'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useI18n } from '@/lib/i18n'
import { canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import type { Sprint, Task } from '@/types'

interface SprintContainerProps {
  sprint: Sprint
  tasks: Task[]
}

export function SprintContainer({ sprint, tasks }: SprintContainerProps) {
  const { t } = useI18n()
  const startSprint = useStore((state) => state.startSprint)
  const completeSprint = useStore((state) => state.completeSprint)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const [collapsed, setCollapsed] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const doneCount = useMemo(
    () => tasks.filter((task) => task.status === 'done').length,
    [tasks]
  )
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
  const canManageSprint = canManageProject(activeProjectRole)

  return (
    <>
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 px-5 py-3.5">
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="mt-1 rounded-xl p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{sprint.name}</h2>
              <span className={[
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                sprint.status === 'active'
                  ? 'bg-emerald-100 text-emerald-700'
                  : sprint.status === 'completed'
                    ? 'bg-slate-200 text-slate-600'
                    : 'bg-blue-100 text-jira-blue',
              ].join(' ')}>
                {t(`common.status.${sprint.status}`)}
              </span>
              <span className="text-sm text-slate-500">{t('backlog.issueCount', { count: tasks.length })}</span>
            </div>
            {sprint.goal && (
              <p className="mt-2 text-sm text-slate-500">
                <span className="font-semibold text-slate-700">{t('backlog.goal')}:</span> {sprint.goal}
              </p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 w-44 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-sm text-slate-500">{t('backlog.progress')}: {progress}%</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              <Plus size={16} />
              {t('backlog.createIssue')}
            </button>

            {canManageSprint && sprint.status === 'planned' && (
              <button
                onClick={() => startSprint(sprint.id)}
                className="rounded-xl bg-jira-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-jira-blue-dk"
              >
                {t('backlog.startSprint')}
              </button>
            )}

            {canManageSprint && sprint.status === 'active' && (
              <button
                onClick={() => completeSprint(sprint.id)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                {t('backlog.completeSprint')}
              </button>
            )}
          </div>
        </div>

        {!collapsed && (
          <Droppable droppableId={`sprint-${sprint.id}`} type="BACKLOG_TASK">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={snapshot.isDraggingOver ? 'bg-jira-blue-lt/40' : 'bg-white'}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[minmax(0,1.35fr)_110px_110px_110px_70px_40px]">
                  <span>{t('task.summary')}</span>
                  <span className="hidden sm:block">{t('task.status')}</span>
                  <span className="hidden sm:block">{t('task.priority')}</span>
                  <span className="hidden sm:block">{t('task.dueDate')}</span>
                  <span className="hidden sm:block">{t('task.attachments')}</span>
                  <span>{t('task.assignee')}</span>
                </div>
                {tasks.map((task, index) => (
                  <BacklogRow key={task.id} task={task} index={index} />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        )}
      </section>

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          initialValues={{ sprint_id: sprint.id }}
        />
      )}
    </>
  )
}
