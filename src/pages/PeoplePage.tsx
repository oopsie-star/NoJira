import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle, Link2, Mail, Plus, ShieldCheck, Trash2, UserMinus, XCircle } from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuthContext } from '@/auth/AuthContext'
import { parseSandboxDeliveryNote } from '@/lib/approvalNotifications'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { canInviteToProject, canManageProject } from '@/lib/permissions'
import { placeholderAsPerson } from '@/lib/people'
import { useStore } from '@/store'
import type { Locale, Profile, ProjectRole } from '@/types'

const JOB_TITLE_OPTIONS = [
  'Senior Designer',
  'Designer',
  'Senior Frontend Engineer',
  'Frontend Engineer',
  'Senior Backend Engineer',
  'Backend Engineer',
  'Senior QA Engineer',
  'QA Engineer',
  'Senior Product Manager',
  'Product Manager',
  'Senior Project Manager',
  'Project Manager',
]

const DEPARTMENT_OPTIONS = [
  'Design',
  'Frontend',
  'Backend',
  'Quality Assurance',
  'Product',
  'Project Delivery',
]

function InviteForm() {
  const { t } = useI18n()
  const inviteToProject = useStore((state) => state.inviteToProject)
  const projectMembers = useStore((state) => state.projectMembers)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('member')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!normalized) return

    // Already-in-project short-circuit — the RPC upserts, but tell the admin plainly.
    if (projectMembers.some((m) => m.profile?.email?.toLowerCase() === normalized)) {
      setFeedback(t('people.alreadyInProject'))
      return
    }

    setLoading(true)
    setFeedback(null)
    try {
      const result = await inviteToProject(email, role, message.trim() || null)
      setFeedback(result?.emailSent ? t('people.inviteSuccess') : t('people.invitePartial'))
      setEmail('')
      setRole('member')
      setMessage('')
    } catch (err) {
      setFeedback(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[28px] bg-white p-6 shadow-sm">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('people.addUser')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('people.addUserHint')}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(160px,0.7fr)_auto]">
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
          {loading ? t('people.addingUser') : t('people.addUserAction')}
        </button>
      </div>

      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={t('people.inviteMessagePlaceholder')}
        rows={2}
        className="mt-3 w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
      />

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
  const fetchAssignableProfiles = useStore((state) => state.fetchAssignableProfiles)
  const fetchDeletionRequests = useStore((state) => state.fetchDeletionRequests)
  const approveMember = useStore((state) => state.approveMember)
  const declineMember = useStore((state) => state.declineMember)
  const removeProjectMember = useStore((state) => state.removeProjectMember)
  const inviteToProject = useStore((state) => state.inviteToProject)
  const cancelInvite = useStore((state) => state.cancelInvite)
  const invitePlaceholder = useStore((state) => state.invitePlaceholder)
  const linkPlaceholder = useStore((state) => state.linkPlaceholder)
  const deleteProject = useStore((state) => state.deleteProject)
  const addProfileToProject = useStore((state) => state.addProfileToProject)
  const resolveDeletionRequest = useStore((state) => state.resolveDeletionRequest)
  const triggerApprovalNotification = useStore((state) => state.triggerApprovalNotification)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const projects = useStore((state) => state.projects)
  const workspaceProjects = useStore((state) => state.workspaceProjects)
  const assignableProfiles = useStore((state) => state.assignableProfiles)
  const deletionRequests = useStore((state) => state.deletionRequests)
  const projectMembers = useStore((state) => state.projectMembers)
  const projectInvites = useStore((state) => state.projectInvites)
  const pendingMembers = useStore((state) => state.pendingMembers)
  const placeholders = useStore((state) => state.placeholders)
  const fetchPlaceholders = useStore((state) => state.fetchPlaceholders)
  const deletePlaceholder = useStore((state) => state.deletePlaceholder)
  const updateProfile = useStore((state) => state.updateProfile)
  const updateProjectMemberRole = useStore((state) => state.updateProjectMemberRole)

  const [removingPlaceholderId, setRemovingPlaceholderId] = useState<string | null>(null)
  const [decliningProfileId, setDecliningProfileId] = useState<string | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [invitingPlaceholderId, setInvitingPlaceholderId] = useState<string | null>(null)
  const [linkingPlaceholderId, setLinkingPlaceholderId] = useState<string | null>(null)
  const [linkTargetId, setLinkTargetId] = useState<string>('')
  const [linkSubmitting, setLinkSubmitting] = useState(false)
  const [cancelingInviteId, setCancelingInviteId] = useState<string | null>(null)
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [retryingProfileId, setRetryingProfileId] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [addingProfileId, setAddingProfileId] = useState<string | null>(null)
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
  const [availableRoles, setAvailableRoles] = useState<Record<string, ProjectRole>>({})
  const isAdmin = profile?.role === 'admin'
  const canManage = canManageProject(activeProjectRole)
  const canInvite = canInviteToProject(activeProjectRole)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (!activeProjectId) return
    void Promise.all([fetchMembers(), fetchProjectInvites(), fetchPlaceholders()])
  }, [activeProjectId, fetchMembers, fetchProjectInvites, fetchPlaceholders])

  async function handleRemovePlaceholder(id: string, name: string) {
    if (!window.confirm(t('people.removePlaceholderConfirm', { name }))) return
    setRemovingPlaceholderId(id)
    setProjectActionError(null)
    try {
      await deletePlaceholder(id)
    } catch (err) {
      setProjectActionError(getErrorMessage(err))
    } finally {
      setRemovingPlaceholderId(null)
    }
  }

  async function handleDeclineMember(profileId: string) {
    if (!window.confirm(t('people.declineConfirm'))) return
    setDecliningProfileId(profileId)
    try {
      await declineMember(profileId)
    } catch (err) {
      setProjectActionError(getErrorMessage(err))
    } finally {
      setDecliningProfileId(null)
    }
  }

  async function handleRemoveMember(profileId: string, name: string) {
    if (!window.confirm(t('people.removeMemberConfirm', { name }))) return
    setRemovingMemberId(profileId)
    setMemberActionError(null)
    try {
      await removeProjectMember(profileId)
    } catch (err) {
      const raw = getErrorMessage(err)
      setMemberActionError(raw.includes('last_project_admin') ? t('people.cannotRemoveLastAdmin') : raw)
    } finally {
      setRemovingMemberId(null)
    }
  }

  async function handleInvitePlaceholder(placeholderId: string, email: string | null) {
    if (!email) return
    setInvitingPlaceholderId(placeholderId)
    setMemberActionError(null)
    try {
      await invitePlaceholder(placeholderId, email, 'member')
    } catch (err) {
      setMemberActionError(getErrorMessage(err))
    } finally {
      setInvitingPlaceholderId(null)
    }
  }

  async function handleLinkPlaceholder(placeholderId: string) {
    if (!linkTargetId) return
    setLinkSubmitting(true)
    setMemberActionError(null)
    try {
      await linkPlaceholder(placeholderId, linkTargetId)
      setLinkingPlaceholderId(null)
      setLinkTargetId('')
    } catch (err) {
      setMemberActionError(getErrorMessage(err))
    } finally {
      setLinkSubmitting(false)
    }
  }

  async function handleCancelInvite(inviteId: string) {
    if (!window.confirm(t('people.cancelInviteConfirm'))) return
    setCancelingInviteId(inviteId)
    setMemberActionError(null)
    try {
      await cancelInvite(inviteId)
    } catch (err) {
      setMemberActionError(getErrorMessage(err))
    } finally {
      setCancelingInviteId(null)
    }
  }

  useEffect(() => {
    if (!activeProjectId || !canInvite) return
    void fetchAssignableProfiles()
  }, [activeProjectId, canInvite, fetchAssignableProfiles])

  useEffect(() => {
    if (!isAdmin) return
    void Promise.all([fetchPendingMembers(), fetchWorkspaceProjects(), fetchDeletionRequests()])
  }, [isAdmin, fetchDeletionRequests, fetchPendingMembers, fetchWorkspaceProjects])

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

  async function handleAddProfile(profileId: string) {
    setAddingProfileId(profileId)
    setProjectActionError(null)
    try {
      await addProfileToProject(profileId, availableRoles[profileId] ?? 'member')
    } catch (err) {
      setProjectActionError(getErrorMessage(err))
    } finally {
      setAddingProfileId(null)
    }
  }

  async function handleResolveDeletionRequest(requestId: string, resolution: 'approved' | 'rejected') {
    setResolvingRequestId(requestId)
    setProjectActionError(null)
    try {
      await resolveDeletionRequest(requestId, resolution)
    } catch (err) {
      setProjectActionError(getErrorMessage(err))
    } finally {
      setResolvingRequestId(null)
    }
  }

  return (
    <GlobalLayout>
      <div className="flex min-h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
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
                  <div key={pending.id} className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-white px-4 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <UserAvatar profile={pending} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{pending.full_name || pending.email}</p>
                        <p className="break-all text-xs text-slate-500">{pending.email}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => void handleApprovalEmailRetry(pending.id)}
                        disabled={retryingProfileId === pending.id}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      >
                        {retryingProfileId === pending.id ? t('people.approvalEmailRetrying') : t('people.retryApprovalEmail')}
                      </button>
                      <button
                        onClick={() => void handleDeclineMember(pending.id)}
                        disabled={decliningProfileId === pending.id}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 sm:w-auto"
                      >
                        <XCircle size={16} />
                        {t('people.decline')}
                      </button>
                      <button
                        onClick={() => approveMember(pending.id)}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk sm:w-auto"
                      >
                        <CheckCircle size={16} />
                        {t('people.approve')}
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
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{t('people.deletionRequests')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('people.deletionRequestsHint')}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                {deletionRequests.length}
              </span>
            </div>

            {projectActionError && (
              <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{projectActionError}</p>
            )}

            {deletionRequests.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t('people.noDeletionRequests')}</p>
            ) : (
              <div className="mt-4 space-y-3">
                {deletionRequests.map((request) => (
                  <div key={request.id} className="rounded-2xl border border-slate-200 px-4 py-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                            {t(`people.deletionRequestType.${request.entity_type}`)}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            request.status === 'approved'
                              ? 'bg-emerald-50 text-emerald-700'
                              : request.status === 'rejected'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-amber-50 text-amber-700'
                          }`}>
                            {t(`people.deletionRequestStatus.${request.status}`)}
                          </span>
                        </div>
                        <p className="mt-3 break-words text-sm font-semibold text-slate-900">{request.entity_label}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {request.project?.name ?? '—'} · {request.requester?.full_name || request.requester?.email || '—'}
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          {new Date(request.created_at).toLocaleString()}
                        </p>
                      </div>

                      {request.status === 'pending' && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => void handleResolveDeletionRequest(request.id, 'approved')}
                            disabled={resolvingRequestId === request.id}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
                          >
                            <ShieldCheck size={16} />
                            {t('people.approveDeletionRequest')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResolveDeletionRequest(request.id, 'rejected')}
                            disabled={resolvingRequestId === request.id}
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            {t('people.rejectDeletionRequest')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  <div key={project.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
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
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
            {canInvite && <InviteForm />}

            {canInvite && (
              <section className="rounded-[28px] bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{t('people.availableMembers')}</h2>
                    <p className="mt-1 text-sm text-slate-500">{t('people.availableMembersHint')}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                    {assignableProfiles.length}
                  </span>
                </div>

                {assignableProfiles.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">{t('people.noAvailableMembers')}</p>
                ) : (
                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {assignableProfiles.map((candidate) => (
                      <div key={candidate.id} className="rounded-2xl border border-slate-200 px-4 py-4">
                        <div className="flex items-start gap-3">
                          <UserAvatar profile={candidate} size={36} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">{candidate.full_name || candidate.email}</p>
                            <p className="break-all text-xs text-slate-500">{candidate.email}</p>
                            {(candidate.job_title || candidate.department) && (
                              <p className="mt-2 text-sm text-slate-500">
                                {[candidate.job_title, candidate.department].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <select
                            value={availableRoles[candidate.id] ?? 'member'}
                            onChange={(event) => setAvailableRoles((state) => ({ ...state, [candidate.id]: event.target.value as ProjectRole }))}
                            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                          >
                            <option value="admin">{t('projectRole.admin')}</option>
                            <option value="founder">{t('projectRole.founder')}</option>
                            <option value="ceo">{t('projectRole.ceo')}</option>
                            <option value="member">{t('projectRole.member')}</option>
                            <option value="viewer">{t('projectRole.viewer')}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleAddProfile(candidate.id)}
                            disabled={addingProfileId === candidate.id}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
                          >
                            <Plus size={16} />
                            {addingProfileId === candidate.id ? t('people.addingToProject') : t('people.addToProject')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {canInvite && (() => {
              const openInvites = projectInvites.filter((invite) => invite.status !== 'accepted')
              return (
              <section className="rounded-[28px] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{t('people.pendingInvites')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('people.pendingInvitesHint')}</p>
                {openInvites.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">{t('people.noInvites')}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {openInvites.map((invite) => (
                      <div key={invite.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="break-all text-sm font-semibold text-slate-900">{invite.email}</p>
                          <p className="text-xs text-slate-500">{t(`projectRole.${invite.project_role}`)} · {t('people.inviteStatusPending')}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void inviteToProject(invite.email, invite.project_role)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            <Mail size={14} />
                            {t('people.resendInvite')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCancelInvite(invite.id)}
                            disabled={cancelingInviteId === invite.id}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                          >
                            <XCircle size={14} />
                            {t('people.cancelInvite')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              )
            })()}

            <section className="rounded-[28px] bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-900">{t('people.title')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('people.memberCount', { count: projectMembers.length })}</p>
              </div>

              {memberActionError && (
                <p className="mx-4 mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{memberActionError}</p>
              )}

              {projectMembers.length === 0 ? (
                <div className="p-10 text-sm text-slate-500">{t('people.empty')}</div>
              ) : (
                <div className="space-y-3 p-4">
                  {projectMembers.map((member) => {
                    const person = member.profile
                    if (!person) return null
                    const canEditMemberProfile = isAdmin || canManage || profile?.id === person.id

                    return (
                      <div key={member.id} className="rounded-2xl border border-slate-200 px-4 py-4">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                          <div className="flex min-w-0 items-center gap-3 xl:w-[280px] xl:flex-shrink-0">
                            <UserAvatar profile={person} size={40} muted={!person.avatar_url} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-900">{person.full_name || person.email}</p>
                              <p className="truncate text-sm text-slate-500">{person.email}</p>
                            </div>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveMember(person.id, person.full_name || person.email)}
                                disabled={removingMemberId === person.id}
                                title={t('people.removeMember')}
                                aria-label={t('people.removeMember')}
                                className="ml-auto shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                              >
                                <UserMinus size={16} />
                              </button>
                            )}
                          </div>

                          <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(160px,180px)_minmax(0,1fr)_minmax(0,1fr)_160px]">
                            <label className="block">
                              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('people.projectRole')}</span>
                              <select
                                disabled={!canManage || member.project_role === 'owner'}
                                value={member.project_role}
                                onChange={(event) => updateProjectMemberRole(member.id, event.target.value as ProjectRole)}
                                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              >
                                <option value="owner">{t('projectRole.owner')}</option>
                                <option value="admin">{t('projectRole.admin')}</option>
                                <option value="founder">{t('projectRole.founder')}</option>
                                <option value="ceo">{t('projectRole.ceo')}</option>
                                <option value="member">{t('projectRole.member')}</option>
                                <option value="viewer">{t('projectRole.viewer')}</option>
                              </select>
                            </label>

                            <label className="block">
                              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('people.jobTitle')}</span>
                              <input
                                list="job-title-options"
                                disabled={!canEditMemberProfile}
                                defaultValue={person.job_title ?? ''}
                                onBlur={(event) => updateProfile(person.id, { job_title: event.target.value })}
                                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              />
                            </label>

                            <label className="block">
                              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('people.department')}</span>
                              <input
                                list="department-options"
                                disabled={!canEditMemberProfile}
                                defaultValue={person.department ?? ''}
                                onBlur={(event) => updateProfile(person.id, { department: event.target.value })}
                                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              />
                            </label>

                            <label className="block">
                              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('people.locale')}</span>
                              <select
                                disabled={!canEditMemberProfile}
                                value={person.locale as Locale}
                                onChange={(event) => updateProfile(person.id, { locale: event.target.value as Locale })}
                                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
                              >
                                <option value="en">{t('common.english')}</option>
                                <option value="ru">{t('common.russian')}</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {placeholders.length > 0 && (
              <section className="rounded-[28px] bg-white shadow-sm">
                <div className="border-b border-slate-200 px-6 py-5">
                  <h2 className="text-lg font-semibold text-slate-900">{t('people.importedTitle')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('people.importedHint')}</p>
                </div>
                <div className="grid gap-3 p-4 xl:grid-cols-2">
                  {placeholders.map((placeholder) => (
                    <div key={placeholder.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar profile={placeholderAsPerson(placeholder)} size={38} muted={!placeholder.avatar_url} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{placeholder.display_name}</p>
                          <p className="truncate text-xs text-slate-500">{placeholder.email || t('people.fromJira')}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600">
                          {t('people.fromJira')}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => {
                              setLinkTargetId('')
                              setLinkingPlaceholderId((cur) => (cur === placeholder.id ? null : placeholder.id))
                            }}
                            className={[
                              'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                              linkingPlaceholderId === placeholder.id
                                ? 'border-qira-pistachio bg-qira-pistachio-lt text-qira-pistachio'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                            ].join(' ')}
                          >
                            <Link2 size={14} />
                            {t('people.linkAccount')}
                          </button>
                        )}
                        {canInvite && placeholder.email && placeholder.status !== 'invited' && (
                          <button
                            type="button"
                            onClick={() => void handleInvitePlaceholder(placeholder.id, placeholder.email)}
                            disabled={invitingPlaceholderId === placeholder.id}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-qira-pistachio/30 px-3 py-1.5 text-xs font-semibold text-qira-pistachio transition hover:bg-qira-pistachio-lt disabled:opacity-60"
                          >
                            <Mail size={14} />
                            {invitingPlaceholderId === placeholder.id ? t('people.placeholderInviting') : t('people.placeholderInvite')}
                          </button>
                        )}
                        {placeholder.status === 'invited' && (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                            {t('people.inviteStatusInvited')}
                          </span>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void handleRemovePlaceholder(placeholder.id, placeholder.display_name)}
                            disabled={removingPlaceholderId === placeholder.id}
                            className="shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                            title={t('common.delete')}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>

                      {linkingPlaceholderId === placeholder.id && (
                        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
                          <p className="text-xs text-slate-500 sm:flex-1">{t('people.linkAccountHint')}</p>
                          <select
                            value={linkTargetId}
                            onChange={(event) => setLinkTargetId(event.target.value)}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-qira-pistachio"
                          >
                            <option value="">{t('people.linkAccountSelect')}</option>
                            {projectMembers.map((member) => member.profile && (
                              <option key={member.id} value={member.profile.id}>
                                {member.profile.full_name || member.profile.email}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleLinkPlaceholder(placeholder.id)}
                            disabled={!linkTargetId || linkSubmitting}
                            className="rounded-xl bg-qira-pistachio px-3 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
                          >
                            {linkSubmitting ? t('people.linking') : t('people.linkConfirm')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <datalist id="job-title-options">
              {JOB_TITLE_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>

            <datalist id="department-options">
              {DEPARTMENT_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </>
        )}
      </div>
    </GlobalLayout>
  )
}
