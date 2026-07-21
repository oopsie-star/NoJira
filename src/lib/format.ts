import type { Locale, Profile } from '@/types'

export function formatDate(locale: Locale, value?: string | null, options?: { time?: boolean }) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    ...(options?.time ? { timeStyle: 'short' } : {}),
  }).format(new Date(value))
}

export function parseLabels(input: string) {
  return Array.from(new Set(
    input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  ))
}

export function formatPerson(profile?: Pick<Profile, 'full_name' | 'email'> | null) {
  if (!profile) return ''
  return profile.full_name || profile.email
}
