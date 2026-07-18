import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Send, Share2 } from 'lucide-react'
import { displayFilename } from '@/lib/attachments'
import { useI18n } from '@/lib/i18n'
import { buildTaskShareUrl, shareHref, signedAttachmentLinks, taskShareBase, withAttachmentNames, withAttachments, type ShareTarget } from '@/lib/share'
import { useStore } from '@/store'
import type { Task } from '@/types'

const TARGETS: { id: ShareTarget; labelKey: string; dot: string }[] = [
  { id: 'telegram', labelKey: 'share.telegram', dot: 'bg-sky-500' },
  { id: 'whatsapp', labelKey: 'share.whatsapp', dot: 'bg-emerald-500' },
  { id: 'viber', labelKey: 'share.viber', dot: 'bg-violet-500' },
]

export function ShareTaskMenu({ task, projectKey }: { task: Task; projectKey: string | undefined }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [clipboardBlock, setClipboardBlock] = useState('')
  const [copied, setCopied] = useState(false)

  const attachmentNotes = useStore((state) => state.attachmentNotes)
  const nameForAttachment = (path: string) => displayFilename(path, attachmentNotes[path]?.original_name)

  const taskUrl = projectKey ? buildTaskShareUrl(projectKey, task.id) : window.location.href

  // Messenger deep links must stay short — include attachment NAMES only, no giant
  // signed URLs (those break Telegram/Viber's URL length limit).
  const messengerBody = withAttachmentNames(
    taskShareBase(task.key, task.title, task.description, 400),
    task.attachments.map(nameForAttachment),
    t('share.attachments'),
  )

  // Clipboard has no length limit — include full signed attachment links.
  const clipboardBody = taskShareBase(task.key, task.title, task.description, 1000) + clipboardBlock

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // Resolve signed attachment links when the menu opens (for the clipboard copy),
  // so the copy handler stays synchronous.
  useEffect(() => {
    if (!open || task.attachments.length === 0) return
    let active = true
    void signedAttachmentLinks(task.attachments, nameForAttachment).then((links) => {
      if (active) setClipboardBlock(withAttachments('', links, t('share.attachments')))
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task.attachments, t])

  function openTarget(target: ShareTarget) {
    window.open(shareHref(target, messengerBody, taskUrl), '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`${clipboardBody}\n\n${taskUrl}`)
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
        className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Share2 size={18} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('share.title')}</p>
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
