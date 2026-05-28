import { useMemo, useState, type FormEvent } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Plus } from 'lucide-react'
import { BacklogRow } from './BacklogRow'
import { SprintContainer } from './SprintContainer'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { canManageProject } from '@/lib/permissions'
import { EPIC_COLORS } from '@/types'
import { useStore } from '@/store'

function CreateSprintModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const createSprint = useStore((state) => state.createSprint)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
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
      <form onSubmit={handleSubmit} className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-semibold text-slate-900">{t('backlog.createSprint')}</h3>
        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.name')}</label>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.goal')}</label>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.start')}</label>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.end')}</label>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          {error && <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-jira-blue-dk">{t('common.create')}</button>
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
      await createEpic({ title: title.trim(), description: description.trim(), color })
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-semibold text-slate-900">{t('backlog.createEpic')}</h3>
        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.name')}</label>
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.description')}</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Color</label>
            <div className="flex flex-wrap gap-3">
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
        <div className="mt-6 flex justify-end gap-3">
          {error && <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-jira-blue-dk">{t('common.create')}</button>
        </div>
      </form>
    </div>
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

  const canManage = canManageProject(activeProjectRole)

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return !query
      ? tasks
      : tasks.filter((task) =>
          [task.key, task.title, task.description, ...task.labels].join(' ').toLowerCase().includes(query)
        )
  }, [tasks, search])

  const rootTasks = useMemo(
    () => filteredTasks.filter((task) => !task.parent_task_id),
    [filteredTasks]
  )

  const sprintTasks = useMemo(() => {
    const map = new Map<string, typeof tasks>()
    for (const sprint of sprints) map.set(sprint.id, [])
    for (const task of rootTasks) {
      if (task.sprint_id && map.has(task.sprint_id)) {
        map.get(task.sprint_id)!.push(task)
      }
    }
    for (const [key, value] of map.entries()) {
      map.set(key, value.slice().sort((left, right) => left.position - right.position))
      }
      return map
  }, [rootTasks, sprints])

  const backlogTasks = useMemo(
    () => rootTasks.filter((task) => !task.sprint_id).sort((left, right) => left.position - right.position),
    [rootTasks]
  )

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const sprintMatch = destination.droppableId.match(/^sprint-(.+)$/)
    if (sprintMatch) {
      updateTask(draggableId, { sprint_id: sprintMatch[1] })
      return
    }
    if (destination.droppableId === 'backlog') {
      updateTask(draggableId, { sprint_id: null })
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="space-y-6 p-6">
        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <section className="rounded-[28px] bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('nav.backlog')}</p>
                  <h1 className="mt-1 text-3xl font-semibold text-slate-900">{t('backlog.title')}</h1>
                  <p className="mt-2 text-sm text-slate-500">{t('board.searchPlaceholder')}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setShowCreateTask(true)} className="inline-flex items-center gap-2 rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk">
                    <Plus size={16} />
                    {t('backlog.createIssue')}
                  </button>
                  {canManage && (
                    <>
                      <button onClick={() => setShowSprintModal(true)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">{t('backlog.createSprint')}</button>
                      <button onClick={() => setShowEpicModal(true)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">{t('backlog.createEpic')}</button>
                    </>
                  )}
                </div>
              </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('backlog.searchPlaceholder')} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue" />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{t('backlog.issueCount', { count: rootTasks.length })}</div>
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
              <aside className="rounded-[28px] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">{t('backlog.epics')}</h2>
                  {canManage && (
                    <button onClick={() => setShowEpicModal(true)} className="rounded-xl bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900">
                      <Plus size={16} />
                    </button>
                  )}
                </div>

                <div className="mt-4 space-y-3">
                  {epics.length === 0 && <p className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('backlog.noEpics')}</p>}
                  {epics.map((epic) => {
                    const epicTasks = filteredTasks.filter((task) => task.epic_id === epic.id)
                    const progress = epicTasks.length
                      ? Math.round((epicTasks.filter((task) => task.status === 'done').length / epicTasks.length) * 100)
                      : 0

                    return (
                      <div key={epic.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-start gap-3">
                          <span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: epic.color }} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{epic.title}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-400">{epic.key}</p>
                          </div>
                        </div>
                        {epic.description && <p className="mt-3 text-sm text-slate-500">{epic.description}</p>}
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: epic.color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </aside>

              <div className="space-y-5">
                {sprints.map((sprint) => (
                  <SprintContainer key={sprint.id} sprint={sprint} tasks={sprintTasks.get(sprint.id) ?? []} />
                ))}

                <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{t('backlog.unplanned')}</h2>
                      <p className="text-sm text-slate-500">{t('backlog.issueCount', { count: backlogTasks.length })}</p>
                    </div>
                  </div>

                  <Droppable droppableId="backlog" type="BACKLOG_TASK">
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={snapshot.isDraggingOver ? 'bg-jira-blue-lt/40' : 'bg-white'}>
                        <div className="grid grid-cols-[1.3fr_150px_140px_120px_90px_44px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          <span>{t('task.summary')}</span>
                          <span>{t('task.status')}</span>
                          <span>{t('task.priority')}</span>
                          <span>{t('task.dueDate')}</span>
                          <span>{t('task.attachments')}</span>
                          <span>{t('task.assignee')}</span>
                        </div>
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

      {showSprintModal && <CreateSprintModal onClose={() => setShowSprintModal(false)} />}
      {showEpicModal && <CreateEpicModal onClose={() => setShowEpicModal(false)} />}
      {showCreateTask && <CreateTaskModal onClose={() => setShowCreateTask(false)} />}
    </DragDropContext>
  )
}
