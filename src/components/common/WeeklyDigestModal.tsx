import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { getMoodCopy } from '@/lib/weeklyDigest'
import { useStore } from '@/store'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  )
}

/**
 * Private, personal weekly digest — never a public leaderboard, just what
 * this one person did this week (see fetchWeeklyDigestIfDue in the store).
 * Must be read to the bottom before it can be closed: the close controls
 * stay disabled until the content is scrolled all the way down, or — for a
 * short digest that doesn't need scrolling — as soon as it's laid out.
 */
export function WeeklyDigestModal() {
  const digest = useStore((state) => state.weeklyDigest)
  const dismiss = useStore((state) => state.dismissWeeklyDigest)
  const { t, locale } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)
  const [canClose, setCanClose] = useState(false)

  useLayoutEffect(() => {
    if (!digest) { setCanClose(false); return }
    const el = contentRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) setCanClose(true)
  }, [digest])

  if (!digest) return null

  const mood = getMoodCopy(digest.mood, locale)

  function handleScroll() {
    const el = contentRef.current
    if (el && el.scrollHeight - el.scrollTop <= el.clientHeight + 24) setCanClose(true)
  }

  function handleClose() {
    if (canClose) void dismiss()
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <span className="text-2xl" aria-hidden>{mood.emoji}</span>
          <button
            type="button"
            onClick={handleClose}
            disabled={!canClose}
            aria-label={t('common.close')}
            className={[
              'rounded-lg p-1.5 transition',
              canClose ? 'text-slate-500 hover:bg-slate-100' : 'cursor-not-allowed text-slate-200',
            ].join(' ')}
          >
            <X size={18} />
          </button>
        </div>

        <div ref={contentRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{mood.headline}</h2>
          <p className="mt-1 text-sm text-slate-500">{mood.note}</p>

          <dl className="mt-5 divide-y divide-slate-100 text-sm">
            <Row
              label={t('weeklyDigest.activeDays')}
              value={digest.activeDayLabels.length ? digest.activeDayLabels.join(', ') : '—'}
            />
            <Row
              label={t('weeklyDigest.missedDays')}
              value={digest.missedDayLabels.length ? digest.missedDayLabels.join(', ') : '—'}
            />
            <Row
              label={t('weeklyDigest.tasksViewed')}
              value={digest.tasksViewed.length
                ? digest.tasksViewed.map((task) => `${task.title}${task.count > 1 ? ` ×${task.count}` : ''}`).join(', ')
                : t('weeklyDigest.noActivity')}
            />
            <Row
              label={t('weeklyDigest.filesDownloaded')}
              value={digest.filesDownloaded.length ? digest.filesDownloaded.join(', ') : t('weeklyDigest.noActivity')}
            />
            <Row label={t('weeklyDigest.audioPlayed')} value={String(digest.audioPlayedCount)} />
            <Row label={t('weeklyDigest.commentsAdded')} value={String(digest.commentsAdded)} />
          </dl>
        </div>

        <div className="border-t border-slate-100 px-5 py-3">
          {!canClose && <p className="mb-2 text-center text-xs text-slate-400">{t('weeklyDigest.readHint')}</p>}
          <button
            type="button"
            onClick={handleClose}
            disabled={!canClose}
            className={[
              'w-full rounded-2xl px-4 py-2.5 text-sm font-semibold transition',
              canClose ? 'bg-qira-pistachio text-white hover:bg-qira-pistachio-dk' : 'cursor-not-allowed bg-slate-100 text-slate-400',
            ].join(' ')}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
