import { useEffect, useMemo, useState } from 'react'
import { LogOut, Clock } from 'lucide-react'
import { useAuthContext } from '@/auth/AuthContext'
import { parseSandboxDeliveryNote } from '@/lib/approvalNotifications'
import { useI18n } from '@/lib/i18n'
import { useStore, type ApprovalNotificationResponse } from '@/store'

export function PendingApprovalPage() {
  const { signOut, profile } = useAuthContext()
  const { t } = useI18n()
  const triggerApprovalNotification = useStore((state) => state.triggerApprovalNotification)
  const requestAccessAgain = useStore((state) => state.requestAccessAgain)
  const [notificationState, setNotificationState] = useState<ApprovalNotificationResponse | null>(null)
  const [reRequested, setReRequested] = useState(false)
  const [reRequesting, setReRequesting] = useState(false)
  const isDeclined = Boolean(profile?.access_declined) && !reRequested

  async function handleRequestAgain() {
    setReRequesting(true)
    try {
      await requestAccessAgain()
      setReRequested(true)
      void triggerApprovalNotification({ force: true })
    } finally {
      setReRequesting(false)
    }
  }
  const sandboxInfo = useMemo(
    () => parseSandboxDeliveryNote(notificationState?.message),
    [notificationState?.message]
  )

  useEffect(() => {
    if (!profile || profile.approved) return

    const hasDeliveryState = Boolean(profile.approval_email_sent_at || profile.approval_email_last_attempt_at)
    if (hasDeliveryState) {
      setNotificationState({
        status: profile.approval_email_sent_at ? 'sent' : 'retry',
        message: profile.approval_email_last_error,
        sentAt: profile.approval_email_sent_at,
      })
    }

    void triggerApprovalNotification().then((result) => {
      if (result) setNotificationState(result)
    })
  }, [
    profile,
    triggerApprovalNotification,
  ])

  const statusCopy = useMemo(() => {
    if (!notificationState) {
      return {
        label: t('pendingApproval.statusIdle'),
        tone: 'bg-slate-100 text-slate-600',
      }
    }

    if (notificationState.status === 'sandbox_sent' || sandboxInfo) {
      return {
        label: t('pendingApproval.statusSandbox'),
        tone: 'bg-sky-50 text-sky-700',
      }
    }

    if (notificationState.status === 'sent' || notificationState.status === 'already_sent') {
      return {
        label: t('pendingApproval.statusSent'),
        tone: 'bg-emerald-50 text-emerald-700',
      }
    }

    if (notificationState.status === 'queued' || notificationState.status === 'cooldown') {
      return {
        label: t('pendingApproval.statusQueued'),
        tone: 'bg-slate-100 text-slate-600',
      }
    }

    return {
      label: notificationState.message ? `${t('pendingApproval.statusError')} ${notificationState.message}` : t('pendingApproval.statusRetry'),
      tone: 'bg-amber-50 text-amber-700',
    }
  }, [notificationState, sandboxInfo, t])

  return (
    <div className="flex min-h-screen items-center justify-center bg-qira-cream px-4">
      <div className="w-full max-w-md rounded-[32px] bg-white p-10 text-center shadow-xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-qira-pistachio-lt text-qira-pistachio">
          <Clock size={32} />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-qira-anthracite">{t('pendingApproval.title')}</h1>
        <p className="mt-3 text-sm text-slate-500">
          {t('pendingApproval.body', { email: profile?.email ?? '—' })}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {t('pendingApproval.note')}
        </p>
        <div className={`mt-3 inline-flex max-w-full items-center justify-center rounded-full px-4 py-1.5 text-xs font-semibold ${statusCopy.tone}`}>
          {statusCopy.label}
        </div>
        {sandboxInfo && (
          <p className="mt-3 rounded-2xl bg-sky-50 px-4 py-3 text-left text-xs text-sky-700">
            {t('pendingApproval.sandboxNote', {
              deliveredTo: sandboxInfo.deliveredTo,
              adminEmail: sandboxInfo.intendedRecipient ?? '—',
            })}
          </p>
        )}
        {isDeclined && (
          <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-4 text-left">
            <p className="text-sm font-semibold text-rose-700">{t('pendingApproval.declinedTitle')}</p>
            <p className="mt-1 text-xs text-rose-600">{t('pendingApproval.declinedBody')}</p>
            <button
              onClick={() => void handleRequestAgain()}
              disabled={reRequesting}
              className="mt-3 w-full rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
            >
              {reRequesting ? t('pendingApproval.requesting') : t('pendingApproval.requestAgain')}
            </button>
          </div>
        )}

        {reRequested && (
          <p className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {t('pendingApproval.requestSent')}
          </p>
        )}

        <button
          onClick={() => signOut()}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          <LogOut size={16} />
          {t('pendingApproval.signOut')}
        </button>
      </div>
    </div>
  )
}
