import { useMemo, useState, type FormEvent } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Plus } from 'lucide-react'
import { BacklogRow } from './BacklogRow'
import { SprintContainer } from './SprintContainer'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { canManageProject } from '@/lib/permissions'
import { EPIC_COLORS, EPIC_STATUS_OPTIONS, PORTFOLIO_ITEM_OPTIONS, type Epic, type PortfolioItem, type PortfolioItemType, type Task } from '@/types'
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
      <form onSubmit={handleSubmit} className="flex w-full max-w-xl flex-col rounded-[28px] bg-white shadow-2xl" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
        <div className="flex-shrink-0 border-b border-slate-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-slate-900">{t('backlog.createSprint')}</h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.name')}</label>
            <input autoFocus autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.goal')}</label>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {error && <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-jira-blue-dk">{t('common.create')}</button>
        </div>
      </form>
    </div>
  )
}

function CreateRoadmapModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const portfolioItems = useStore((state) => state.portfolioItems)
  const createPortfolioItem = useStore((state) => state.createPortfolioItem)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [itemType, setItemType] = useState<PortfolioItemType>('initiative')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setError(null)
    try {
      await createPortfolioItem({
        title: title.trim(),
        description: description.trim(),
        item_type: itemType,
        parent_id: parentId || null,
        color: itemType === 'milestone' ? '#FF8B00' : '#6554C0',
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
          <h3 className="text-xl font-semibold text-slate-900">{t('backlog.createRoadmap')}</h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.name')}</label>
            <input autoFocus autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.description')}</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.roadmapType')}</label>
              <select value={itemType} onChange={(event) => setItemType(event.target.value as PortfolioItemType)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue">
                {PORTFOLIO_ITEM_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.parentItem')}</label>
              <select value={parentId} onChange={(event) => setParentId(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue">
                <option value="">{t('backlog.noParent')}</option>
                {portfolioItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.key} - {item.title}</option>
                ))}
              </select>
            </div>
          </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
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
  const portfolioItems = useStore((state) => state.portfolioItems)
  const createEpic = useStore((state) => state.createEpic)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(EPIC_COLORS[0])
  const [parentPortfolioItemId, setParentPortfolioItemId] = useState('')
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
        parent_portfolio_item_id: parentPortfolioItemId || null,
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
            <input autoFocus autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('common.description')}</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('backlog.parentItem')}</label>
              <select value={parentPortfolioItemId} onChange={(event) => setParentPortfolioItemId(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue">
                <option value="">{t('backlog.noParent')}</option>
                {portfolioItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.key} - {item.title}</option>
                ))}
              </select>
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
        </div>
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {error && <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-jira-blue-dk">{t('common.create')}</button>
        </div>
      </form>
    </div>
  )
}

function EpicCard({
  epic,
  tasks,
  portfolioItems,
  canManage,
}: {
  epic: Epic
  tasks: Task[]
  portfolioItems: PortfolioItem[]
  canManage: boolean
}) {
  const { t } = useI18n()
  const updateEpic = useStore((state) => state.updateEpic)

  const epicTasks = tasks.filter((task) => task.epic_id === epic.id)
  const progress = epicTasks.length
    ? Math.round((epicTasks.filter((task) => task.status === 'done').length / epicTasks.length) * 100)
    : 0

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: epic.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{epic.title}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-400">{epic.key}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {t('backlog.epicCount', { count: epicTasks.length })}
            </span>
          </div>
          {epic.description && <p className="mt-2 text-sm text-slate-500">{epic.description}</p>}
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: epic.color }} />
      </div>

      <div className="mt-3 grid gap-2">
        <select
          value={epic.status}
          disabled={!canManage}
          onChange={(event) => void updateEpic(epic.id, { status: event.target.value as Epic['status'] })}
          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-jira-blue disabled:bg-slate-50"
        >
          {EPIC_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{t(`common.status.${status === 'done' ? 'completed' : status}`)}</option>
          ))}
        </select>
        <select
          value={epic.parent_portfolio_item_id ?? ''}
          disabled={!canManage}
          onChange={(event) => void updateEpic(epic.id, { parent_portfolio_item_id: event.target.value || null })}
          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-jira-blue disabled:bg-slate-50"
        >
          <option value="">{t('backlog.noParent')}</option>
          {portfolioItems.map((item) => (
            <option key={item.id} value={item.id}>{item.key} - {item.title}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function RoadmapNode({
  item,
  tasks,
  portfolioItems,
  epics,
  canManage,
  level = 0,
}: {
  item: PortfolioItem
  tasks: Task[]
  portfolioItems: PortfolioItem[]
  epics: Epic[]
  canManage: boolean
  level?: number
}) {
  const childItems = portfolioItems.filter((entry) => entry.parent_id === item.id)
  const childEpics = epics.filter((epic) => epic.parent_portfolio_item_id === item.id)
  const linkedTasks = tasks.filter((task) => childEpics.some((epic) => epic.id === task.epic_id))
  const progress = linkedTasks.length
    ? Math.round((linkedTasks.filter((task) => task.status === 'done').length / linkedTasks.length) * 100)
    : 0

  return (
    <div className="space-y-3" style={{ marginLeft: level * 12 }}>
      <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-400">{item.key} - {item.item_type}</p>
            {item.description && <p className="mt-2 text-sm text-slate-500">{item.description}</p>}
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
            {linkedTasks.length}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: item.color }} />
        </div>
      </div>

      {childEpics.map((epic) => (
        <EpicCard key={epic.id} epic={epic} tasks={tasks} portfolioItems={portfolioItems} canManage={canManage} />
      ))}

      {childItems.map((child) => (
        <RoadmapNode key={child.id} item={child} tasks={tasks} portfolioItems={portfolioItems} epics={epics} canManage={canManage} level={level + 1} />
      ))}
    </div>
  )
}

export function BacklogView() {
  const { t } = useI18n()
  const tasks = useStore((state) => state.tasks)
  const sprints = useStore((state) => state.sprints)
  const epics = useStore((state) => state.epics)
  const portfolioItems = useStore((state) => state.portfolioItems)
  const updateTask = useStore((state) => state.updateTask)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)

  const [search, setSearch] = useState('')
  const [showSprintModal, setShowSprintModal] = useState(false)
  const [showEpicModal, setShowEpicModal] = useState(false)
  const [showRoadmapModal, setShowRoadmapModal] = useState(false)
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
  }, [rootTasks, sprints, tasks])

  const backlogTasks = useMemo(
    () => rootTasks.filter((task) => !task.sprint_id).sort((left, right) => left.position - right.position),
    [rootTasks]
  )

  const rootRoadmapItems = useMemo(
    () => portfolioItems.filter((item) => !item.parent_id).sort((left, right) => left.position - right.position),
    [portfolioItems]
  )

  const standaloneEpics = useMemo(
    () => epics.filter((epic) => !epic.parent_portfolio_item_id),
    [epics]
  )

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const sprintMatch = destination.droppableId.match(/^sprint-(.+)$/)
    if (sprintMatch) {
      void updateTask(draggableId, { sprint_id: sprintMatch[1] })
      return
    }
    if (destination.droppableId === 'backlog') {
      void updateTask(draggableId, { sprint_id: null })
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
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
                  className="min-w-[140px] flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                />
                <span className="hidden rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 sm:block">
                  {t('backlog.issueCount', { count: rootTasks.length })}
                </span>
                <button onClick={() => setShowCreateTask(true)} className="inline-flex items-center gap-1.5 rounded-2xl bg-jira-blue px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk">
                  <Plus size={15} />
                  {t('backlog.createIssue')}
                </button>
                {canManage && (
                  <>
                    <button onClick={() => setShowSprintModal(true)} className="rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">{t('backlog.createSprint')}</button>
                    <button onClick={() => setShowEpicModal(true)} className="rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">{t('backlog.createEpic')}</button>
                    <button onClick={() => setShowRoadmapModal(true)} className="hidden rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 lg:inline-flex">{t('backlog.createRoadmap')}</button>
                  </>
                )}
              </div>
            </section>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t('backlog.roadmap')}</h2>
                    <p className="text-sm text-slate-500">{t('backlog.epics')}</p>
                  </div>
                  {canManage && (
                    <button onClick={() => setShowRoadmapModal(true)} className="rounded-xl bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900">
                      <Plus size={16} />
                    </button>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="space-y-4">
                    {rootRoadmapItems.length === 0 && standaloneEpics.length === 0 ? (
                      <p className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('backlog.noRoadmap')}</p>
                    ) : (
                      <>
                        {rootRoadmapItems.map((item) => (
                          <RoadmapNode
                            key={item.id}
                            item={item}
                            tasks={filteredTasks}
                            portfolioItems={portfolioItems}
                            epics={epics}
                            canManage={canManage}
                          />
                        ))}

                        {standaloneEpics.length > 0 && (
                          <div className="space-y-3">
                            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-4">
                              <p className="text-sm font-semibold text-slate-900">{t('backlog.standaloneEpics')}</p>
                            </div>
                            {standaloneEpics.map((epic) => (
                              <EpicCard key={epic.id} epic={epic} tasks={filteredTasks} portfolioItems={portfolioItems} canManage={canManage} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </aside>

              <div className="min-h-0 overflow-y-auto pr-1">
                <div className="space-y-4">
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
                          <div className="grid grid-cols-[minmax(0,1.35fr)_110px_110px_110px_70px_40px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
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
            </div>
          </>
        )}
      </div>

      {showSprintModal && <CreateSprintModal onClose={() => setShowSprintModal(false)} />}
      {showEpicModal && <CreateEpicModal onClose={() => setShowEpicModal(false)} />}
      {showRoadmapModal && <CreateRoadmapModal onClose={() => setShowRoadmapModal(false)} />}
      {showCreateTask && <CreateTaskModal onClose={() => setShowCreateTask(false)} />}
    </DragDropContext>
  )
}
