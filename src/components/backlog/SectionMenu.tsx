import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface SectionMenuItem {
  label: string
  onSelect: () => void | Promise<void>
  danger?: boolean
  disabled?: boolean
}

interface SectionMenuProps {
  items: SectionMenuItem[]
  label: string
}

export function SectionMenu({ items, label }: SectionMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                void item.onSelect()
              }}
              className={[
                'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition',
                item.danger
                  ? 'text-rose-600 hover:bg-rose-50'
                  : 'text-slate-700 hover:bg-slate-100',
                item.disabled ? 'cursor-not-allowed opacity-50' : '',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
