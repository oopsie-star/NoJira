import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { TaskDrawer } from '@/components/task/TaskDrawer'
import { useI18n } from '@/lib/i18n'
import { calculateAverageCycleTimeHours, formatCycleTime, getStatusAgeDays, isTaskBlocked } from '@/lib/ops'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store'
import type { Task } from '@/types'

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

  const doneCount = useMemo(() => tasks.filter((task) => task.status === 'done').length, [tasks])
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
  const blockedCount = useMemo(() => tasks.filter((task) => isTaskBlocked(task.id, taskLinks, tasks)).length, [taskLinks, tasks])
  const agingCount = useMemo(() => tasks.filter((task) => task.status !== 'done' && getStatusAgeDays(task) >= 3).length, [tasks])
  const cycleTime = useMemo(() => formatCycleTime(locale, calculateAverageCycleTimeHours(tasks)), [locale, tasks])

  return (
    <GlobalLayout>
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-16 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <section className="shrink-0 rounded-[28px] bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-4">
              {/* Sprint name row */}
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {isKanbanMode ? t('board.kanbanMode') : t('board.currentSprint')}
                  </p>
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="mt-0.5 truncate text-base font-bold text-slate-900 sm:text-xl">
                      {displaySprintName}
                    </h1>
                    {sprints.length > 0 && (
                      <select
                        value={activeSprintId ?? 'all'}
                        onChange={(event) => setActiveSprintId(event.target.value)}
                        className="mt-0.5 shrink-0 rounded-xl border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none transition focus:border-qira-pistachio"
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

              {/* Metrics row */}
              <div className="mt-2.5 flex flex-wrap gap-1.5 sm:gap-2">
                {[
                  { label: t('board.metrics.total'), value: tasks.length },
                  { label: t('status.done'), value: doneCount },
                  { label: t('board.metrics.progress'), value: `${progress}%` },
                  { label: t('board.metrics.cycleTime'), value: cycleTime },
                  { label: t('board.metrics.blocked'), value: blockedCount },
                  { label: t('board.metrics.stale'), value: agingCount },
                ].map(({ label, value }) => (
                  <div key={label} className="min-w-[72px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 sm:px-3 sm:py-2">
                    <p className="text-[10px] uppercase tracking-[0.10em] text-slate-500 sm:text-[11px]">{label}</p>
                    <p className="mt-0.5 text-base font-semibold text-slate-900 sm:mt-1 sm:text-xl">{value}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="min-h-0 flex-1 overflow-hidden">
              {isLoading ? (
                <BoardSkeleton />
              ) : (activeSprintId || isKanbanMode) ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  {isKanbanMode && (
                    <div className="shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
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
