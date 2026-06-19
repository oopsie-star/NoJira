import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { ChevronDown, ChevronRight, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { BacklogRow } from './BacklogRow'
import { BacklogStatusSummary } from './BacklogStatusSummary'
import { BulkActionBar } from './BulkActionBar'
import { SectionMenu, type SectionMenuItem } from './SectionMenu'
import { SprintContainer } from './SprintContainer'
import { UserAvatar } from '@/components/common/UserAvatar'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useAuthContext } from '@/auth/AuthContext'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { isTaskBlocked } from '@/lib/ops'
import { EPIC_COLORS, EPIC_STATUS_OPTIONS, isTerminalStatus, type Epic, type Profile, type Sprint, type Task, type TaskStatus } from '@/types'
import { useStore } from '@/store'

const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000

type QuickFilterId = 'mine' | 'blocked' | 'bugs' | 'high' | 'dueSoon' | 'unassigned'

function getStatusCounts(tasks: Task[]): Record<TaskStatus, number> {
  return tasks.reduce<Record<TaskStatus, number>>(
    (counts, task) => {
      counts[task.status] += 1
      return counts
    },
    { todo: 0, in_progress: 0, done: 0, cancelled: 0, archived: 0, deleted: 0 }
  )
}

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const update = (event?: MediaQueryListEvent) => setIsMobile(event ? event.matches : mediaQuery.matches)

    update()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update)
      return () => mediaQuery.removeEventListener('change', update)
    }

    mediaQuery.addListener(update)
    return () => mediaQuery.removeListener(update)
  }, [])

  return isMobile
}

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

interface QuickFilterOption {
  id: QuickFilterId
  label: string
}

interface FiltersSheetProps {
  open: boolean
  onClose: () => void
  epicFilter: string
  assigneeFilter: string
  setEpicFilter: (value: string) => void
  setAssigneeFilter: (value: string) => void
  quickFilters: QuickFilterId[]
  toggleQuickFilter: (value: QuickFilterId) => void
  clearFilters: () => void
  epics: Epic[]
  members: Profile[]
  quickFilterOptions: QuickFilterOption[]
}

function FiltersSheet({
  open,
  onClose,
  epicFilter,
  assigneeFilter,
  setEpicFilter,
  setAssigneeFilter,
  quickFilters,
  toggleQuickFilter,
  clearFilters,
  epics,
  members,
  quickFilterOptions,
}: FiltersSheetProps) {
  const { t } = useI18n()

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-slate-950/35" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[80] rounded-t-[28px] bg-white px-4 pb-4 pt-3 shadow-2xl md:left-1/2 md:top-1/2 md:w-full md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:px-6 md:pb-6 md:pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t('backlog.filters')}</h3>
            <p className="text-sm text-slate-500">{t('board.quickFilters')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label={t('backlog.closeFilters')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('board.epicFilter')}</label>
            <select
              value={epicFilter}
              onChange={(event) => setEpicFilter(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
            >
              <option value="">{t('board.epicFilter')} — {t('common.all')}</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>{epic.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('board.assigneeFilter')}</label>
            <select
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
            >
              <option value="">{t('board.assigneeFilter')} — {t('common.all')}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('board.quickFilters')}</label>
            <div className="flex flex-wrap gap-2">
              {quickFilterOptions.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => toggleQuickFilter(filter.id)}
                  className={[
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    quickFilters.includes(filter.id) ? 'bg-qira-pistachio text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                  ].join(' ')}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            {t('board.quick.clear')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-qira-pistachio px-4 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
          >
            {t('backlog.done')}
          </button>
        </div>
      </div>
    </>
  )
}

interface TaskListSectionProps {
  sectionKey: string
  title: string
  subtitle?: string
  itemCount: number
  statusCounts: Record<TaskStatus, number>
  tasks: Task[]
  droppableId: string
  emptyLabel: string
  createLabel: string
  onCreate: () => void
  actions?: SectionMenuItem[]
  mobile?: boolean
  defaultCollapsed?: boolean
  titleBadges?: ReactNode
  headerControl?: ReactNode
}

function TaskListSection({
  sectionKey,
  title,
  subtitle,
  itemCount,
  statusCounts,
  tasks,
  droppableId,
  emptyLabel,
  createLabel,
  onCreate,
  actions = [],
  mobile = false,
  defaultCollapsed = false,
  titleBadges,
  headerControl,
}: TaskListSectionProps) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <section key={sectionKey} className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-3 py-3 sm:px-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label={collapsed ? t('backlog.expandSection') : t('backlog.collapseSection')}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">{title}</h2>
              {titleBadges}
              <span className="text-xs text-slate-500">{t('backlog.issueCount', { count: itemCount })}</span>
            </div>
            {subtitle && (
              <p className="mt-1.5 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <BacklogStatusSummary counts={statusCounts} />
            {headerControl}
            <SectionMenu items={actions} label={t('backlog.moreActions')} />
          </div>
        </div>
      </div>

      {!collapsed && (
        <>
          <Droppable droppableId={droppableId} type="BACKLOG_TASK">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={[
                  'space-y-2 p-2 sm:p-3',
                  snapshot.isDraggingOver ? 'bg-qira-pistachio-lt/30' : 'bg-white',
                ].join(' ')}
              >
                {tasks.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                    {emptyLabel}
                  </p>
                )}
                {tasks.map((task, index) => (
                  <BacklogRow
                    key={task.id}
                    task={task}
                    index={index}
                    mobile={mobile}
                    dragDisabled={mobile}
                  />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          <div className="border-t border-slate-200 px-2 py-2 sm:px-3">
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Plus size={15} />
              {createLabel}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export function BacklogView() {
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const allTasks = useStore((state) => state.tasks)
  // Terminal tasks (cancelled / archived / deleted) leave the backlog entirely —
  // they live only in the board's "Closed" view, where they can be recovered.
  const tasks = useMemo(() => allTasks.filter((task) => !isTerminalStatus(task.status)), [allTasks])
  const sprints = useStore((state) => state.sprints)
  const epics = useStore((state) => state.epics)
  const members = useStore((state) => state.members)
  const taskLinks = useStore((state) => state.taskLinks)
  const updateTask = useStore((state) => state.updateTask)
  const updateEpic = useStore((state) => state.updateEpic)
  const deleteEpic = useStore((state) => state.deleteEpic)
  const requestEntityDeletion = useStore((state) => state.requestEntityDeletion)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const profileId = useStore((state) => state.profile?.id ?? null)
  const clearTaskSelection = useStore((state) => state.clearTaskSelection)

  // Drop any multi-select when leaving the backlog.
  useEffect(() => () => clearTaskSelection(), [clearTaskSelection])

  const [search, setSearch] = useState('')
  const [epicFilter, setEpicFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [quickFilters, setQuickFilters] = useState<QuickFilterId[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [showSprintModal, setShowSprintModal] = useState(false)
  const [showEpicModal, setShowEpicModal] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [taskSeed, setTaskSeed] = useState<Partial<Task> | null>(null)
  const [sprintSeedEpicId, setSprintSeedEpicId] = useState<string | null>(null)
  const isMobile = useIsMobileViewport()

  const canCollaborate = Boolean(activeProjectRole)
  const isSuperAdmin = profile?.role === 'admin'

  const quickFilterMap = useMemo(() => ({
    mine: (task: Task) => Boolean(profileId && task.assignee_id === profileId),
    blocked: (task: Task) => isTaskBlocked(task.id, taskLinks, tasks),
    bugs: (task: Task) => task.issue_type === 'bug',
    high: (task: Task) => task.priority === 'high' || task.priority === 'highest',
    dueSoon: (task: Task) => Boolean(
      task.due_date
      && task.status !== 'done'
      && new Date(task.due_date).getTime() - Date.now() <= DUE_SOON_MS
    ),
    unassigned: (task: Task) => !task.assignee_id,
  }), [profileId, taskLinks, tasks])

  const quickFilterOptions = useMemo<QuickFilterOption[]>(() => ([
    { id: 'mine', label: t('board.quick.me') },
    { id: 'blocked', label: t('board.quick.blocked') },
    { id: 'bugs', label: t('board.quick.bugs') },
    { id: 'high', label: t('board.quick.high') },
    { id: 'dueSoon', label: t('board.quick.dueSoon') },
    { id: 'unassigned', label: t('board.quick.unassigned') },
  ]), [t])

  const taskById = useMemo(() => {
    const map = new Map<string, Task>()
    for (const task of tasks) map.set(task.id, task)
    return map
  }, [tasks])

  // All tasks (incl. subtasks) matching the active filters. Subtasks are kept so
  // sections can surface ones whose parent lives elsewhere (e.g. a subtask in a
  // sprint whose parent isn't) — Jira shows those; hiding them looked like "0".
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    const activeQuickFilters = quickFilters
      .map((filterId) => quickFilterMap[filterId])
      .filter(Boolean)

    return tasks
      .filter((task) => {
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
      .sort((left, right) => left.position - right.position)
  }, [assigneeFilter, epicFilter, quickFilterMap, quickFilters, search, tasks])

  const rootTasks = useMemo(() => filteredTasks.filter((task) => !task.parent_task_id), [filteredTasks])

  // A subtask should appear in a section only when its parent is NOT already in
  // that same section (otherwise it stays nested under the parent).
  const orphanInSection = useMemo(
    () => (task: Task, parentBelongs: (parent: Task) => boolean): boolean => {
      if (!task.parent_task_id) return true
      const parent = taskById.get(task.parent_task_id)
      return !parent || !parentBelongs(parent)
    },
    [taskById]
  )

  const sortedEpics = useMemo(
    () => epics.slice().sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [epics]
  )

  const sortedSprints = useMemo(
    () => sprints
      .slice()
      .sort((left, right) => {
        const statusOrder: Record<Sprint['status'], number> = { active: 0, planned: 1, completed: 2 }
        return statusOrder[left.status] - statusOrder[right.status] || left.created_at.localeCompare(right.created_at)
      }),
    [sprints]
  )

  const hasActiveFilters = Boolean(search.trim() || epicFilter || assigneeFilter || quickFilters.length)

  // Jira's backlog only lists active + future sprints — completed sprints live in
  // reports, not the backlog. Mirror that so old closed sprints from the board's
  // history (imported when "include completed sprints" was on) don't clutter it.
  const sprintSections = useMemo(
    () => sortedSprints
      .filter((sprint) => sprint.status !== 'completed')
      .map((sprint) => ({
        sprint,
        tasks: filteredTasks.filter(
          (task) => task.sprint_id === sprint.id && orphanInSection(task, (parent) => parent.sprint_id === sprint.id),
        ),
      }))
      .filter(({ tasks }) => !hasActiveFilters || tasks.length > 0),
    [filteredTasks, orphanInSection, hasActiveFilters, sortedSprints]
  )

  // Completed sprints are hidden (above); their tasks fall back into the Backlog
  // so nothing is lost — mirrors Jira moving incomplete issues to the backlog.
  const completedSprintIds = useMemo(
    () => new Set(sprints.filter((sprint) => sprint.status === 'completed').map((sprint) => sprint.id)),
    [sprints]
  )
  const inBacklog = useMemo(
    () => (task: Task) => (!task.sprint_id || completedSprintIds.has(task.sprint_id)) && !task.epic_id,
    [completedSprintIds]
  )

  const backlogTasks = useMemo(
    () => filteredTasks.filter((task) => inBacklog(task) && orphanInSection(task, inBacklog)),
    [filteredTasks, inBacklog, orphanInSection]
  )

  // Jira Board/Backlog split is a Kanban concept — show it only when the project
  // has no (non-completed) sprints. Scrum projects use sprint sections + Backlog,
  // so they must not get a spurious empty "Board" section.
  const isKanbanStyle = useMemo(() => !sprints.some((sprint) => sprint.status !== 'completed'), [sprints])
  const hasBoardPlacement = useMemo(
    () => isKanbanStyle && rootTasks.some((task) => task.jira_board_placement === 'board' || task.jira_board_placement === 'backlog'),
    [isKanbanStyle, rootTasks]
  )
  const boardPlacementTasks = useMemo(
    () => backlogTasks.filter((task) => task.jira_board_placement === 'board'),
    [backlogTasks]
  )
  const pureBacklogTasks = useMemo(
    () => backlogTasks.filter((task) => task.jira_board_placement !== 'board'),
    [backlogTasks]
  )

  const epicSections = useMemo(
    () => sortedEpics
      .map((epic) => {
        const directTasks = rootTasks.filter((task) => task.epic_id === epic.id && !task.sprint_id)
        const linkedSprintCount = sortedSprints.filter((sprint) => sprint.epic_id === epic.id).length
        return {
          epic,
          directTasks,
          linkedSprintCount,
          statusCounts: getStatusCounts(directTasks),
        }
      })
      .filter(({ directTasks }) => !hasActiveFilters || directTasks.length > 0),
    [hasActiveFilters, rootTasks, sortedEpics, sortedSprints]
  )

  const firstExpandedSectionKey = useMemo(() => {
    const orderedKeys = [
      ...sprintSections.map(({ sprint }) => `sprint-${sprint.id}`),
      'backlog',
      ...epicSections.map(({ epic }) => `epic-${epic.id}`),
    ]

    return orderedKeys.find((key) => {
      if (key === 'backlog') return backlogTasks.length > 0 || orderedKeys.length === 1
      return true
    }) ?? 'backlog'
  }, [backlogTasks.length, epicSections, sprintSections])

  const activeFilterCount = Number(Boolean(epicFilter)) + Number(Boolean(assigneeFilter)) + quickFilters.length

  function toggleQuickFilter(filterId: QuickFilterId) {
    setQuickFilters((current) => (
      current.includes(filterId)
        ? current.filter((value) => value !== filterId)
        : [...current, filterId]
    ))
  }

  function clearFilters() {
    setEpicFilter('')
    setAssigneeFilter('')
    setQuickFilters([])
  }

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

    if (destination.droppableId === 'board-placement') {
      void updateTask(draggableId, { sprint_id: null, epic_id: null, jira_board_placement: 'board' })
      return
    }

    if (destination.droppableId === 'backlog') {
      void updateTask(draggableId, {
        sprint_id: null,
        epic_id: null,
        ...(hasBoardPlacement ? { jira_board_placement: 'backlog' as const } : {}),
      })
    }
  }

  async function handleDeleteEpic(epic: Epic) {
    if (!window.confirm(t('backlog.deleteEpicConfirm', { name: epic.title }))) return
    await deleteEpic(epic.id)
  }

  async function handleRequestDeleteEpic(epic: Epic) {
    await requestEntityDeletion('epic', epic.id, `${epic.key} — ${epic.title}`)
  }

  const showGlobalEmptyState = sprintSections.length === 0 && backlogTasks.length === 0 && epicSections.length === 0
  const memberPreview = members.slice(0, 4)

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex min-h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 sm:gap-4 sm:p-4">
        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <section className="shrink-0 rounded-[20px] border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t('backlog.searchPlaceholder')}
                      className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowFilters(true)}
                    className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    <SlidersHorizontal size={16} />
                    {!isMobile && <span>{t('backlog.filters')}</span>}
                    {activeFilterCount > 0 && (
                      <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>

                  <span className="hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 lg:inline-flex">
                    {t('backlog.issueCount', { count: rootTasks.length })}
                  </span>

                  {memberPreview.length > 0 && (
                    <div className="hidden items-center -space-x-2 lg:flex">
                      {memberPreview.map((member) => (
                        <div key={member.id} className="rounded-full ring-2 ring-white">
                          <UserAvatar profile={member} size={30} muted={!member} />
                        </div>
                      ))}
                      {members.length > memberPreview.length && (
                        <span className="ml-2 inline-flex h-8 min-w-[32px] items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
                          +{members.length - memberPreview.length}
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => openTaskModal()}
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-qira-pistachio px-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
                  >
                    <Plus size={15} />
                    <span>{isMobile ? t('common.create') : t('backlog.createIssue')}</span>
                  </button>

                  {canCollaborate && !isMobile && (
                    <>
                      <button
                        type="button"
                        onClick={() => openSprintModal()}
                        className="inline-flex h-11 shrink-0 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        {t('backlog.createSprint')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowEpicModal(true)}
                        className="inline-flex h-11 shrink-0 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        {t('backlog.createEpic')}
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                  {isMobile && canCollaborate && (
                    <>
                      <button
                        type="button"
                        onClick={() => openSprintModal()}
                        className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        {t('backlog.createSprint')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowEpicModal(true)}
                        className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        {t('backlog.createEpic')}
                      </button>
                    </>
                  )}

                  {quickFilterOptions.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => toggleQuickFilter(filter.id)}
                      className={[
                        'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                        quickFilters.includes(filter.id) ? 'bg-qira-pistachio text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
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
            </section>

            <div className="space-y-3">
              {showGlobalEmptyState ? (
                <section className="rounded-[20px] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 shadow-sm">
                  <p>{t('backlog.noVisibleIssues')}</p>
                  <button
                    type="button"
                    onClick={() => openTaskModal()}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-2 font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    <Plus size={15} />
                    {t('backlog.createIssue')}
                  </button>
                </section>
              ) : (
                <>
                  {sprintSections.map(({ sprint, tasks: sprintTasks }) => (
                    <SprintContainer
                      key={sprint.id}
                      sprint={sprint}
                      tasks={sprintTasks}
                      mobile={isMobile}
                      defaultCollapsed={isMobile && firstExpandedSectionKey !== `sprint-${sprint.id}`}
                    />
                  ))}

                  {hasBoardPlacement && (
                    <TaskListSection
                      sectionKey="board-placement"
                      title={t('backlog.boardSection')}
                      itemCount={boardPlacementTasks.length}
                      statusCounts={getStatusCounts(boardPlacementTasks)}
                      tasks={boardPlacementTasks}
                      droppableId="board-placement"
                      emptyLabel={t('backlog.noBoardTasks')}
                      createLabel={t('backlog.createIssue')}
                      onCreate={() => openTaskModal({ jira_board_placement: 'board' })}
                      actions={[{ label: t('backlog.createIssue'), onSelect: () => openTaskModal({ jira_board_placement: 'board' }) }]}
                      mobile={isMobile}
                    />
                  )}

                  <TaskListSection
                    sectionKey="backlog"
                    title={t('backlog.title')}
                    itemCount={(hasBoardPlacement ? pureBacklogTasks : backlogTasks).length}
                    statusCounts={getStatusCounts(hasBoardPlacement ? pureBacklogTasks : backlogTasks)}
                    tasks={hasBoardPlacement ? pureBacklogTasks : backlogTasks}
                    droppableId="backlog"
                    emptyLabel={t('backlog.noBacklogTasks')}
                    createLabel={t('backlog.createIssue')}
                    onCreate={() => openTaskModal()}
                    actions={[{ label: t('backlog.createIssue'), onSelect: () => openTaskModal() }]}
                    mobile={isMobile}
                    defaultCollapsed={isMobile && firstExpandedSectionKey !== 'backlog'}
                  />

                  {epicSections.map(({ epic, directTasks, linkedSprintCount, statusCounts }) => {
                    const actions: SectionMenuItem[] = []

                    if (canCollaborate) {
                      actions.push(
                        { label: t('backlog.createIssue'), onSelect: () => openTaskModal({ epic_id: epic.id }) },
                        { label: t('backlog.createSprintInEpic'), onSelect: () => openSprintModal(epic.id) },
                      )
                    }

                    if (isSuperAdmin) {
                      actions.push({
                        label: t('backlog.deleteEpic'),
                        onSelect: () => handleDeleteEpic(epic),
                        danger: true,
                      })
                    } else {
                      actions.push({
                        label: t('backlog.requestDelete'),
                        onSelect: () => handleRequestDeleteEpic(epic),
                      })
                    }

                    return (
                      <TaskListSection
                        key={epic.id}
                        sectionKey={`epic-${epic.id}`}
                        title={epic.title}
                        subtitle={linkedSprintCount > 0 ? t('backlog.linkedSprints', { count: linkedSprintCount }) : undefined}
                        itemCount={directTasks.length}
                        statusCounts={statusCounts}
                        tasks={directTasks}
                        droppableId={`epic-${epic.id}`}
                        emptyLabel={t('backlog.noDirectEpicTasks')}
                        createLabel={t('backlog.createIssue')}
                        onCreate={() => openTaskModal({ epic_id: epic.id })}
                        actions={actions}
                        mobile={isMobile}
                        defaultCollapsed={isMobile && firstExpandedSectionKey !== `epic-${epic.id}`}
                        titleBadges={(
                          <>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                              {epic.key}
                            </span>
                            {linkedSprintCount > 0 && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                {t('backlog.sprintCount', { count: linkedSprintCount })}
                              </span>
                            )}
                          </>
                        )}
                        headerControl={canCollaborate ? (
                          <select
                            value={epic.status}
                            onChange={(event) => void updateEpic(epic.id, { status: event.target.value as Epic['status'] })}
                            className="hidden rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 outline-none transition focus:border-qira-pistachio md:block"
                          >
                            {EPIC_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {t(`common.status.${status === 'done' ? 'completed' : status}`)}
                              </option>
                            ))}
                          </select>
                        ) : undefined}
                      />
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <FiltersSheet
        open={showFilters}
        onClose={() => setShowFilters(false)}
        epicFilter={epicFilter}
        assigneeFilter={assigneeFilter}
        setEpicFilter={setEpicFilter}
        setAssigneeFilter={setAssigneeFilter}
        quickFilters={quickFilters}
        toggleQuickFilter={toggleQuickFilter}
        clearFilters={clearFilters}
        epics={sortedEpics}
        members={members}
        quickFilterOptions={quickFilterOptions}
      />

      {showSprintModal && <CreateSprintModal initialEpicId={sprintSeedEpicId} onClose={closeSprintModal} />}
      {showEpicModal && <CreateEpicModal onClose={() => setShowEpicModal(false)} />}
      {showCreateTask && <CreateTaskModal onClose={closeTaskModal} initialValues={taskSeed ?? undefined} />}

      <BulkActionBar />
    </DragDropContext>
  )
}
