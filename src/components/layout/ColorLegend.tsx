import { useState } from 'react'
import { ChevronDown, ChevronRight, Palette } from 'lucide-react'
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

/**
 * One swatch, carrying whatever the active theme resolves it to. It needs no
 * theme scope of its own precisely because it uses the same classes the real UI
 * uses — so it cannot drift from what is on screen.
 *
 * It used to show the colour twice, light beside dark. That was a misreading:
 * the point of the guide is to decode what you are looking at right now, and
 * the other theme's square is a colour you will never see on this screen.
 */
function Swatch({ swatch }: { swatch: string }) {
  return <span className={`h-4 w-4 shrink-0 rounded border ${swatch}`} aria-hidden />
}

function LegendRows({ rows }: { rows: { swatch: string; key: string }[] }) {
  const { t } = useI18n()
  return (
    <ul className="space-y-1.5">
      {rows.map(({ swatch, key }) => (
        <li key={key} className="flex items-center gap-2">
          <Swatch swatch={swatch} />
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
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('legend.rowHeading')}</p>
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
