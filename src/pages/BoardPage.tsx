import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { TaskDrawer } from '@/components/task/TaskDrawer'
import { useI18n } from '@/lib/i18n'
import { calculateAverageCycleTimeHours, formatCycleTime, getStatusAgeDays, isTaskBlocked } from '@/lib/ops'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store'
import { isTerminalStatus, type Task } from '@/types'

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 gap-4 overflow-x-auto">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="w-[340px] rounded-[24px] bg-white p-4 shadow-sm">
          <div className="h-6 w-24 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((__, cardIndex) => (
              <div key={cardIndex} className="h-36 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function BoardPage() {
  const { locale, t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchBoard = useStore((state) => state.fetchBoard)
  const fetchBacklog = useStore((state) => state.fetchBacklog)
  const fetchEpics = useStore((state) => state.fetchEpics)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchSprints = useStore((state) => state.fetchSprints)
  const fetchTaskLinks = useStore((state) => state.fetchTaskLinks)
  const patchTask = useStore((state) => state.patchTask)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const sprints = useStore((state) => state.sprints)
  const activeSprintId = useStore((state) => state.activeSprintId)
  const setActiveSprintId = useStore((state) => state.setActiveSprintId)
  const tasks = useStore((state) => state.tasks)
  const taskLinks = useStore((state) => state.taskLinks)
  const loadingBoard = useStore((state) => state.loadingBoard)
  const loadingBacklog = useStore((state) => state.loadingBacklog)

  // Track when sprints have been fetched so we can distinguish "loading" from "truly empty"
  const [sprintsLoaded, setSprintsLoaded] = useState(false)
  // Prevent re-initialization when user manually changes sprint
  const sprintsInitialized = useRef(false)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (!activeProjectId) {
      setSprintsLoaded(false)
      return
    }
    setSprintsLoaded(false)
    sprintsInitialized.current = false
    Promise.all([
      fetchSprints().then(() => setSprintsLoaded(true)),
      fetchEpics(),
      fetchMembers(),
      fetchTaskLinks(),
    ])
  }, [activeProjectId, fetchSprints, fetchEpics, fetchMembers, fetchTaskLinks])

  // One-shot sprint initialization — only runs once per project, never overrides user selection
  useEffect(() => {
    if (!sprintsLoaded || sprints.length === 0) return
    if (sprintsInitialized.current) return
    sprintsInitialized.current = true
    const activeSprint = sprints.find((s) => s.status === 'active') ?? sprints[0]
    setActiveSprintId(activeSprint.id)
  }, [sprintsLoaded, sprints, setActiveSprintId])

  // Load board tasks whenever the sprint selection changes
  useEffect(() => {
    if (!activeProjectId) return
    if (activeSprintId === 'all') {
      fetchBacklog()
    } else if (activeSprintId) {
      fetchBoard(activeSprintId)
    }
  }, [activeProjectId, activeSprintId, fetchBoard, fetchBacklog])

  // For no-sprint projects: load all tasks once sprints are confirmed empty
  useEffect(() => {
    if (!activeProjectId || !sprintsLoaded || sprints.length > 0 || activeSprintId) return
    fetchBacklog()
  }, [activeProjectId, sprintsLoaded, sprints.length, activeSprintId, fetchBacklog])

  // Realtime subscription — covers sprint, all-sprint, and kanban modes
  useEffect(() => {
    if (!activeProjectId) return
    const isKanbanMode = sprintsLoaded && sprints.length === 0
    if (!activeSprintId && !isKanbanMode) return

    const channel = supabase
      .channel(`board-${activeProjectId}-${activeSprintId ?? 'kanban'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${activeProjectId}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            patchTask(payload.new.id, payload.new as Partial<Task>)
            return
          }
          if (activeSprintId === 'all' || isKanbanMode) {
            fetchBacklog()
          } else {
            fetchBoard(activeSprintId!)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeProjectId, activeSprintId, sprintsLoaded, sprints.length, fetchBoard, fetchBacklog, patchTask])

  const isKanbanMode = sprintsLoaded && sprints.length === 0
  const activeSprint = activeSprintId && activeSprintId !== 'all'
    ? sprints.find((sprint) => sprint.id === activeSprintId)
    : null

  const displaySprintName =
    isKanbanMode ? t('board.kanbanMode') :
    activeSprintId === 'all' ? t('board.allSprints') :
    activeSprint?.name ?? t('board.noActiveSprint')

  const isLoading = isKanbanMode || activeSprintId === 'all'
    ? loadingBacklog
    : loadingBoard

  // Metrics reflect the active board only — closed (cancelled/archived/deleted) tasks are excluded.
  const activeTasks = useMemo(() => tasks.filter((task) => !isTerminalStatus(task.status)), [tasks])
  const doneCount = useMemo(() => activeTasks.filter((task) => task.status === 'done').length, [activeTasks])
  const progress = activeTasks.length ? Math.round((doneCount / activeTasks.length) * 100) : 0
  const blockedCount = useMemo(() => activeTasks.filter((task) => isTaskBlocked(task.id, taskLinks, tasks)).length, [activeTasks, taskLinks, tasks])
  const agingCount = useMemo(() => activeTasks.filter((task) => task.status !== 'done' && getStatusAgeDays(task) >= 3).length, [activeTasks])
  const cycleTime = useMemo(() => formatCycleTime(locale, calculateAverageCycleTimeHours(activeTasks)), [locale, activeTasks])

  return (
    <GlobalLayout>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-5">
        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-16 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <section className="shrink-0 overflow-hidden rounded-2xl bg-white px-3 py-2.5 shadow-sm sm:rounded-[28px] sm:px-5 sm:py-4">
              {/* Sprint name row */}
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {isKanbanMode ? t('board.kanbanMode') : t('board.currentSprint')}
                  </p>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    {/* On phones the select doubles as the title; the standalone h1 only shows once there's room */}
                    <h1 className={[
                      'min-w-0 truncate text-base font-bold text-slate-900 sm:text-xl',
                      sprints.length > 0 ? 'hidden sm:block' : 'block',
                    ].join(' ')}>
                      {displaySprintName}
                    </h1>
                    {sprints.length > 0 && (
                      <select
                        value={activeSprintId ?? 'all'}
                        onChange={(event) => setActiveSprintId(event.target.value)}
                        className="min-w-0 max-w-full flex-1 truncate rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-qira-pistachio sm:max-w-[240px] sm:flex-none sm:py-1 sm:font-normal"
                      >
                        <option value="all">{t('board.allSprints')}</option>
                        {sprints.map((sprint) => (
                          <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                {activeSprint?.goal && (
                  <p className="hidden shrink-0 max-w-xs truncate text-sm text-slate-500 lg:block">{activeSprint.goal}</p>
                )}
              </div>

              {/* Metrics — compact horizontal strip on phones, card row on wide screens */}
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:mt-2.5 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
                {[
                  { label: t('board.metrics.total'), value: activeTasks.length },
                  { label: t('status.done'), value: doneCount },
                  { label: t('board.metrics.progress'), value: `${progress}%` },
                  { label: t('board.metrics.cycleTime'), value: cycleTime },
                  { label: t('board.metrics.blocked'), value: blockedCount },
                  { label: t('board.metrics.stale'), value: agingCount },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 sm:min-w-[72px] sm:flex-1 sm:flex-col sm:items-start sm:gap-0 sm:px-3 sm:py-2"
                  >
                    <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">{label}</span>
                    <span className="text-sm font-bold text-slate-900 sm:mt-1 sm:text-xl">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <div className="min-h-0 flex-1 overflow-hidden">
              {isLoading ? (
                <BoardSkeleton />
              ) : (activeSprintId || isKanbanMode) ? (
                <div className="flex h-full min-h-0 flex-col gap-2 sm:gap-3">
                  {isKanbanMode && (
                    <div className="shrink-0 truncate rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 sm:rounded-2xl sm:px-4 sm:py-2.5 sm:text-sm">
                      {t('board.kanbanBanner')}
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <KanbanBoard />
                  </div>
                </div>
              ) : (
                <section className="flex h-full items-center justify-center rounded-[28px] bg-white p-16 text-center shadow-sm">
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-900">{t('board.noActiveSprint')}</h2>
                    <p className="mt-2 text-sm text-slate-500">{t('board.openBacklog')}</p>
                    <Link to="/backlog" className="mt-5 inline-flex rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk">
                      {t('board.openBacklog')}
                    </Link>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>

      <TaskDrawer />
    </GlobalLayout>
  )
}
