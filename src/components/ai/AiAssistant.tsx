import { useEffect, useRef, useState } from 'react'
import { Paperclip, Sparkles, X, Send } from 'lucide-react'
import { callLLM, getLLMConfig } from '@/lib/ai'
import {
  executeTool,
  findAiAgentProfile,
  getFillTaskToolDefinition,
  getSplitTasksToolDefinition,
  getToolDefinitions,
  mapWithConcurrency,
  resolveAssigneeByRole,
} from '@/lib/agentTools'
import type { FillTaskResult, SplitTasksResult } from '@/lib/agentTools'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'
import type { LLMMessage } from '@/lib/ai'

interface AiAssistantProps {
  projectName?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface PendingFile {
  name: string
  content: string
}

type FillOutcome = { data: FillTaskResult; block: string } | { error: string; block: string }

const MAX_TOOL_ITERATIONS = 8
const FILL_TASK_CONCURRENCY = 4

export function AiAssistant({ projectName }: AiAssistantProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const epics = useStore((state) => state.epics)
  const sprints = useStore((state) => state.sprints)
  const members = useStore((state) => state.members)
  const createEpic = useStore((state) => state.createEpic)
  const createSprint = useStore((state) => state.createSprint)
  const createTask = useStore((state) => state.createTask)
  const updateTask = useStore((state) => state.updateTask)

  useEffect(() => {
    const config = getLLMConfig()
    setHasKey(Boolean(config.apiKey))
  }, [open])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const content = await file.text()
    setPendingFile({ name: file.name, content })
  }

  async function handleImportFile(file: PendingFile) {
    setMessages((prev) => [...prev, { role: 'user', content: `📎 ${file.name}` }])
    setLoading(true)

    const aiAgentProfileId = findAiAgentProfile(members)?.id ?? null
    const epicsList = epics.map((epic) => `${epic.id}: ${epic.title}`).join('; ') || 'none yet'
    const membersList = members.map((member) => `${member.full_name || member.email} — ${member.department || 'no department set'}`).join('; ') || 'none'

    function say(content: string) {
      setMessages((prev) => [...prev, { role: 'assistant', content }])
    }

    let split: SplitTasksResult | null = null

    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const parsed = JSON.parse(file.content) as unknown
        const items = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { tasks?: unknown })?.tasks)
            ? (parsed as { tasks: unknown[] }).tasks
            : null
        if (!items) throw new Error('expected a JSON array of tasks (or a { tasks: [...] } object)')

        const maybeEpic = (parsed as { epic?: SplitTasksResult['epic'] })?.epic
        const maybeSprints = (parsed as { sprints?: SplitTasksResult['sprints'] })?.sprints
        split = { epic: maybeEpic, sprints: maybeSprints, task_blocks: items.map((item) => JSON.stringify(item)) }
      } catch (err) {
        say(`Не смог разобрать JSON: ${err instanceof Error ? err.message : String(err)}`)
        setLoading(false)
        return
      }
    } else {
      const splitPrompt = [
        'You split a source document listing project tasks into individual task blocks — one verbatim block of text per task.',
        'Do not interpret or summarize the content, just find the boundaries between tasks.',
        `Existing epics: ${epicsList}.`,
        'Reuse an existing epic by id if the document is clearly about one of them; otherwise propose a title for a new epic.',
      ].join(' ')

      const result = await callLLM(
        [{ role: 'system', content: splitPrompt }, { role: 'user', content: file.content }],
        { maxTokens: 4096, tools: [getSplitTasksToolDefinition()], toolChoice: { name: 'split_tasks' } },
      )

      const call = result.toolCalls?.[0]
      if (result.error || !call) {
        say(`Не удалось разобрать файл: ${result.error ?? 'модель не вернула структуру'}`)
        setLoading(false)
        return
      }

      try {
        split = JSON.parse(call.arguments) as SplitTasksResult
      } catch {
        say('Не удалось разобрать ответ модели (битый JSON)')
        setLoading(false)
        return
      }
    }

    if (!split.task_blocks?.length) {
      say('В файле не нашлось ни одной задачи')
      setLoading(false)
      return
    }

    say(`Нашёл задач: ${split.task_blocks.length}. Начинаю создавать...`)

    let epicId = split.epic?.existing_epic_id ?? null
    if (!epicId) {
      const createdEpic = await createEpic({
        title: split.epic?.new_title || file.name,
        description: split.epic?.new_description ?? '',
        created_by: aiAgentProfileId ?? undefined,
      })
      if (!createdEpic) {
        say('Не удалось создать эпик')
        setLoading(false)
        return
      }
      epicId = createdEpic.id
      say(`Создан эпик "${createdEpic.title}" (${createdEpic.key})`)
    }

    const sprintIdByName = new Map<string, string>()
    for (const sprint of split.sprints ?? []) {
      const createdSprint = await createSprint({ epic_id: epicId, name: sprint.name, goal: sprint.goal ?? '' })
      if (createdSprint) {
        sprintIdByName.set(sprint.name, createdSprint.id)
        say(`Создан спринт "${createdSprint.name}"`)
      }
    }

    const fillPrompt = [
      'Extract this single task\'s fields from the given block of text. Only use what is literally stated — never invent a priority, due date, or role.',
      `Team members and their roles: ${membersList}.`,
    ].join(' ')

    const filled = await mapWithConcurrency<string, FillOutcome>(split.task_blocks, FILL_TASK_CONCURRENCY, async (block) => {
      const result = await callLLM(
        [{ role: 'system', content: fillPrompt }, { role: 'user', content: block }],
        { maxTokens: 500, tools: [getFillTaskToolDefinition()], toolChoice: { name: 'fill_task' } },
      )
      const call = result.toolCalls?.[0]
      if (result.error || !call) return { error: result.error ?? 'модель не вернула структуру', block }
      try {
        return { data: JSON.parse(call.arguments) as FillTaskResult, block }
      } catch {
        return { error: 'битый JSON от модели', block }
      }
    })

    let createdCount = 0
    let unassignedCount = 0

    for (const outcome of filled) {
      if ('error' in outcome) {
        say(`Пропустил задачу — ${outcome.error}`)
        continue
      }

      const { data } = outcome
      const { id: assigneeId, note } = resolveAssigneeByRole(data.role, members)
      if (!assigneeId) unassignedCount += 1
      const sprintId = data.sprint_name ? sprintIdByName.get(data.sprint_name) ?? null : null

      const task = await createTask({
        epic_id: epicId,
        sprint_id: sprintId,
        title: data.title,
        description: data.description ?? '',
        priority: data.priority,
        due_date: data.due_date ?? null,
        assignee_id: assigneeId,
        reporter_id: aiAgentProfileId ?? undefined,
      })

      if (task) {
        createdCount += 1
        say(`Создана задача "${task.title}" (${task.key})${note}`)
      } else {
        say(`Не удалось создать задачу "${data.title}"`)
      }
    }

    say(`Готово: создано ${createdCount} из ${split.task_blocks.length} задач, ${unassignedCount} без исполнителя.`)
    setLoading(false)
  }

  async function handleSend() {
    if (loading) return

    if (pendingFile) {
      const file = pendingFile
      setPendingFile(null)
      setInput('')
      await handleImportFile(file)
      return
    }

    const text = input.trim()
    if (!text) return
    setInput('')

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const aiAgentProfileId = findAiAgentProfile(members)?.id ?? null
    const epicsList = epics.map((epic) => `${epic.id}: ${epic.title}`).join('; ') || 'none yet'
    const sprintsList = sprints.map((sprint) => `${sprint.id}: ${sprint.name} (epic ${sprint.epic_id ?? 'none'})`).join('; ') || 'none yet'
    const membersList = members.map((member) => `${member.full_name || member.email} — ${member.department || 'no department set'}`).join('; ') || 'none'

    const systemPrompt = [
      'You are Qira AI, an agent that manages epics, sprints, and tasks for this project management app.',
      'You have tools to create epics, sprints, and tasks, and to edit tasks — when the user asks you to create or fill in project items (e.g. from pasted text), actually call the tools, do not just describe what you would do.',
      'Never invent a due date — only set one if the source text explicitly gives it. Never invent an assignee — only set a role if the source text or team roster supports it.',
      `Project: ${projectName ?? 'Unknown'}.`,
      `Existing epics: ${epicsList}.`,
      `Existing sprints: ${sprintsList}.`,
      `Team members and their roles: ${membersList}.`,
      'Respond concisely.',
    ].join(' ')

    let wireMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    const tools = getToolDefinitions()
    const toolCtx = { members, aiAgentProfileId, createEpic, createSprint, createTask, updateTask }

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const result = await callLLM(wireMessages, { maxTokens: 800, tools })

      if (result.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: result.error as string }])
        break
      }

      if (result.toolCalls?.length) {
        wireMessages = [...wireMessages, { role: 'assistant', content: result.content ?? '', toolCalls: result.toolCalls }]

        for (const call of result.toolCalls) {
          const toolContent = await executeTool(call.name, call.arguments, toolCtx)
          setMessages((prev) => [...prev, { role: 'assistant', content: toolContent }])
          wireMessages = [...wireMessages, { role: 'tool', content: toolContent, toolCallId: call.id }]
        }
        continue
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: result.content ?? 'No response' }])
      break
    }

    setLoading(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed right-4 bottom-40 lg:right-6 lg:bottom-20 z-[80] w-80 sm:w-96 rounded-2xl bg-white shadow-2xl flex flex-col"
          style={{ maxHeight: '60vh', animation: 'aiSlideUp 0.18s ease-out' }}
        >
          <style>{`
            @keyframes aiSlideUp {
              from { opacity: 0; transform: translateY(16px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#6B9E6B]" />
              <span className="text-sm font-semibold text-slate-900">{t('ai.title')}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {!hasKey ? (
              <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                {t('ai.configure')}
              </p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">{t('ai.title')} 👋</p>
            ) : null}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={['flex', msg.role === 'user' ? 'justify-end' : 'justify-start'].join(' ')}
              >
                <div
                  className={[
                    'max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
                    msg.role === 'user'
                      ? 'bg-[#6B9E6B] text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm',
                  ].join(' ')}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-500 italic">
                  {t('ai.thinking')}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {hasKey && (
            <div className="border-t border-slate-100 px-3 py-2">
              {pendingFile && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                  <Paperclip size={12} />
                  <span className="min-w-0 flex-1 truncate">{pendingFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    className="rounded-lg p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,.json"
                  className="hidden"
                  onChange={(e) => void handleFileSelected(e)}
                />
                <button
                  type="button"
                  onClick={handleAttachClick}
                  disabled={loading}
                  title={t('ai.attach')}
                  className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  <Paperclip size={15} />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('ai.placeholder')}
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#6B9E6B] transition"
                  style={{ maxHeight: '100px' }}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={(!input.trim() && !pendingFile) || loading}
                  className="rounded-xl bg-[#6B9E6B] p-2.5 text-white transition hover:bg-[#5a8a5a] disabled:opacity-50"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-[80]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#6B9E6B] text-white shadow-lg transition hover:bg-[#5a8a5a] hover:scale-105 active:scale-95"
          title={t('ai.title')}
        >
          <Sparkles size={22} />
        </button>
      </div>
    </>
  )
}
