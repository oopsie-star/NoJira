import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useAuthContext } from '@/auth/AuthContext'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { parseLabels } from '@/lib/format'
import { useStore } from '@/store'
import type { IssuePriority, IssueType, Task, TaskStatus } from '@/types'

interface CreateTaskModalProps {
  onClose: () => void
  initialValues?: Partial<Task>
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
      {children}
    </label>
  )
}

export function CreateTaskModal({ onClose, initialValues }: CreateTaskModalProps) {
  const { profile } = useAuthContext()
  const { t } = useI18n()
  const createTask = useStore((state) => state.createTask)
  const tasks = useStore((state) => state.tasks)
  const sprints = useStore((state) => state.sprints)
  const epics = useStore((state) => state.epics)
  const members = useStore((state) => state.members)

  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(initialValues?.status ?? 'todo')
  const [issueType, setIssueType] = useState<IssueType>(initialValues?.issue_type ?? 'task')
  const [priority, setPriority] = useState<IssuePriority>(initialValues?.priority ?? 'medium')
  const [sprintId, setSprintId] = useState(initialValues?.sprint_id ?? '')
  const [epicId, setEpicId] = useState(initialValues?.epic_id ?? '')
  const [assigneeId, setAssigneeId] = useState(initialValues?.assignee_id ?? '')
  const [dueDate, setDueDate] = useState(initialValues?.due_date ?? '')
  const [labelsInput, setLabelsInput] = useState((initialValues?.labels ?? []).join(', '))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextPosition = useMemo(() => {
    const relevant = tasks
      .filter((task) => task.sprint_id === (sprintId || null) && task.status === status)
      .sort((left, right) => left.position - right.position)
    return (relevant[relevant.length - 1]?.position ?? 0) + 1000
  }, [tasks, sprintId, status])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return

    setLoading(true)
    setError(null)
    try {
      await createTask({
        title: title.trim(),
        description: description.trim(),
        status,
        issue_type: issueType,
        priority,
        sprint_id: sprintId || null,
        epic_id: epicId || null,
        assignee_id: assigneeId || null,
        reporter_id: profile?.id ?? null,
        due_date: dueDate || null,
        labels: parseLabels(labelsInput),
        position: nextPosition,
      })
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-3xl rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t('task.modalTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('task.modalSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-6 px-6 py-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-5">
            <div>
              <FieldLabel>{t('task.summary')}</FieldLabel>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('task.titlePlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-jira-blue focus:ring-4 focus:ring-jira-blue-lt"
              />
            </div>

            <div>
              <FieldLabel>{t('task.description')}</FieldLabel>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={7}
                placeholder={t('task.descriptionPlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue focus:ring-4 focus:ring-jira-blue-lt"
              />
            </div>

            <div>
              <FieldLabel>{t('task.labels')}</FieldLabel>
              <input
                value={labelsInput}
                onChange={(event) => setLabelsInput(event.target.value)}
                placeholder={t('task.labelsPlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue focus:ring-4 focus:ring-jira-blue-lt"
              />
            </div>
          </div>

          <div className="space-y-4 rounded-[24px] bg-slate-50 p-4">
            <div>
              <FieldLabel>{t('task.issueType')}</FieldLabel>
              <select
                value={issueType}
                onChange={(event) => setIssueType(event.target.value as IssueType)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              >
                <option value="task">{t('issueType.task')}</option>
                <option value="story">{t('issueType.story')}</option>
                <option value="bug">{t('issueType.bug')}</option>
              </select>
            </div>

            <div>
              <FieldLabel>{t('task.status')}</FieldLabel>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              >
                <option value="todo">{t('status.todo')}</option>
                <option value="in_progress">{t('status.in_progress')}</option>
                <option value="done">{t('status.done')}</option>
              </select>
            </div>

            <div>
              <FieldLabel>{t('task.priority')}</FieldLabel>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as IssuePriority)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              >
                <option value="lowest">{t('priority.lowest')}</option>
                <option value="low">{t('priority.low')}</option>
                <option value="medium">{t('priority.medium')}</option>
                <option value="high">{t('priority.high')}</option>
                <option value="highest">{t('priority.highest')}</option>
              </select>
            </div>

            <div>
              <FieldLabel>{t('task.assignee')}</FieldLabel>
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              >
                <option value="">{t('common.unassigned')}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>{t('task.sprint')}</FieldLabel>
              <select
                value={sprintId}
                onChange={(event) => setSprintId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              >
                <option value="">{t('common.backlog')}</option>
                {sprints.filter((sprint) => sprint.status !== 'completed').map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>{t('task.epic')}</FieldLabel>
              <select
                value={epicId}
                onChange={(event) => setEpicId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              >
                <option value="">{t('common.none')}</option>
                {epics.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.key} — {epic.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>{t('task.dueDate')}</FieldLabel>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-jira-blue"
              />
            </div>
          </div>

          <div className="col-span-full flex justify-end gap-3 border-t border-slate-200 pt-5">
            {error && (
              <div className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || loading}
              className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? t('auth.wait') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
