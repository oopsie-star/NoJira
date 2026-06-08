import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, FolderKanban, Search, SquareCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'

interface TaskHit { id: string; key: string; title: string; project_id: string }
type Item =
  | { kind: 'project'; id: string; label: string; sub: string }
  | { kind: 'task'; id: string; label: string; sub: string; projectId: string }

export function CommandPalette() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const projects = useStore((s) => s.projects)
  const setActiveProjectId = useStore((s) => s.setActiveProjectId)
  const setOpenTaskId = useStore((s) => s.setOpenTaskId)
  const fetchBacklog = useStore((s) => s.fetchBacklog)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [taskHits, setTaskHits] = useState<TaskHit[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Global Cmd/Ctrl-K toggle.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setTaskHits([])
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Debounced global task search (RLS limits to the user's projects).
  useEffect(() => {
    if (!open) return
    const safe = query.trim().replace(/[%,()\\]/g, '')
    if (!safe) { setTaskHits([]); return }
    const handle = window.setTimeout(async () => {
      const { data } = await supabase
        .from('tasks')
        .select('id,key,title,project_id')
        .or(`title.ilike.%${safe}%,key.ilike.%${safe}%`)
        .limit(12)
      setTaskHits((data ?? []) as TaskHit[])
    }, 180)
    return () => window.clearTimeout(handle)
  }, [query, open])

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]))
    return (id: string) => map.get(id) ?? ''
  }, [projects])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const projectHits = (q
      ? projects.filter((p) => `${p.name} ${p.key}`.toLowerCase().includes(q))
      : projects
    ).slice(0, 5)
    return [
      ...projectHits.map((p): Item => ({ kind: 'project', id: p.id, label: p.name, sub: p.key })),
      ...taskHits.map((tk): Item => ({ kind: 'task', id: tk.id, label: tk.title, sub: `${tk.key} · ${projectName(tk.project_id)}`, projectId: tk.project_id })),
    ]
  }, [projects, taskHits, query, projectName])

  useEffect(() => { setActiveIndex(0) }, [items.length])

  async function select(item: Item) {
    setOpen(false)
    if (item.kind === 'project') {
      setActiveProjectId(item.id)
      navigate('/backlog')
      await fetchBacklog()
    } else {
      setActiveProjectId(item.projectId)
      navigate('/backlog')
      await fetchBacklog()
      setOpenTaskId(item.id)
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
    else if (event.key === 'Enter' && items[activeIndex]) { event.preventDefault(); void select(items[activeIndex]) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <Search size={18} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('command.placeholder')}
            className="w-full bg-transparent py-3.5 text-sm text-slate-900 outline-none"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">{t('command.empty')}</p>
          ) : (
            items.map((item, index) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void select(item)}
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                  index === activeIndex ? 'bg-qira-pistachio-lt' : 'hover:bg-slate-50',
                ].join(' ')}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.kind === 'project' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'}`}>
                  {item.kind === 'project' ? <FolderKanban size={15} /> : <SquareCheck size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="block truncate text-xs text-slate-500">{item.sub}</span>
                </span>
                {index === activeIndex && <CornerDownLeft size={14} className="shrink-0 text-slate-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
