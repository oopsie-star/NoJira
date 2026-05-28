import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { TaskDrawer } from '@/components/task/TaskDrawer'
import { useI18n } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store'
import type { Task } from '@/types'

function BoardSkeleton() {
  return (
    <div className="flex gap-5 p-6">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="w-[360px] rounded-[24px] bg-white p-4 shadow-sm">
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
  const { t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchBoard = useStore((state) => state.fetchBoard)
  const fetchEpics = useStore((state) => state.fetchEpics)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchSprints = useStore((state) => state.fetchSprints)
  const patchTask = useStore((state) => state.patchTask)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const sprints = useStore((state) => state.sprints)
  const activeSprintId = useStore((state) => state.activeSprintId)
  const setActiveSprintId = useStore((state) => state.setActiveSprintId)
  const tasks = useStore((state) => state.tasks)
  const loadingBoard = useStore((state) => state.loadingBoard)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      Promise.all([fetchSprints(), fetchEpics(), fetchMembers()])
    }
  }, [activeProjectId, fetchSprints, fetchEpics, fetchMembers])

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

  return (
    <GlobalLayout>
      <div className="space-y-6 p-6">
        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-16 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <section className="rounded-[28px] bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('board.currentSprint')}</p>
                  <h1 className="mt-1 text-3xl font-semibold text-slate-900">{activeSprint?.name ?? t('board.noActiveSprint')}</h1>
                  {activeSprint?.goal && <p className="mt-2 max-w-3xl text-sm text-slate-500">{activeSprint.goal}</p>}
                </div>

                <div className="grid min-w-[320px] gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('board.metrics.total')}</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-900">{tasks.length}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('status.done')}</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-900">{doneCount}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('board.metrics.progress')}</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-900">{progress}%</p>
                  </div>
                </div>
              </div>

              {sprints.length > 0 && (
                <div className="mt-5 max-w-md">
                  <select
                    value={activeSprintId ?? ''}
                    onChange={(event) => setActiveSprintId(event.target.value || null)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                  >
                    {sprints.map((sprint) => (
                      <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            {loadingBoard ? (
              <BoardSkeleton />
            ) : activeSprint ? (
              <KanbanBoard />
            ) : (
              <section className="rounded-[28px] bg-white p-16 text-center shadow-sm">
                <h2 className="text-2xl font-semibold text-slate-900">{t('board.noActiveSprint')}</h2>
                <p className="mt-2 text-sm text-slate-500">{t('board.openBacklog')}</p>
                <Link to="/backlog" className="mt-5 inline-flex rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk">
                  {t('board.openBacklog')}
                </Link>
              </section>
            )}
          </>
        )}
      </div>

      <TaskDrawer />
    </GlobalLayout>
  )
}
