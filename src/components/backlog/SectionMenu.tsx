import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    // A fixed-position menu doesn't track its trigger while the page scrolls
    // or resizes, so close it rather than let it drift away from the button.
    function handleReposition() {
      setOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [open])

  if (items.length === 0) return null

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    }
    setOpen((value) => !value)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        onClick={handleToggle}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && position && createPortal(
        // Portaled to <body> (position: fixed) so the menu escapes any
        // ancestor's `overflow-hidden` — sections use that for rounded
        // corners, which otherwise clips the dropdown when the section is
        // shorter than the menu (e.g. an empty sprint with few actions).
        <div
          ref={menuRef}
          style={{ top: position.top, right: position.right }}
          className="fixed z-30 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
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
        </div>,
        document.body
      )}
    </>
  )
}
