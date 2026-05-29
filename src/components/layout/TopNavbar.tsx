import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Check, ChevronDown, FolderPlus, Globe, LogOut, Menu, Plus } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthContext } from '@/auth/AuthContext'
import { UserAvatar } from '@/components/common/UserAvatar'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { CreateTaskModal } from '@/components/task/CreateTaskModal'
import { useI18n } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
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
        className="flex min-w-0 max-w-[58vw] items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-left text-white transition hover:bg-white/15 sm:max-w-none sm:min-w-[200px] sm:gap-3 sm:rounded-xl"
      >
        <div className="min-w-0">
          <p className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 sm:block">{t('project.current')}</p>
          <p className="truncate text-sm font-semibold">{activeProject?.name ?? t('project.noProjects')}</p>
        </div>
        <ChevronDown size={16} className="text-white/70" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[calc(100vw-1.5rem)] max-w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
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

function NotificationMenu() {
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const activeProjectId = useStore((state) => state.activeProjectId)
  const notifications = useStore((state) => state.notifications)
  const fetchNotifications = useStore((state) => state.fetchNotifications)
  const markNotificationRead = useStore((state) => state.markNotificationRead)
  const markAllNotificationsRead = useStore((state) => state.markAllNotificationsRead)
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
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

  useEffect(() => {
    if (!profile || !activeProjectId) return

    void fetchNotifications()

    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.id}` },
        () => { void fetchNotifications() }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeProjectId, fetchNotifications, profile])

  const unreadCount = notifications.filter((notification) => !notification.is_read).length

  async function handleOpenNotification(notificationId: string, taskId: string | null) {
    await markNotificationRead(notificationId)
    setOpen(false)
    if (taskId) {
      navigate('/backlog')
      setOpenTaskId(taskId)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-xl border border-white/10 bg-white/10 p-2 text-white transition hover:bg-white/15"
        title={t('nav.notifications')}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[calc(100vw-1.5rem)] max-w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{t('nav.notifications')}</p>
            <button
              type="button"
              onClick={() => void markAllNotificationsRead()}
              className="text-xs font-semibold text-jira-blue transition hover:text-jira-blue-dk"
            >
              {t('nav.markAllRead')}
            </button>
          </div>

          <div className="overflow-y-auto p-2" style={{ maxHeight: 'min(420px, calc(100dvh - 5rem))' }}>
            {notifications.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{t('nav.noNotifications')}</p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void handleOpenNotification(notification.id, notification.task_id)}
                  className={[
                    'mb-2 w-full rounded-2xl border px-4 py-3 text-left transition last:mb-0',
                    notification.is_read ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-jira-blue/20 bg-jira-blue-lt/40 hover:bg-jira-blue-lt/60',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{notification.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{notification.body}</p>
                      {notification.task && (
                        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                          {notification.task.key} - {notification.task.title}
                        </p>
                      )}
                    </div>
                    {!notification.is_read && <Check size={16} className="mt-0.5 flex-shrink-0 text-jira-blue" />}
                  </div>
                </button>
              ))
            )}
          </div>
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
                  onClick={() => void handleLocaleChange(item)}
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

export function TopNavbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const location = useLocation()
  const { t } = useI18n()
  const activeProjectId = useStore((state) => state.activeProjectId)
  const projectMembers = useStore((state) => state.projectMembers)
  const [createOpen, setCreateOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)

  const currentLabel = useMemo(() => {
    if (location.pathname.startsWith('/backlog')) return t('nav.backlog')
    if (location.pathname.startsWith('/people')) return t('nav.people')
    if (location.pathname.startsWith('/ops')) return t('nav.ops')
    return t('nav.board')
  }, [location.pathname, t])

  return (
    <>
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-jira-blue px-3 shadow-sm sm:h-14 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Hamburger — mobile only */}
          <button
            onClick={onToggleSidebar}
            className="flex-shrink-0 rounded-xl border border-white/10 bg-white/10 p-2 text-white transition hover:bg-white/15 lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <div className="hidden min-w-0 sm:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">{t('nav.workspace')}</p>
            <h1 className="text-base font-semibold text-white">{currentLabel}</h1>
          </div>
          <ProjectSwitcher />
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="hidden items-center -space-x-2 lg:flex">
            {projectMembers.slice(0, 5).map((member) => (
              <UserAvatar key={member.id} profile={member.profile ?? null} size={30} muted={!member.profile} />
            ))}
            {projectMembers.length > 5 && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-jira-blue bg-white text-[10px] font-semibold text-slate-600">
                +{projectMembers.length - 5}
              </span>
            )}
          </div>

          <NotificationMenu />

          <button
            onClick={() => setProjectOpen(true)}
            className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15 md:inline-flex"
          >
            <FolderPlus size={16} />
            {t('project.create')}
          </button>

          {activeProjectId && (
            <button
              onClick={() => setCreateOpen(true)}
              aria-label={t('nav.create')}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white p-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 sm:rounded-xl sm:px-3 sm:py-2"
            >
              <Plus size={18} />
              <span className="hidden sm:inline">{t('nav.create')}</span>
            </button>
          )}
          <HeaderMenu />
        </div>
      </header>

      {createOpen && <CreateTaskModal onClose={() => setCreateOpen(false)} />}
      {projectOpen && <CreateProjectModal onClose={() => setProjectOpen(false)} />}
    </>
  )
}
