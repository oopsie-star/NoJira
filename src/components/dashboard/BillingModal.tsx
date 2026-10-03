import { Check, Mail, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

/**
 * Commercial placeholder, on purpose.
 *
 * There is no plan, subscription or seat model in the database yet — see
 * CURRENT_PLAN in DashboardPage for the single constant that stands in for one.
 * This modal exists so the upgrade path has a real place to live in the UI;
 * when billing is wired up, the contact button becomes the checkout call and
 * the copy below becomes the plan comparison. It deliberately does NOT pretend
 * a payment flow exists.
 */
export function BillingModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()

  const included = [
    t('billing.feature.projects'),
    t('billing.feature.team'),
    t('billing.feature.ai'),
    t('billing.feature.integrations'),
  ]

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('billing.title')}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface-card p-6 shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('billing.title')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('billing.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-qira-pistachio/40 bg-qira-pistachio-lt/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-qira-pistachio-dk">
            {t('billing.comingSoon')}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{t('billing.comingSoonBody')}</p>
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-900">{t('billing.included')}</p>
          <ul className="mt-3 space-y-2">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                <Check size={16} className="mt-0.5 shrink-0 text-qira-pistachio" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <a
            href={`mailto:?subject=${encodeURIComponent(t('billing.mailSubject'))}`}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
          >
            <Mail size={16} />
            {t('billing.contact')}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
