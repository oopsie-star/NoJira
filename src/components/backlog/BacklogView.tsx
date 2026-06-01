import { useMemo, useState, type FormEvent } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { BacklogRow } from './BacklogRow'
import { SprintContainer } from './SprintContainer'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useAuthContext } from '@/auth/AuthContext'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { EPIC_COLORS, EPIC_STATUS_OPTIONS, type Epic, type Sprint, type Task } from '@/types'
import { useStore } from '@/store'

function CreateSprintModal({
  initialEpicId,
  onClose,
}: {
  initialEpicId?: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const epics = useStore((state) => state.epics)
  const createSprint = useStore((state) => state.createSprint)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [epicId, setEpicId] = useState(initialEpicId ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      await createSprint({
        name: name.trim(),
        goal: goal.trim(),
        epic_id: epicId || null,
        start_date: startDate || null,
        end_date: endDate || null,
      })
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4">
      <form onSubmit={handleSubmit} className="flex w-full max-w-xl flex-col rounded-[28px] bg-white shadow-2xl" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
        <div className="flex-shrink-0 border-b border-slate-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-slate-900">{t('backlog.createSprint')}</h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.name')}</label>
              <input autoFocus autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.goal')}</label>
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.parentEpic')}</label>
              <select
                value={epicId}
                onChange={(event) => setEpicId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
              >
                <option value="">{t('common.none')}</option>
                {epics.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.key} — {epic.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.start')}</label>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.end')}</label>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {error && <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white hover:bg-qira-pistachio-dk">{t('common.create')}</button>
        </div>
      </form>
    </div>
  )
}

function CreateEpicModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const createEpic = useStore((state) => state.createEpic)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(EPIC_COLORS[0])
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setError(null)
    try {
      await createEpic({
        title: title.trim(),
        description: description.trim(),
        color,
        parent_portfolio_item_id: null,
      })
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4">
      <form onSubmit={handleSubmit} className="flex w-full max-w-xl flex-col rounded-[28px] bg-white shadow-2xl" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
        <div className="flex-shrink-0 border-b border-slate-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-slate-900">{t('backlog.createEpic')}</h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.name')}</label>
              <input autoFocus autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.description')}</label>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.epicColor')}</label>
              <div className="flex flex-wrap gap-2">
                {EPIC_COLORS.map((epicColor) => (
                  <button
                    key={epicColor}
                    type="button"
                    onClick={() => setColor(epicColor)}
                    className={['h-9 w-9 rounded-full border-4 transition', color === epicColor ? 'border-slate-300' : 'border-transparent'].join(' ')}
                    style={{ backgroundColor: epicColor }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {error && <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white hover:bg-qira-pistachio-dk">{t('common.create')}</button>
        </div>
      </form>
    </div>
  )
}

function EpicSection({
  epic,
  tasks,
  sprints,
  canEdit,
  onCreateTask,
  onCreateSprint,
}: {
  epic: Epic
  tasks: Task[]
  sprints: Sprint[]
  canEdit: boolean
  onCreateTask: (initialValues?: Partial<Task>) => void
  onCreateSprint: (epicId: string) => void
}) {
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const updateEpic = useStore((state) => state.updateEpic)
  const deleteEpic = useStore((state) => state.deleteEpic)
  const requestEntityDeletion = useStore((state) => state.requestEntityDeletion)
  const [requestingDelete, setRequestingDelete] = useState(false)
  const [deletingEpic, setDeletingEpic] = useState(false)

  const epicSprints = useMemo(
    () => sprints.filter((sprint) => sprint.epic_id === epic.id),
    [epic.id, sprints]
  )
  const sprintIdSet = useMemo(
    () => new Set(epicSprints.map((sprint) => sprint.id)),
    [epicSprints]
  )
  const directTasks = useMemo(
    () => tasks.filter((task) => task.epic_id === epic.id && !task.sprint_id),
    [epic.id, tasks]
  )
  const nestedSprintTasks = useMemo(
    () => tasks.filter((task) => task.sprint_id && sprintIdSet.has(task.sprint_id)),
    [sprintIdSet, tasks]
  )
  const allEpicTasks = useMemo(
    () => [...directTasks, ...nestedSprintTasks],
    [directTasks, nestedSprintTasks]
  )
  const progress = allEpicTasks.length
    ? Math.round((allEpicTasks.filter((task) => task.status === 'done').length / allEpicTasks.length) * 100)
    : 0
  const isSuperAdmin = profile?.role === 'admin'

  async function handleDeleteEpic() {
    if (!window.confirm(t('backlog.deleteEpicConfirm', { name: epic.title }))) return
    setDeletingEpic(true)
    try {
      await deleteEpic(epic.id)
    } finally {
      setDeletingEpic(false)
    }
  }

  async function handleRequestDeleteEpic() {
    setRequestingDelete(true)
    try {
      await requestEntityDeletion('epic', epic.id, `${epic.key} — ${epic.title}`)
    } finally {
      setRequestingDelete(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: epic.color }} />
              <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900">{epic.title}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{epic.key}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {t('backlog.issueCount', { count: allEpicTasks.length })}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {t('backlog.sprintCount', { count: epicSprints.length })}
              </span>
            </div>
            {epic.description && (
              <p className="mt-2 break-words text-sm text-slate-500">{epic.description}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="h-2 w-full max-w-48 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: epic.color }} />
              </div>
              <span className="text-sm text-slate-500">{t('backlog.progress')}: {progress}%</span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto xl:flex-col">
            <select
              value={epic.status}
              disabled={!canEdit}
              onChange={(event) => void updateEpic(epic.id, { status: event.target.value as Epic['status'] })}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio disabled:bg-slate-50"
            >
              {EPIC_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{t(`common.status.${status === 'done' ? 'completed' : status}`)}</option>
              ))}
            </select>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => onCreateTask({ epic_id: epic.id })}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  <Plus size={15} />
                  {t('backlog.createIssue')}
                </button>
                <button
                  type="button"
                  onClick={() => onCreateSprint(epic.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
                >
                  <Plus size={15} />
                  {t('backlog.createSprintInEpic')}
                </button>
              </>
            )}
            {isSuperAdmin ? (
              <button
                type="button"
                onClick={() => void handleDeleteEpic()}
                disabled={deletingEpic}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <Trash2 size={15} />
                {t('backlog.deleteEpic')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRequestDeleteEpic()}
                disabled={requestingDelete}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                <ShieldAlert size={15} />
                {requestingDelete ? t('backlog.deletionRequestSending') : t('backlog.requestDelete')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="rounded-[24px] bg-slate-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.directEpicTasks')}</h3>
              <p className="mt-1 text-sm text-slate-500">{t('backlog.issueCount', { count: directTasks.length })}</p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onCreateTask({ epic_id: epic.id })}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
              >
                {t('backlog.createIssue')}
              </button>
            )}
          </div>

          <Droppable droppableId={`epic-${epic.id}`} type="BACKLOG_TASK">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={[
                  'min-h-[120px] space-y-3 rounded-[20px] border border-dashed border-slate-200 p-3 transition',
                  snapshot.isDraggingOver ? 'border-qira-pistachio bg-qira-pistachio-lt/30' : 'bg-white',
                ].join(' ')}
              >
                {directTasks.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('backlog.noDirectEpicTasks')}</p>
                )}
                {directTasks.map((task, index) => (
                  <BacklogRow key={task.id} task={task} index={index} />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.epicSprints')}</h3>
              <p className="mt-1 text-sm text-slate-500">{t('backlog.sprintCount', { count: epicSprints.length })}</p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onCreateSprint(epic.id)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                {t('backlog.createSprintInEpic')}
              </button>
            )}
          </div>

          {epicSprints.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('backlog.noEpicSprints')}</p>
          ) : (
            epicSprints.map((sprint) => (
              <SprintContainer
                key={sprint.id}
                sprint={sprint}
                tasks={tasks.filter((task) => task.sprint_id === sprint.id)}
              />
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export function BacklogView() {
  const { t } = useI18n()
  const tasks = useStore((state) => state.tasks)
  const sprints = useStore((state) => state.sprints)
  const epics = useStore((state) => state.epics)
  const updateTask = useStore((state) => state.updateTask)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)

  const [search, setSearch] = useState('')
  const [showSprintModal, setShowSprintModal] = useState(false)
  const [showEpicModal, setShowEpicModal] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [taskSeed, setTaskSeed] = useState<Partial<Task> | null>(null)
  const [sprintSeedEpicId, setSprintSeedEpicId] = useState<string | null>(null)

  const canCollaborate = Boolean(activeProjectRole)

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return !query
      ? tasks
      : tasks.filter((task) =>
          [task.key, task.title, task.description, ...task.labels].join(' ').toLowerCase().includes(query)
        )
  }, [tasks, search])

  const rootTasks = useMemo(
    () => filteredTasks.filter((task) => !task.parent_task_id).sort((left, right) => left.position - right.position),
    [filteredTasks]
  )

  const sortedEpics = useMemo(
    () => epics.slice().sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [epics]
  )

  const sortedSprints = useMemo(
    () => sprints.slice().sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [sprints]
  )

  const standaloneSprints = useMemo(
    () => sortedSprints.filter((sprint) => !sprint.epic_id),
    [sortedSprints]
  )

  const backlogTasks = useMemo(
    () => rootTasks.filter((task) => !task.sprint_id && !task.epic_id),
    [rootTasks]
  )

  function openTaskModal(initialValues?: Partial<Task>) {
    setTaskSeed(initialValues ?? null)
    setShowCreateTask(true)
  }

  function openSprintModal(initialEpicId?: string | null) {
    setSprintSeedEpicId(initialEpicId ?? null)
    setShowSprintModal(true)
  }

  function closeTaskModal() {
    setShowCreateTask(false)
    setTaskSeed(null)
  }

  function closeSprintModal() {
    setShowSprintModal(false)
    setSprintSeedEpicId(null)
  }

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const sprintMatch = destination.droppableId.match(/^sprint-(.+)$/)
    if (sprintMatch) {
      void updateTask(draggableId, { sprint_id: sprintMatch[1] })
      return
    }

    const epicMatch = destination.droppableId.match(/^epic-(.+)$/)
    if (epicMatch) {
      void updateTask(draggableId, {
        sprint_id: null,
        epic_id: epicMatch[1],
      })
      return
    }

    if (destination.droppableId === 'backlog') {
      void updateTask(draggableId, {
        sprint_id: null,
        epic_id: null,
      })
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex min-h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <section className="shrink-0 rounded-[28px] bg-white px-4 py-3 shadow-sm sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('backlog.searchPlaceholder')}
                  className="min-w-[140px] flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                />
                <span className="hidden rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 sm:block">
                  {t('backlog.issueCount', { count: rootTasks.length })}
                </span>
                <button onClick={() => openTaskModal()} className="inline-flex items-center gap-1.5 rounded-2xl bg-qira-pistachio px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk">
                  <Plus size={15} />
                  {t('backlog.createIssue')}
                </button>
                {canCollaborate && (
                  <>
                    <button onClick={() => openSprintModal()} className="rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">{t('backlog.createSprint')}</button>
                    <button onClick={() => setShowEpicModal(true)} className="rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">{t('backlog.createEpic')}</button>
                  </>
                )}
              </div>
            </section>

            <div className="grid min-h-0 flex-1 gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
              <section className="min-h-0 space-y-4">
                <div className="rounded-[28px] bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{t('backlog.epicHierarchy')}</h2>
                      <p className="mt-1 text-sm text-slate-500">{t('backlog.epicHierarchyHint')}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                      {sortedEpics.length}
                    </span>
                  </div>
                </div>

                {sortedEpics.length === 0 ? (
                  <section className="rounded-[28px] bg-white p-8 text-sm text-slate-500 shadow-sm">
                    {t('backlog.noEpicHierarchy')}
                  </section>
                ) : (
                  sortedEpics.map((epic) => (
                    <EpicSection
                      key={epic.id}
                      epic={epic}
                      tasks={rootTasks}
                      sprints={sortedSprints}
                      canEdit={canCollaborate}
                      onCreateTask={openTaskModal}
                      onCreateSprint={openSprintModal}
                    />
                  ))
                )}
              </section>

              <div className="min-h-0 space-y-4">
                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{t('backlog.standaloneSprints')}</h2>
                      <p className="mt-1 text-sm text-slate-500">{t('backlog.sprintCount', { count: standaloneSprints.length })}</p>
                    </div>
                    {canCollaborate && (
                      <button
                        type="button"
                        onClick={() => openSprintModal()}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        {t('backlog.createSprint')}
                      </button>
                    )}
                  </div>

                  <div className="space-y-4 p-4">
                    {standaloneSprints.length === 0 ? (
                      <p className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('backlog.noStandaloneSprints')}</p>
                    ) : (
                      standaloneSprints.map((sprint) => (
                        <SprintContainer
                          key={sprint.id}
                          sprint={sprint}
                          tasks={rootTasks.filter((task) => task.sprint_id === sprint.id)}
                        />
                      ))
                    )}
                  </div>
                </section>

                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{t('backlog.unplanned')}</h2>
                      <p className="text-sm text-slate-500">{t('backlog.issueCount', { count: backlogTasks.length })}</p>
                    </div>
                  </div>

                  <Droppable droppableId="backlog" type="BACKLOG_TASK">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={[
                          'space-y-3 p-3',
                          snapshot.isDraggingOver ? 'bg-qira-pistachio-lt/40' : 'bg-white',
                        ].join(' ')}
                      >
                        {backlogTasks.length === 0 && (
                          <p className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('backlog.noBacklogTasks')}</p>
                        )}
                        {backlogTasks.map((task, index) => (
                          <BacklogRow key={task.id} task={task} index={index} />
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </section>
              </div>
            </div>
          </>
        )}
      </div>

      {showSprintModal && <CreateSprintModal initialEpicId={sprintSeedEpicId} onClose={closeSprintModal} />}
      {showEpicModal && <CreateEpicModal onClose={() => setShowEpicModal(false)} />}
      {showCreateTask && <CreateTaskModal onClose={closeTaskModal} initialValues={taskSeed ?? undefined} />}
    </DragDropContext>
  )
}
