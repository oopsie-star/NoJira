import { X } from 'lucide-react'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useI18n } from '@/lib/i18n'
import { MAX_ASSIGNEES, type Profile } from '@/types'

interface MultiAssigneePickerProps {
  value: string[]
  onChange: (ids: string[]) => void
  members: Profile[]
  disabled?: boolean
}

/** Notion-style assignee field: pick up to 3 team members; 2+ = a universal task. */
export function MultiAssigneePicker({ value, onChange, members, disabled = false }: MultiAssigneePickerProps) {
  const { t } = useI18n()
  const available = members.filter((member) => !value.includes(member.id))

  return (
    <div className="space-y-2">
      {value.map((id) => {
        const member = members.find((m) => m.id === id) ?? null
        return (
          <div key={id} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <UserAvatar profile={member} size={22} muted={!member} />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{member?.full_name || member?.email || id}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label={t('common.delete')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )
      })}

      {!disabled && value.length < MAX_ASSIGNEES && (
        <select
          value=""
          onChange={(event) => { if (event.target.value) onChange([...value, event.target.value]) }}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
        >
          <option value="">{value.length === 0 ? t('common.unassigned') : t('task.addAssignee')}</option>
          {available.map((member) => (
            <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
          ))}
        </select>
      )}

      {value.length >= 2 && (
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">{t('task.universalHint')}</p>
      )}
    </div>
  )
}
