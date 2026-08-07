import { useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { diffLines } from '@/lib/diff'
import { formatDate, formatPerson } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import type { TaskFieldChange } from '@/types'

const FIELD_LABEL_KEY = {
  title: 'task.changeHistory.fieldTitle',
  description: 'task.changeHistory.fieldDescription',
} as const

function ChangeEntry({ change }: { change: TaskFieldChange }) {
  const { t, locale } = useI18n()
  const lines = diffLines(change.old_value, change.new_value)
  const who = change.profile ? formatPerson(change.profile) : null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{t(FIELD_LABEL_KEY[change.field_name])}</span>
        <span>·</span>
        <span>{formatDate(locale, change.changed_at, { time: true })}</span>
        <span>·</span>
        <span className={who ? 'font-medium text-slate-700' : 'italic text-slate-400'}>
          {who ?? t('task.changeHistory.externalChange')}
        </span>
      </div>
      <div className="mt-2 space-y-0.5 overflow-x-auto rounded-xl bg-slate-50 p-2 font-mono text-xs">
        {lines.map((line, index) => (
          <div
            key={index}
            className={[
              'whitespace-pre-wrap break-words rounded px-1.5 py-0.5',
              line.type === 'added'
                ? 'bg-emerald-100 text-emerald-800'
                : line.type === 'removed'
                  ? 'bg-rose-100 text-rose-700 line-through decoration-rose-400'
                  : 'text-slate-400',
            ].join(' ')}
          >
            {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
            {line.text || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TaskChangeHistory({ changes }: { changes: TaskFieldChange[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  if (changes.length === 0) return null

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-700"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <History size={12} />
        {t('task.changeHistory.title')} ({changes.length})
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {changes.map((change) => <ChangeEntry key={change.id} change={change} />)}
        </div>
      )}
    </div>
  )
}
