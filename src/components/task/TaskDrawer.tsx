import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Calendar, Link2, MessageSquare, Paperclip, Plus, Send, ShieldAlert, Timer, Trash2, X } from 'lucide-react'
import { callLLM, getLLMConfig } from '@/lib/ai'
import type { LLMMessage } from '@/lib/ai'
import { supabase } from '@/lib/supabase'
import { IssueTypeBadge, PriorityBadge } from '@/components/common/IssueBadges'
import { UserAvatar } from '@/components/common/UserAvatar'
import { AttachmentUpload } from './AttachmentUpload'
import { JiraDescriptionRenderer } from './JiraDescriptionRenderer'
import { StatusDropdown } from './StatusDropdown'
import { useAuthContext } from '@/auth/AuthContext'
import { useI18n } from '@/lib/i18n'
import { formatDate, formatPerson, parseLabels } from '@/lib/format'
import { calculateAverageCycleTimeHours, formatCycleTime, formatStatusAge } from '@/lib/ops'
import { canDeleteAuthoredContent } from '@/lib/permissions'
import { activeMentionQuery, extractMentionedIds, mentionLabel } from '@/lib/mentions'
import { MarkdownRenderer } from '@/lib/markdown'
import { MarkdownEditor } from '@/components/common/MarkdownEditor'
import { placeholderAsPerson, taskAssigneeDisplay, taskReporterDisplay } from '@/lib/people'
import { useStore } from '@/store'
import type { IssuePriority, IssueType, Profile, Task, TaskLinkType, TaskStatus } from '@/types'

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
  const placeholders = useStore((state) => state.placeholders)
  const taskLinks = useStore((state) => state.taskLinks)
  const taskComments = useStore((state) => state.taskComments)
  const taskActivities = useStore((state) => state.taskActivities)
  const updateTask = useStore((state) => state.updateTask)
  const deleteTask = useStore((state) => state.deleteTask)
  const requestEntityDeletion = useStore((state) => state.requestEntityDeletion)
  const createSubtask = useStore((state) => state.createSubtask)
  const createTaskComment = useStore((state) => state.createTaskComment)
  const createTaskLink = useStore((state) => state.createTaskLink)
  const deleteTaskComment = useStore((state) => state.deleteTaskComment)
  const deleteTaskLink = useStore((state) => state.deleteTaskLink)
  const fetchTaskContext = useStore((state) => state.fetchTaskContext)
  const clearTaskContext = useStore((state) => state.clearTaskContext)
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const { profile } = useAuthContext()
  const { locale, t } = useI18n()

  const [savedFlash, setSavedFlash] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashSaved = useCallback(() => {
    setSavedFlash(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSavedFlash(false), 1800)
  }, [])

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
  const [editDescription, setEditDescription] = useState(false)
  const [draftLabels, setDraftLabels] = useState('')
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const [commentUploading, setCommentUploading] = useState(false)
  const [deleteRequestSending, setDeleteRequestSending] = useState(false)
  const commentFileRef = useRef<HTMLInputElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null)
  const [linkType, setLinkType] = useState<TaskLinkType>('blocks')
  const [linkedTaskId, setLinkedTaskId] = useState('')
  const [saving, setSaving] = useState(false)

  const relatedLinks = useMemo(
    () => taskLinks.filter((link) => link.source_task_id === openTaskId || link.target_task_id === openTaskId),
    [openTaskId, taskLinks]
  )

  const linkableTasks = useMemo(
    () => tasks.filter((item) => item.id !== openTaskId && !item.parent_task_id).sort((left, right) => left.title.localeCompare(right.title)),
    [openTaskId, tasks]
  )

  const cycleTime = useMemo(
    () => formatCycleTime(locale, calculateAverageCycleTimeHours([task ?? undefined].filter(Boolean) as Task[])),
    [locale, task]
  )

  useEffect(() => {
    if (!task) {
      clearTaskContext()
      return
    }

    setDraftTitle(task.title)
    setDraftDescription(task.description)
    setEditDescription(false)
    setDraftLabels(task.labels.join(', '))
    setSubtaskTitle('')
    setCommentBody('')
    setCommentFiles([])
    setLinkType('blocks')
    setLinkedTaskId('')
    void fetchTaskContext(task.id)
  }, [task, fetchTaskContext, clearTaskContext])

  if (!task) return null

  const currentTask = task
  const hasRichDescription = Boolean(currentTask.jira_description_adf)
  const selectedSprint = currentTask.sprint_id
    ? (sprints.find((sprint) => sprint.id === currentTask.sprint_id) ?? null)
    : null
  const availableSprints = selectedSprint
    ? sprints
    : sprints.filter((sprint) => !currentTask.epic_id || sprint.epic_id === currentTask.epic_id)
  const effectiveEpicId = selectedSprint ? (selectedSprint.epic_id ?? '') : (currentTask.epic_id ?? '')

  const isDirty =
    draftTitle.trim() !== currentTask.title ||
    draftDescription !== currentTask.description ||
    parseLabels(draftLabels).join('|') !== currentTask.labels.join('|')

  async function quickUpdate(fields: Partial<Task>) {
    await updateTask(currentTask.id, fields)
    flashSaved()
  }

  async function persistDrafts() {
    const nextFields: Partial<Task> = {}

    if (draftTitle.trim() && draftTitle.trim() !== currentTask.title) nextFields.title = draftTitle.trim()
    if (draftDescription !== currentTask.description) nextFields.description = draftDescription

    const parsedLabels = parseLabels(draftLabels)
    if (parsedLabels.join('|') !== currentTask.labels.join('|')) nextFields.labels = parsedLabels

    if (Object.keys(nextFields).length) {
      await updateTask(currentTask.id, nextFields)
      flashSaved()
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await persistDrafts()
    } finally {
      setSaving(false)
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

  async function handleRequestDelete() {
    setDeleteRequestSending(true)
    try {
      await requestEntityDeletion('task', currentTask.id, `${currentTask.key} — ${currentTask.title}`)
    } finally {
      setDeleteRequestSending(false)
    }
  }

  async function handleCreateSubtask() {
    if (!subtaskTitle.trim()) return
    await createSubtask(currentTask.id, subtaskTitle)
    setSubtaskTitle('')
  }

  async function handleAddComment() {
    if (!commentBody.trim() && commentFiles.length === 0) return
    setCommentUploading(true)
    try {
      const uploadedPaths: string[] = []
      for (const file of commentFiles) {
        const safeName = file.name.replace(/[^\w.\-() ]+/g, '_')
        const path = `${currentTask.project_id}/${currentTask.id}/comments/${profile?.id ?? 'unknown'}/${Date.now()}-${safeName}`
        const { error } = await supabase.storage.from('attachments').upload(path, file, { upsert: false })
        if (!error) uploadedPaths.push(path)
      }
      const mentionedIds = extractMentionedIds(commentBody, members)
      await createTaskComment(currentTask.id, commentBody, uploadedPaths, mentionedIds)
      setCommentBody('')
      setCommentFiles([])
      setMention(null)
    } finally {
      setCommentUploading(false)
    }
  }

  function handleCommentChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    setCommentBody(value)
    const caret = event.target.selectionStart ?? value.length
    const found = activeMentionQuery(value.slice(0, caret))
    setMention(found ? { start: found.start, end: caret, query: found.query } : null)
  }

  function insertMention(member: Profile) {
    if (!mention) return
    const label = mentionLabel(member)
    const next = `${commentBody.slice(0, mention.start)}@${label} ${commentBody.slice(mention.end)}`
    setCommentBody(next)
    setMention(null)
    const pos = mention.start + label.length + 2
    requestAnimationFrame(() => {
      const el = commentRef.current
      if (el) { el.focus(); el.setSelectionRange(pos, pos) }
    })
  }

  function handleCommentFileInput(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    setCommentFiles((prev) => [...prev, ...picked])
    event.target.value = ''
  }

  async function handleAddLink() {
    if (!linkedTaskId) return
    await createTaskLink(currentTask.id, linkedTaskId, linkType)
    setLinkedTaskId('')
  }

  async function handleAiSuggestDescription(currentText: string): Promise<string | null> {
    if (!getLLMConfig().apiKey) return null
    const assigneeName = assigneeDisplay?.person?.full_name || assigneeDisplay?.person?.email || null
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are an assistant helping software teams write clear, actionable task descriptions. Your job is to SUPPLEMENT (not replace) an existing description with 1–3 concise sentences: add missing acceptance criteria, clarify scope, or note edge cases. Write in the same language as the task title and existing description. Output only the supplemental text — no preamble, no labels.',
      },
      {
        role: 'user',
        content: `Task: ${currentTask.title}\nAssignee: ${assigneeName ?? 'unassigned'}\nCurrent description:\n${currentText || '(empty)'}\n\nWrite a brief, useful supplement.`,
      },
    ]
    const result = await callLLM(messages, { maxTokens: 250 })
    if (result.error || !result.content) return null
    return result.content
  }

  function getLinkText(type: TaskLinkType, isIncoming: boolean) {
    if (type === 'blocks') return t(isIncoming ? 'task.link.blockedBy' : 'task.link.blocks')
    if (type === 'duplicates') return t(isIncoming ? 'task.link.duplicatedBy' : 'task.link.duplicates')
    return t('task.link.relates_to')
  }

  const canDelete = profile?.role === 'admin'

  const mentionCandidates = mention
    ? members
        .filter((member) => mentionLabel(member).toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 6)
    : []

  // Assignee/reporter may be a real profile or an imported Jira placeholder.
  const assigneeDisplay = taskAssigneeDisplay(currentTask, placeholders)
  const reporterDisplay = taskReporterDisplay(currentTask, placeholders)
  const assigneeValue = currentTask.assignee_id ?? (currentTask.assignee_placeholder_id ? `placeholder:${currentTask.assignee_placeholder_id}` : '')
  const reporterValue = currentTask.reporter_id ?? (currentTask.reporter_placeholder_id ? `placeholder:${currentTask.reporter_placeholder_id}` : '')

  function personFields(value: string, kind: 'assignee' | 'reporter'): Partial<Task> {
    const real = value && !value.startsWith('placeholder:') ? value : null
    const placeholder = value.startsWith('placeholder:') ? value.slice('placeholder:'.length) : null
    return kind === 'assignee'
      ? { assignee_id: real, assignee_placeholder_id: placeholder }
      : { reporter_id: real, reporter_placeholder_id: placeholder }
  }

  return (
    <>
      {/* Dimming backdrop only on small screens; on desktop the drawer is a side
          panel that leaves the backlog list visible and clickable for fast
          switching between issues (Jira-style). */}
      <div className="fixed inset-0 z-[60] bg-slate-950/25 lg:hidden" onClick={handleClose} />

      <aside className="fixed bottom-0 right-0 top-0 z-[70] flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl lg:max-w-[760px]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              {currentTask.key}
            </span>
            <IssueTypeBadge type={currentTask.issue_type} />
            <PriorityBadge priority={currentTask.priority} />
          </div>

          <div className="flex items-center gap-2">
            {savedFlash && !isDirty && (
              <span className="flex items-center gap-1 text-sm font-medium text-emerald-600 transition-opacity">
                ✓ {t('common.saved')}
              </span>
            )}
            {isDirty && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-qira-pistachio px-3 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
              >
                {saving ? '…' : t('common.save')}
              </button>
            )}
            {canDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={18} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRequestDelete()}
                disabled={deleteRequestSending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
              >
                <ShieldAlert size={15} />
                {deleteRequestSending ? t('backlog.deletionRequestSending') : t('task.requestDelete')}
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

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[1.6fr_0.9fr]">
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
              className="w-full border-none px-0 text-2xl font-semibold leading-tight text-slate-900 outline-none sm:text-[30px]"
            />

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-sm font-semibold text-slate-900">{t('task.reporter')}</p>
                <div className="flex items-center gap-3">
                  <UserAvatar profile={reporterDisplay?.person} size={34} muted={!reporterDisplay} />
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {reporterDisplay?.person.full_name || reporterDisplay?.person.email || '—'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {reporterDisplay?.imported ? t('people.fromJira') : t('task.reporter')}
                    </p>
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
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('task.description')}</p>
                {hasRichDescription && (
                  <button
                    type="button"
                    onClick={() => setEditDescription((v) => !v)}
                    className="text-xs font-medium text-qira-pistachio transition hover:text-qira-pistachio-dk"
                  >
                    {editDescription ? t('task.jira.viewRich') : t('task.jira.editAsText')}
                  </button>
                )}
              </div>
              {hasRichDescription && !editDescription ? (
                <JiraDescriptionRenderer
                  adf={currentTask.jira_description_adf as NonNullable<Task['jira_description_adf']>}
                  attachments={currentTask.attachments}
                />
              ) : (
                <MarkdownEditor
                  value={draftDescription}
                  onChange={setDraftDescription}
                  onBlur={persistDrafts}
                  rows={10}
                  placeholder={t('task.emptyDescription')}
                  members={members}
                  onAiSuggest={handleAiSuggestDescription}
                />
              )}
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
                  className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                />
                <button
                  type="button"
                  onClick={handleCreateSubtask}
                  disabled={!subtaskTitle.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
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

              <div className="relative mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <textarea
                  ref={commentRef}
                  value={commentBody}
                  onChange={handleCommentChange}
                  onKeyDown={(event) => { if (event.key === 'Escape') setMention(null) }}
                  rows={3}
                  placeholder={t('task.commentPlaceholder')}
                  className="w-full resize-none bg-transparent text-sm text-slate-900 outline-none"
                />
                {mention && mentionCandidates.length > 0 && (
                  <div className="absolute left-3 top-[3.25rem] z-10 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                    {mentionCandidates.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onMouseDown={(event) => { event.preventDefault(); insertMention(member) }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <UserAvatar profile={member} size={22} muted={false} />
                        <span className="truncate">{mentionLabel(member)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {commentFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {commentFiles.map((file, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {file.name}
                        <button
                          type="button"
                          onClick={() => setCommentFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="ml-0.5 text-slate-400 hover:text-slate-700"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => commentFileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-slate-600"
                    title={t('task.attachments')}
                  >
                    <Paperclip size={16} />
                  </button>
                  <input
                    ref={commentFileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleCommentFileInput}
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddComment()}
                    disabled={(!commentBody.trim() && commentFiles.length === 0) || commentUploading}
                    className="inline-flex items-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
                  >
                    <Send size={15} />
                    {commentUploading ? '…' : t('task.addComment')}
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
                      <MarkdownRenderer source={comment.body} members={members} className="mt-2" />
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
                  onChange={(status: TaskStatus) => void quickUpdate({ status })}
                />
              </MetaSection>

              <MetaSection title={t('task.issueType')}>
                <select
                  value={currentTask.issue_type}
                  onChange={(event) => void quickUpdate({ issue_type: event.target.value as IssueType })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                >
                  <option value="task">{t('issueType.task')}</option>
                  <option value="story">{t('issueType.story')}</option>
                  <option value="bug">{t('issueType.bug')}</option>
                </select>
              </MetaSection>

              <MetaSection title={t('task.priority')}>
                <select
                  value={currentTask.priority}
                  onChange={(event) => void quickUpdate({ priority: event.target.value as IssuePriority })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
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
                  value={assigneeValue}
                  onChange={(event) => void quickUpdate(personFields(event.target.value, 'assignee'))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                >
                  <option value="">{t('common.unassigned')}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name || member.email}
                    </option>
                  ))}
                  {placeholders.length > 0 && (
                    <optgroup label={t('people.fromJira')}>
                      {placeholders.map((placeholder) => (
                        <option key={placeholder.id} value={`placeholder:${placeholder.id}`}>
                          {placeholder.display_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </MetaSection>

              <MetaSection title={t('task.reporter')}>
                <select
                  value={reporterValue}
                  onChange={(event) => void quickUpdate(personFields(event.target.value, 'reporter'))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                >
                  <option value="">{t('common.unassigned')}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name || member.email}
                    </option>
                  ))}
                  {placeholders.length > 0 && (
                    <optgroup label={t('people.fromJira')}>
                      {placeholders.map((placeholder) => (
                        <option key={placeholder.id} value={`placeholder:${placeholder.id}`}>
                          {placeholder.display_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </MetaSection>

              <MetaSection title={t('task.sprint')}>
                <select
                  value={currentTask.sprint_id ?? ''}
                  onChange={(event) => void quickUpdate({ sprint_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                >
                  <option value="">{t('common.backlog')}</option>
                  {availableSprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.epic_id
                        ? `${sprint.name} — ${epics.find((epic) => epic.id === sprint.epic_id)?.title ?? t('task.epic')}`
                        : sprint.name}
                    </option>
                  ))}
                </select>
              </MetaSection>

               <MetaSection title={t('task.epic')}>
                 <select
                   disabled={Boolean(selectedSprint)}
                   value={effectiveEpicId}
                   onChange={(event) => void quickUpdate({ epic_id: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio disabled:bg-slate-50"
                >
                  <option value="">{t('common.none')}</option>
                  {epics.map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.key} — {epic.title}
                    </option>
                  ))}
                 </select>
                 {selectedSprint && (
                   <p className="mt-2 text-xs text-slate-500">
                     {selectedSprint.epic_id
                       ? `${t('task.epic')}: ${epics.find((epic) => epic.id === selectedSprint.epic_id)?.title ?? t('common.none')}`
                       : t('common.none')}
                   </p>
                 )}
               </MetaSection>

               <MetaSection title={t('task.links')}>
                 <div className="space-y-3">
                   <select
                     value={linkType}
                     onChange={(event) => setLinkType(event.target.value as TaskLinkType)}
                     className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                   >
                     <option value="blocks">{t('task.link.blocks')}</option>
                     <option value="relates_to">{t('task.link.relates_to')}</option>
                     <option value="duplicates">{t('task.link.duplicates')}</option>
                   </select>

                   <select
                     value={linkedTaskId}
                     onChange={(event) => setLinkedTaskId(event.target.value)}
                     className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                   >
                     <option value="">{t('task.selectIssue')}</option>
                     {linkableTasks.map((candidate) => (
                       <option key={candidate.id} value={candidate.id}>
                         {candidate.key} - {candidate.title}
                       </option>
                     ))}
                   </select>

                   <button
                     type="button"
                     disabled={!linkedTaskId}
                     onClick={handleAddLink}
                     className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
                   >
                     <Link2 size={15} />
                     {t('task.addLink')}
                   </button>

                   <div className="space-y-2">
                     {relatedLinks.length === 0 ? (
                       <p className="rounded-2xl bg-white px-4 py-4 text-sm text-slate-500">{t('task.noLinks')}</p>
                     ) : (
                       relatedLinks.map((link) => {
                         const isIncoming = link.target_task_id === currentTask.id
                         const linkedTask = isIncoming
                           ? tasks.find((item) => item.id === link.source_task_id) ?? link.source_task
                           : tasks.find((item) => item.id === link.target_task_id) ?? link.target_task
                         const canDeleteLink = canDeleteAuthoredContent(activeProjectRole, profile?.id, link.created_by, currentTask.status)

                         return (
                           <div key={link.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                             <div className="flex items-start justify-between gap-3">
                               <button
                                 type="button"
                                 onClick={() => linkedTask?.id && setOpenTaskId(linkedTask.id)}
                                 className="min-w-0 text-left"
                               >
                                 <p className="truncate text-sm font-semibold text-slate-900">
                                   {linkedTask?.key ?? '—'} - {linkedTask?.title ?? '—'}
                                 </p>
                                 <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-400">{getLinkText(link.link_type, isIncoming)}</p>
                               </button>
                               {canDeleteLink && (
                                 <button
                                   type="button"
                                   onClick={() => void deleteTaskLink(link.id)}
                                   className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                 >
                                   <Trash2 size={14} />
                                 </button>
                               )}
                             </div>
                           </div>
                         )
                       })
                     )}
                   </div>
                 </div>
               </MetaSection>

               <MetaSection title={t('task.labels')}>
                 <input
                   value={draftLabels}
                  onChange={(event) => setDraftLabels(event.target.value)}
                  onBlur={persistDrafts}
                  placeholder={t('task.labelsPlaceholder')}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                />
              </MetaSection>

               <MetaSection title={t('task.dueDate')}>
                 <input
                   type="date"
                  value={currentTask.due_date ?? ''}
                  onChange={(event) => void quickUpdate({ due_date: event.target.value || null })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-qira-pistachio"
                 />
               </MetaSection>

               <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                 <div className="flex items-center gap-2 text-slate-900">
                   <Timer size={16} />
                   <p className="font-semibold">{t('task.daysInStatus')}</p>
                 </div>
                 <p className="mt-2">{formatStatusAge(locale, currentTask)}</p>
                 <p className="mt-3"><span className="font-semibold text-slate-900">{t('task.cycleTime')}:</span> {cycleTime}</p>
                 <p className="mt-2"><span className="font-semibold text-slate-900">{t('task.started')}:</span> {formatDate(locale, currentTask.started_at)}</p>
                 <p className="mt-2"><span className="font-semibold text-slate-900">{t('task.completed')}:</span> {formatDate(locale, currentTask.completed_at)}</p>
                 <p className="mt-3"><span className="font-semibold text-slate-900">{t('task.created')}:</span> {formatDate(locale, currentTask.created_at)}</p>
                 <p className="mt-2"><span className="font-semibold text-slate-900">{t('task.updated')}:</span> {formatDate(locale, currentTask.updated_at)}</p>
               </div>
             </div>
           </div>
        </div>
      </aside>
    </>
  )
}
