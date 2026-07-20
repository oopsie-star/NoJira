import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Send, Share2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { buildEpicShareUrl, shareHref, taskShareBase, type ShareTarget } from '@/lib/share'
import type { Epic, Profile, Task } from '@/types'

const TARGETS: { id: ShareTarget; labelKey: string; dot: string }[] = [
  { id: 'telegram', labelKey: 'share.telegram', dot: 'bg-sky-500' },
  { id: 'whatsapp', labelKey: 'share.whatsapp', dot: 'bg-emerald-500' },
  { id: 'viber', labelKey: 'share.viber', dot: 'bg-violet-500' },
]

interface ShareEpicMenuProps {
  epic: Epic
  /** All tasks belonging to this epic — direct ones and those in its sprints. */
  tasks: Task[]
  members: Profile[]
  projectKey: string | undefined
}

export function ShareEpicMenu({ epic, tasks, members, projectKey }: ShareEpicMenuProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const epicUrl = projectKey ? buildEpicShareUrl(projectKey, epic.id) : window.location.href

  const fileCount = epic.attachments.length + tasks.reduce((sum, task) => sum + task.attachments.length, 0)

  const countsByAssignee = new Map<string, number>()
  let unassigned = 0
  for (const task of tasks) {
    const ids = task.assignee_ids?.length ? task.assignee_ids : (task.assignee_id ? [task.assignee_id] : [])
    if (!ids.length) {
      unassigned += 1
      continue
    }
    for (const id of ids) countsByAssignee.set(id, (countsByAssignee.get(id) ?? 0) + 1)
  }
  const assigneeLines = [...countsByAssignee.entries()]
    .map(([id, count]) => {
      const member = members.find((item) => item.id === id)
      return { name: member?.full_name || member?.email || '—', count }
    })
    .sort((a, b) => b.count - a.count)
  if (unassigned > 0) assigneeLines.push({ name: t('share.unassigned'), count: unassigned })

  const statsBlock = [
    `${t('share.fileCount')}: ${fileCount}`,
    '',
    `${t('share.tasksByAssignee')}:`,
    ...(assigneeLines.length ? assigneeLines.map((a) => `• ${a.name}: ${a.count}`) : ['—']),
  ].join('\n')

  const shareBody = `${taskShareBase(epic.key, epic.title, epic.description, 600)}\n\n${statsBlock}`

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  function openTarget(target: ShareTarget) {
    window.open(shareHref(target, shareBody, epicUrl), '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`${shareBody}\n\n${epicUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard unavailable — ignore.
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('share.button')}
        title={t('share.button')}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Share2 size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('share.titleEpic')}</p>
          {TARGETS.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => openTarget(target.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${target.dot} text-white`}>
                <Send size={13} />
              </span>
              {t(target.labelKey)}
            </button>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => void copyAll()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            </span>
            {copied ? t('share.copied') : t('share.copyLink')}
          </button>
        </div>
      )}
    </div>
  )
}
