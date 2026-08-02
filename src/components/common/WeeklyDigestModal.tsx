import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { getMoodCopy } from '@/lib/weeklyDigest'
import { projectPath } from '@/lib/projectRoutes'
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
 * Scoped to whichever project is currently active: it appears when you
 * enter a project you haven't seen today's digest for, not all at once on
 * app load. Must be read to the bottom before it can be closed: the close
 * controls stay disabled until the content is scrolled all the way down,
 * or — for a short digest that doesn't need scrolling — as soon as it's
 * laid out.
 */
export function WeeklyDigestModal() {
  const current = useStore((state) => state.weeklyDigest)
  const dismiss = useStore((state) => state.dismissWeeklyDigest)
  const { t, locale } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)
  const [canClose, setCanClose] = useState(false)

  useLayoutEffect(() => {
    if (!current) { setCanClose(false); return }
    setCanClose(false)
    const el = contentRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) setCanClose(true)
  }, [current])

  if (!current) return null

  const { stats } = current
  const mood = getMoodCopy(stats.mood, locale)

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
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>{mood.emoji}</span>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{current.projectName}</span>
          </div>
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
              value={stats.activeDayLabels.length ? stats.activeDayLabels.join(', ') : '—'}
            />
            <Row
              label={t('weeklyDigest.missedDays')}
              value={stats.missedDayLabels.length ? stats.missedDayLabels.join(', ') : '—'}
            />
            <Row
              label={t('weeklyDigest.filesDownloaded')}
              value={stats.filesDownloaded.length ? stats.filesDownloaded.join(', ') : t('weeklyDigest.noActivity')}
            />
            <Row label={t('weeklyDigest.audioPlayed')} value={String(stats.audioPlayedCount)} />
            <Row label={t('weeklyDigest.commentsAdded')} value={String(stats.commentsAdded)} />
          </dl>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-500">{t('weeklyDigest.tasksViewed')}</p>
            {stats.tasksViewed.length ? (
              <ul className="mt-3 space-y-3">
                {stats.tasksViewed.map((task) => (
                  <li key={task.taskId} className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <a
                      href={`${projectPath(current.projectKey, 'backlog')}?task=${task.taskId}`}
                      className="font-semibold text-qira-pistachio-dk underline"
                    >
                      {task.taskKey}
                    </a>
                    <span className="ml-1.5 text-slate-700">{task.title}</span>
                    {task.count > 1 && <span className="ml-1.5 text-slate-400">×{task.count}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm font-medium text-slate-900">{t('weeklyDigest.noActivity')}</p>
            )}
          </div>
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
