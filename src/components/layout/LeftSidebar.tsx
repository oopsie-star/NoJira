import { LayoutDashboard, ListTodo, Users, Workflow, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'
import { projectPath, type AppSection } from '@/lib/projectRoutes'
import { useStore } from '@/store'

const NAV_ITEMS = [
  { section: 'board' as AppSection, key: 'nav.board', Icon: LayoutDashboard },
  { section: 'backlog' as AppSection, key: 'nav.backlog', Icon: ListTodo },
  { section: 'people' as AppSection, key: 'nav.people', Icon: Users },
  { section: 'ops' as AppSection, key: 'nav.ops', Icon: Workflow },
] as const

interface LeftSidebarProps {
  open: boolean
  onClose: () => void
}

export function LeftSidebar({ open, onClose }: LeftSidebarProps) {
  const { t } = useI18n()
  const projects = useStore((state) => state.projects)
  const projectMembers = useStore((state) => state.projectMembers)
  const projectTaskCount = useStore((state) => state.projectTaskCount)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const currentKey = activeProject?.key

  return (
    <>
    <aside className={[
      'flex w-[228px] flex-shrink-0 flex-col border-r border-slate-200 bg-white xl:w-[236px]',
      // Mobile: fixed slide-in overlay
      'fixed inset-y-0 left-0 z-40 transition-transform duration-300 ease-out',
      open ? 'translate-x-0' : '-translate-x-full',
      // Desktop: static, always visible, no animation
      'lg:static lg:z-auto lg:translate-x-0 lg:transition-none',
    ].join(' ')}>
      <div className="border-b border-slate-200 px-3.5 py-3.5 xl:px-4 xl:py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-qira-pistachio text-sm font-bold text-white shadow-sm">
            Q
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{activeProject?.name ?? t('app.name')}</p>
            <p className="truncate text-xs text-slate-500">
              {activeProject ? `${activeProject.key} • ${t('nav.softwareProject')}` : t('project.noProjects')}
            </p>
          </div>
          {/* Close button — mobile only */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <nav className="p-2">
        {NAV_ITEMS.map(({ section, key, Icon }) => (
          <NavLink
            key={section}
            to={currentKey ? projectPath(currentKey, section) : `/${section}`}
            onClick={onClose}
            className={({ isActive }) => [
              'mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              isActive
                ? 'bg-qira-pistachio-lt text-qira-pistachio shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            <Icon size={18} />
            {t(key)}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1" />

      <div className="p-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {t('project.current')}
          </p>
          {/* Stats for the ACTIVE project — its issues and its team. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">{t('project.tasks')}</p>
              <p className="mt-1 truncate text-lg font-semibold text-slate-900">{projectTaskCount}</p>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">{t('nav.people')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{projectMembers.length}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
    </>
  )
}
