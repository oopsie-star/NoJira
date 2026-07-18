import { useEffect, useRef, useState } from 'react'
import { Paperclip, Sparkles, Square, X, Send } from 'lucide-react'
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

// A single chat message can still trigger a bulk edit across every task in an
// epic (list_tasks + one update_task per task) — same reasoning as imports,
// so this needs real headroom too, not just enough for a 1-2 call reply.
const MAX_TOOL_ITERATIONS = 60
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
  const abortControllerRef = useRef<AbortController | null>(null)

  const epics = useStore((state) => state.epics)
  const sprints = useStore((state) => state.sprints)
  const members = useStore((state) => state.members)
  const tasks = useStore((state) => state.tasks)
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

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  /** Shared tool-calling loop — same mechanism for a normal chat message and
   * for a whole attached document, just with a different iteration budget:
   * the model calls create_epic/create_sprint/create_task/update_task one at
   * a time until it stops, no forced upfront "summarize everything" step. */
  async function runAgentLoop(userContent: string, history: ChatMessage[], extraInstruction: string, maxIterations: number) {
    setLoading(true)
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      await runAgentLoopBody(userContent, history, extraInstruction, maxIterations, controller)
    } catch (err) {
      say(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function runAgentLoopBody(userContent: string, history: ChatMessage[], extraInstruction: string, maxIterations: number, controller: AbortController) {
    const aiAgentProfileId = findAiAgentProfile(members)?.id ?? null
    const epicsList = epics.map((epic) => `${epic.id}: ${epic.title}`).join('; ') || 'none yet'
    const sprintsList = sprints.map((sprint) => `${sprint.id}: ${sprint.name} (epic ${sprint.epic_id ?? 'none'})`).join('; ') || 'none yet'
    const membersList = members.map((member) => `${member.full_name || member.email} — ${member.department || 'no department set'}`).join('; ') || 'none'

    const systemPrompt = [
      'You are Qira AI, an agent that manages epics, sprints, and tasks for this project management app.',
      'You have tools to list tasks, create epics/sprints/tasks, and edit tasks — actually call the tools, do not just describe what you would do.',
      'If the user asks you to change/clean up/reformat tasks in an epic or sprint (e.g. "remove this text from every task\'s description", "prepend the title to each task") and you don\'t already have their ids, call list_tasks first — never ask the user to paste ids, titles, or descriptions themselves, you can look them up.',
      'When editing many tasks the same way, call update_task once per task, one at a time, until you\'ve covered all of them from list_tasks — do not stop partway to ask for confirmation.',
      'The "Existing epics" list below is for REFERENCE only — reuse one of those ids only if the user\'s message explicitly says to add to / continue an existing epic. Otherwise, for a new request or a newly attached document, always call create_epic for a fresh epic — never default to the most recently mentioned or most recently created epic just because it exists.',
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
    const toolCtx = { members, tasks, aiAgentProfileId, createEpic, createSprint, createTask, updateTask }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let result = await callLLM(wireMessages, { maxTokens: 3000, tools, signal: controller.signal })

      // An empty turn (no tool call, no text) with finish_reason 'length' is
      // a truncated response, not a real "nothing to say" — retry once with
      // a bigger budget instead of surfacing a useless "No response".
      if (!result.aborted && !result.error && !result.toolCalls?.length && !result.content && result.finishReason === 'length') {
        result = await callLLM(wireMessages, { maxTokens: 8000, tools, signal: controller.signal })
      }

      if (result.aborted) {
        say('Остановлено.')
        return
      }

      if (result.error) {
        say(result.error)
        return
      }

      if (result.toolCalls?.length) {
        wireMessages = [...wireMessages, { role: 'assistant', content: result.content ?? '', toolCalls: result.toolCalls }]

        for (const call of result.toolCalls) {
          if (controller.signal.aborted) {
            say('Остановлено.')
            return
          }

          // A single tool call throwing (e.g. a DB write rejected by RLS)
          // must never kill the whole run — catch it, feed the error back
          // to the model as this call's result, and keep going.
          let toolContent: string
          try {
            toolContent = await executeTool(call.name, call.arguments, toolCtx)
          } catch (err) {
            toolContent = `Error: ${err instanceof Error ? err.message : String(err)}`
          }

          // list_tasks can return a large raw JSON payload meant for the
          // model — show a short human summary in the chat instead of
          // dumping it verbatim.
          if (call.name === 'list_tasks') {
            let displayed = toolContent
            try {
              const parsed = JSON.parse(toolContent) as unknown
              if (Array.isArray(parsed)) displayed = `Просмотрел задач: ${parsed.length}`
            } catch {
              // not JSON (e.g. "No tasks found...") — show as-is
            }
            say(displayed)
          } else {
            say(toolContent)
          }
          wireMessages = [...wireMessages, { role: 'tool', content: toolContent, toolCallId: call.id }]
        }
        continue
      }

      if (!result.content) {
        say(`Модель вернула пустой ответ без вызова инструментов${result.finishReason ? ` (finish_reason: ${result.finishReason})` : ''}. Попробуйте переформулировать запрос или другую модель.`)
        return
      }

      say(result.content)
      return
    }

    say('Остановился — похоже, достиг лимита шагов и не всё успел обработать. Проверьте бэклог; при необходимости повторите для оставшихся задач.')
  }

  /** .json files are already discrete records — parsed locally, then each
   * item gets one independent fill_task call (small payload, no truncation
   * risk) before being created directly, without going through the chat loop. */
  async function importFromJson(file: PendingFile, userText: string) {
    setMessages((prev) => [...prev, { role: 'user', content: `📎 ${file.name}` }])
    setLoading(true)
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      await importFromJsonBody(file, userText, controller)
    } catch (err) {
      say(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function importFromJsonBody(file: PendingFile, userText: string, controller: AbortController) {
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
      return
    }

    if (!items.length) {
      say('В файле не нашлось ни одной задачи')
      return
    }

    say(`Нашёл задач: ${items.length}. Начинаю создавать...`)

    let epicId = epicMeta?.existing_epic_id ?? null
    if (!epicId) {
      let createdEpic
      try {
        createdEpic = await createEpic({
          title: epicMeta?.new_title || userText.trim() || file.name,
          description: epicMeta?.new_description ?? '',
          created_by: aiAgentProfileId ?? undefined,
        })
      } catch (err) {
        say(`Не удалось создать эпик: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      if (!createdEpic) {
        say('Не удалось создать эпик')
        return
      }
      epicId = createdEpic.id
      say(`Создан эпик "${createdEpic.title}" (${createdEpic.key})`)
    }

    const sprintIdByName = new Map<string, string>()
    for (const sprint of sprintsMeta ?? []) {
      try {
        const createdSprint = await createSprint({ epic_id: epicId, name: sprint.name, goal: sprint.goal ?? '', created_by: aiAgentProfileId ?? undefined })
        if (createdSprint) {
          sprintIdByName.set(sprint.name, createdSprint.id)
          say(`Создан спринт "${createdSprint.name}"`)
        }
      } catch (err) {
        say(`Не удалось создать спринт "${sprint.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const fillPrompt = [
      'Extract this single task\'s fields from the given block of text. Only use what is literally stated — never invent a priority, due date, or role.',
      `Team members and their roles: ${membersList}.`,
    ].join(' ')

    const filled = await mapWithConcurrency<string, FillOutcome>(items.map((item) => JSON.stringify(item)), FILL_TASK_CONCURRENCY, async (block) => {
      if (controller.signal.aborted) return { error: 'остановлено', block }
      const result = await callLLM(
        [{ role: 'system', content: fillPrompt }, { role: 'user', content: block }],
        { maxTokens: 800, tools: [getFillTaskToolDefinition()], toolChoice: { name: 'fill_task' }, signal: controller.signal },
      )
      if (result.aborted) return { error: 'остановлено', block }
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
      if (controller.signal.aborted) {
        say('Остановлено.')
        break
      }

      if ('error' in outcome) {
        say(`Пропустил задачу — ${outcome.error}`)
        continue
      }

      const { data } = outcome
      const { id: assigneeId, note } = resolveAssigneeByRole(data.role, members)
      if (!assigneeId) unassignedCount += 1
      const sprintId = data.sprint_name ? sprintIdByName.get(data.sprint_name) ?? null : null

      try {
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
      } catch (err) {
        say(`Не удалось создать задачу "${data.title}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    say(`Готово: создано ${createdCount} из ${items.length} задач, ${unassignedCount} без исполнителя.`)
  }

  async function handleImportFile(file: PendingFile, userText: string) {
    if (file.name.toLowerCase().endsWith('.json')) {
      await importFromJson(file, userText)
      return
    }

    setMessages((prev) => [...prev, { role: 'user', content: userText ? `${userText}\n📎 ${file.name}` : `📎 ${file.name}` }])

    const extraInstruction = [
      'The user attached a document listing many tasks for one epic — this is a bulk import, not a normal chat message.',
      userText
        ? `The user's instruction for this attachment: "${userText}". Follow it (e.g. whether to create a new epic or use an existing one).`
        : 'No extra instruction was given — create a new epic for this document (see the epic-creation rule above), do not add it to an existing one.',
      'If you are adding these tasks to an EXISTING epic (not creating a brand new one), call list_tasks for that epic first and compare titles — skip creating any task whose title already matches one that\'s already there, so re-running an import doesn\'t create duplicates. Skip this check when creating a brand new epic, since nothing exists in it yet.',
      'Go through the ENTIRE document from top to bottom, task by task, and call create_task once per task (skipping ones already present, per the duplicate check above) — preserve each task\'s id/title/content as written, do not summarize.',
      'Do not stop partway to ask for confirmation — keep calling the tools until you have processed the whole document, then give a brief final summary of how many tasks you created and how many you skipped as duplicates.',
    ].join(' ')

    await runAgentLoop(file.content, [], extraInstruction, IMPORT_MAX_ITERATIONS)
  }

  async function handleSend() {
    if (loading) return

    if (pendingFile) {
      const file = pendingFile
      const userText = input.trim()
      setPendingFile(null)
      setInput('')
      await handleImportFile(file, userText)
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
                {loading ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    title={t('ai.stop')}
                    className="rounded-xl bg-rose-500 p-2.5 text-white transition hover:bg-rose-600"
                  >
                    <Square size={15} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!input.trim() && !pendingFile}
                    className="rounded-xl bg-[#6B9E6B] p-2.5 text-white transition hover:bg-[#5a8a5a] disabled:opacity-50"
                  >
                    <Send size={15} />
                  </button>
                )}
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
