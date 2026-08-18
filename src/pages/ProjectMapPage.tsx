import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Code2, Flag, FlaskConical, Loader2, Palette, Plus, Server, Sparkles, Trash2 } from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { TaskDrawer } from '@/components/task/TaskDrawer'
import { AttachmentUpload } from '@/components/task/AttachmentUpload'
import { UserAvatar } from '@/components/common/UserAvatar'
import { StatusBadge } from '@/components/common/IssueBadges'
import { MarkdownRenderer } from '@/lib/markdown'
import { useAuthContext } from '@/auth/AuthContext'
import { canAskInMapBlock, mapDisciplinesForProfile } from '@/lib/discipline'
import { findTopicMismatch, type TopicMismatch } from '@/lib/mapTopicMatch'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { canDeleteAttachment, canManageProject, canOverrideDelete } from '@/lib/permissions'
import { useStore } from '@/store'
import { MAP_DISCIPLINES, type MapDiscipline, type ProjectMapBlock, type ProjectMapQaEntry } from '@/types'

const DISCIPLINE_ICONS: Record<MapDiscipline, typeof Server> = {
  backend: Server,
  frontend: Code2,
  design: Palette,
  qa: FlaskConical,
}

/** What a QA block can declare it covers — QA never covers itself. */
const COVERABLE_DISCIPLINES = MAP_DISCIPLINES.filter(
  (item): item is Exclude<MapDiscipline, 'qa'> => item !== 'qa',
)

/** Matches the discipline badge palette used on backlog rows. */
const DISCIPLINE_ACTIVE_CLASSES: Record<MapDiscipline, string> = {
  backend: 'bg-amber-100 text-amber-700',
  frontend: 'bg-blue-100 text-blue-700',
  design: 'bg-pink-100 text-pink-700',
  qa: 'bg-emerald-100 text-emerald-700',
}

function AuthorLine({ entry }: { entry: ProjectMapQaEntry }) {
  const { locale, t } = useI18n()

  return (
    <div className="flex items-center gap-2">
      {entry.author_agent ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
          <Sparkles size={11} />
          {t(`ai.agent.${entry.author_agent}`)}
        </span>
      ) : (
        <>
          <UserAvatar profile={entry.author ?? null} size={20} muted={!entry.author} />
          <span className="text-xs font-semibold text-slate-700">
            {entry.author?.full_name || entry.author?.email || '—'}
          </span>
        </>
      )}
      <span className="text-xs text-slate-400">{formatDate(locale, entry.created_at, { time: true })}</span>
    </div>
  )
}

function QaThread({ question, answers }: { question: ProjectMapQaEntry; answers: ProjectMapQaEntry[] }) {
  const { t } = useI18n()
  const { profile } = useAuthContext()
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const addProjectMapQa = useStore((state) => state.addProjectMapQa)
  const deleteProjectMapQa = useStore((state) => state.deleteProjectMapQa)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const canDelete = (entry: ProjectMapQaEntry) =>
    canOverrideDelete(activeProjectRole) || Boolean(profile?.id && entry.author_id === profile.id)

  async function handleAnswer(event: FormEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    setSending(true)
    try {
      await addProjectMapQa(question.block_id, draft, question.id)
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <AuthorLine entry={question} />
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-900">{question.body}</p>
        </div>
        {canDelete(question) && (
          <button
            type="button"
            onClick={() => void deleteProjectMapQa(question.id)}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            aria-label={t('common.delete')}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {answers.length === 0 ? (
        <p className="mt-2 border-l-2 border-slate-100 pl-3 text-xs text-slate-400">
          {t('map.noAnswer')} · {t('map.awaitingAgent')}
        </p>
      ) : (
        <div className="mt-2 space-y-2 border-l-2 border-qira-pistachio-lt pl-3">
          {answers.map((answer) => (
            <div key={answer.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <AuthorLine entry={answer} />
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{answer.body}</p>
              </div>
              {canDelete(answer) && (
                <button
                  type="button"
                  onClick={() => void deleteProjectMapQa(answer.id)}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAnswer} className="mt-2.5 flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('map.answerPlaceholder')}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-qira-pistachio"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
        >
          {t('map.answer')}
        </button>
      </form>
    </div>
  )
}

function LinkedWork({ block }: { block: ProjectMapBlock }) {
  const { t } = useI18n()
  const tasks = useStore((state) => state.tasks)
  const epics = useStore((state) => state.epics)
  const setOpenTaskId = useStore((state) => state.setOpenTaskId)

  // Agents may reference work that isn't loaded (or was deleted) — only render
  // links we can actually resolve, so a stale id never becomes a dead chip.
  const linkedTasks = useMemo(
    () => block.linked_task_ids.map((id) => tasks.find((task) => task.id === id)).filter(Boolean),
    [block.linked_task_ids, tasks],
  )
  const linkedEpics = useMemo(
    () => block.linked_epic_ids.map((id) => epics.find((epic) => epic.id === id)).filter(Boolean),
    [block.linked_epic_ids, epics],
  )

  if (linkedTasks.length === 0 && linkedEpics.length === 0) return null

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{t('map.linkedWork')}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {linkedEpics.map((epic) => epic && (
          <span
            key={epic.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: `${epic.color}20`, color: epic.color }}
          >
            <Flag size={11} />
            {epic.key} · {epic.title}
          </span>
        ))}
        {linkedTasks.map((task) => task && (
          <button
            key={task.id}
            type="button"
            onClick={() => setOpenTaskId(task.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <span className="uppercase tracking-[0.08em] text-slate-400">{task.key}</span>
            <span className="max-w-[16rem] truncate">{task.title}</span>
            <StatusBadge status={task.status} />
          </button>
        ))}
      </div>
    </div>
  )
}

function MapBlockCard({
  block,
  focused,
  onNavigateToBlock,
}: {
  block: ProjectMapBlock
  focused: boolean
  onNavigateToBlock: (block: ProjectMapBlock) => void
}) {
  const { locale, t } = useI18n()
  const { profile } = useAuthContext()
  const members = useStore((state) => state.members)
  const allBlocks = useStore((state) => state.projectMapBlocks)
  const projectMapQa = useStore((state) => state.projectMapQa)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const addProjectMapQa = useStore((state) => state.addProjectMapQa)
  const updateProjectMapBlock = useStore((state) => state.updateProjectMapBlock)
  const deleteProjectMapBlock = useStore((state) => state.deleteProjectMapBlock)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [mismatch, setMismatch] = useState<TopicMismatch | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const canManage = canManageProject(activeProjectRole)
  const canAsk = canAskInMapBlock(block, profile, activeProjectRole)
  const ownDisciplines = mapDisciplinesForProfile(profile)

  // Arriving from the Q&A navigator: reveal the thread and bring it on screen.
  useEffect(() => {
    if (!focused) return
    setQuestionsOpen(true)
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focused])

  const { questions, answersByQuestion } = useMemo(() => {
    const forBlock = projectMapQa.filter((entry) => entry.block_id === block.id)
    const byQuestion = new Map<string, ProjectMapQaEntry[]>()
    for (const entry of forBlock) {
      if (!entry.parent_id) continue
      const bucket = byQuestion.get(entry.parent_id)
      if (bucket) bucket.push(entry)
      else byQuestion.set(entry.parent_id, [entry])
    }
    return { questions: forBlock.filter((entry) => !entry.parent_id), answersByQuestion: byQuestion }
  }, [projectMapQa, block.id])

  async function handleAsk(event: FormEvent) {
    event.preventDefault()
    if (!draft.trim() || !canAsk) return

    // One speed bump, not a wall: if the question clearly belongs to another
    // block, say so and make them press again. Pressing again posts it here —
    // the heuristic is a hint and is sometimes wrong, so it never gets a veto.
    if (!mismatch) {
      const found = findTopicMismatch(draft, block, allBlocks)
      if (found) {
        setMismatch(found)
        return
      }
    }

    setSending(true)
    try {
      await addProjectMapQa(block.id, draft)
      setDraft('')
      setMismatch(null)
      setQuestionsOpen(true)
    } finally {
      setSending(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('map.deleteBlockConfirm', { name: block.title }))) return
    await deleteProjectMapBlock(block.id)
  }

  return (
    <section
      ref={sectionRef}
      className={[
        'rounded-[28px] bg-white p-5 shadow-sm transition',
        focused ? 'ring-2 ring-qira-pistachio' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {canManage ? (
            <input
              key={block.title}
              defaultValue={block.title}
              placeholder={t('map.newBlockTitle')}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== block.title) void updateProjectMapBlock(block.id, { title: value })
                else event.target.value = block.title
              }}
              className="w-full rounded-lg border border-transparent bg-transparent px-1 -mx-1 text-base font-semibold text-slate-900 outline-none transition focus:border-slate-200 focus:bg-white"
            />
          ) : (
            <h2 className="text-base font-semibold text-slate-900">{block.title}</h2>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
            <span>{t('map.updated')} {formatDate(locale, block.updated_at, { time: true })}</span>
            {block.last_ai_agent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">
                <Sparkles size={10} />
                {t(`ai.agent.${block.last_ai_agent}`)}
              </span>
            )}
            {/* QA is cross-cutting: declaring whose work a QA block covers is
                what lets those authors ask about it, not just testers. */}
            {block.discipline === 'qa' && (canManage ? (
              <label className="inline-flex items-center gap-1">
                <span>{t('map.coversLabel')}</span>
                <select
                  value={block.covers_discipline ?? ''}
                  onChange={(event) => void updateProjectMapBlock(block.id, {
                    covers_discipline: (event.target.value || null) as ProjectMapBlock['covers_discipline'],
                  })}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 outline-none transition focus:border-qira-pistachio"
                >
                  <option value="">{t('map.coversUndeclared')}</option>
                  {COVERABLE_DISCIPLINES.map((item) => (
                    <option key={item} value={item}>{t(`map.discipline.${item}`)}</option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                {t('map.coversLabel')}{' '}
                {block.covers_discipline
                  ? t(`map.discipline.${block.covers_discipline}`)
                  : t('map.coversUndeclared')}
              </span>
            ))}
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            aria-label={t('map.deleteBlock')}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="mt-3">
        {block.body.trim() ? (
          <MarkdownRenderer source={block.body} members={members} className="text-sm text-slate-700" />
        ) : (
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-400">{t('map.emptyBody')}</p>
        )}
      </div>

      <LinkedWork block={block} />

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setAttachmentsOpen((value) => !value)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-slate-700"
        >
          {attachmentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('task.attachments')}
          {block.attachments.length > 0 && <span className="font-normal text-slate-400">({block.attachments.length})</span>}
        </button>
        {attachmentsOpen && (
          <div className="mt-2">
            <AttachmentUpload
              pathPrefix={`${block.project_id}/project-map/${block.id}`}
              currentUserId={profile?.id ?? null}
              attachments={block.attachments}
              canDelete={(authorId) => canDeleteAttachment(activeProjectRole, profile?.id ?? null, authorId)}
              onAttachmentsChange={(paths) => updateProjectMapBlock(block.id, { attachments: paths })}
              wide
            />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-[20px] bg-slate-50 p-3">
        <button
          type="button"
          onClick={() => setQuestionsOpen((value) => !value)}
          className="flex w-full items-center gap-2 text-left"
        >
          {questionsOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
          <span className="text-sm font-semibold text-slate-900">{t('map.questions')}</span>
          <span className="text-xs text-slate-500">{t('map.questionCount', { count: questions.length })}</span>
        </button>

        {questionsOpen && (
          <div className="mt-3 space-y-2">
            {questions.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-400">{t('map.noQuestions')}</p>
            ) : (
              questions.map((question) => (
                <QaThread
                  key={question.id}
                  question={question}
                  answers={answersByQuestion.get(question.id) ?? []}
                />
              ))
            )}
          </div>
        )}

        {mismatch && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">{t('map.mismatchTitle')}</p>
                <p className="mt-1 text-sm text-amber-800">{t('map.mismatchBody')}</p>
                <button
                  type="button"
                  onClick={() => {
                    onNavigateToBlock(mismatch.suggested)
                    setMismatch(null)
                  }}
                  className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-left text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
                >
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px]">
                    {t(`map.discipline.${mismatch.suggested.discipline}`)}
                  </span>
                  <span className="truncate">{mismatch.suggested.title}</span>
                </button>
                <p className="mt-2 text-xs text-amber-700">{t('map.mismatchHint')}</p>
              </div>
            </div>
          </div>
        )}

        {canAsk ? (
          <form onSubmit={handleAsk} className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                // Editing the question invalidates the previous verdict, so the
                // check re-runs on the next submit instead of waving it through.
                if (mismatch) setMismatch(null)
              }}
              placeholder={t('map.askPlaceholder')}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-qira-pistachio"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="shrink-0 rounded-xl bg-qira-pistachio px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-40"
            >
              {mismatch ? t('map.askAnyway') : t('map.ask')}
            </button>
          </form>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
            {ownDisciplines.length > 0
              ? t('map.askOtherBranch', {
                  branch: ownDisciplines.map((item) => t(`map.discipline.${item}`)).join(', '),
                })
              : t('map.askNoDepartment')}
          </p>
        )}
      </div>
    </section>
  )
}

interface QaNavEntry {
  question: ProjectMapQaEntry
  block: ProjectMapBlock
  answerCount: number
}

/**
 * Standing index of every thread in the map, split by whether it has been
 * answered. With a couple of hundred blocks across four tabs, a question is
 * otherwise unfindable unless you already know which block it sits under.
 */
function QaNavigator({
  entries,
  onOpen,
  activeQuestionId,
}: {
  entries: QaNavEntry[]
  onOpen: (entry: QaNavEntry) => void
  activeQuestionId: string | null
}) {
  const { locale, t } = useI18n()
  const [open, setOpen] = useState(true)

  const unanswered = entries.filter((entry) => entry.answerCount === 0)
  const answered = entries.filter((entry) => entry.answerCount > 0)

  function renderGroup(label: string, group: QaNavEntry[], tone: 'pending' | 'done') {
    if (group.length === 0) return null
    return (
      <div>
        <p className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
          {label} · {group.length}
        </p>
        <div className="mt-1.5 space-y-1.5">
          {group.map((entry) => (
            <button
              key={entry.question.id}
              type="button"
              onClick={() => onOpen(entry)}
              className={[
                'w-full rounded-xl border px-3 py-2 text-left transition',
                entry.question.id === activeQuestionId
                  ? 'border-qira-pistachio bg-qira-pistachio-lt/40'
                  : 'border-slate-200 bg-white hover:bg-slate-50',
              ].join(' ')}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={[
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    tone === 'pending' ? 'bg-amber-500' : 'bg-emerald-500',
                  ].join(' ')}
                  aria-hidden
                />
                <span className="shrink-0 text-[11px] font-semibold text-slate-400">
                  {t(`map.discipline.${entry.block.discipline}`)}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                  {formatDate(locale, entry.question.created_at)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-900">{entry.question.body}</p>
              <p className="mt-0.5 truncate text-xs text-slate-400">{entry.block.title}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="rounded-[28px] bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
        <span className="text-sm font-semibold text-slate-900">{t('map.navTitle')}</span>
        {unanswered.length > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            {unanswered.length}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 max-h-[60vh] space-y-4 overflow-y-auto pr-0.5">
          {entries.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-400">{t('map.navEmpty')}</p>
          ) : (
            <>
              {renderGroup(t('map.navUnanswered'), unanswered, 'pending')}
              {renderGroup(t('map.navAnswered'), answered, 'done')}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function ProjectMapPage() {
  const { t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchProjectMap = useStore((state) => state.fetchProjectMap)
  const fetchBacklog = useStore((state) => state.fetchBacklog)
  const fetchEpics = useStore((state) => state.fetchEpics)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchPlaceholders = useStore((state) => state.fetchPlaceholders)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectRole = useStore((state) => state.activeProjectRole)
  const blocks = useStore((state) => state.projectMapBlocks)
  const loading = useStore((state) => state.loadingProjectMap)
  const error = useStore((state) => state.projectMapError)
  const createProjectMapBlock = useStore((state) => state.createProjectMapBlock)
  const projectMapQa = useStore((state) => state.projectMapQa)
  const [discipline, setDiscipline] = useState<MapDiscipline>('backend')
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null)
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const canManage = canManageProject(activeProjectRole)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      // Tasks/epics/members back the linked-work chips and markdown mentions —
      // without them a block's links can't be resolved to anything renderable.
      void Promise.all([fetchProjectMap(), fetchBacklog(), fetchEpics(), fetchMembers(), fetchPlaceholders()])
    }
  }, [activeProjectId, fetchProjectMap, fetchBacklog, fetchEpics, fetchMembers, fetchPlaceholders])

  const countByDiscipline = useMemo(() => {
    const counts = { backend: 0, frontend: 0, design: 0, qa: 0 } as Record<MapDiscipline, number>
    for (const block of blocks) counts[block.discipline] += 1
    return counts
  }, [blocks])

  const visibleBlocks = useMemo(
    () => blocks.filter((block) => block.discipline === discipline),
    [blocks, discipline],
  )

  const qaEntries = useMemo<QaNavEntry[]>(() => {
    const blockById = new Map(blocks.map((block) => [block.id, block]))
    const answerCounts = new Map<string, number>()
    for (const entry of projectMapQa) {
      if (!entry.parent_id) continue
      answerCounts.set(entry.parent_id, (answerCounts.get(entry.parent_id) ?? 0) + 1)
    }
    return projectMapQa
      .filter((entry) => !entry.parent_id && blockById.has(entry.block_id))
      .map((question) => ({
        question,
        block: blockById.get(question.block_id) as ProjectMapBlock,
        answerCount: answerCounts.get(question.id) ?? 0,
      }))
      // Newest first — the navigator is a worklist, and the freshest ask is the
      // one most likely still waiting on someone.
      .sort((left, right) => right.question.created_at.localeCompare(left.question.created_at))
  }, [projectMapQa, blocks])

  /** Switch to the block's tab and scroll its thread into view. */
  function navigateToBlock(block: ProjectMapBlock, questionId: string | null = null) {
    setDiscipline(block.discipline)
    setActiveQuestionId(questionId)
    // Re-set even when it's the same block, so a second click re-scrolls.
    setFocusedBlockId(null)
    window.requestAnimationFrame(() => setFocusedBlockId(block.id))
  }

  return (
    <GlobalLayout>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
        <section className="shrink-0 rounded-[28px] bg-white px-5 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-base font-semibold text-slate-900">{t('map.title')}</h1>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500">{t('map.subtitle')}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {MAP_DISCIPLINES.map((item) => {
              const Icon = DISCIPLINE_ICONS[item]
              const isActive = item === discipline
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setDiscipline(item)}
                  className={[
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    isActive ? DISCIPLINE_ACTIVE_CLASSES[item] : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  ].join(' ')}
                >
                  <Icon size={13} />
                  {t(`map.discipline.${item}`)}
                  <span className={isActive ? 'opacity-70' : 'text-slate-400'}>{countByDiscipline[item]}</span>
                </button>
              )
            })}
          </div>
        </section>

        {loading && blocks.length === 0 ? (
          <section className="rounded-[28px] bg-white p-8 shadow-sm">
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              {t('map.loading')}
            </div>
          </section>
        ) : error ? (
          <section className="rounded-[28px] bg-white p-8 shadow-sm">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertCircle size={20} className="text-rose-500" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{t('map.error')}</p>
                <p className="mt-1 text-sm text-slate-500">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => void fetchProjectMap()}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                {t('map.retry')}
              </button>
            </div>
          </section>
        ) : (
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {visibleBlocks.length === 0 ? (
                <section className="rounded-[28px] bg-white p-8 shadow-sm">
                  <p className="text-center text-sm text-slate-500">{t('map.empty')}</p>
                </section>
              ) : (
                visibleBlocks.map((block) => (
                  <MapBlockCard
                    key={block.id}
                    block={block}
                    focused={block.id === focusedBlockId}
                    onNavigateToBlock={(target) => navigateToBlock(target)}
                  />
                ))
              )}

              {canManage && (
                <button
                  type="button"
                  onClick={() => void createProjectMapBlock({ discipline, title: t('map.newBlockTitle') })}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-[28px] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  <Plus size={15} />
                  {t('map.addBlock')}
                </button>
              )}
            </div>

            {/* Above the blocks on narrow screens, pinned beside them on wide. */}
            <aside className="order-first w-full shrink-0 lg:sticky lg:top-0 lg:order-none lg:w-[300px]">
              <QaNavigator
                entries={qaEntries}
                activeQuestionId={activeQuestionId}
                onOpen={(entry) => navigateToBlock(entry.block, entry.question.id)}
              />
            </aside>
          </div>
        )}
      </div>
      <TaskDrawer />
    </GlobalLayout>
  )
}
