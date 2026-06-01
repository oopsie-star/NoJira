import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle, Trash2 } from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuthContext } from '@/auth/AuthContext'
import { parseSandboxDeliveryNote } from '@/lib/approvalNotifications'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { canInviteToProject, canManageProject } from '@/lib/permissions'
import { useStore } from '@/store'
import type { Locale, Profile, ProjectRole } from '@/types'

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
          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as ProjectRole)}
          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
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
          className="rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
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

function getApprovalEmailStateLabel(profile: Profile, t: (key: string) => string) {
  if (parseSandboxDeliveryNote(profile.approval_email_last_error)) return t('people.approvalEmailSandbox')
  if (profile.approval_email_sent_at) return t('people.approvalEmailSent')
  if (profile.approval_email_last_error) return t('people.approvalEmailFailed')
  return t('people.approvalEmailPending')
}

export function PeoplePage() {
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchProjectInvites = useStore((state) => state.fetchProjectInvites)
  const fetchPendingMembers = useStore((state) => state.fetchPendingMembers)
  const fetchWorkspaceProjects = useStore((state) => state.fetchWorkspaceProjects)
  const approveMember = useStore((state) => state.approveMember)
  const deleteProject = useStore((state) => state.deleteProject)
  const triggerApprovalNotification = useStore((state) => state.triggerApprovalNotification)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const projects = useStore((state) => state.projects)
  const workspaceProjects = useStore((state) => state.workspaceProjects)
  const projectMembers = useStore((state) => state.projectMembers)
  const projectInvites = useStore((state) => state.projectInvites)
  const pendingMembers = useStore((state) => state.pendingMembers)
  const updateProfile = useStore((state) => state.updateProfile)
  const updateProjectMemberRole = useStore((state) => state.updateProjectMemberRole)

  const [retryingProfileId, setRetryingProfileId] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
  const isAdmin = profile?.role === 'admin'
  const canManage = canManageProject(activeProjectRole)
  const canInvite = canInviteToProject(activeProjectRole)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      Promise.all([fetchMembers(), fetchProjectInvites()])
    }
  }, [activeProjectId, fetchMembers, fetchProjectInvites])

  useEffect(() => {
    if (!isAdmin) return
    void Promise.all([fetchPendingMembers(), fetchWorkspaceProjects()])
  }, [isAdmin, fetchPendingMembers, fetchWorkspaceProjects])

  async function handleApprovalEmailRetry(profileId: string) {
    setRetryingProfileId(profileId)
    try {
      await triggerApprovalNotification({ profileId, force: true })
    } finally {
      setRetryingProfileId(null)
    }
  }

  async function handleDeleteProject(projectId: string, projectName: string) {
    if (!window.confirm(t('project.deleteConfirm', { name: projectName }))) return

    setDeletingProjectId(projectId)
    setProjectActionError(null)
    try {
      await deleteProject(projectId)
    } catch (err) {
      setProjectActionError(getErrorMessage(err))
    } finally {
      setDeletingProjectId(null)
    }
  }

  return (
    <GlobalLayout>
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        <section className="shrink-0 rounded-[28px] bg-white px-5 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-base font-semibold text-slate-900">{t('people.title')}</h1>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500">{t('people.subtitle')}</span>
            {activeProject && (
              <>
                <span className="text-slate-300">·</span>
                <span className="rounded-full bg-qira-pistachio-lt px-3 py-0.5 text-sm font-semibold text-qira-pistachio">
                  {activeProject.name} · {t('people.memberCount', { count: projectMembers.length })}
                </span>
              </>
            )}
          </div>
        </section>

        {isAdmin && pendingMembers.length > 0 && (
          <section className="rounded-[28px] bg-amber-50 p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">{t('people.pendingApprovals')} ({pendingMembers.length})</h2>
            <div className="mt-4 space-y-3">
              {pendingMembers.map((pending) => {
                const sandboxInfo = parseSandboxDeliveryNote(pending.approval_email_last_error)

                return (
                  <div key={pending.id} className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-white px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <UserAvatar profile={pending} size={36} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{pending.full_name || pending.email}</p>
                        <p className="break-all text-xs text-slate-500">{pending.email}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2.5 py-1 font-semibold ${
                            sandboxInfo
                              ? 'bg-sky-50 text-sky-700'
                              : pending.approval_email_sent_at
                                ? 'bg-emerald-50 text-emerald-700'
                                : pending.approval_email_last_error
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-slate-100 text-slate-600'
                          }`}>
                            {getApprovalEmailStateLabel(pending, t)}
                          </span>
                          {pending.approval_email_attempts > 0 && (
                            <span className="text-slate-400">#{pending.approval_email_attempts}</span>
                          )}
                          {sandboxInfo && (
                            <span className="w-full break-words whitespace-pre-wrap text-sky-700">
                              {t('people.approvalEmailSandboxNote', {
                                deliveredTo: sandboxInfo.deliveredTo,
                                adminEmail: sandboxInfo.intendedRecipient ?? '—',
                              })}
                            </span>
                          )}
                          {!sandboxInfo && pending.approval_email_last_error && (
                            <span className="w-full break-words whitespace-pre-wrap text-rose-600">{pending.approval_email_last_error}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                      <button
                        onClick={() => void handleApprovalEmailRetry(pending.id)}
                        disabled={retryingProfileId === pending.id}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      >
                        {retryingProfileId === pending.id ? t('people.approvalEmailRetrying') : t('people.retryApprovalEmail')}
                      </button>
                      <button
                        onClick={() => approveMember(pending.id)}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk sm:w-auto"
                      >
                        <CheckCircle size={16} />
                        Одобрить
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="rounded-[28px] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{t('project.workspaceProjects')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('project.workspaceProjectsHint')}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                {workspaceProjects.length}
              </span>
            </div>

            {projectActionError && (
              <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{projectActionError}</p>
            )}

            {workspaceProjects.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t('people.noWorkspaceProjects')}</p>
            ) : (
              <div className="mt-4 space-y-3">
                {workspaceProjects.map((project) => (
                  <div key={project.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{project.name}</p>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{project.key}</span>
                        {project.id === activeProjectId && (
                          <span className="rounded-full bg-qira-pistachio-lt px-2.5 py-1 text-xs font-semibold text-qira-pistachio">
                            {t('project.activeBadge')}
                          </span>
                        )}
                      </div>
                      {project.description && (
                        <p className="mt-2 break-words text-sm text-slate-600">{project.description}</p>
                      )}
                      <p className="mt-2 text-xs text-slate-400">
                        {new Date(project.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteProject(project.id, project.name)}
                      disabled={deletingProjectId === project.id}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      <Trash2 size={16} />
                      {deletingProjectId === project.id ? t('project.deleteDeleting') : t('project.delete')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!activeProjectId ? (
          <section className="rounded-[28px] bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        ) : (
          <>
            <div className={`grid min-h-0 flex-1 gap-4 ${canInvite ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
              <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
                {canInvite && <InviteForm />}

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

              {canInvite && (
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
              )}
            </div>
          </>
        )}
      </div>
    </GlobalLayout>
  )
}
