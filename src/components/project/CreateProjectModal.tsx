import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/store'

interface CreateProjectModalProps {
  onClose: () => void
}

export function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const { t } = useI18n()
  const createProject = useStore((state) => state.createProject)
  const [name, setName] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      await createProject({ name, key: projectKey, description })
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t('project.create')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('project.noProjectsHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 grid gap-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t('project.name')}
            </label>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-jira-blue focus:ring-4 focus:ring-jira-blue-lt"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t('project.key')}
            </label>
            <input
              value={projectKey}
              onChange={(event) => setProjectKey(event.target.value.toUpperCase())}
              placeholder={t('project.keyPlaceholder')}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-jira-blue focus:ring-4 focus:ring-jira-blue-lt"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t('project.description')}
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-jira-blue focus:ring-4 focus:ring-jira-blue-lt"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          {error && (
            <p className="mr-auto rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-2xl bg-jira-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-jira-blue-dk disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t('auth.wait') : t('project.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
