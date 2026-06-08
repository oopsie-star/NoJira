import { useRef, useState, type ReactNode } from 'react'
import { Bold, Code, Eye, Italic, Link2, List, ListChecks, ListOrdered, Pencil, Quote, Strikethrough } from 'lucide-react'
import { MarkdownRenderer } from '@/lib/markdown'
import { useI18n } from '@/lib/i18n'
import type { Profile } from '@/types'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  rows?: number
  members?: Profile[]
}

export function MarkdownEditor({ value, onChange, onBlur, placeholder, rows = 8, members }: MarkdownEditorProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  function apply(transform: (sel: string) => { text: string; selStart: number; selEnd: number }) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const sel = value.slice(start, end)
    const { text, selStart, selEnd } = transform(sel)
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + selStart, start + selEnd)
    })
  }

  const wrap = (token: string, placeholderText = '') =>
    apply((sel) => {
      const inner = sel || placeholderText
      return { text: `${token}${inner}${token}`, selStart: token.length, selEnd: token.length + inner.length }
    })

  const prefixLines = (prefix: string | ((index: number) => string)) =>
    apply((sel) => {
      const lines = (sel || t('markdown.itemPlaceholder')).split('\n')
      const text = lines.map((ln, i) => `${typeof prefix === 'function' ? prefix(i) : prefix}${ln}`).join('\n')
      return { text, selStart: 0, selEnd: text.length }
    })

  function insertLink() {
    apply((sel) => {
      const label = sel || t('markdown.linkText')
      const text = `[${label}](url)`
      return { text, selStart: text.length - 4, selEnd: text.length - 1 }
    })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.metaKey || event.ctrlKey) {
      const k = event.key.toLowerCase()
      if (k === 'b') { event.preventDefault(); wrap('**', t('markdown.bold')) }
      else if (k === 'i') { event.preventDefault(); wrap('_', t('markdown.italic')) }
    }
  }

  const tools: { icon: ReactNode; label: string; run: () => void }[] = [
    { icon: <Bold size={15} />, label: t('markdown.bold'), run: () => wrap('**', t('markdown.bold')) },
    { icon: <Italic size={15} />, label: t('markdown.italic'), run: () => wrap('_', t('markdown.italic')) },
    { icon: <Strikethrough size={15} />, label: t('markdown.strike'), run: () => wrap('~~') },
    { icon: <Code size={15} />, label: t('markdown.code'), run: () => wrap('`') },
    { icon: <List size={15} />, label: t('markdown.bulletList'), run: () => prefixLines('- ') },
    { icon: <ListOrdered size={15} />, label: t('markdown.orderedList'), run: () => prefixLines((i) => `${i + 1}. `) },
    { icon: <ListChecks size={15} />, label: t('markdown.checklist'), run: () => prefixLines('- [ ] ') },
    { icon: <Quote size={15} />, label: t('markdown.quote'), run: () => prefixLines('> ') },
    { icon: <Link2 size={15} />, label: t('markdown.link'), run: insertLink },
  ]

  return (
    <div className="rounded-2xl border border-slate-200">
      <div className="flex items-center gap-0.5 border-b border-slate-200 px-1.5 py-1">
        {!preview && tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.label}
            onMouseDown={(e) => { e.preventDefault(); tool.run() }}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            {tool.icon}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
        >
          {preview ? <><Pencil size={13} /> {t('markdown.edit')}</> : <><Eye size={13} /> {t('markdown.preview')}</>}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[6rem] px-4 py-2">
          {value.trim()
            ? <MarkdownRenderer source={value} members={members} />
            : <p className="py-3 text-sm text-slate-400">{t('markdown.nothingToPreview')}</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          className="w-full resize-y rounded-b-2xl bg-transparent px-4 py-3 text-sm text-slate-900 outline-none"
        />
      )}
    </div>
  )
}
