import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Import,
  Loader2,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'
import type {
  JiraBoardInfo,
  JiraImportJob,
  JiraImportOptions,
  JiraImportPreview,
  JiraProjectInfo,
} from '@/types'

type WizardStep = 'connect' | 'select' | 'preview' | 'progress' | 'result'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getStepLabel(step: string | null, t: (key: string) => string): string {
  if (!step) return ''
  const key = `ops.jira.step4.${step}`
  return t(key) !== key ? t(key) : step
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div
      className={[
        'h-2 w-2 rounded-full transition-colors',
        done ? 'bg-qira-pistachio' : active ? 'bg-slate-700' : 'bg-slate-200',
      ].join(' ')}
    />
  )
}

// ── Shared form field ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </label>
      {children}
    </div>
  )
}

// ── Option toggle ──────────────────────────────────────────────────────────────

function OptionToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 rounded border-slate-300 text-qira-pistachio focus:ring-qira-pistachio"
      />
    </label>
  )
}

// ── Preview stat card ──────────────────────────────────────────────────────────

function PreviewStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-3 text-center">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  )
}

// ── Main wizard ────────────────────────────────────────────────────────────────

export function JiraImportWizard({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const projects = useStore((s) => s.projects)
  const fetchProjects = useStore((s) => s.fetchProjects)
  const fetchBacklog = useStore((s) => s.fetchBacklog)
  const fetchSprints = useStore((s) => s.fetchSprints)
  const fetchEpics = useStore((s) => s.fetchEpics)
  const setActiveProjectId = useStore((s) => s.setActiveProjectId)

  const [step, setStep] = useState<WizardStep>('connect')

  // Step 1
  const [siteUrl, setSiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null)

  // Step 2
  const [jiraProjects, setJiraProjects] = useState<JiraProjectInfo[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjectKey, setSelectedProjectKey] = useState('')
  const [selectedProjectName, setSelectedProjectName] = useState('')
  const [jiraBoards, setJiraBoards] = useState<JiraBoardInfo[]>([])
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [selectedBoardId, setSelectedBoardId] = useState<string>('')
  const [useExistingProject, setUseExistingProject] = useState(false)
  const [selectedLocalProjectId, setSelectedLocalProjectId] = useState<string>('')
  const [selectError, setSelectError] = useState<string | null>(null)

  // Step 3
  const [preview, setPreview] = useState<JiraImportPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [options, setOptions] = useState<JiraImportOptions>({
    include_attachments: true,
    include_completed_sprints: true,
    include_comments: true,
    max_attachment_size_mb: 10,
  })

  // Step 4/5
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JiraImportJob | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setConnectError(null)
    setConnecting(true)

    const { data, error } = await supabase.functions.invoke('jira-import', {
      body: { action: 'connect', site_url: siteUrl.trim(), email: email.trim(), api_token: apiToken.trim() },
    })

    setConnecting(false)

    if (error || !data?.connection_id) {
      const msg = data?.error ?? error?.message ?? ''
      setConnectError(
        msg.includes('invalidCredentials') || msg.includes('401')
          ? t('ops.jira.error.invalidCredentials')
          : t('ops.jira.error.generic'),
      )
      return
    }

    setConnectionId(data.connection_id)
    setConnectedEmail(data.jira_user_email ?? email)
    setStep('select')
    void loadProjects(data.connection_id)
  }

  async function loadProjects(connId: string) {
    setLoadingProjects(true)
    setSelectError(null)
    const { data, error } = await supabase.functions.invoke('jira-import', {
      body: { action: 'list_projects', connection_id: connId },
    })
    setLoadingProjects(false)
    if (error || !data?.projects) {
      setSelectError(t('ops.jira.error.generic'))
      return
    }
    setJiraProjects(data.projects)
    if (data.projects.length > 0) {
      setSelectedProjectKey(data.projects[0].key)
      setSelectedProjectName(data.projects[0].name)
      void loadBoards(connId, data.projects[0].key)
    }
  }

  async function loadBoards(connId: string, projectKey: string) {
    setLoadingBoards(true)
    setJiraBoards([])
    setSelectedBoardId('')
    const { data } = await supabase.functions.invoke('jira-import', {
      body: { action: 'list_boards', connection_id: connId, project_key: projectKey },
    })
    setLoadingBoards(false)
    if (data?.boards) setJiraBoards(data.boards)
  }

  function handleProjectChange(key: string) {
    const proj = jiraProjects.find((p) => p.key === key)
    setSelectedProjectKey(key)
    setSelectedProjectName(proj?.name ?? key)
    if (connectionId) void loadBoards(connectionId, key)
  }

  async function handleToPreview() {
    if (!selectedProjectKey) return
    setStep('preview')
    setLoadingPreview(true)
    const { data } = await supabase.functions.invoke('jira-import', {
      body: {
        action: 'preview',
        connection_id: connectionId,
        project_key: selectedProjectKey,
        board_id: selectedBoardId || undefined,
      },
    })
    setLoadingPreview(false)
    if (data) setPreview(data as JiraImportPreview)
  }

  async function handleStartImport() {
    setImporting(true)
    setImportError(null)
    setStep('progress')

    const { data, error } = await supabase.functions.invoke('jira-import', {
      body: {
        action: 'start',
        connection_id: connectionId,
        project_key: selectedProjectKey,
        board_id: selectedBoardId || undefined,
        local_project_id: useExistingProject && selectedLocalProjectId ? selectedLocalProjectId : undefined,
        options,
      },
    })

    if (error || !data) {
      setImporting(false)
      setImportError(error?.message ?? t('ops.jira.error.generic'))
      setJobStatus({ status: 'failed', error_message: error?.message ?? t('ops.jira.error.generic') } as JiraImportJob)
      setStep('result')
      return
    }

    const startedJob = data as JiraImportJob
    if (startedJob.id) setJobId(startedJob.id)
    setJobStatus(startedJob)

    if (startedJob.status !== 'running') {
      // Small project — already finished synchronously
      setImporting(false)
      await finishImport(startedJob)
      return
    }

    // Large project — poll resume every 3s until done
    const currentJobId = startedJob.id
    const resuming = { current: false }

    pollRef.current = window.setInterval(async () => {
      if (resuming.current) return
      resuming.current = true
      try {
        const { data: resumeData, error: resumeErr } = await supabase.functions.invoke('jira-import', {
          body: { action: 'resume', job_id: currentJobId },
        })
        if (resumeData) {
          const job = resumeData as JiraImportJob
          setJobStatus(job)
          if (job.status !== 'running') {
            if (pollRef.current !== null) {
              window.clearInterval(pollRef.current)
              pollRef.current = null
            }
            setImporting(false)
            await finishImport(job)
          }
        } else if (resumeErr) {
          // Transient error — log and let the next tick retry
          console.error('[jira-import] resume error:', resumeErr.message)
        }
      } finally {
        resuming.current = false
      }
    }, 3000)
  }

  async function finishImport(job: JiraImportJob) {
    const importedProjectId = job.local_project_id ?? selectedLocalProjectId ?? null
    await fetchProjects()
    if (importedProjectId) setActiveProjectId(importedProjectId)
    await Promise.all([fetchBacklog(), fetchSprints(), fetchEpics()])
    setStep('result')
  }

  function handleReset() {
    setStep('connect')
    setConnectionId(null)
    setConnectedEmail(null)
    setSiteUrl('')
    setEmail('')
    setApiToken('')
    setConnectError(null)
    setJiraProjects([])
    setJiraBoards([])
    setSelectedProjectKey('')
    setSelectedBoardId('')
    setPreview(null)
    setJobId(null)
    setJobStatus(null)
    setImportError(null)
  }

  // ── Step renderers ─────────────────────────────────────────────────────────

  const stepOrder: WizardStep[] = ['connect', 'select', 'preview', 'progress', 'result']
  const currentIndex = stepOrder.indexOf(step)

  function renderConnect() {
    return (
      <form onSubmit={(e) => void handleConnect(e)} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('ops.jira.step1.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('ops.jira.step1.subtitle')}</p>
        </div>

        <Field label={t('ops.jira.step1.siteUrl')}>
          <input
            required
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder={t('ops.jira.step1.siteUrlPlaceholder')}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
          />
        </Field>

        <Field label={t('ops.jira.step1.email')}>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
          />
        </Field>

        <Field label={t('ops.jira.step1.apiToken')}>
          <div className="relative">
            <input
              required
              type={showToken ? 'text' : 'password'}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 pr-12 text-sm outline-none focus:border-qira-pistachio"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
            {t('ops.jira.step1.apiTokenHint')}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-qira-pistachio hover:underline"
            >
              <ExternalLink size={11} />
            </a>
          </p>
        </Field>

        {connectError && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{connectError}</p>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded-2xl bg-qira-pistachio px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
          >
            {connecting && <Loader2 size={15} className="animate-spin" />}
            {connecting ? t('ops.jira.step1.connecting') : t('ops.jira.step1.connect')}
          </button>
        </div>
      </form>
    )
  }

  function renderSelect() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('ops.jira.step2.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('ops.jira.step2.subtitle')}</p>
          {connectedEmail && (
            <p className="mt-2 text-xs text-qira-pistachio">
              {t('ops.jira.step1.connected', { email: connectedEmail })}
            </p>
          )}
        </div>

        {selectError && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{selectError}</p>
        )}

        <Field label={t('ops.jira.step2.project')}>
          {loadingProjects ? (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              {t('ops.jira.step2.loadingProjects')}
            </div>
          ) : (
            <select
              value={selectedProjectKey}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
            >
              {jiraProjects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={t('ops.jira.step2.board')}>
          {loadingBoards ? (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              {t('ops.jira.step2.loadingBoards')}
            </div>
          ) : (
            <select
              value={selectedBoardId}
              onChange={(e) => setSelectedBoardId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
            >
              <option value="">{t('ops.jira.step2.noBoard')}</option>
              {jiraBoards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.type})
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            {t('ops.jira.step2.localProject')}
          </p>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="localProject"
                checked={!useExistingProject}
                onChange={() => { setUseExistingProject(false); setSelectedLocalProjectId('') }}
                className="text-qira-pistachio focus:ring-qira-pistachio"
              />
              <span className="text-sm text-slate-700">{t('ops.jira.step2.newProject')}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="localProject"
                checked={useExistingProject}
                onChange={() => setUseExistingProject(true)}
                className="text-qira-pistachio focus:ring-qira-pistachio"
              />
              <span className="text-sm text-slate-700">{t('ops.jira.step2.localProject')}</span>
            </label>
          </div>
          {useExistingProject && (
            <select
              value={selectedLocalProjectId}
              onChange={(e) => setSelectedLocalProjectId(e.target.value)}
              className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-qira-pistachio"
            >
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => setStep('connect')}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ChevronLeft size={15} />
            {t('ops.jira.back')}
          </button>
          <button
            type="button"
            onClick={() => void handleToPreview()}
            disabled={!selectedProjectKey || loadingProjects}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-qira-pistachio px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
          >
            {t('ops.jira.next')}
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    )
  }

  function renderPreview() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('ops.jira.step3.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('ops.jira.step3.subtitle')}</p>
        </div>

        {loadingPreview ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            {t('ops.jira.step3.loadingPreview')}
          </div>
        ) : preview ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <PreviewStat label={t('ops.jira.step3.epics')} value={preview.epics_count} />
            <PreviewStat label={t('ops.jira.step3.issues')} value={preview.issues_count} />
            <PreviewStat label={t('ops.jira.step3.subtasks')} value={preview.subtasks_count} />
            <PreviewStat label={t('ops.jira.step3.sprints')} value={preview.sprints_count} />
            <PreviewStat label={t('ops.jira.step3.attachments')} value={preview.attachments_count} />
            <PreviewStat
              label={t('ops.jira.step3.attachmentSize')}
              value={formatBytes(preview.estimated_attachment_size_bytes)}
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <OptionToggle
            label={t('ops.jira.step3.includeAttachments')}
            checked={options.include_attachments}
            onChange={(v) => setOptions((o) => ({ ...o, include_attachments: v }))}
          />
          <OptionToggle
            label={t('ops.jira.step3.includeCompletedSprints')}
            checked={options.include_completed_sprints}
            onChange={(v) => setOptions((o) => ({ ...o, include_completed_sprints: v }))}
          />
          <OptionToggle
            label={t('ops.jira.step3.includeComments')}
            checked={options.include_comments}
            onChange={(v) => setOptions((o) => ({ ...o, include_comments: v }))}
          />
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">
              {t('ops.jira.step3.maxAttachmentSize')}
            </span>
            <input
              type="number"
              min={1}
              max={500}
              value={options.max_attachment_size_mb}
              onChange={(e) =>
                setOptions((o) => ({ ...o, max_attachment_size_mb: Number(e.target.value) }))
              }
              className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-center outline-none focus:border-qira-pistachio"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => setStep('select')}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ChevronLeft size={15} />
            {t('ops.jira.back')}
          </button>
          <button
            type="button"
            onClick={() => void handleStartImport()}
            disabled={loadingPreview}
            className="inline-flex items-center gap-2 rounded-2xl bg-qira-pistachio px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
          >
            <Import size={15} />
            {t('ops.jira.step3.startImport')}
          </button>
        </div>
      </div>
    )
  }

  function renderProgress() {
    const pct =
      jobStatus?.progress_total && jobStatus.progress_total > 0
        ? Math.round((jobStatus.progress_done / jobStatus.progress_total) * 100)
        : null

    return (
      <div className="space-y-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('ops.jira.step4.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('ops.jira.step4.subtitle')}</p>
        </div>

        <div className="flex flex-col items-center gap-6 py-8">
          <Loader2 size={40} className="animate-spin text-qira-pistachio" />

          {pct !== null ? (
            <div className="w-full">
              <div className="mb-1.5 flex justify-between text-xs text-slate-500">
                <span>{getStepLabel(jobStatus?.current_step ?? null, t)}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-qira-pistachio transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="w-full">
              {jobStatus?.current_step && (
                <p className="mb-2 text-center text-sm text-slate-500">
                  {getStepLabel(jobStatus.current_step, t)}
                </p>
              )}
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full animate-pulse rounded-full bg-qira-pistachio/60" style={{ width: '60%' }} />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderResult() {
    const status = jobStatus?.status ?? 'failed'
    const isSuccess = status === 'completed' || status === 'partial'
    const title = status === 'completed'
      ? t('ops.jira.step5.title')
      : status === 'partial'
        ? t('ops.jira.step5.titlePartial')
        : t('ops.jira.step5.titleFailed')

    const warnings: string[] = Array.isArray(jobStatus?.warnings)
      ? jobStatus.warnings
      : []

    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div
            className={[
              'flex h-14 w-14 items-center justify-center rounded-full',
              isSuccess ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600',
            ].join(' ')}
          >
            {isSuccess ? <Check size={28} /> : <AlertTriangle size={28} />}
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {jobStatus?.error_message && (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {t('ops.jira.step5.error')}: {jobStatus.error_message}
            </p>
          )}
        </div>

        {isSuccess && (
          <div className="grid grid-cols-2 gap-3">
            <PreviewStat label={t('ops.jira.step5.issues')} value={jobStatus?.progress_done ?? 0} />
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-semibold text-amber-800">
              {t('ops.jira.step5.warnings')} ({warnings.length})
            </p>
            <ul className="space-y-1">
              {warnings.slice(0, 10).map((w, i) => (
                <li key={i} className="text-xs text-amber-700">
                  • {w}
                </li>
              ))}
              {warnings.length > 10 && (
                <li className="text-xs text-amber-500">
                  … and {warnings.length - 10} more
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {t('ops.jira.step5.importAnother')}
          </button>
          {isSuccess && (
            <button
              type="button"
              onClick={() => { navigate('/backlog'); onClose() }}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-qira-pistachio px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
            >
              {t('ops.jira.step5.openBacklog')}
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={step !== 'progress' ? onClose : undefined}
      />

      {/* Panel */}
      <div className="absolute inset-y-0 right-0 flex max-w-xl w-full flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Import size={18} className="text-qira-pistachio" />
            <span className="text-sm font-semibold text-slate-900">{t('ops.jira.title')}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {stepOrder.map((s, i) => (
                <StepDot key={s} active={i === currentIndex} done={i < currentIndex} />
              ))}
            </div>
            <button
              type="button"
              onClick={step !== 'progress' ? onClose : undefined}
              disabled={step === 'progress'}
              className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          {step === 'connect' && renderConnect()}
          {step === 'select' && renderSelect()}
          {step === 'preview' && renderPreview()}
          {step === 'progress' && renderProgress()}
          {step === 'result' && renderResult()}
        </div>

        {/* Footer — cancel button for early steps */}
        {(step === 'connect' || step === 'select' || step === 'preview') && (
          <div className="shrink-0 border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-slate-400 transition hover:text-slate-600"
            >
              {t('ops.jira.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
