import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

interface DeleteEntityModalProps {
  /** e.g. t('backlog.deleteEpicConfirm', { name: epic.title }) */
  message: string
  taskCount: number
  onCancel: () => void
  onConfirm: (withTasks: boolean) => Promise<void>
  /** Overrides the default "Delete, keep tasks" / "Delete with tasks" wording — used for the reversible archive flow. */
  labels?: {
    keep: string
    keepHint: string
    with: string
    withHint: string
    /** Archiving isn't destructive, so its "with tasks" option shouldn't be styled red. */
    withDanger?: boolean
  }
}

export function DeleteEntityModal({ message, taskCount, onCancel, onConfirm, labels }: DeleteEntityModalProps) {
  const { t } = useI18n()
  const [pending, setPending] = useState<'with' | 'without' | null>(null)
  const keepLabel = labels?.keep ?? t('backlog.deleteKeepTasks')
  const keepHint = labels?.keepHint ?? t('backlog.deleteKeepTasksHint')
  const withLabel = labels?.with ?? t('backlog.deleteWithTasks')
  const withHint = labels?.withHint ?? t('backlog.deleteWithTasksHint')
  const withDanger = labels?.withDanger ?? true

  async function handle(withTasks: boolean) {
    setPending(withTasks ? 'with' : 'without')
    try {
      await onConfirm(withTasks)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-900">{message}</h3>
        <p className="mt-2 text-sm text-slate-500">
          {taskCount > 0 ? t('backlog.deleteEntityTaskCount', { count: taskCount }) : t('backlog.deleteEntityNoTasks')}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => handle(false)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:bg-slate-100 disabled:opacity-60"
          >
            <span className="block text-sm font-semibold text-slate-900">
              {pending === 'without' ? '…' : keepLabel}
            </span>
            <span className="block text-xs text-slate-500">{keepHint}</span>
          </button>

          <button
            type="button"
            disabled={pending !== null}
            onClick={() => handle(true)}
            className={
              withDanger
                ? 'rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left transition hover:bg-rose-100 disabled:opacity-60'
                : 'rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100 disabled:opacity-60'
            }
          >
            <span className={`block text-sm font-semibold ${withDanger ? 'text-rose-700' : 'text-slate-900'}`}>
              {pending === 'with' ? '…' : withLabel}
            </span>
            <span className={`block text-xs ${withDanger ? 'text-rose-600' : 'text-slate-500'}`}>{withHint}</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={pending !== null}
            className="mt-1 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
