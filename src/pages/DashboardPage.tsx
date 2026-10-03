import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, CalendarClock, CircleAlert, Clock, Plus, ShieldAlert, Sparkles, UserPlus,
} from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { BillingModal } from '@/components/dashboard/BillingModal'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { useAuthContext } from '@/auth/AuthContext'
import { useI18n } from '@/lib/i18n'
import { formatDate } from '@/lib/format'
import { attentionQueues, completedSince, summarizeProjects, type ProjectSummary } from '@/lib/dashboard'
import { projectPath } from '@/lib/projectRoutes'
import { useStore } from '@/store'

/**
 * Stands in for a real subscription. There is no plan or seat model in the
 * database — see BillingModal. One constant, so wiring up billing later means
 * replacing a single read rather than hunting literals through the page.
 */
const CURRENT_PLAN = 'pilot' as const

function greetingKey(): 'morning' | 'day' | 'evening' {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'day'
  return 'evening'
}

interface AttentionTileProps {
  label: string
  count: number
  Icon: typeof CircleAlert
  tone: 'neutral' | 'warn' | 'danger'
  to?: string
  onClick?: () => void
}

function AttentionTile({ label, count, Icon, tone, to, onClick }: AttentionTileProps) {
  const toneClasses = {
    neutral: 'border-slate-200 bg-surface-card hover:border-slate-300',
    warn: count > 0 ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/70' : 'border-slate-200 bg-surface-card hover:border-slate-300',
    danger: count > 0 ? 'border-rose-200 bg-rose-50 hover:bg-rose-100/70' : 'border-slate-200 bg-surface-card hover:border-slate-300',
  }[tone]

  const iconTone = {
    neutral: 'text-slate-400',
    warn: count > 0 ? 'text-amber-500' : 'text-slate-300',
    danger: count > 0 ? 'text-rose-500' : 'text-slate-300',
  }[tone]

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <Icon size={18} className={`shrink-0 ${iconTone}`} />
        <span className="text-2xl font-bold leading-none text-slate-900">{count}</span>
      </div>
      <p className="mt-2 text-xs font-medium leading-snug text-slate-600">{label}</p>
    </>
  )

  const className = `block rounded-2xl border p-3.5 text-left shadow-sm transition ${toneClasses}`
  if (to) return <Link to={to} className={className}>{body}</Link>
  return <button type="button" onClick={onClick} className={`${className} w-full`}>{body}</button>
}

function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const { locale, t } = useI18n()
  const { project, total, done, inProgress, progress, blocked, overdue, sprint, sprintDaysLeft, lastActivity } = summary

  return (
    <Link
      to={projectPath(project.key, 'board')}
      className="group flex flex-col rounded-2xl border border-slate-200 bg-surface-card p-4 shadow-sm transition hover:border-qira-pistachio/60 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{project.name}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{project.key}</p>
        </div>
        <ArrowRight size={16} className="mt-0.5 shrink-0 text-slate-300 transition group-hover:text-qira-pistachio" />
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs text-slate-500">
          <span>{t('dashboard.project.progress')}</span>
          <span className="font-semibold text-slate-900">{progress}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-qira-pistachio transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          {t('dashboard.project.counts', { done, total, inProgress })}
        </p>
      </div>

      {sprint && (
        <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
          <CalendarClock size={12} className="shrink-0 text-slate-400" />
          <span className="min-w-0 truncate font-medium">{sprint.name}</span>
          {sprintDaysLeft !== null && (
            <span className={`ml-auto shrink-0 font-semibold ${sprintDaysLeft < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
              {sprintDaysLeft < 0
                ? t('dashboard.project.sprintOverdue', { days: Math.abs(sprintDaysLeft) })
                : t('dashboard.project.sprintLeft', { days: sprintDaysLeft })}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {blocked > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
            <CircleAlert size={10} />
            {t('dashboard.tile.blocked')} {blocked}
          </span>
        )}
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            <AlertTriangle size={10} />
            {t('dashboard.tile.overdue')} {overdue}
          </span>
        )}
        {lastActivity && (
          <span className="ml-auto text-[10px] text-slate-400">
            {t('dashboard.project.updated', { date: formatDate(locale, lastActivity) })}
          </span>
        )}
      </div>
    </Link>
  )
}

export function DashboardPage() {
  const { t } = useI18n()
  const { profile } = useAuthContext()

  const projects = useStore((state) => state.projects)
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchDashboard = useStore((state) => state.fetchDashboard)
  const dashboardTasks = useStore((state) => state.dashboardTasks)
  const dashboardBlockLinks = useStore((state) => state.dashboardBlockLinks)
  const dashboardSprints = useStore((state) => state.dashboardSprints)
  const loadingDashboard = useStore((state) => state.loadingDashboard)
  const loadingProjects = useStore((state) => state.loadingProjects)
  const pendingMembers = useStore((state) => state.pendingMembers)
  const deletionRequests = useStore((state) => state.deletionRequests)
  const profileId = useStore((state) => state.profile?.id ?? null)

  const [billingOpen, setBillingOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  // Keyed on the project list rather than run once: the list arrives after the
  // first render, and on a cold load it is empty at mount.
  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard, projects.length])

  const queues = useMemo(
    () => attentionQueues(dashboardTasks, dashboardBlockLinks, profileId),
    [dashboardTasks, dashboardBlockLinks, profileId]
  )

  const summaries = useMemo(
    () => summarizeProjects(projects, dashboardTasks, dashboardBlockLinks, dashboardSprints)
      // Projects with work in flight lead; dormant ones settle at the bottom.
      .sort((left, right) => (right.inProgress - left.inProgress) || (right.total - left.total)),
    [projects, dashboardTasks, dashboardBlockLinks, dashboardSprints]
  )

  const doneThisWeek = useMemo(() => completedSince(dashboardTasks, 7), [dashboardTasks])
  const pendingDeletions = useMemo(
    () => deletionRequests.filter((request) => request.status === 'pending').length,
    [deletionRequests]
  )

  const firstProjectKey = projects[0]?.key
  const myWorkLink = firstProjectKey ? `${projectPath(firstProjectKey, 'backlog')}` : undefined
  // Both loads matter: the project list arrives first and the task slice second,
  // and keying the skeleton on either one alone flashes the "no projects" empty
  // state in the gap between them on a cold load.
  const showSkeleton = (loadingProjects || loadingDashboard) && summaries.length === 0

  // No Blocked tile: this workspace records no 'blocks' links at all, so it was
  // a permanent zero taking a slot. The queue is still computed and still feeds
  // the per-project chip, which only appears when there is something to report.
  // The approval tiles are admin-only and only when there is anything pending.
  const attentionTiles: AttentionTileProps[] = [
    { label: t('dashboard.tile.assignedNotStarted'), count: queues.assignedNotStarted.length, Icon: Clock, tone: 'neutral', to: myWorkLink },
    { label: t('dashboard.tile.myInProgress'), count: queues.myInProgress.length, Icon: Sparkles, tone: 'neutral', to: myWorkLink },
    { label: t('dashboard.tile.overdue'), count: queues.overdue.length, Icon: AlertTriangle, tone: 'danger', to: myWorkLink },
    { label: t('dashboard.tile.stale'), count: queues.stale.length, Icon: Clock, tone: 'warn', to: myWorkLink },
  ]
  const peopleLink = firstProjectKey ? projectPath(firstProjectKey, 'people') : undefined
  if (isAdmin && pendingMembers.length > 0) {
    attentionTiles.push({ label: t('dashboard.tile.pendingMembers'), count: pendingMembers.length, Icon: UserPlus, tone: 'warn', to: peopleLink })
  }
  if (isAdmin && pendingDeletions > 0) {
    attentionTiles.push({ label: t('dashboard.tile.pendingDeletions'), count: pendingDeletions, Icon: ShieldAlert, tone: 'warn', to: peopleLink })
  }

  return (
    <GlobalLayout>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] p-3 sm:p-5">

          {/* Hero — no address or domain here on purpose: a branded one is coming
              and nothing on this page should have to change when it does. */}
          <section className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
                {t(`dashboard.greeting.${greetingKey()}`, { name: (profile?.full_name || '').split(' ')[0] || '' })}
              </h1>
              <p className="mt-1 text-sm text-slate-500">{t('dashboard.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => setBillingOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-qira-pistachio/50 bg-qira-pistachio-lt/50 px-3 py-1.5 text-xs font-semibold text-qira-pistachio-dk transition hover:bg-qira-pistachio-lt"
            >
              <Sparkles size={14} />
              {t(`billing.plan.${CURRENT_PLAN}`)}
              <span className="text-qira-pistachio">· {t('billing.upgrade')}</span>
            </button>
          </section>

          {/* Triage — every tile is a queue of work, not a vanity number.
              One grid, admin tiles included: splitting them across two grids
              pushed the approvals onto a row of their own, and sizing the grid
              to the tiles present stretched them wide whenever there were few.
              Six columns is the maximum this can hold, so the row stays one row
              and a tile keeps the same width no matter how many are shown. */}
          <section className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {t('dashboard.attention')}
            </h2>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {attentionTiles.map((tile) => (
                <AttentionTile key={tile.label} {...tile} />
              ))}
            </div>
          </section>

          {/* Projects */}
          <section className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {t('dashboard.projects')}
              </h2>
              <span className="text-xs text-slate-400">
                {t('dashboard.weekSummary', { done: doneThisWeek })}
              </span>
            </div>

            {showSkeleton ? (
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-[168px] animate-pulse rounded-2xl bg-surface-card shadow-sm" />
                ))}
              </div>
            ) : summaries.length === 0 ? (
              <div className="mt-2.5 rounded-2xl border border-dashed border-slate-300 bg-surface-card p-10 text-center">
                <p className="text-sm font-semibold text-slate-900">{t('project.noProjects')}</p>
                <p className="mt-1 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
                >
                  <Plus size={16} />
                  {t('project.create')}
                </button>
              </div>
            ) : (
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {summaries.map((summary) => (
                  <ProjectCard key={summary.project.id} summary={summary} />
                ))}
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-surface-card/60 p-4 text-sm font-semibold text-slate-500 transition hover:border-qira-pistachio hover:text-qira-pistachio-dk"
                >
                  <Plus size={20} />
                  {t('project.create')}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      {billingOpen && <BillingModal onClose={() => setBillingOpen(false)} />}
      {/* The store appends the new project, so this page re-renders with its
          card already in place — no navigation needed. */}
      {createOpen && <CreateProjectModal onClose={() => setCreateOpen(false)} />}
    </GlobalLayout>
  )
}
