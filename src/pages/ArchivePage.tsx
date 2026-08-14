import { useEffect } from 'react'
import { Flag, Undo2 } from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { TaskDrawer } from '@/components/task/TaskDrawer'
import { PriorityBadge, StatusBadge } from '@/components/common/IssueBadges'
import { AssigneeAvatars } from '@/components/common/AssigneeAvatars'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { useStore } from '@/store'
import type { Epic, Task } from '@/types'

function ArchivedEpicRow({ epic, onRestore }: { epic: Epic; onRestore: () => void }) {
  const { t } = useI18n()
  const tasks = useStore((state) => state.tasks)
  const taskCount = tasks.filter((task) => task.epic_id === epic.id).length

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${epic.color}20`, color: epic.color }}
        aria-hidden
      >
        <Flag size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">{epic.key}</span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{epic.title}</p>
        {taskCount > 0 && (
          <p className="mt-1 text-xs text-slate-400">{t('backlog.deleteEntityTaskCount', { count: taskCount })}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRestore}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        <Undo2 size={15} />
        {t('archive.restoreEpic')}
      </button>
    </div>
  )
}

function ArchiveRow({ task, onOpen, onRepublish }: { task: Task; onOpen: () => void; onRepublish: () => void }) {
  const { t, locale } = useI18n()
  const members = useStore((state) => state.members)
  const placeholders = useStore((state) => state.placeholders)
  const epics = useStore((state) => state.epics)
  const epic = epics.find((e) => e.id === task.epic_id)

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">{task.key}</span>
          {epic && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{epic.title}</span>}
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{task.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          <span className="text-xs text-slate-400">{formatDate(locale, task.updated_at, { time: true })}</span>
        </div>
      </button>
      <AssigneeAvatars task={task} members={members} placeholders={placeholders} size={28} />
      <button
        type="button"
        onClick={onRepublish}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        <Undo2 size={15} />
        {t('archive.republish')}
      </button>
    </div>
  )
}

export function ArchivePage() {
  const { t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchBacklog = useStore((state) => state.fetchBacklog)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchEpics = useStore((state) => state.fetchEpics)
  const fetchPlaceholders = useStore((state) => state.fetchPlaceholders)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const tasks = useStore((state) => state.tasks)
  const epics = useStore((state) => state.epics)
  const updateTask = useStore((state) => state.updateTask)
  const restoreEpic = useStore((state) => state.restoreEpic)
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const notify = useStore((state) => state.notify)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([fetchBacklog(), fetchMembers(), fetchEpics(), fetchPlaceholders()])
    }
  }, [activeProjectId, fetchBacklog, fetchMembers, fetchEpics, fetchPlaceholders])

  const archivedTasks = tasks.filter((task) => task.status === 'archived')
  const archivedEpics = epics.filter((epic) => epic.status === 'archived')

  async function handleRepublish(taskId: string) {
    await updateTask(taskId, { status: 'todo' })
    notify(t('archive.republished'), 'success')
  }

  async function handleRestoreEpic(epicId: string) {
    await restoreEpic(epicId)
    notify(t('archive.epicRestored'), 'success')
  }

  return (
    <GlobalLayout>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
        <section className="shrink-0 rounded-[28px] bg-white px-5 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-base font-semibold text-slate-900">{t('archive.title')}</h1>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500">{t('archive.subtitle')}</span>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('archive.epicsTitle')}</h2>
          <div className="space-y-2">
            {archivedEpics.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{t('archive.epicsEmpty')}</p>
            ) : (
              archivedEpics.map((epic) => (
                <ArchivedEpicRow key={epic.id} epic={epic} onRestore={() => void handleRestoreEpic(epic.id)} />
              ))
            )}
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm">
          <div className="space-y-2">
            {archivedTasks.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{t('archive.empty')}</p>
            ) : (
              archivedTasks.map((task) => (
                <ArchiveRow
                  key={task.id}
                  task={task}
                  onOpen={() => setOpenTaskId(task.id)}
                  onRepublish={() => void handleRepublish(task.id)}
                />
              ))
            )}
          </div>
        </section>
      </div>
      <TaskDrawer />
    </GlobalLayout>
  )
}
