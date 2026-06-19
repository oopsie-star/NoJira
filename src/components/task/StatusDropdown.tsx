import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { StatusBadge } from '@/components/common/IssueBadges'
import { useI18n } from '@/lib/i18n'
import { STATUS_COLUMNS, TERMINAL_STATUSES, type TaskStatus } from '@/types'

interface StatusDropdownProps {
  value: TaskStatus
  onChange: (status: TaskStatus) => void
}

export function StatusDropdown({ value, onChange }: StatusDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-slate-300"
      >
        <StatusBadge status={value} />
        <ChevronDown size={14} className="text-slate-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 min-w-[190px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          {STATUS_COLUMNS.map((status) => (
            <button
              key={status}
              onClick={() => {
                onChange(status)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
            >
              <div>
                <StatusBadge status={status} />
              </div>
              {status === value && <Check size={16} className="text-qira-pistachio" />}
            </button>
          ))}

          {/* Terminal statuses — move the task off the active board */}
          <div className="my-1 border-t border-slate-100" />
          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('board.closed')}</p>
          {TERMINAL_STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => {
                onChange(status)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
            >
              <div>
                <StatusBadge status={status} />
              </div>
              {status === value && <Check size={16} className="text-qira-pistachio" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
