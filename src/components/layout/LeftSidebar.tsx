import { FolderKanban, LayoutDashboard, ListTodo, Plus, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'

const NAV_ITEMS = [
  { to: '/board', key: 'nav.board', Icon: LayoutDashboard },
  { to: '/backlog', key: 'nav.backlog', Icon: ListTodo },
  { to: '/people', key: 'nav.people', Icon: Users },
] as const

export function LeftSidebar() {
  const { t } = useI18n()
  const projects = useStore((state) => state.projects)
  const projectMembers = useStore((state) => state.projectMembers)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const setActiveProjectId = useStore((state) => state.setActiveProjectId)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  return (
    <aside className="flex w-[264px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-jira-blue text-sm font-bold text-white shadow-sm">
            NJ
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{activeProject?.name ?? t('app.name')}</p>
            <p className="truncate text-xs text-slate-500">
              {activeProject ? `${activeProject.key} • ${t('nav.softwareProject')}` : t('project.noProjects')}
            </p>
          </div>
        </div>
      </div>

      <nav className="p-3">
        {NAV_ITEMS.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => [
              'mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              isActive
                ? 'bg-jira-blue-lt text-jira-blue shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            <Icon size={18} />
            {t(key)}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200 px-3 py-4">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('project.switcher')}</p>
          <Plus size={14} className="text-slate-400" />
        </div>
        <div className="space-y-1">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setActiveProjectId(project.id)}
              className={[
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                project.id === activeProjectId
                  ? 'bg-jira-blue-lt font-semibold text-jira-blue'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              ].join(' ')}
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 text-[11px] font-bold text-white">
                {project.key.slice(0, 2)}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{project.name}</span>
                <span className="block truncate text-xs font-normal text-slate-400">{project.key}</span>
              </span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">{t('project.noProjects')}</p>
          )}
        </div>
      </div>

      <div className="p-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {t('project.current')}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">{t('project.switcher')}</p>
              <p className="mt-1 truncate text-lg font-semibold text-slate-900">{projects.length}</p>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">{t('nav.people')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{projectMembers.length}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
