import { useState } from 'react'
import { LayoutDashboard, ListTodo, Plus, Users, Workflow, X } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { useI18n } from '@/lib/i18n'
import { projectPath, sectionFromPathname, type AppSection } from '@/lib/projectRoutes'
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
  const navigate = useNavigate()
  const location = useLocation()
  const projects = useStore((state) => state.projects)
  const projectMembers = useStore((state) => state.projectMembers)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const currentKey = activeProject?.key
  const currentSection = sectionFromPathname(location.pathname)
  const [showCreateProject, setShowCreateProject] = useState(false)

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

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200 px-2.5 py-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('project.all')}</p>
          <button
            type="button"
            onClick={() => {
              onClose()
              setShowCreateProject(true)
            }}
            title={t('project.create')}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-1">
          {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  navigate(projectPath(project.key, currentSection))
                  onClose()
                }}
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                  project.id === activeProjectId
                  ? 'bg-qira-pistachio-lt font-semibold text-qira-pistachio'
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

      <div className="p-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {t('project.current')}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">{t('project.all')}</p>
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

    {showCreateProject && (
      <CreateProjectModal onClose={() => setShowCreateProject(false)} />
    )}
    </>
  )
}
