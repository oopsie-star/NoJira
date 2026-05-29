import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'
import { WEBHOOK_EVENT_OPTIONS, type ProjectAutomationSettings, type WebhookEvent } from '@/types'

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

  const [name, setName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>(['task.created', 'task.updated'])
  const automationOptions: Array<{ key: keyof Pick<ProjectAutomationSettings, 'auto_assign_on_start' | 'auto_close_parent_tasks' | 'auto_close_epics' | 'notify_on_unblock'>, label: string, hint: string }> = [
    { key: 'auto_assign_on_start', label: t('ops.automation.autoAssign'), hint: t('ops.automation.autoAssignHint') },
    { key: 'auto_close_parent_tasks', label: t('ops.automation.closeParent'), hint: t('ops.automation.closeParentHint') },
    { key: 'auto_close_epics', label: t('ops.automation.closeEpics'), hint: t('ops.automation.closeEpicsHint') },
    { key: 'notify_on_unblock', label: t('ops.automation.notifyUnblock'), hint: t('ops.automation.notifyUnblockHint') },
  ]

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([fetchAutomationSettings(), fetchProjectWebhooks()])
    }
  }, [activeProjectId, fetchAutomationSettings, fetchProjectWebhooks])

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

  async function handleWebhookSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !endpointUrl.trim()) return

    await createProjectWebhook({
      name: name.trim(),
      endpoint_url: endpointUrl.trim(),
      secret: secret.trim(),
      events,
    })

    setName('')
    setEndpointUrl('')
    setSecret('')
    setEvents(['task.created', 'task.updated'])
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
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        <section className="rounded-[28px] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('nav.ops')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{t('ops.title')}</h1>
          <p className="mt-2 text-sm text-slate-500">{t('ops.subtitle')}</p>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <section className="rounded-[28px] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t('ops.automationTitle')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('ops.subtitle')}</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {automationOptions.map((option) => (
                  <label key={option.key} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                      <p className="mt-1 text-sm text-slate-500">{option.hint}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(automationSettings?.[option.key])}
                      onChange={(event) => void updateAutomationSettings({ [option.key]: event.target.checked })}
                      className="h-5 w-5 rounded border-slate-300 text-jira-blue focus:ring-jira-blue"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="min-h-0 rounded-[28px] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{t('ops.webhooksTitle')}</h2>
              <form onSubmit={handleWebhookSubmit} className="mt-4 grid gap-3">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('ops.webhookName')}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue"
                />
                <input
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  placeholder={t('ops.webhookUrl')}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue"
                />
                <input
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={t('ops.webhookSecret')}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-jira-blue"
                />

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
                          events.includes(item) ? 'bg-jira-blue text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
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
                    className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk"
                  >
                    {t('ops.createWebhook')}
                  </button>
                </div>
              </form>

              <div className="mt-4 max-h-[280px] overflow-y-auto space-y-3">
                {projectWebhooks.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">{t('ops.noWebhooks')}</p>
                ) : (
                  projectWebhooks.map((webhook) => (
                    <div key={webhook.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{webhook.name}</p>
                          <p className="truncate text-sm text-slate-500">{webhook.endpoint_url}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {webhook.events.map((eventName) => (
                              <span key={eventName} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {eventName}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteProjectWebhook(webhook.id)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="min-h-0 overflow-y-auto rounded-[28px] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t('ops.apiTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('ops.apiSubtitle')}</p>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{t('ops.apiBase')}</p>
                  <CopyButton text={restBase} />
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{restBase}</pre>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{t('ops.apiProject')}</p>
                  <CopyButton text={activeProjectId} />
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-950 px-4 py-3 text-xs text-slate-100">{activeProjectId}</pre>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
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
      </div>
    </GlobalLayout>
  )
}
