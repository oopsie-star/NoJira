import { useMemo, useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { TaskCard } from './TaskCard'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useI18n } from '@/lib/i18n'
import { STATUS_COLUMNS, isTerminalStatus, type Epic, type Task, type TaskStatus } from '@/types'

/** Lane id used for the "no epic" swimlane. Epic ids are UUIDs, so no clash. */
export const NO_EPIC_LANE = '__no_epic__'
export const CLOSED_SLOT = '__closed__'
/** Droppable ids are `<laneId>::<status>` — '::' never appears in a UUID. */
export function laneDroppableId(laneId: string, slot: string) {
  return `${laneId}::${slot}`
}

export interface BoardLane {
  id: string
  epic: Epic | null
  tasks: Task[]
}

interface LaneColumnProps {
  laneId: string
  slot: string
  title: string
  tasks: Task[]
  sprintId: string | null
  epicId: string | null
  status?: TaskStatus
  disableCreate?: boolean
}

function LaneColumn({ laneId, slot, title, tasks, sprintId, epicId, status, disableCreate }: LaneColumnProps) {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <section className="flex w-[86vw] max-w-[420px] shrink-0 snap-start flex-col rounded-xl border border-slate-200 bg-slate-50/70 sm:w-[250px] lg:w-[290px]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <p className="min-w-0 truncate text-xs font-semibold text-slate-700">{title}</p>
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-[11px] text-slate-500">{tasks.length}</span>
            {!disableCreate && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>

        <Droppable droppableId={laneDroppableId(laneId, slot)}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={[
                'min-h-[72px] space-y-2 p-2 transition',
                snapshot.isDraggingOver ? 'bg-qira-pistachio-lt/60' : '',
              ].join(' ')}
            >
              {tasks.map((task, index) => (
                <TaskCard key={task.id} task={task} index={index} />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </section>

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          initialValues={{ sprint_id: sprintId, status: status ?? 'todo', epic_id: epicId }}
        />
      )}
    </>
  )
}

interface BoardSwimLaneProps {
  lane: BoardLane
  showClosed: boolean
  sprintId: string | null
}

/**
 * One epic (or "no epic") rendered as a horizontal band containing its own
 * status columns — so an epic is visible on the board with the work that
 * belongs to it, instead of only appearing as a label on cards.
 */
export function BoardSwimLane({ lane, showClosed, sprintId }: BoardSwimLaneProps) {
  const { t } = useI18n()
  const activeTasks = useMemo(() => lane.tasks.filter((task) => !isTerminalStatus(task.status)), [lane.tasks])
  // Lanes with no work start collapsed so empty epics don't flood the board.
  const [collapsed, setCollapsed] = useState(lane.tasks.length === 0)

  const columns = useMemo(() => {
    const map: Record<'todo' | 'in_progress' | 'done', Task[]> = { todo: [], in_progress: [], done: [] }
    for (const task of activeTasks) map[task.status as 'todo' | 'in_progress' | 'done'].push(task)
    for (const status of STATUS_COLUMNS) {
      const key = status as 'todo' | 'in_progress' | 'done'
      map[key] = map[key].slice().sort((a, b) => a.position - b.position)
    }
    return map
  }, [activeTasks])

  const closedTasks = useMemo(
    () => lane.tasks.filter((task) => isTerminalStatus(task.status)).sort((a, b) => a.position - b.position),
    [lane.tasks]
  )

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? t('backlog.expandSection') : t('backlog.collapseSection')}
          className="shrink-0 rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>

        {lane.epic ? (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: lane.epic.color }} aria-hidden />
            <span className="min-w-0 truncate text-sm font-semibold" style={{ color: lane.epic.color }}>
              {lane.epic.title}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: `${lane.epic.color}20`, color: lane.epic.color }}
            >
              {lane.epic.key}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate text-sm font-semibold text-slate-600">{t('board.noEpic')}</span>
        )}

        <span className="ml-auto shrink-0 text-xs text-slate-500">
          {t('kanban.issues', { count: activeTasks.length })}
        </span>
      </div>

      {!collapsed && (
        <div className="flex snap-x snap-proximity gap-3 overflow-x-auto p-3 sm:snap-none">
          {STATUS_COLUMNS.map((status) => (
            <LaneColumn
              key={status}
              laneId={lane.id}
              slot={status}
              status={status}
              title={t(`status.${status}`)}
              tasks={columns[status as 'todo' | 'in_progress' | 'done']}
              sprintId={sprintId}
              epicId={lane.epic?.id ?? null}
            />
          ))}
          {showClosed && (
            <LaneColumn
              laneId={lane.id}
              slot={CLOSED_SLOT}
              title={t('board.closed')}
              tasks={closedTasks}
              sprintId={sprintId}
              epicId={lane.epic?.id ?? null}
              disableCreate
            />
          )}
        </div>
      )}
    </section>
  )
}
