import { LayoutDashboard, ListTodo, Users, Workflow } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'

const MOBILE_NAV_ITEMS = [
  { to: '/board', key: 'nav.board', Icon: LayoutDashboard },
  { to: '/backlog', key: 'nav.backlog', Icon: ListTodo },
  { to: '/people', key: 'nav.people', Icon: Users },
  { to: '/ops', key: 'nav.ops', Icon: Workflow },
] as const

export function MobileBottomBar() {
  const { t } = useI18n()

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 lg:hidden"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <nav className="pointer-events-auto mx-auto flex max-w-md items-center gap-1 rounded-[28px] border border-slate-200/80 bg-white/95 p-2 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.55)] backdrop-blur">
        {MOBILE_NAV_ITEMS.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/board'}
            aria-label={t(key)}
            className={({ isActive }) => [
              'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition',
              isActive ? 'bg-qira-pistachio-lt text-qira-pistachio' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            <Icon size={18} />
            <span className="truncate">{t(key)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
