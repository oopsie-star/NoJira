import { useRef, useState, type ReactNode } from 'react'
import { Bold, Code, Italic, Link2, List, ListChecks, ListOrdered, Loader2, Pencil, Quote, Sparkles, Strikethrough } from 'lucide-react'
import { MarkdownRenderer } from '@/lib/markdown'
import { useI18n } from '@/lib/i18n'
import type { Profile } from '@/types'

const MAX_SUGGESTION_CHARS = 800

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  rows?: number
  members?: Profile[]
  onAiSuggest?: (text: string) => Promise<string | null>
}

export function MarkdownEditor({ value, onChange, onBlur, placeholder, rows = 8, members, onAiSuggest }: MarkdownEditorProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLTextAreaElement>(null)
  // Rendered by default (so markdown from imports shows as formatted text,
  // not raw syntax) — editing is an explicit action, not the default state.
  const [editing, setEditing] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  function startEditing() {
    setEditing(true)
    requestAnimationFrame(() => ref.current?.focus())
  }

  function handleBlur() {
    setEditing(false)
    onBlur?.()
  }

  async function handleAiSuggest() {
    if (!onAiSuggest || aiLoading) return
    setAiLoading(true)
    setAiSuggestion(null)
    const result = await onAiSuggest(value)
    setAiLoading(false)
    if (result) setAiSuggestion(result.slice(0, MAX_SUGGESTION_CHARS))
  }

  function acceptSuggestion() {
    if (!aiSuggestion) return
    const separator = value.trim() ? '\n\n' : ''
    onChange(value + separator + aiSuggestion)
    setAiSuggestion(null)
  }

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

  if (!editing) {
    return value.trim() ? (
      <div className="group rounded-2xl border border-slate-200">
        <div className="flex items-center justify-end border-b border-slate-100 px-1.5 py-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            <Pencil size={13} /> {t('markdown.edit')}
          </button>
        </div>
        <div className="px-4 py-2">
          <MarkdownRenderer source={value} members={members} />
        </div>
      </div>
    ) : (
      <button
        type="button"
        onClick={startEditing}
        className="w-full rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-left text-sm text-slate-400 transition hover:border-qira-pistachio hover:text-slate-500"
      >
        {placeholder || t('markdown.edit')}
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200">
      <div className="flex items-center gap-0.5 border-b border-slate-200 px-1.5 py-1">
        {tools.map((tool) => (
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
        {onAiSuggest && (
          <button
            type="button"
            title={aiLoading ? t('ai.suggestGenerating') : t('ai.suggestDescription')}
            onMouseDown={(e) => { e.preventDefault(); void handleAiSuggest() }}
            disabled={aiLoading}
            className="ml-1 rounded-lg p-1.5 text-[#6B9E6B] transition hover:bg-slate-100 disabled:opacity-50"
          >
            {aiLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          </button>
        )}
      </div>

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        rows={rows}
        placeholder={placeholder}
        autoFocus
        className={['w-full resize-y bg-transparent px-4 py-3 text-sm text-slate-900 outline-none', aiSuggestion ? '' : 'rounded-b-2xl'].join(' ')}
      />

      {aiSuggestion && (
        <div className="rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Sparkles size={13} className="text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('ai.suggestLabel')}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-400">{aiSuggestion}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={acceptSuggestion}
              className="rounded-xl bg-[#6B9E6B] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#5a8a5a]"
            >
              {t('ai.suggestAccept')}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAiSuggestion(null)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white"
            >
              {t('ai.suggestReject')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
