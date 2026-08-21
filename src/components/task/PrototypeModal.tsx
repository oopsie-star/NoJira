import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Loader2, Save, Sparkles, Wand2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { useAuthContext } from '@/auth/AuthContext'
import { useStore } from '@/store'
import { getLLMConfig } from '@/lib/ai'
import { storageBucket } from '@/lib/attachments'
import { buildPrototypeBrief, selectMapBlocks, STITCH_URL, type PrototypePlatform } from '@/lib/prototypePrompt'
import { generatePrototypeHtml, listPrototypes, nextPrototypeFilename, prototypeVersion } from '@/lib/prototype'
import type { Task } from '@/types'

interface PrototypeModalProps {
  task: Task
  onClose: () => void
}

export function PrototypeModal({ task, onClose }: PrototypeModalProps) {
  const { t } = useI18n()
  const { profile } = useAuthContext()

  const projects = useStore((state) => state.projects)
  const epics = useStore((state) => state.epics)
  const sprints = useStore((state) => state.sprints)
  const tasks = useStore((state) => state.tasks)
  const projectMapBlocks = useStore((state) => state.projectMapBlocks)
  const loadingProjectMap = useStore((state) => state.loadingProjectMap)
  const fetchProjectMap = useStore((state) => state.fetchProjectMap)
  const updateTask = useStore((state) => state.updateTask)
  const recordAttachmentOriginalName = useStore((state) => state.recordAttachmentOriginalName)

  const [platform, setPlatform] = useState<PrototypePlatform>('mobile')
  const [brief, setBrief] = useState('')
  // Once the operator edits the brief by hand we stop overwriting it when the
  // platform toggle or the Project Map fetch changes the assembled version.
  const [briefEdited, setBriefEdited] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // The map is only fetched by the Project Map page, so it's usually empty here.
  useEffect(() => {
    if (!projectMapBlocks.length) void fetchProjectMap()
  }, [projectMapBlocks.length, fetchProjectMap])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !generating) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, generating])

  useEffect(() => () => abortRef.current?.abort(), [])

  const context = useMemo(() => {
    const project = projects.find((item) => item.id === task.project_id) ?? null
    const epic = task.epic_id ? epics.find((item) => item.id === task.epic_id) ?? null : null
    const sprint = task.sprint_id ? sprints.find((item) => item.id === task.sprint_id) ?? null : null
    const vision = epics.find((item) => item.project_id === task.project_id && item.is_vision) ?? null
    const subtasks = tasks
      .filter((item) => item.parent_task_id === task.id)
      .sort((left, right) => left.position - right.position)
    const mapBlocks = selectMapBlocks(
      projectMapBlocks.filter((block) => block.project_id === task.project_id),
      task.id,
      task.epic_id
    )

    return { project, vision, epic, sprint, task, subtasks, mapBlocks, platform }
  }, [projects, epics, sprints, tasks, projectMapBlocks, task, platform])

  const assembledBrief = useMemo(() => buildPrototypeBrief(context), [context])

  useEffect(() => {
    if (!briefEdited) setBrief(assembledBrief)
  }, [assembledBrief, briefEdited])

  const savedPrototypes = useMemo(() => listPrototypes(task.attachments), [task.attachments])
  const hasApiKey = Boolean(getLLMConfig().apiKey)

  async function handleCopyAndOpenStitch() {
    setError(null)
    try {
      await navigator.clipboard.writeText(brief)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      setError(getErrorMessage(err))
      return
    }
    window.open(STITCH_URL, '_blank', 'noopener,noreferrer')
  }

  async function handleGenerate() {
    setError(null)
    setTruncated(false)
    setSavedPath(null)
    setGenerating(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await generatePrototypeHtml(brief, platform, { signal: controller.signal })
      if (result.aborted) return
      if (result.error === 'no-api-key') { setError(t('prototype.noApiKey')); return }
      if (result.error === 'no-html') { setError(t('prototype.noHtml')); return }
      if (result.error === 'timeout') { setError(t('prototype.timeout')); return }
      if (result.error) { setError(result.error); return }
      setHtml(result.html)
      setTruncated(Boolean(result.truncated))
    } finally {
      abortRef.current = null
      setGenerating(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  async function handleSave() {
    if (!html) return
    setSaving(true)
    setError(null)
    try {
      const filename = nextPrototypeFilename(task.attachments)
      const path = `${task.project_id}/${task.id}/${profile?.id ?? 'unknown'}/${Date.now()}-${filename}`
      const blob = new Blob([html], { type: 'text/html' })

      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(path, blob, { upsert: false, contentType: 'text/html' })
      if (uploadError) throw uploadError

      await recordAttachmentOriginalName(task.project_id, path, filename, 'text/html')
      await updateTask(task.id, { attachments: [...task.attachments, path] })
      setSavedPath(path)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleLoadSaved(path: string) {
    setError(null)
    try {
      const { data } = await supabase.storage.from(storageBucket(path)).createSignedUrl(path, 3600)
      if (!data?.signedUrl) throw new Error(t('preview.unavailable'))
      const response = await fetch(data.signedUrl)
      setHtml(await response.text())
      setTruncated(false)
      setSavedPath(path)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  function handleOpenInTab() {
    if (!html) return
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener,noreferrer')
    // The new tab keeps its own reference; revoking later just frees this one.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/70 p-2 sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Wand2 size={16} className="shrink-0 text-qira-pistachio" />
            <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
              {t('prototype.title')} · {task.key}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,440px)_1fr] lg:overflow-hidden">
          {/* ── Brief + actions ─────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col gap-3 border-slate-200 p-4 lg:overflow-y-auto lg:border-r">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t('prototype.platform')}
              </p>
              <div className="mt-2 inline-flex rounded-xl border border-slate-200 p-0.5">
                {(['mobile', 'desktop'] as PrototypePlatform[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPlatform(option)}
                    className={[
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                      platform === option ? 'bg-qira-pistachio text-white' : 'text-slate-600 hover:bg-slate-100',
                    ].join(' ')}
                  >
                    {t(`prototype.platform.${option}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t('prototype.brief')}
                </p>
                {briefEdited && (
                  <button
                    type="button"
                    onClick={() => { setBriefEdited(false); setBrief(assembledBrief) }}
                    className="text-xs font-medium text-qira-pistachio transition hover:text-qira-pistachio-dk"
                  >
                    {t('prototype.rebuild')}
                  </button>
                )}
              </div>
              <textarea
                value={brief}
                onChange={(event) => { setBrief(event.target.value); setBriefEdited(true) }}
                spellCheck={false}
                className="min-h-[220px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700 outline-none transition focus:border-qira-pistachio focus:bg-white"
              />
              <p className="mt-2 text-xs text-slate-500">
                {loadingProjectMap
                  ? t('prototype.contextLoading')
                  : t('prototype.contextSummary', {
                      blocks: context.mapBlocks.length,
                      vision: context.vision ? '✓' : '—',
                      epic: context.epic ? '✓' : '—',
                    })}
              </p>
            </div>

            {error && (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>
            )}

            <div className="flex flex-col gap-2">
              {generating ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  <Loader2 size={15} className="animate-spin" />
                  {t('prototype.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={!hasApiKey || !brief.trim()}
                  title={hasApiKey ? undefined : t('prototype.noApiKey')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-50"
                >
                  <Sparkles size={15} />
                  {t('prototype.generate')}
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleCopyAndOpenStitch()}
                disabled={!brief.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                <ExternalLink size={15} />
                {copied ? t('prototype.copied') : t('prototype.copyAndOpenStitch')}
              </button>
              <p className="text-xs leading-relaxed text-slate-500">{t('prototype.stitchHint')}</p>
            </div>

            {savedPrototypes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t('prototype.savedVersions')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {savedPrototypes.map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => void handleLoadSaved(path)}
                      className={[
                        'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                        savedPath === path
                          ? 'border-qira-pistachio bg-qira-pistachio-lt text-qira-pistachio-dk'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      v{prototypeVersion(path)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Preview ─────────────────────────────────────────────────── */}
          <div className="flex min-h-[420px] flex-col lg:min-h-0">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t('prototype.preview')}
              </p>
              {html && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleOpenInTab}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                  >
                    <ExternalLink size={13} />
                    {t('preview.openTab')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-qira-pistachio px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
                  >
                    <Save size={13} />
                    {saving ? t('prototype.saving') : t('prototype.save')}
                  </button>
                </div>
              )}
            </div>

            {truncated && (
              <p className="shrink-0 bg-amber-50 px-4 py-2 text-xs text-amber-700">{t('prototype.truncated')}</p>
            )}

            <div className="min-h-0 flex-1 bg-slate-100">
              {html ? (
                /* No allow-same-origin: generated markup must never reach this
                   app's origin, storage, or Supabase session. */
                <iframe
                  title={t('prototype.preview')}
                  srcDoc={html}
                  sandbox="allow-scripts"
                  className="h-full min-h-[420px] w-full border-none bg-white"
                />
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center p-8 text-center text-sm text-slate-500">
                  {generating ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-qira-pistachio" />
                      {t('prototype.generating')}
                    </span>
                  ) : (
                    t('prototype.previewEmpty')
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
