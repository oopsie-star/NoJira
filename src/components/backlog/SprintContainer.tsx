import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Droppable } from '@hello-pangea/dnd'
import { BacklogRow } from './BacklogRow'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useAuthContext } from '@/auth/AuthContext'
import { useI18n } from '@/lib/i18n'
import { canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import type { Sprint, Task } from '@/types'

interface SprintContainerProps {
  sprint: Sprint
  tasks: Task[]
}

export function SprintContainer({ sprint, tasks }: SprintContainerProps) {
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const epics = useStore((state) => state.epics)
  const updateSprint = useStore((state) => state.updateSprint)
  const startSprint = useStore((state) => state.startSprint)
  const completeSprint = useStore((state) => state.completeSprint)
  const deleteSprint = useStore((state) => state.deleteSprint)
  const requestEntityDeletion = useStore((state) => state.requestEntityDeletion)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const [collapsed, setCollapsed] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [requestingDelete, setRequestingDelete] = useState(false)
  const [deletingSprint, setDeletingSprint] = useState(false)

  const doneCount = useMemo(
    () => tasks.filter((task) => task.status === 'done').length,
    [tasks]
  )
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
  const canManageSprint = canManageProject(activeProjectRole)
  const isSuperAdmin = profile?.role === 'admin'

  async function handleDeleteSprint() {
    if (!window.confirm(t('backlog.deleteSprintConfirm', { name: sprint.name }))) return
    setDeletingSprint(true)
    try {
      await deleteSprint(sprint.id)
    } finally {
      setDeletingSprint(false)
    }
  }

  async function handleRequestDeleteSprint() {
    setRequestingDelete(true)
    try {
      await requestEntityDeletion('sprint', sprint.id, sprint.name)
    } finally {
      setRequestingDelete(false)
    }
  }

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
                    : 'bg-blue-100 text-qira-pistachio',
              ].join(' ')}>
                {t(`common.status.${sprint.status}`)}
              </span>
              {sprint.epic_id && (
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                  {epics.find((epic) => epic.id === sprint.epic_id)?.title ?? t('task.epic')}
                </span>
              )}
              <span className="text-sm text-slate-500">{t('backlog.issueCount', { count: tasks.length })}</span>
            </div>
            {sprint.goal && (
              <p className="mt-2 break-words text-sm text-slate-500">
                <span className="font-semibold text-slate-700">{t('backlog.goal')}:</span> {sprint.goal}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="h-2 w-full max-w-44 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-sm text-slate-500">{t('backlog.progress')}: {progress}%</span>
            </div>
            {canManageSprint && (
              <div className="mt-3 max-w-sm">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t('backlog.parentEpic')}
                </label>
                <select
                  value={sprint.epic_id ?? ''}
                  onChange={(event) => void updateSprint(sprint.id, { epic_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                >
                  <option value="">{t('common.none')}</option>
                  {epics.map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.key} — {epic.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
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
                className="rounded-xl bg-qira-pistachio px-3 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
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

            {isSuperAdmin ? (
              <button
                type="button"
                onClick={() => void handleDeleteSprint()}
                disabled={deletingSprint}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <Trash2 size={15} />
                {t('backlog.deleteSprint')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRequestDeleteSprint()}
                disabled={requestingDelete}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                <ShieldAlert size={15} />
                {requestingDelete ? t('backlog.deletionRequestSending') : t('backlog.requestDelete')}
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
                className={[
                  'space-y-3 p-3',
                  snapshot.isDraggingOver ? 'bg-qira-pistachio-lt/40' : 'bg-white',
                ].join(' ')}
              >
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
