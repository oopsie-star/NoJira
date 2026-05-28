import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FolderPlus, Globe, LogOut, Plus } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuthContext } from '@/auth/AuthContext'
import { UserAvatar } from '@/components/common/UserAvatar'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'
import type { Locale } from '@/types'

function ProjectSwitcher() {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useI18n()
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const setActiveProjectId = useStore((state) => state.setActiveProjectId)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-[220px] items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-left text-white transition hover:bg-white/15"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70">{t('project.current')}</p>
          <p className="truncate text-sm font-semibold">{activeProject?.name ?? t('project.noProjects')}</p>
        </div>
        <ChevronDown size={16} className="text-white/70" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('project.switcher')}</p>
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                setActiveProjectId(project.id)
                setOpen(false)
              }}
              className={[
                'flex w-full items-start justify-between rounded-xl px-3 py-3 text-left transition',
                project.id === activeProjectId ? 'bg-jira-blue-lt text-jira-blue' : 'hover:bg-slate-100',
              ].join(' ')}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{project.name}</p>
                <p className="truncate text-xs text-slate-500">{project.key}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function HeaderMenu() {
  const ref = useRef<HTMLDivElement>(null)
  const { profile, signOut } = useAuthContext()
  const updateProfile = useStore((state) => state.updateProfile)
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  async function handleLocaleChange(nextLocale: Locale) {
    setLocale(nextLocale)
    if (profile && profile.locale !== nextLocale) {
      await updateProfile(profile.id, { locale: nextLocale })
    }
  }

  if (!profile) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-2.5 py-1.5 text-white transition hover:bg-white/15"
      >
        <UserAvatar profile={profile} size={30} />
        <div className="hidden text-left md:block">
          <p className="text-sm font-medium leading-none">{profile.full_name || profile.email}</p>
          <p className="mt-1 text-xs text-white/70">{t(`role.${profile.role}`)}</p>
        </div>
        <ChevronDown size={16} className="text-white/70" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-3">
              <UserAvatar profile={profile} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{profile.full_name || profile.email}</p>
                <p className="truncate text-xs text-slate-500">{profile.email}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {t(`role.${profile.role}`)}
                  {profile.job_title ? ` • ${profile.job_title}` : ''}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-slate-200 p-2">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              <Globe size={12} />
              {t('common.language')}
            </p>
            <div className="flex gap-2">
              {(['en', 'ru'] as Locale[]).map((item) => (
                <button
                  key={item}
                  onClick={() => handleLocaleChange(item)}
                  className={[
                    'flex-1 rounded-xl px-3 py-2 text-sm font-medium transition',
                    locale === item ? 'bg-jira-blue text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                  ].join(' ')}
                >
                  {item === 'en' ? t('common.english') : t('common.russian')}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut size={16} />
            {t('nav.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}

export function TopNavbar() {
  const location = useLocation()
  const { t } = useI18n()
  const activeProjectId = useStore((state) => state.activeProjectId)
  const projectMembers = useStore((state) => state.projectMembers)
  const [createOpen, setCreateOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)

  const currentLabel = useMemo(() => {
    if (location.pathname.startsWith('/backlog')) return t('nav.backlog')
    if (location.pathname.startsWith('/people')) return t('nav.people')
    return t('nav.board')
  }, [location.pathname, t])

  return (
    <>
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-jira-blue px-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">{t('nav.workspace')}</p>
            <h1 className="text-lg font-semibold text-white">{currentLabel}</h1>
          </div>
          <ProjectSwitcher />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center -space-x-2 lg:flex">
            {projectMembers.slice(0, 6).map((member) => (
              <UserAvatar key={member.id} profile={member.profile ?? null} size={32} muted={!member.profile} />
            ))}
            {projectMembers.length > 6 && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-jira-blue bg-white text-xs font-semibold text-slate-600">
                +{projectMembers.length - 6}
              </span>
            )}
          </div>

          <button
            onClick={() => setProjectOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            <FolderPlus size={16} />
            {t('project.create')}
          </button>

          <button
            onClick={() => setCreateOpen(true)}
            disabled={!activeProjectId}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={16} />
            {t('nav.create')}
          </button>
          <HeaderMenu />
        </div>
      </header>

      {createOpen && <CreateTaskModal onClose={() => setCreateOpen(false)} />}
      {projectOpen && <CreateProjectModal onClose={() => setProjectOpen(false)} />}
    </>
  )
}
