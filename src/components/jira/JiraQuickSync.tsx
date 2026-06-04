import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'
import type { JiraImportJob, JiraImportOptions } from '@/types'

interface SavedSync {
  connectionId: string
  projectKey: string
  boardId: string | null
  localProjectId: string
  options: JiraImportOptions
}

async function countProjectTasks(projectId: string): Promise<number> {
  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  return count ?? 0
}

/**
 * One-click incremental re-import. Reuses the last working connection + import
 * preferences (no settings dialog) and runs the idempotent import, which skips
 * already-imported issues and adds only what's new in Jira.
 */
export function JiraQuickSync() {
  const { t } = useI18n()
  const fetchProjects = useStore((s) => s.fetchProjects)
  const fetchBacklog = useStore((s) => s.fetchBacklog)
  const fetchSprints = useStore((s) => s.fetchSprints)
  const fetchEpics = useStore((s) => s.fetchEpics)
  const setActiveProjectId = useStore((s) => s.setActiveProjectId)

  const [saved, setSaved] = useState<SavedSync | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data } = await supabase.functions.invoke('jira-import', {
        body: { action: 'get_last_connection' },
      })
      if (!active) return
      const conn = data?.connection
      const prefs = data?.preferences
      if (conn?.token_saved && prefs?.last_jira_project_key && prefs?.local_project_id) {
        setSaved({
          connectionId: conn.connection_id,
          projectKey: prefs.last_jira_project_key,
          boardId: prefs.last_jira_board_id ?? null,
          localProjectId: prefs.local_project_id,
          options: {
            include_attachments: prefs.include_attachments,
            include_completed_sprints: prefs.include_completed_sprints,
            include_comments: prefs.include_comments,
            max_attachment_size_mb: prefs.max_attachment_size_mb,
            skip_attachments_over_limit: prefs.skip_attachments_over_limit,
            import_users: prefs.import_users,
          },
        })
      }
    })()
    return () => {
      active = false
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [])

  async function runSync() {
    if (!saved || running) return
    setRunning(true)
    setResult(null)

    const before = await countProjectTasks(saved.localProjectId)

    try {
      const { data, error } = await supabase.functions.invoke('jira-import', {
        body: {
          action: 'start',
          connection_id: saved.connectionId,
          project_key: saved.projectKey,
          board_id: saved.boardId || undefined,
          local_project_id: saved.localProjectId,
          options: saved.options,
        },
      })
      if (error || !data) throw new Error(error?.message ?? t('ops.jira.error.generic'))

      let job = data as JiraImportJob
      if (job.status === 'running' && job.id) {
        await new Promise<void>((resolve) => {
          pollRef.current = window.setInterval(async () => {
            const { data: rd } = await supabase.functions.invoke('jira-import', {
              body: { action: 'resume', job_id: job.id },
            })
            if (rd) {
              job = rd as JiraImportJob
              if (job.status !== 'running') {
                if (pollRef.current !== null) {
                  window.clearInterval(pollRef.current)
                  pollRef.current = null
                }
                resolve()
              }
            }
          }, 3000)
        })
      }

      // Refresh into the synced project so the new issues are visible.
      await fetchProjects()
      setActiveProjectId(saved.localProjectId)
      await Promise.all([fetchBacklog(), fetchSprints(), fetchEpics()])

      const after = await countProjectTasks(saved.localProjectId)
      const added = Math.max(0, after - before)

      if (job.status === 'failed') {
        setResult({ ok: false, message: job.error_message ?? t('ops.jira.sync.failed') })
      } else {
        setResult({
          ok: true,
          message: added > 0 ? t('ops.jira.sync.added', { count: added }) : t('ops.jira.sync.upToDate'),
        })
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : t('ops.jira.sync.failed') })
    } finally {
      setRunning(false)
    }
  }

  if (!saved) return null

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => void runSync()}
        disabled={running}
        title={t('ops.jira.sync.hint')}
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
      >
        {running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        {running ? t('ops.jira.sync.running') : t('ops.jira.quickSync')}
      </button>
      {result && (
        <span
          className={[
            'inline-flex items-center gap-1.5 text-xs font-medium',
            result.ok ? 'text-emerald-600' : 'text-rose-600',
          ].join(' ')}
        >
          {result.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
          {result.message}
        </span>
      )}
    </div>
  )
}
