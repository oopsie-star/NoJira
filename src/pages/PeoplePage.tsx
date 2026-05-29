import { useEffect, useState, type FormEvent } from 'react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuthContext } from '@/auth/AuthContext'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import type { Locale, ProjectRole } from '@/types'

function InviteForm() {
  const { t } = useI18n()
  const inviteToProject = useStore((state) => state.inviteToProject)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('member')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setFeedback(null)
    try {
      const result = await inviteToProject(email, role)
      setFeedback(result?.emailSent ? t('people.inviteSuccess') : t('people.invitePartial'))
      setEmail('')
      setRole('member')
    } catch (err) {
      setFeedback(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[28px] bg-white p-6 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.7fr_auto]">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('people.inviteEmail')}
          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as ProjectRole)}
          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
        >
          <option value="admin">{t('projectRole.admin')}</option>
          <option value="founder">{t('projectRole.founder')}</option>
          <option value="ceo">{t('projectRole.ceo')}</option>
          <option value="member">{t('projectRole.member')}</option>
          <option value="viewer">{t('projectRole.viewer')}</option>
        </select>
        <button
          type="submit"
          disabled={!email.trim() || loading}
          className="rounded-2xl bg-jira-blue px-4 py-3 text-sm font-semibold text-white transition hover:bg-jira-blue-dk disabled:opacity-60"
        >
          {t('people.inviteAction')}
        </button>
      </div>

      {feedback && (
        <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {feedback}
        </p>
      )}
    </form>
  )
}

export function PeoplePage() {
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchProjectInvites = useStore((state) => state.fetchProjectInvites)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const projects = useStore((state) => state.projects)
  const projectMembers = useStore((state) => state.projectMembers)
  const projectInvites = useStore((state) => state.projectInvites)
  const updateProfile = useStore((state) => state.updateProfile)
  const updateProjectMemberRole = useStore((state) => state.updateProjectMemberRole)

  const canManage = canManageProject(activeProjectRole)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      Promise.all([fetchMembers(), fetchProjectInvites()])
    }
  }, [activeProjectId, fetchMembers, fetchProjectInvites])

  return (
    <GlobalLayout>
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('nav.people')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{t('people.title')}</h1>
          <p className="mt-2 text-sm text-slate-500">{t('people.subtitle')}</p>
          <div className="mt-4 inline-flex rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {activeProject ? `${activeProject.name} • ` : ''}{t('people.memberCount', { count: projectMembers.length })}
          </div>
        </section>

        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
                {canManage && <InviteForm />}

                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-white shadow-sm">
                  {projectMembers.length === 0 ? (
                    <div className="p-10 text-sm text-slate-500">{t('people.empty')}</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-[minmax(0,1.2fr)_160px_1fr_1fr_140px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        <span>{t('people.name')}</span>
                        <span>{t('people.projectRole')}</span>
                        <span>{t('people.jobTitle')}</span>
                        <span>{t('people.department')}</span>
                        <span>{t('people.locale')}</span>
                      </div>

                      <div className="min-h-0 overflow-auto">
                        {projectMembers.map((member) => {
                          const person = member.profile
                          if (!person) return null

                          return (
                            <div key={member.id} className="grid grid-cols-[minmax(0,1.2fr)_160px_1fr_1fr_140px] items-center gap-4 border-b border-slate-200 px-5 py-4 last:border-b-0">
                              <div className="flex min-w-0 items-center gap-3">
                                <UserAvatar profile={person} size={38} muted={!person.avatar_url} />
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-900">{person.full_name || person.email}</p>
                                  <p className="truncate text-sm text-slate-500">{person.email}</p>
                                </div>
                              </div>

                              <select
                                disabled={!canManage || member.project_role === 'owner'}
                                value={member.project_role}
                                onChange={(event) => updateProjectMemberRole(member.id, event.target.value as ProjectRole)}
                                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              >
                                <option value="owner">{t('projectRole.owner')}</option>
                                <option value="admin">{t('projectRole.admin')}</option>
                                <option value="founder">{t('projectRole.founder')}</option>
                                <option value="ceo">{t('projectRole.ceo')}</option>
                                <option value="member">{t('projectRole.member')}</option>
                                <option value="viewer">{t('projectRole.viewer')}</option>
                              </select>

                              <input
                                disabled={profile?.id !== person.id}
                                defaultValue={person.job_title ?? ''}
                                onBlur={(event) => updateProfile(person.id, { job_title: event.target.value })}
                                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              />

                              <input
                                disabled={profile?.id !== person.id}
                                defaultValue={person.department ?? ''}
                                onBlur={(event) => updateProfile(person.id, { department: event.target.value })}
                                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              />

                              <select
                                disabled={profile?.id !== person.id}
                                value={person.locale as Locale}
                                onChange={(event) => updateProfile(person.id, { locale: event.target.value as Locale })}
                                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              >
                                <option value="en">{t('common.english')}</option>
                                <option value="ru">{t('common.russian')}</option>
                              </select>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </section>
              </div>

              <section className="min-h-0 overflow-y-auto rounded-[28px] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{t('people.pendingInvites')}</h2>
                {projectInvites.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">{t('people.noInvites')}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {projectInvites.map((invite) => (
                      <div key={invite.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{invite.email}</p>
                          <p className="text-xs text-slate-500">{t(`projectRole.${invite.project_role}`)}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {invite.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </GlobalLayout>
  )
}
