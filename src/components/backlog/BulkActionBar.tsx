import { CheckSquare, X } from 'lucide-react'
import { useAuthContext } from '@/auth/AuthContext'
import { useI18n } from '@/lib/i18n'
import { canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import type { Task, TaskStatus } from '@/types'

export function BulkActionBar() {
  const { t } = useI18n()
  const { profile } = useAuthContext()
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const sprints = useStore((s) => s.sprints)
  const epics = useStore((s) => s.epics)
  const members = useStore((s) => s.members)
  const placeholders = useStore((s) => s.placeholders)
  const bulkUpdateTasks = useStore((s) => s.bulkUpdateTasks)
  const clearTaskSelection = useStore((s) => s.clearTaskSelection)
  const activeProjectRole = useStore((s) => s.activeProjectRole)

  // Reorganizing across epics (as opposed to just picking a sprint) is
  // powerful enough — imported data can be messy — that it's reserved for
  // project owners/admins/founders/ceos and the global super admin.
  const canMoveAcrossEpics = canManageProject(activeProjectRole) || profile?.role === 'admin'

  const count = selectedTaskIds.length
  if (count === 0) return null

  const apply = (fields: Partial<Task>) => void bulkUpdateTasks(fields)

  function assigneeFields(value: string): Partial<Task> {
    if (!value) return { assignee_id: null, assignee_placeholder_id: null }
    if (value.startsWith('placeholder:')) return { assignee_id: null, assignee_placeholder_id: value.slice('placeholder:'.length) }
    return { assignee_id: value, assignee_placeholder_id: null }
  }

  const selectClass =
    'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-qira-pistachio'

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-2xl">
        <span className="inline-flex items-center gap-2 rounded-xl bg-qira-pistachio-lt px-3 py-2 text-sm font-semibold text-qira-pistachio-dk">
          <CheckSquare size={15} />
          {t('bulk.selected', { count })}
        </span>

        <select className={selectClass} value="" onChange={(e) => e.target.value && apply({ status: e.target.value as TaskStatus })}>
          <option value="">{t('bulk.setStatus')}</option>
          <option value="todo">{t('status.todo')}</option>
          <option value="in_progress">{t('status.in_progress')}</option>
          <option value="done">{t('status.done')}</option>
          <option value="cancelled">{t('status.cancelled')}</option>
          <option value="archived">{t('status.archived')}</option>
          <option value="deleted">{t('status.deleted')}</option>
        </select>

        <select
          className={selectClass}
          value=""
          onChange={(e) => {
            const value = e.target.value
            if (!value) return
            if (value === 'backlog') { apply({ sprint_id: null, epic_id: null }); return }
            if (value.startsWith('epic:')) { apply({ sprint_id: null, epic_id: value.slice('epic:'.length) }); return }
            apply({ sprint_id: value })
          }}
        >
          <option value="">{t('bulk.setSprint')}</option>
          <option value="backlog">{t('common.backlog')}</option>
          {canMoveAcrossEpics && epics.length > 0 && (
            <optgroup label={t('backlog.epicCount', { count: epics.length })}>
              {epics.map((epic) => (
                <option key={epic.id} value={`epic:${epic.id}`}>{epic.key} — {epic.title}</option>
              ))}
            </optgroup>
          )}
          {sprints.filter((s) => s.status !== 'completed').map((sprint) => (
            <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
          ))}
        </select>

        <select className={selectClass} value="" onChange={(e) => { if (e.target.value) apply(assigneeFields(e.target.value === 'none' ? '' : e.target.value)) }}>
          <option value="">{t('bulk.setAssignee')}</option>
          <option value="none">{t('common.unassigned')}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
          ))}
          {placeholders.length > 0 && (
            <optgroup label={t('people.fromJira')}>
              {placeholders.map((placeholder) => (
                <option key={placeholder.id} value={`placeholder:${placeholder.id}`}>{placeholder.display_name}</option>
              ))}
            </optgroup>
          )}
        </select>

        <button
          type="button"
          onClick={clearTaskSelection}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={15} />
          {t('bulk.clear')}
        </button>
      </div>
    </div>
  )
}
