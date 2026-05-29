import { useEffect, useMemo } from 'react'
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

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      Promise.all([fetchSprints(), fetchEpics(), fetchMembers(), fetchTaskLinks()])
    }
  }, [activeProjectId, fetchSprints, fetchEpics, fetchMembers, fetchTaskLinks])

  useEffect(() => {
    const activeSprint = sprints.find((sprint) => sprint.status === 'active') ?? sprints[0]
    if (activeSprint && activeSprint.id !== activeSprintId) {
      setActiveSprintId(activeSprint.id)
    }
    if (!activeSprint && activeSprintId) {
      setActiveSprintId(null)
    }
  }, [sprints, activeSprintId, setActiveSprintId])

  useEffect(() => {
    if (activeSprintId) {
      fetchBoard(activeSprintId)
    }
  }, [activeSprintId, fetchBoard])

  useEffect(() => {
    if (!activeProjectId || !activeSprintId) return

    const channel = supabase
      .channel(`board-${activeProjectId}-${activeSprintId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${activeProjectId}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            patchTask(payload.new.id, payload.new as Partial<Task>)
            return
          }
          fetchBoard(activeSprintId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeProjectId, activeSprintId, fetchBoard, patchTask])

  const activeSprint = sprints.find((sprint) => sprint.id === activeSprintId)
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('board.currentSprint')}</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="mt-0.5 truncate text-base font-bold text-slate-900 sm:text-xl">
                      {activeSprint?.name ?? t('board.noActiveSprint')}
                    </h1>
                    {sprints.length > 1 && (
                      <select
                        value={activeSprintId ?? ''}
                        onChange={(event) => setActiveSprintId(event.target.value || null)}
                        className="mt-0.5 shrink-0 rounded-xl border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none transition focus:border-jira-blue"
                      >
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
              {loadingBoard ? (
                <BoardSkeleton />
              ) : activeSprint ? (
                <KanbanBoard />
              ) : (
                <section className="flex h-full items-center justify-center rounded-[28px] bg-white p-16 text-center shadow-sm">
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-900">{t('board.noActiveSprint')}</h2>
                    <p className="mt-2 text-sm text-slate-500">{t('board.openBacklog')}</p>
                    <Link to="/backlog" className="mt-5 inline-flex rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk">
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
