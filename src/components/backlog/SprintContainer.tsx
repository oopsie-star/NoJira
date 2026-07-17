import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Droppable } from '@hello-pangea/dnd'
import { BacklogRow } from './BacklogRow'
import { BacklogStatusSummary } from './BacklogStatusSummary'
import { SectionMenu, type SectionMenuItem } from './SectionMenu'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useAuthContext } from '@/auth/AuthContext'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { canEditAuthoredContent, canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import type { Sprint, Task, TaskStatus } from '@/types'

interface SprintContainerProps {
  sprint: Sprint
  tasks: Task[]
  mobile?: boolean
  defaultCollapsed?: boolean
}

function getStatusCounts(tasks: Task[]): Record<TaskStatus, number> {
  return tasks.reduce<Record<TaskStatus, number>>(
    (counts, task) => {
      counts[task.status] += 1
      return counts
    },
    { todo: 0, in_progress: 0, done: 0, cancelled: 0, archived: 0, deleted: 0 }
  )
}

export function SprintContainer({
  sprint,
  tasks,
  mobile = false,
  defaultCollapsed = false,
}: SprintContainerProps) {
  const { profile } = useAuthContext()
  const { locale, t } = useI18n()
  const epics = useStore((state) => state.epics)
  const startSprint = useStore((state) => state.startSprint)
  const completeSprint = useStore((state) => state.completeSprint)
  const updateSprint = useStore((state) => state.updateSprint)
  const deleteSprint = useStore((state) => state.deleteSprint)
  const requestEntityDeletion = useStore((state) => state.requestEntityDeletion)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [showCreate, setShowCreate] = useState(false)
  const [requestingDelete, setRequestingDelete] = useState(false)
  const [deletingSprint, setDeletingSprint] = useState(false)

  const epic = useMemo(
    () => (sprint.epic_id ? epics.find((item) => item.id === sprint.epic_id) ?? null : null),
    [epics, sprint.epic_id]
  )
  const statusCounts = useMemo(() => getStatusCounts(tasks), [tasks])
  const canManageSprint = canManageProject(activeProjectRole)
  const isSuperAdmin = profile?.role === 'admin'
  const canEditName = canEditAuthoredContent(activeProjectRole, profile?.id, sprint.created_by)

  const dateLabel = useMemo(() => {
    if (!sprint.start_date && !sprint.end_date) return null
    if (sprint.start_date && sprint.end_date) {
      return `${formatDate(locale, sprint.start_date)} - ${formatDate(locale, sprint.end_date)}`
    }
    return sprint.start_date ? formatDate(locale, sprint.start_date) : formatDate(locale, sprint.end_date)
  }, [locale, sprint.end_date, sprint.start_date])

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

  const actionItems: SectionMenuItem[] = [
    { label: t('backlog.createIssue'), onSelect: () => setShowCreate(true) },
    ...(canManageSprint && sprint.status === 'planned'
      ? [{ label: t('backlog.startSprint'), onSelect: () => startSprint(sprint.id) }]
      : []),
    ...(canManageSprint && sprint.status === 'active'
      ? [{ label: t('backlog.completeSprint'), onSelect: () => completeSprint(sprint.id) }]
      : []),
    isSuperAdmin
      ? {
          label: t('backlog.deleteSprint'),
          onSelect: handleDeleteSprint,
          danger: true,
          disabled: deletingSprint,
        }
      : {
          label: requestingDelete ? t('backlog.deletionRequestSending') : t('backlog.requestDelete'),
          onSelect: handleRequestDeleteSprint,
          disabled: requestingDelete,
        },
  ]

  return (
    <>
      <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
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
                {canEditName ? (
                  <input
                    key={sprint.name}
                    defaultValue={sprint.name}
                    onBlur={(event) => {
                      const value = event.target.value.trim()
                      if (value && value !== sprint.name) void updateSprint(sprint.id, { name: value })
                      else event.target.value = sprint.name
                    }}
                    className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1 -mx-1 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-200 focus:bg-white sm:text-base"
                  />
                ) : (
                  <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">{sprint.name}</h2>
                )}
                <span className={[
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  sprint.status === 'active'
                    ? 'bg-emerald-100 text-emerald-700'
                    : sprint.status === 'completed'
                      ? 'bg-slate-200 text-slate-600'
                      : 'bg-blue-100 text-qira-pistachio',
                ].join(' ')}>
                  {t(`common.status.${sprint.status}`)}
                </span>
                {epic && (
                  <span
                    className="truncate rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: `${epic.color}20`, color: epic.color }}
                  >
                    {epic.title}
                  </span>
                )}
                <span className="text-xs text-slate-500">{t('backlog.issueCount', { count: tasks.length })}</span>
              </div>

              {(dateLabel || sprint.goal) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  {dateLabel && <span>{dateLabel}</span>}
                  {sprint.goal && <span className="line-clamp-1">{sprint.goal}</span>}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <BacklogStatusSummary counts={statusCounts} />
              <SectionMenu items={actionItems} label={t('backlog.moreActions')} />
            </div>
          </div>
        </div>

        {!collapsed && (
          <>
            <Droppable droppableId={`sprint-${sprint.id}`} type="BACKLOG_TASK">
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
                      {t('backlog.noSprintTasks')}
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
                onClick={() => setShowCreate(true)}
                className="inline-flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <Plus size={15} />
                {t('backlog.createIssue')}
              </button>
            </div>
          </>
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
