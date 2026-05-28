import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { canDeleteAuthoredContent } from '@/lib/permissions'
import { useStore } from '@/store'
import type { ProjectRole, TaskStatus } from '@/types'

function isImage(path: string) {
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path)
}

function getFilename(path: string) {
  return path.split('/').pop() ?? path
}

interface SignedAttachment {
  path: string
  signedUrl: string | null
}

interface AttachmentUploadProps {
  projectId: string
  taskId: string
  taskStatus: TaskStatus
  currentUserId: string | null
  activeProjectRole: ProjectRole | null
  attachments: string[]
}

function getAttachmentAuthorId(path: string) {
  const [, , authorId] = path.split('/')
  return authorId ?? null
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, '_')
}

export function AttachmentUpload({
  projectId,
  taskId,
  taskStatus,
  currentUserId,
  activeProjectRole,
  attachments,
}: AttachmentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateTask = useStore((state) => state.updateTask)
  const { t } = useI18n()
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedAttachments, setSignedAttachments] = useState<SignedAttachment[]>([])

  useEffect(() => {
    let active = true

    async function loadSignedUrls() {
      if (!attachments.length) {
        setSignedAttachments([])
        return
      }

      const results = await Promise.all(
        attachments.map(async (path) => {
          const { data } = await supabase.storage
            .from('attachments')
            .createSignedUrl(path, 3600)

          return { path, signedUrl: data?.signedUrl ?? null }
        })
      )

      if (active) {
        setSignedAttachments(results)
      }
    }

    loadSignedUrls()
    return () => {
      active = false
    }
  }, [attachments])

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    setUploading(true)
    setError(null)
    const newPaths: string[] = []

    try {
      for (const file of files) {
        const nextPath = `${projectId}/${taskId}/${currentUserId ?? 'unknown'}/${Date.now()}-${safeFilename(file.name)}`
        const { error } = await supabase.storage
          .from('attachments')
          .upload(nextPath, file, { upsert: false })

        if (error) throw error
        newPaths.push(nextPath)
      }

      if (newPaths.length) {
        await updateTask(taskId, { attachments: [...attachments, ...newPaths] })
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    uploadFiles(Array.from(event.dataTransfer.files))
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    uploadFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  async function handleDelete(path: string) {
    if (!canDeleteAuthoredContent(activeProjectRole, currentUserId, getAttachmentAuthorId(path), taskStatus)) return
    await supabase.storage.from('attachments').remove([path])
    await updateTask(taskId, { attachments: attachments.filter((item) => item !== path) })
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{t('task.attachments')}</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-sm font-medium text-jira-blue hover:text-jira-blue-dk"
        >
          {t('common.create')}
        </button>
      </div>

      {signedAttachments.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {signedAttachments.map(({ path, signedUrl }) => (
            <div key={path} className="group rounded-xl border border-slate-200 bg-slate-50 p-2">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{getFilename(path)}</p>
                  <p className="text-xs text-slate-500">/{path.split('/').slice(-2).join('/')}</p>
                </div>
                {canDeleteAuthoredContent(activeProjectRole, currentUserId, getAttachmentAuthorId(path), taskStatus) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(path)}
                    className="rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-slate-700"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {isImage(path) && signedUrl ? (
                <a href={signedUrl} target="_blank" rel="noreferrer">
                  <img
                    src={signedUrl}
                    alt={getFilename(path)}
                    className="h-36 w-full rounded-xl border border-slate-200 object-cover"
                  />
                </a>
              ) : (
                <a
                  href={signedUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-jira-blue"
                >
                  <FileText size={16} />
                  {getFilename(path)}
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500">{t('task.noFiles')}</p>
      )}

      {error && (
        <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={[
          'rounded-2xl border-2 border-dashed px-4 py-8 text-center transition',
          dragOver ? 'border-jira-blue bg-jira-blue-lt' : 'border-slate-200 bg-slate-50',
        ].join(' ')}
      >
        {uploading ? (
          <div className="flex justify-center">
            <Loader2 size={18} className="animate-spin text-jira-blue" />
          </div>
        ) : (
          <>
            <Upload size={18} className="mx-auto mb-2 text-slate-500" />
            <p className="text-sm text-slate-600">{t('task.dropFiles')}</p>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
    </div>
  )
}
