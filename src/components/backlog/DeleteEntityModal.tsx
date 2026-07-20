import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

interface DeleteEntityModalProps {
  /** e.g. t('backlog.deleteEpicConfirm', { name: epic.title }) */
  message: string
  taskCount: number
  onCancel: () => void
  onConfirm: (withTasks: boolean) => Promise<void>
}

export function DeleteEntityModal({ message, taskCount, onCancel, onConfirm }: DeleteEntityModalProps) {
  const { t } = useI18n()
  const [pending, setPending] = useState<'with' | 'without' | null>(null)

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
              {pending === 'without' ? '…' : t('backlog.deleteKeepTasks')}
            </span>
            <span className="block text-xs text-slate-500">{t('backlog.deleteKeepTasksHint')}</span>
          </button>

          <button
            type="button"
            disabled={pending !== null}
            onClick={() => handle(true)}
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left transition hover:bg-rose-100 disabled:opacity-60"
          >
            <span className="block text-sm font-semibold text-rose-700">
              {pending === 'with' ? '…' : t('backlog.deleteWithTasks')}
            </span>
            <span className="block text-xs text-rose-600">{t('backlog.deleteWithTasksHint')}</span>
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
