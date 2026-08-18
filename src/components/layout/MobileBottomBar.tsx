import { Archive, LayoutDashboard, ListTodo, Map, Users, Workflow } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'
import { projectPath, useCurrentProjectKey, type AppSection } from '@/lib/projectRoutes'
import { useStore } from '@/store'

const MOBILE_NAV_ITEMS = [
  { section: 'board' as AppSection, key: 'nav.board', Icon: LayoutDashboard },
  { section: 'backlog' as AppSection, key: 'nav.backlog', Icon: ListTodo },
  { section: 'map' as AppSection, key: 'nav.map', Icon: Map },
  { section: 'people' as AppSection, key: 'nav.people', Icon: Users },
  { section: 'ops' as AppSection, key: 'nav.ops', Icon: Workflow },
  { section: 'archive' as AppSection, key: 'nav.archive', Icon: Archive },
] as const

export function MobileBottomBar() {
  const { t } = useI18n()
  const currentKey = useCurrentProjectKey()
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const clearTaskContext = useStore((state) => state.clearTaskContext)

  return (
    // A solid bar docked to the bottom edge — not a floating pill — and above
    // the task drawer (z-[70]) so it stays reachable on every screen, the task
    // view included. Draft fields all persist on blur, which fires before the
    // tap lands, so closing the task from here can't lose an in-flight edit.
    <nav
      className="fixed inset-x-0 bottom-0 z-[75] flex items-stretch border-t border-slate-200 bg-white px-1 pt-1.5 lg:hidden"
      style={{ height: 'var(--qira-mobile-nav-h)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {MOBILE_NAV_ITEMS.map(({ section, key, Icon }) => (
        <NavLink
          key={section}
          to={currentKey ? projectPath(currentKey, section) : `/${section}`}
          end={section === 'board'}
          aria-label={t(key)}
          onClick={() => { clearTaskContext(); setOpenTaskId(null) }}
          className={({ isActive }) => [
            'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1 text-[10px] font-semibold leading-tight transition',
            isActive ? 'bg-qira-pistachio-lt text-qira-pistachio' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
          ].join(' ')}
        >
          <Icon size={20} className="shrink-0" />
          <span className="w-full truncate text-center">{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
