import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'

/** Global toast — surfaces save failures (and their reason) so nothing fails silently. */
export function Toaster() {
  const toast = useStore((state) => state.toast)
  const dismiss = useStore((state) => state.dismissToast)
  const { t } = useI18n()

  useEffect(() => {
    if (!toast) return
    // Errors linger longer so they're actually noticed.
    const ms = toast.kind === 'error' ? 9000 : 3500
    const id = window.setTimeout(dismiss, ms)
    return () => window.clearTimeout(id)
  }, [toast, dismiss])

  if (!toast) return null
  const isError = toast.kind === 'error'

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-3"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div
        role="alert"
        className={[
          'pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg',
          isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800',
        ].join(' ')}
      >
        {isError
          ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-500" />
          : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{isError ? t('toast.error') : t('toast.success')}</p>
          <p className="mt-0.5 break-words text-sm">{toast.message}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('common.close')}
          className="-mr-1 ml-1 shrink-0 rounded-lg p-1 transition hover:bg-black/5"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
