import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send } from 'lucide-react'
import { callLLM, getLLMConfig } from '@/lib/ai'
import { useI18n } from '@/lib/i18n'
import type { LLMMessage } from '@/lib/ai'

interface AiAssistantProps {
  projectName?: string
  currentPage?: string
  taskTitle?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function AiAssistant({ projectName, currentPage, taskTitle }: AiAssistantProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const config = getLLMConfig()
    setHasKey(Boolean(config.apiKey))
  }, [open])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const contextParts = [`Project: ${projectName ?? 'Unknown'}`, `Page: ${currentPage ?? 'Unknown'}`]
    if (taskTitle) contextParts.push(`Task: ${taskTitle}`)

    const systemPrompt = `You are Qira AI, an intelligent assistant for project management. You help teams manage tasks, sprints, and projects efficiently. Current context: ${contextParts.join(', ')}. Respond concisely and helpfully.`

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    const result = await callLLM(llmMessages, { maxTokens: 512 })
    setLoading(false)

    const assistantContent = result.content ?? result.error ?? 'No response'
    setMessages((prev) => [...prev, { role: 'assistant', content: assistantContent }])
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
            <div className="border-t border-slate-100 px-3 py-2 flex gap-2 items-end">
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
                disabled={!input.trim() || loading}
                className="rounded-xl bg-[#6B9E6B] p-2.5 text-white transition hover:bg-[#5a8a5a] disabled:opacity-50"
              >
                <Send size={15} />
              </button>
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
