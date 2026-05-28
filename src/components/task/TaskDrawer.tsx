import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Calendar, MessageSquare, Plus, Send, Trash2, X } from 'lucide-react'
import { IssueTypeBadge, PriorityBadge } from '@/components/common/IssueBadges'
import { UserAvatar } from '@/components/common/UserAvatar'
import { AttachmentUpload } from './AttachmentUpload'
import { StatusDropdown } from './StatusDropdown'
import { useAuthContext } from '@/auth/AuthContext'
import { useI18n } from '@/lib/i18n'
import { formatDate, formatPerson, parseLabels } from '@/lib/format'
import { canDeleteAuthoredContent } from '@/lib/permissions'
import { useStore } from '@/store'
import type { IssuePriority, IssueType, Task, TaskStatus } from '@/types'

function MetaSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</p>
      {children}
    </div>
  )
}

export function TaskDrawer() {
  const openTaskId = useStore((state) => state.openTaskId)
  const tasks = useStore((state) => state.tasks)
  const epics = useStore((state) => state.epics)
  const sprints = useStore((state) => state.sprints)
  const members = useStore((state) => state.members)
  const taskComments = useStore((state) => state.taskComments)
  const taskActivities = useStore((state) => state.taskActivities)
  const updateTask = useStore((state) => state.updateTask)
  const deleteTask = useStore((state) => state.deleteTask)
  const createSubtask = useStore((state) => state.createSubtask)
  const createTaskComment = useStore((state) => state.createTaskComment)
  const deleteTaskComment = useStore((state) => state.deleteTaskComment)
  const fetchTaskContext = useStore((state) => state.fetchTaskContext)
  const clearTaskContext = useStore((state) => state.clearTaskContext)
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const { profile } = useAuthContext()
  const { locale, t } = useI18n()

  const task = useMemo(
    () => tasks.find((item) => item.id === openTaskId),
    [tasks, openTaskId]
  )

  const subtasks = useMemo(
    () => tasks
      .filter((item) => item.parent_task_id === openTaskId)
      .sort((left, right) => left.position - right.position),
    [tasks, openTaskId]
  )

  const parentTask = useMemo(
    () => (task?.parent_task_id ? tasks.find((item) => item.id === task.parent_task_id) ?? null : null),
    [tasks, task]
  )

  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftLabels, setDraftLabels] = useState('')
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [commentBody, setCommentBody] = useState('')

  useEffect(() => {
    if (!task) {
      clearTaskContext()
      return
    }

    setDraftTitle(task.title)
    setDraftDescription(task.description)
    setDraftLabels(task.labels.join(', '))
    setSubtaskTitle('')
    setCommentBody('')
    void fetchTaskContext(task.id)
  }, [task, fetchTaskContext, clearTaskContext])

  if (!task) return null

  const currentTask = task

  async function persistDrafts() {
    const nextFields: Partial<Task> = {}

    if (draftTitle.trim() && draftTitle.trim() !== currentTask.title) nextFields.title = draftTitle.trim()
    if (draftDescription !== currentTask.description) nextFields.description = draftDescription

    const parsedLabels = parseLabels(draftLabels)
    if (parsedLabels.join('|') !== currentTask.labels.join('|')) nextFields.labels = parsedLabels

    if (Object.keys(nextFields).length) {
      await updateTask(currentTask.id, nextFields)
    }
  }

  async function handleClose() {
    await persistDrafts()
    clearTaskContext()
    setOpenTaskId(null)
  }

  async function handleDelete() {
    if (!window.confirm(t('task.deleteConfirm', { title: currentTask.title }))) return
    clearTaskContext()
    setOpenTaskId(null)
    await deleteTask(currentTask.id)
  }

  async function handleCreateSubtask() {
    if (!subtaskTitle.trim()) return
    await createSubtask(currentTask.id, subtaskTitle)
    setSubtaskTitle('')
  }

  async function handleAddComment() {
    if (!commentBody.trim()) return
    await createTaskComment(currentTask.id, commentBody)
    setCommentBody('')
  }

  const canDelete = canDeleteAuthoredContent(
    activeProjectRole,
    profile?.id,
    currentTask.reporter_id,
    currentTask.status
  )

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={handleClose} />

      <aside className="fixed right-0 top-0 z-[70] flex h-screen w-full max-w-[980px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              {currentTask.key}
            </span>
            <IssueTypeBadge type={currentTask.issue_type} />
            <PriorityBadge priority={currentTask.priority} />
          </div>

          <div className="flex items-center gap-2">
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.6fr_0.9fr]">
          <div className="min-h-0 overflow-y-auto p-6">
            {parentTask && (
              <button
                type="button"
                onClick={() => setOpenTaskId(parentTask.id)}
                className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
              >
                {t('task.parentIssue')}: {parentTask.key}
              </button>
            )}

            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={persistDrafts}
              className="w-full border-none px-0 text-[30px] font-semibold leading-tight text-slate-900 outline-none"
            />

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-sm font-semibold text-slate-900">{t('task.reporter')}</p>
                <div className="flex items-center gap-3">
                  <UserAvatar profile={currentTask.reporter} size={34} muted={!currentTask.reporter} />
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {currentTask.reporter?.full_name || currentTask.reporter?.email || '—'}
                    </p>
                    <p className="text-xs text-slate-500">{t('task.reporter')}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-sm font-semibold text-slate-900">{t('task.dueDate')}</p>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Calendar size={16} />
                  {formatDate(locale, currentTask.due_date)}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <MetaSection title={t('task.description')}>
                <textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  onBlur={persistDrafts}
                  rows={10}
                  placeholder={t('task.emptyDescription')}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                />
              </MetaSection>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t('task.subtasks')}</p>
                  <p className="text-xs text-slate-500">{t('task.subtasksHint')}</p>
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <input
                  value={subtaskTitle}
                  onChange={(event) => setSubtaskTitle(event.target.value)}
                  placeholder={t('task.subtaskPlaceholder')}
                  className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                />
                <button
                  type="button"
                  onClick={handleCreateSubtask}
                  disabled={!subtaskTitle.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-jira-blue px-4 py-3 text-sm font-semibold text-white transition hover:bg-jira-blue-dk disabled:opacity-60"
                >
                  <Plus size={16} />
                  {t('task.createSubtask')}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {subtasks.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t('task.noSubtasks')}</p>
                ) : (
                  subtasks.map((subtask) => (
                    <button
                      key={subtask.id}
                      type="button"
                      onClick={() => setOpenTaskId(subtask.id)}
                      className="flex w-full items-start justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <IssueTypeBadge type={subtask.issue_type} />
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{subtask.key}</span>
                        </div>
                        <p className="mt-2 truncate text-sm font-semibold text-slate-900">{subtask.title}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {t(`status.${subtask.status}`)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="mt-6">
              <AttachmentUpload
                projectId={currentTask.project_id}
                taskId={currentTask.id}
                taskStatus={currentTask.status}
                currentUserId={profile?.id ?? null}
                activeProjectRole={activeProjectRole}
                attachments={currentTask.attachments}
              />
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-slate-500" />
                <p className="text-sm font-semibold text-slate-900">{t('task.comments')}</p>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  rows={3}
                  placeholder={t('task.commentPlaceholder')}
                  className="w-full resize-none bg-transparent text-sm text-slate-900 outline-none"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddComment}
                    disabled={!commentBody.trim()}
                    className="inline-flex items-center gap-2 rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk disabled:opacity-60"
                  >
                    <Send size={15} />
                    {t('task.addComment')}
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {taskComments.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t('task.noComments')}</p>
                ) : (
                  taskComments.map((comment) => {
                    const canDeleteComment = canDeleteAuthoredContent(
                      activeProjectRole,
                      profile?.id,
                      comment.author_id,
                      currentTask.status
                    )

                    return (
                    <div key={comment.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar profile={comment.author} size={32} muted={!comment.author} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{formatPerson(comment.author) || '—'}</p>
                            <p className="text-xs text-slate-500">{formatDate(locale, comment.created_at)}</p>
                          </div>
                        </div>
                        {canDeleteComment && (
                          <button
                            type="button"
                            onClick={() => deleteTaskComment(comment.id)}
                            className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            title={t('common.delete')}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment.body}</p>
                    </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">{t('task.activity')}</p>
              <div className="mt-4 space-y-3">
                {taskActivities.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t('task.noActivity')}</p>
                ) : (
                  taskActivities.map((activity) => (
                    <div key={activity.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar profile={activity.actor} size={30} muted={!activity.actor} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {formatPerson(activity.actor) || t('task.system')}
                            </p>
                            <p className="text-xs text-slate-500">{formatDate(locale, activity.created_at)}</p>
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{activity.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-6">
            <div className="space-y-5">
              <MetaSection title={t('task.status')}>
                <StatusDropdown
                  value={currentTask.status}
                  onChange={(status: TaskStatus) => updateTask(currentTask.id, { status })}
                />
              </MetaSection>

              <MetaSection title={t('task.issueType')}>
                <select
                  value={currentTask.issue_type}
                  onChange={(event) => updateTask(currentTask.id, { issue_type: event.target.value as IssueType })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                >
                  <option value="task">{t('issueType.task')}</option>
                  <option value="story">{t('issueType.story')}</option>
                  <option value="bug">{t('issueType.bug')}</option>
                </select>
              </MetaSection>

              <MetaSection title={t('task.priority')}>
                <select
                  value={currentTask.priority}
                  onChange={(event) => updateTask(currentTask.id, { priority: event.target.value as IssuePriority })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                >
                  <option value="lowest">{t('priority.lowest')}</option>
                  <option value="low">{t('priority.low')}</option>
                  <option value="medium">{t('priority.medium')}</option>
                  <option value="high">{t('priority.high')}</option>
                  <option value="highest">{t('priority.highest')}</option>
                </select>
              </MetaSection>

              <MetaSection title={t('task.assignee')}>
                <select
                  value={currentTask.assignee_id ?? ''}
                  onChange={(event) => updateTask(currentTask.id, { assignee_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                >
                  <option value="">{t('common.unassigned')}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name || member.email}
                    </option>
                  ))}
                </select>
              </MetaSection>

              <MetaSection title={t('task.reporter')}>
                <select
                  value={currentTask.reporter_id ?? ''}
                  onChange={(event) => updateTask(currentTask.id, { reporter_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                >
                  <option value="">{t('common.unassigned')}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name || member.email}
                    </option>
                  ))}
                </select>
              </MetaSection>

              <MetaSection title={t('task.sprint')}>
                <select
                  value={currentTask.sprint_id ?? ''}
                  onChange={(event) => updateTask(currentTask.id, { sprint_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                >
                  <option value="">{t('common.backlog')}</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                    </option>
                  ))}
                </select>
              </MetaSection>

              <MetaSection title={t('task.epic')}>
                <select
                  value={currentTask.epic_id ?? ''}
                  onChange={(event) => updateTask(currentTask.id, { epic_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                >
                  <option value="">{t('common.none')}</option>
                  {epics.map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.key} — {epic.title}
                    </option>
                  ))}
                </select>
              </MetaSection>

              <MetaSection title={t('task.labels')}>
                <input
                  value={draftLabels}
                  onChange={(event) => setDraftLabels(event.target.value)}
                  onBlur={persistDrafts}
                  placeholder={t('task.labelsPlaceholder')}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                />
              </MetaSection>

              <MetaSection title={t('task.dueDate')}>
                <input
                  type="date"
                  value={currentTask.due_date ?? ''}
                  onChange={(event) => updateTask(currentTask.id, { due_date: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
                />
              </MetaSection>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                <p><span className="font-semibold text-slate-900">{t('task.created')}:</span> {formatDate(locale, currentTask.created_at)}</p>
                <p className="mt-2"><span className="font-semibold text-slate-900">{t('task.updated')}:</span> {formatDate(locale, currentTask.updated_at)}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
