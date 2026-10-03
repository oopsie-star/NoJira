import { useState } from 'react'
import { ChevronDown, ChevronRight, Moon, Palette, Sun } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

/**
 * What the colours mean, read straight off the rules that produce them:
 * the row cascade in BacklogRow and the badge palettes in IssueBadges.
 * If either changes, this has to change with it — it is documentation, and
 * documentation that drifts is worse than none.
 */
const ROW_COLOURS: { swatch: string; key: string }[] = [
  { swatch: 'border-emerald-200 bg-emerald-50', key: 'legend.row.unstarted' },
  { swatch: 'border-sky-200 bg-sky-50', key: 'legend.row.done' },
  { swatch: 'border-orange-300 bg-orange-50', key: 'legend.row.reworded' },
  { swatch: 'border-slate-300 bg-slate-100', key: 'legend.row.universal' },
  { swatch: 'border-qira-pistachio bg-qira-pistachio-lt', key: 'legend.row.selected' },
  { swatch: 'border-slate-200 bg-surface-card', key: 'legend.row.plain' },
]

const BADGE_COLOURS: { swatch: string; key: string }[] = [
  { swatch: 'border-rose-200 bg-rose-100', key: 'legend.badge.danger' },
  { swatch: 'border-amber-200 bg-amber-100', key: 'legend.badge.warn' },
  { swatch: 'border-emerald-200 bg-emerald-100', key: 'legend.badge.done' },
  { swatch: 'border-indigo-200 bg-indigo-100', key: 'legend.badge.story' },
]

/** The same swatch twice — once in each theme — so the list answers "what does
 *  this look like for me" whichever theme the reader is currently in. */
function SwatchPair({ swatch }: { swatch: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {/* BOTH swatches are explicitly scoped. Leaving the light one unscoped
          made it inherit whatever theme the page was in, so on a dark page the
          pair rendered as two identical dark squares. */}
      <span className="light contents">
        <span className={`h-4 w-4 rounded border ${swatch}`} aria-hidden />
      </span>
      <span className="dark contents">
        <span className={`h-4 w-4 rounded border ${swatch}`} aria-hidden />
      </span>
    </span>
  )
}

function LegendRows({ rows }: { rows: { swatch: string; key: string }[] }) {
  const { t } = useI18n()
  return (
    <ul className="space-y-1.5">
      {rows.map(({ swatch, key }) => (
        <li key={key} className="flex items-center gap-2">
          <SwatchPair swatch={swatch} />
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-slate-600">{t(key)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ColorLegend() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2 rounded-xl border border-slate-200 p-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:text-slate-700"
      >
        <Palette size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 text-left">{t('legend.title')}</span>
        {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
      </button>

      {open && (
        <div className="mt-2.5 space-y-3">
          <div className="flex items-center gap-2 pl-[2px]">
            <span className="flex shrink-0 gap-1">
              <span className="flex w-4 justify-center text-slate-400" title={t('common.themeLight')}><Sun size={11} /></span>
              <span className="flex w-4 justify-center text-slate-400" title={t('common.themeDark')}><Moon size={11} /></span>
            </span>
            <span className="text-[10px] uppercase tracking-wide text-slate-400">{t('legend.rowHeading')}</span>
          </div>
          <LegendRows rows={ROW_COLOURS} />

          <p className="pt-1 text-[10px] uppercase tracking-wide text-slate-400">{t('legend.badgeHeading')}</p>
          <LegendRows rows={BADGE_COLOURS} />

          <p className="border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-400">
            {t('legend.epicNote')}
          </p>
        </div>
      )}
    </div>
  )
}
