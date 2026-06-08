import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Copy, Eye, EyeOff, Import, LoaderCircle, Trash2 } from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { useI18n } from '@/lib/i18n'
import { JiraImportWizard } from '@/components/jira/JiraImportWizard'
import { JiraQuickSync } from '@/components/jira/JiraQuickSync'
import {
  callLLM,
  DEFAULT_MODELS,
  getFallbackModelOptions,
  getLLMConfig,
  listLLMModels,
  setLLMConfig,
  type LLMModelOption,
  type LLMProvider,
} from '@/lib/ai'
import { useStore } from '@/store'
import { WEBHOOK_EVENT_OPTIONS, type ProjectAutomationSettings, type ProjectWebhook, type WebhookEvent, type WebhookType } from '@/types'

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
    >
      <Copy size={15} />
      {copied ? t('ops.copied') : t('ops.copy')}
    </button>
  )
}

function ModelLibraryCard({
  option,
  selected,
  onSelect,
}: {
  option: LLMModelOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full rounded-2xl border px-4 py-3 text-left transition',
        selected
          ? 'border-qira-pistachio bg-qira-pistachio-lt/20 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900">{option.label}</p>
        {option.providerLabel && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {option.providerLabel}
          </span>
        )}
        {option.contextWindow && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {option.contextWindow}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{option.id}</p>
      {option.description && (
        <p className="mt-2 line-clamp-3 text-sm text-slate-500">{option.description}</p>
      )}
    </button>
  )
}

export function OpsPage() {
  const { t } = useI18n()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchAutomationSettings = useStore((state) => state.fetchAutomationSettings)
  const fetchProjectWebhooks = useStore((state) => state.fetchProjectWebhooks)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const automationSettings = useStore((state) => state.automationSettings)
  const projectWebhooks = useStore((state) => state.projectWebhooks)
  const updateAutomationSettings = useStore((state) => state.updateAutomationSettings)
  const createProjectWebhook = useStore((state) => state.createProjectWebhook)
  const deleteProjectWebhook = useStore((state) => state.deleteProjectWebhook)
  const testProjectWebhook = useStore((state) => state.testProjectWebhook)

  const initialAiConfig = useMemo(() => getLLMConfig(), [])

  const [jiraWizardOpen, setJiraWizardOpen] = useState(false)
  const [name, setName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [webhookType, setWebhookType] = useState<WebhookType>('discord')
  const [events, setEvents] = useState<WebhookEvent[]>(['task.created', 'task.updated'])
  const [webhookTest, setWebhookTest] = useState<Record<string, { ok: boolean; error?: string }>>({})
  const [aiProvider, setAiProvider] = useState<LLMProvider>(initialAiConfig.provider)
  const [aiModel, setAiModel] = useState(initialAiConfig.model)
  const [aiApiKey, setAiApiKey] = useState(initialAiConfig.apiKey)
  const [aiEndpoint, setAiEndpoint] = useState(initialAiConfig.customEndpoint ?? '')
  const [aiShowKey, setAiShowKey] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [aiTesting, setAiTesting] = useState(false)
  const [modelOptions, setModelOptions] = useState<LLMModelOption[]>(() => getFallbackModelOptions(initialAiConfig.provider))
  const [modelLibraryLoading, setModelLibraryLoading] = useState(false)

  const automationOptions: Array<{
    key: keyof Pick<ProjectAutomationSettings, 'auto_assign_on_start' | 'auto_close_parent_tasks' | 'auto_close_epics' | 'notify_on_unblock'>
    label: string
    hint: string
  }> = [
    { key: 'auto_assign_on_start', label: t('ops.automation.autoAssign'), hint: t('ops.automation.autoAssignHint') },
    { key: 'auto_close_parent_tasks', label: t('ops.automation.closeParent'), hint: t('ops.automation.closeParentHint') },
    { key: 'auto_close_epics', label: t('ops.automation.closeEpics'), hint: t('ops.automation.closeEpicsHint') },
    { key: 'notify_on_unblock', label: t('ops.automation.notifyUnblock'), hint: t('ops.automation.notifyUnblockHint') },
  ]

  const AI_PROVIDERS: Array<{ value: LLMProvider; label: string }> = [
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'custom', label: 'Custom (OpenAI-compatible)' },
  ]

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([fetchAutomationSettings(), fetchProjectWebhooks()])
    }
  }, [activeProjectId, fetchAutomationSettings, fetchProjectWebhooks])

  useEffect(() => {
    let cancelled = false
    const fallback = getFallbackModelOptions(aiProvider)
    setModelOptions(fallback)
    setModelLibraryLoading(false)

    const timeoutId = window.setTimeout(async () => {
      const shouldLoad =
        aiProvider === 'openrouter'
        || Boolean(aiApiKey.trim())

      if (!shouldLoad) return

      setModelLibraryLoading(true)
      const nextOptions = await listLLMModels(aiProvider, {
        apiKey: aiApiKey.trim(),
        customEndpoint: aiEndpoint.trim() || undefined,
      })

      if (cancelled) return

      setModelOptions(nextOptions)
      setModelLibraryLoading(false)

      if (aiProvider !== 'custom' && !nextOptions.some((option) => option.id === aiModel)) {
        setAiModel(nextOptions[0]?.id ?? DEFAULT_MODELS[aiProvider])
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [aiApiKey, aiEndpoint, aiModel, aiProvider])

  const restBase = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1`
  const authHeaderExample = useMemo(
    () => `apikey: ${import.meta.env.VITE_SUPABASE_ANON_KEY}\nAuthorization: Bearer <user-access-token>`,
    []
  )
  const taskQueryExample = useMemo(
    () => `${restBase}/tasks?select=id,key,title,status,priority,assignee_id&project_id=eq.${activeProjectId ?? '<project-id>'}&order=updated_at.desc`,
    [activeProjectId, restBase]
  )
  const curlExample = useMemo(
    () => [
      `curl "${taskQueryExample}" \\`,
      `  -H "apikey: ${import.meta.env.VITE_SUPABASE_ANON_KEY}" \\`,
      '  -H "Authorization: Bearer <user-access-token>"',
    ].join('\n'),
    [taskQueryExample]
  )

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.id === aiModel) ?? null,
    [aiModel, modelOptions]
  )

  const modelSelectOptions = useMemo(() => {
    if (aiModel && !modelOptions.some((option) => option.id === aiModel)) {
      return [{ id: aiModel, label: aiModel }, ...modelOptions]
    }
    return modelOptions
  }, [aiModel, modelOptions])

  function handleAiProviderChange(provider: LLMProvider) {
    setAiProvider(provider)
    setAiModel(DEFAULT_MODELS[provider])
    setAiTestResult(null)
  }

  function handleAiSave() {
    setLLMConfig({
      provider: aiProvider,
      model: aiModel,
      apiKey: aiApiKey,
      customEndpoint: aiEndpoint || undefined,
    })
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2000)
  }

  async function handleAiTest() {
    setAiTesting(true)
    setAiTestResult(null)

    setLLMConfig({
      provider: aiProvider,
      model: aiModel,
      apiKey: aiApiKey,
      customEndpoint: aiEndpoint || undefined,
    })

    const result = await callLLM([{ role: 'user', content: 'Say hello in one word' }], { maxTokens: 16 })

    setAiTesting(false)
    if (result.error) {
      setAiTestResult({ ok: false, message: `${t('ops.ai.testFail')}: ${result.error}` })
    } else {
      setAiTestResult({ ok: true, message: `${t('ops.ai.testOk')}: "${result.content}"` })
    }
  }

  async function handleWebhookSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !endpointUrl.trim()) return

    await createProjectWebhook({
      name: name.trim(),
      endpoint_url: endpointUrl.trim(),
      secret: secret.trim(),
      events,
      webhook_type: webhookType,
    })

    setName('')
    setEndpointUrl('')
    setSecret('')
    setWebhookType('discord')
    setEvents(['task.created', 'task.updated'])
  }

  async function handleTestWebhook(webhook: ProjectWebhook) {
    setWebhookTest((prev) => ({ ...prev, [webhook.id]: { ok: true, error: '…' } }))
    const result = await testProjectWebhook(webhook)
    setWebhookTest((prev) => ({ ...prev, [webhook.id]: result }))
  }

  function toggleEvent(nextEvent: WebhookEvent) {
    setEvents((current) => (
      current.includes(nextEvent)
        ? current.filter((value) => value !== nextEvent)
        : [...current, nextEvent]
    ))
  }

  if (!activeProjectId) {
    return (
      <GlobalLayout>
        <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
          <section className="rounded-[28px] bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">{t('project.noProjects')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </section>
        </div>
      </GlobalLayout>
    )
  }

  return (
    <GlobalLayout>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
        <section className="shrink-0 rounded-[28px] bg-white px-5 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-base font-semibold text-slate-900">{t('ops.title')}</h1>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500">{t('ops.subtitle')}</span>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('ops.jira.title')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('ops.jira.subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-start gap-2.5">
              <JiraQuickSync />
              <button
                type="button"
                onClick={() => setJiraWizardOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
              >
                <Import size={16} />
                {t('ops.jira.openWizard')}
              </button>
            </div>
          </div>
        </section>

        {jiraWizardOpen && <JiraImportWizard onClose={() => setJiraWizardOpen(false)} />}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
          <div className="space-y-4">
            <section className="rounded-[28px] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{t('ops.automationTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('ops.subtitle')}</p>

              <div className="mt-4 space-y-3">
                {automationOptions.map((option) => (
                  <label key={option.key} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                      <p className="mt-1 text-sm text-slate-500">{option.hint}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(automationSettings?.[option.key])}
                      onChange={(event) => void updateAutomationSettings({ [option.key]: event.target.checked })}
                      className="h-5 w-5 shrink-0 rounded border-slate-300 text-qira-pistachio focus:ring-qira-pistachio"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{t('ops.webhooksTitle')}</h2>
              <form onSubmit={handleWebhookSubmit} className="mt-4 grid gap-3">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('ops.webhookName')}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
                />
                <input
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  placeholder={t('ops.webhookUrl')}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={webhookType}
                    onChange={(event) => setWebhookType(event.target.value as WebhookType)}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-qira-pistachio"
                  >
                    <option value="discord">Discord</option>
                    <option value="slack">Slack</option>
                    <option value="generic">{t('ops.webhookGeneric')}</option>
                  </select>
                  <input
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={webhookType === 'generic' ? t('ops.webhookSecret') : t('ops.webhookSecretNA')}
                    disabled={webhookType !== 'generic'}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
                <p className="-mt-1 text-xs text-slate-400">{t('ops.webhookTypeHint')}</p>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('ops.webhookEvents')}</p>
                  <div className="flex flex-wrap gap-2">
                    {WEBHOOK_EVENT_OPTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleEvent(item)}
                        className={[
                          'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                          events.includes(item) ? 'bg-qira-pistachio text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                        ].join(' ')}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
                  >
                    {t('ops.createWebhook')}
                  </button>
                </div>
              </form>

              <div className="mt-4 space-y-3">
                {projectWebhooks.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">{t('ops.noWebhooks')}</p>
                ) : (
                  projectWebhooks.map((webhook) => (
                    <div key={webhook.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{webhook.name}</p>
                            <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-indigo-600">
                              {webhook.webhook_type}
                            </span>
                          </div>
                          <p className="truncate text-sm text-slate-500">{webhook.endpoint_url}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {webhook.events.map((eventName) => (
                              <span key={eventName} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {eventName}
                              </span>
                            ))}
                          </div>
                          {webhookTest[webhook.id] && webhookTest[webhook.id].error !== '…' && (
                            <p className={`mt-2 text-xs font-medium ${webhookTest[webhook.id].ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {webhookTest[webhook.id].ok ? t('ops.webhookTestOk') : `${t('ops.webhookTestFail')}: ${webhookTest[webhook.id].error}`}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleTestWebhook(webhook)}
                            disabled={webhookTest[webhook.id]?.error === '…'}
                            className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            {webhookTest[webhook.id]?.error === '…' ? '…' : t('ops.webhookTest')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteProjectWebhook(webhook.id)}
                            className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="rounded-[28px] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t('ops.apiTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('ops.apiSubtitle')}</p>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{t('ops.apiBase')}</p>
                  <CopyButton text={restBase} />
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{restBase}</pre>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{t('ops.apiProject')}</p>
                  <CopyButton text={activeProjectId} />
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{activeProjectId}</pre>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{t('ops.apiTasks')}</p>
                  <CopyButton text={curlExample} />
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{curlExample}</pre>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">Headers</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{authHeaderExample}</pre>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">JavaScript</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{[
                  'const { data } = await fetch(',
                  `  "${taskQueryExample}",`,
                  '  { headers: {',
                  `      apikey: "${import.meta.env.VITE_SUPABASE_ANON_KEY}",`,
                  '      Authorization: "Bearer <user-access-token>",',
                  '    }',
                  '  }',
                  ').then((response) => response.json())',
                ].join('\n')}</pre>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-[28px] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('ops.ai.title')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('ops.ai.hint')}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
              {t('ops.ai.modelsCount', { count: modelOptions.length })}
            </span>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(320px,0.52fr)_minmax(0,0.48fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                    {t('ops.ai.provider')}
                  </label>
                  <select
                    value={aiProvider}
                    onChange={(event) => handleAiProviderChange(event.target.value as LLMProvider)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
                  >
                    {AI_PROVIDERS.map((provider) => (
                      <option key={provider.value} value={provider.value}>{provider.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                    {t('ops.ai.model')}
                  </label>
                  {aiProvider === 'custom' ? (
                    <input
                      value={aiModel}
                      onChange={(event) => setAiModel(event.target.value)}
                      placeholder={DEFAULT_MODELS[aiProvider]}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
                    />
                  ) : (
                    <select
                      value={aiModel}
                      onChange={(event) => setAiModel(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
                    >
                      {modelSelectOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  )}
                  <p className="mt-1.5 text-xs text-slate-500">
                    {selectedModelOption?.id ?? aiModel ?? DEFAULT_MODELS[aiProvider]}
                  </p>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  {t('ops.ai.apiKey')}
                </label>
                <div className="relative">
                  <input
                    type={aiShowKey ? 'text' : 'password'}
                    value={aiApiKey}
                    onChange={(event) => setAiApiKey(event.target.value)}
                    placeholder="sk-..."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 pr-12 text-sm outline-none focus:border-qira-pistachio"
                  />
                  <button
                    type="button"
                    onClick={() => setAiShowKey((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                  >
                    {aiShowKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {aiProvider === 'custom' && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                    {t('ops.ai.endpoint')}
                  </label>
                  <input
                    value={aiEndpoint}
                    onChange={(event) => setAiEndpoint(event.target.value)}
                    placeholder="https://your-provider.com/v1/chat/completions"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
                  />
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {t('ops.ai.modelHint')}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleAiSave}
                  className="rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
                >
                  {aiSaved ? t('ops.ai.saved') : t('ops.ai.save')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAiTest()}
                  disabled={aiTesting || !aiApiKey.trim() || !aiModel.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  {aiTesting && <LoaderCircle size={16} className="animate-spin" />}
                  {aiTesting ? t('ops.ai.testing') : t('ops.ai.test')}
                </button>
              </div>

              {aiTestResult && (
                <div className={[
                  'rounded-2xl px-4 py-3 text-sm font-medium',
                  aiTestResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                ].join(' ')}>
                  {aiTestResult.message}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{t('ops.ai.modelLibrary')}</h3>
                  <p className="mt-1 text-sm text-slate-500">{t('ops.ai.modelLibraryHint')}</p>
                </div>
                {modelLibraryLoading && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    <LoaderCircle size={13} className="animate-spin" />
                    {t('ops.ai.loadingModels')}
                  </span>
                )}
              </div>

              <div className="mt-3 max-h-[480px] overflow-y-auto pr-1">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {modelOptions.map((option) => (
                    <ModelLibraryCard
                      key={option.id}
                      option={option}
                      selected={option.id === aiModel}
                      onSelect={() => setAiModel(option.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </GlobalLayout>
  )
}
