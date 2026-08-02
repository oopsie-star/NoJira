import type { ActivityEvent, Locale } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY_LABELS: Record<Locale, string[]> = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

/** Whether two timestamps fall on the same local calendar day (for "shown today?" gating). */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export type DigestMood = 'praise' | 'neutral' | 'nudge' | 'sad'

export interface WeeklyDigestStats {
  activeDayLabels: string[]
  missedDayLabels: string[]
  activeDaysThisWeek: number
  activeDaysPrevWeek: number
  tasksViewed: { title: string; count: number }[]
  filesDownloaded: string[]
  audioPlayedCount: number
  commentsAdded: number
  mood: DigestMood
}

function dayBounds(daysAgo: number, now: number) {
  const d = new Date(now - daysAgo * DAY_MS)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return { start, end: start + DAY_MS, weekday: new Date(start).getDay() }
}

/** Whether any event of the given type falls within [start, end). */
function hasEventInRange(events: ActivityEvent[], type: string, start: number, end: number) {
  return events.some((e) => {
    if (e.event_type !== type) return false
    const ts = new Date(e.created_at).getTime()
    return ts >= start && ts < end
  })
}

/**
 * Builds a personal weekly digest from a profile's own activity_events
 * (login / view_task / download_attachment / play_audio — see
 * 20260721010000_activity_events.sql) plus their comment count for the
 * week (task_comments isn't part of activity_events, passed in separately).
 * `events` should cover at least the last 14 days for the week-over-week
 * comparison that drives the mood.
 */
export function computeWeeklyDigest(
  events: ActivityEvent[],
  commentsThisWeek: number,
  locale: Locale,
  now: number = Date.now(),
): WeeklyDigestStats {
  const labels = WEEKDAY_LABELS[locale]
  const activeDayLabels: string[] = []
  const missedDayLabels: string[] = []
  let activeDaysThisWeek = 0
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const { start, end, weekday } = dayBounds(daysAgo, now)
    if (hasEventInRange(events, 'login', start, end)) {
      activeDaysThisWeek += 1
      activeDayLabels.push(labels[weekday])
    } else {
      missedDayLabels.push(labels[weekday])
    }
  }

  let activeDaysPrevWeek = 0
  for (let daysAgo = 13; daysAgo >= 7; daysAgo -= 1) {
    const { start, end } = dayBounds(daysAgo, now)
    if (hasEventInRange(events, 'login', start, end)) activeDaysPrevWeek += 1
  }

  const weekStart = dayBounds(6, now).start
  const thisWeekEvents = events.filter((e) => new Date(e.created_at).getTime() >= weekStart)

  const viewCounts = new Map<string, { title: string; count: number }>()
  for (const event of thisWeekEvents) {
    if (event.event_type !== 'view_task' || !event.task_id) continue
    const title = event.detail ?? event.task?.title ?? '—'
    const entry = viewCounts.get(event.task_id) ?? { title, count: 0 }
    entry.count += 1
    viewCounts.set(event.task_id, entry)
  }

  const filesDownloaded = [...new Set(
    thisWeekEvents.filter((e) => e.event_type === 'download_attachment' && e.detail).map((e) => e.detail as string),
  )]

  const audioPlayedCount = thisWeekEvents.filter((e) => e.event_type === 'play_audio').length

  let mood: DigestMood = 'neutral'
  if (activeDaysThisWeek === 0) mood = 'sad'
  else if (activeDaysThisWeek > activeDaysPrevWeek) mood = 'praise'
  else if (activeDaysThisWeek < activeDaysPrevWeek) mood = 'nudge'

  return {
    activeDayLabels,
    missedDayLabels,
    activeDaysThisWeek,
    activeDaysPrevWeek,
    tasksViewed: [...viewCounts.values()].sort((a, b) => b.count - a.count),
    filesDownloaded,
    audioPlayedCount,
    commentsAdded: commentsThisWeek,
    mood,
  }
}

const MOOD_COPY: Record<DigestMood, Record<Locale, { emoji: string; headline: string; note: string }>> = {
  praise: {
    ru: { emoji: '🌿', headline: 'На этой неделе вы были на связи чаще — заметно!', note: 'Так держать — команде это правда помогает.' },
    en: { emoji: '🌿', headline: 'You showed up more this week — noticed!', note: 'Keep it up, it genuinely helps the team.' },
  },
  neutral: {
    ru: { emoji: '👋', headline: 'Ваша неделя в системе', note: 'Ровно как обычно — просто чтобы вы видели картину со стороны.' },
    en: { emoji: '👋', headline: 'Your week in the system', note: 'About the same as usual — just so you can see it from the outside.' },
  },
  nudge: {
    ru: { emoji: '😕', headline: 'На этой неделе заходили реже, чем раньше', note: 'Возможно, дело в загрузке — но команда меньше видит, что у вас происходит.' },
    en: { emoji: '😕', headline: 'You checked in less than the week before', note: "Might just be a busy week — but the team sees less of what's going on for you." },
  },
  sad: {
    ru: { emoji: '😔', headline: 'На этой неделе вас совсем не было видно', note: 'Задачи и комментарии ждали, а никто их не открывал. Всё в порядке?' },
    en: { emoji: '😔', headline: "You weren't around at all this week", note: 'Tasks and comments were waiting with nobody looking at them. Everything okay?' },
  },
}

export function getMoodCopy(mood: DigestMood, locale: Locale) {
  return MOOD_COPY[mood][locale]
}
