import { LayoutDashboard, ListTodo, Users, Workflow } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'
import { projectPath, useCurrentProjectKey, type AppSection } from '@/lib/projectRoutes'

const MOBILE_NAV_ITEMS = [
  { section: 'board' as AppSection, key: 'nav.board', Icon: LayoutDashboard },
  { section: 'backlog' as AppSection, key: 'nav.backlog', Icon: ListTodo },
  { section: 'people' as AppSection, key: 'nav.people', Icon: Users },
  { section: 'ops' as AppSection, key: 'nav.ops', Icon: Workflow },
] as const

export function MobileBottomBar() {
  const { t } = useI18n()
  const currentKey = useCurrentProjectKey()

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 lg:hidden"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <nav className="pointer-events-auto mx-auto flex max-w-md items-center gap-1 rounded-[28px] border border-slate-200/80 bg-white/95 p-2 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.55)] backdrop-blur">
        {MOBILE_NAV_ITEMS.map(({ section, key, Icon }) => (
          <NavLink
            key={section}
            to={currentKey ? projectPath(currentKey, section) : `/${section}`}
            end={section === 'board'}
            aria-label={t(key)}
            className={({ isActive }) => [
              'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-xs font-semibold transition',
              isActive ? 'bg-qira-pistachio-lt text-qira-pistachio' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            <Icon size={22} />
            <span className="truncate">{t(key)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
