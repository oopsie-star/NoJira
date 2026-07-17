import { useEffect, useRef, useState } from 'react'
import { Paperclip, Sparkles, X, Send } from 'lucide-react'
import { callLLM, getLLMConfig } from '@/lib/ai'
import {
  executeTool,
  findAiAgentProfile,
  getFillTaskToolDefinition,
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
const IMPORT_MAX_ITERATIONS = 150
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

  function say(content: string) {
    setMessages((prev) => [...prev, { role: 'assistant', content }])
  }

  /** Shared tool-calling loop — same mechanism for a normal chat message and
   * for a whole attached document, just with a different iteration budget:
   * the model calls create_epic/create_sprint/create_task/update_task one at
   * a time until it stops, no forced upfront "summarize everything" step. */
  async function runAgentLoop(userContent: string, history: ChatMessage[], extraInstruction: string, maxIterations: number) {
    setLoading(true)

    const aiAgentProfileId = findAiAgentProfile(members)?.id ?? null
    const epicsList = epics.map((epic) => `${epic.id}: ${epic.title}`).join('; ') || 'none yet'
    const sprintsList = sprints.map((sprint) => `${sprint.id}: ${sprint.name} (epic ${sprint.epic_id ?? 'none'})`).join('; ') || 'none yet'
    const membersList = members.map((member) => `${member.full_name || member.email} — ${member.department || 'no department set'}`).join('; ') || 'none'

    const systemPrompt = [
      'You are Qira AI, an agent that manages epics, sprints, and tasks for this project management app.',
      'You have tools to create epics, sprints, and tasks, and to edit tasks — actually call the tools, do not just describe what you would do.',
      'Never invent a due date — only set one if the source text explicitly gives it. Never invent an assignee — only set a role if the source text or team roster supports it.',
      `Project: ${projectName ?? 'Unknown'}.`,
      `Existing epics: ${epicsList}.`,
      `Existing sprints: ${sprintsList}.`,
      `Team members and their roles: ${membersList}.`,
      extraInstruction,
      'Respond concisely.',
    ].filter(Boolean).join(' ')

    let wireMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ]

    const tools = getToolDefinitions()
    const toolCtx = { members, aiAgentProfileId, createEpic, createSprint, createTask, updateTask }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const result = await callLLM(wireMessages, { maxTokens: 800, tools })

      if (result.error) {
        say(result.error)
        setLoading(false)
        return
      }

      if (result.toolCalls?.length) {
        wireMessages = [...wireMessages, { role: 'assistant', content: result.content ?? '', toolCalls: result.toolCalls }]

        for (const call of result.toolCalls) {
          const toolContent = await executeTool(call.name, call.arguments, toolCtx)
          say(toolContent)
          wireMessages = [...wireMessages, { role: 'tool', content: toolContent, toolCallId: call.id }]
        }
        continue
      }

      say(result.content ?? 'No response')
      setLoading(false)
      return
    }

    say('Остановился — похоже, достиг лимита шагов и не всё успел обработать. Проверьте бэклог; при необходимости повторите для оставшихся задач.')
    setLoading(false)
  }

  /** .json files are already discrete records — parsed locally, then each
   * item gets one independent fill_task call (small payload, no truncation
   * risk) before being created directly, without going through the chat loop. */
  async function importFromJson(file: PendingFile) {
    setMessages((prev) => [...prev, { role: 'user', content: `📎 ${file.name}` }])
    setLoading(true)

    const aiAgentProfileId = findAiAgentProfile(members)?.id ?? null
    const membersList = members.map((member) => `${member.full_name || member.email} — ${member.department || 'no department set'}`).join('; ') || 'none'

    let items: unknown[]
    let epicMeta: SplitTasksResult['epic']
    let sprintsMeta: SplitTasksResult['sprints']
    try {
      const parsed = JSON.parse(file.content) as unknown
      const parsedItems = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { tasks?: unknown })?.tasks)
          ? (parsed as { tasks: unknown[] }).tasks
          : null
      if (!parsedItems) throw new Error('expected a JSON array of tasks (or a { tasks: [...] } object)')
      items = parsedItems
      epicMeta = (parsed as { epic?: SplitTasksResult['epic'] })?.epic
      sprintsMeta = (parsed as { sprints?: SplitTasksResult['sprints'] })?.sprints
    } catch (err) {
      say(`Не смог разобрать JSON: ${err instanceof Error ? err.message : String(err)}`)
      setLoading(false)
      return
    }

    if (!items.length) {
      say('В файле не нашлось ни одной задачи')
      setLoading(false)
      return
    }

    say(`Нашёл задач: ${items.length}. Начинаю создавать...`)

    let epicId = epicMeta?.existing_epic_id ?? null
    if (!epicId) {
      const createdEpic = await createEpic({
        title: epicMeta?.new_title || file.name,
        description: epicMeta?.new_description ?? '',
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
    for (const sprint of sprintsMeta ?? []) {
      const createdSprint = await createSprint({ epic_id: epicId, name: sprint.name, goal: sprint.goal ?? '', created_by: aiAgentProfileId ?? undefined })
      if (createdSprint) {
        sprintIdByName.set(sprint.name, createdSprint.id)
        say(`Создан спринт "${createdSprint.name}"`)
      }
    }

    const fillPrompt = [
      'Extract this single task\'s fields from the given block of text. Only use what is literally stated — never invent a priority, due date, or role.',
      `Team members and their roles: ${membersList}.`,
    ].join(' ')

    const filled = await mapWithConcurrency<string, FillOutcome>(items.map((item) => JSON.stringify(item)), FILL_TASK_CONCURRENCY, async (block) => {
      const result = await callLLM(
        [{ role: 'system', content: fillPrompt }, { role: 'user', content: block }],
        { maxTokens: 800, tools: [getFillTaskToolDefinition()], toolChoice: { name: 'fill_task' } },
      )
      const call = result.toolCalls?.[0]
      if (result.error || !call) return { error: result.error ?? 'модель не вернула структуру', block }
      try {
        return { data: JSON.parse(call.arguments) as FillTaskResult, block }
      } catch {
        const truncated = result.finishReason === 'length'
        return { error: `битый JSON от модели${truncated ? ' (ответ обрезан лимитом токенов)' : ''}`, block }
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

    say(`Готово: создано ${createdCount} из ${items.length} задач, ${unassignedCount} без исполнителя.`)
    setLoading(false)
  }

  async function handleImportFile(file: PendingFile) {
    if (file.name.toLowerCase().endsWith('.json')) {
      await importFromJson(file)
      return
    }

    setMessages((prev) => [...prev, { role: 'user', content: `📎 ${file.name}` }])

    const extraInstruction = [
      'The user attached a document listing many tasks for one epic — this is a bulk import, not a normal chat message.',
      'Go through the ENTIRE document from top to bottom, task by task, and call create_task once per task — preserve each task\'s id/title/content as written, do not summarize.',
      'Do not stop partway to ask for confirmation — keep calling the tools until you have processed the whole document, then give a brief final summary of how many tasks you created.',
    ].join(' ')

    await runAgentLoop(file.content, [], extraInstruction, IMPORT_MAX_ITERATIONS)
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

    const history = messages
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    await runAgentLoop(text, history, '', MAX_TOOL_ITERATIONS)
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
