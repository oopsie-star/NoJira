import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileText, Loader2, Mic, Music, Square, Upload, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { displayFilename, isImage, previewKind, safeFilename, storageBucket } from '@/lib/attachments'
import { useStore } from '@/store'
import { AttachmentPreview } from './AttachmentPreview'

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

interface SignedAttachment {
  path: string
  signedUrl: string | null
}

interface AttachmentUploadProps {
  /** Storage path prefix this widget uploads under, e.g. `${projectId}/${taskId}` or `${projectId}/epics/${epicId}` — the author id and filename are appended. */
  pathPrefix: string
  currentUserId: string | null
  attachments: string[]
  /** Whether the given uploader (path's author id) may delete a given attachment. */
  canDelete: (authorId: string | null) => boolean
  onAttachmentsChange: (paths: string[]) => Promise<void>
  /** Use the full page width on desktop (more columns) — for full-width contexts like an epic/sprint section, not the narrow task drawer. */
  wide?: boolean
}

function getAttachmentAuthorId(path: string) {
  const parts = path.split('/')
  return parts[parts.length - 2] ?? null
}

export function AttachmentUpload({
  pathPrefix,
  currentUserId,
  attachments,
  canDelete,
  onAttachmentsChange,
  wide = false,
}: AttachmentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useI18n()
  const attachmentNotes = useStore((state) => state.attachmentNotes)
  const updateAttachmentNote = useStore((state) => state.updateAttachmentNote)
  const recordAttachmentOriginalName = useStore((state) => state.recordAttachmentOriginalName)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedAttachments, setSignedAttachments] = useState<SignedAttachment[]>([])
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<number | null>(null)

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
            .from(storageBucket(path))
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
        const nextPath = `${pathPrefix}/${currentUserId ?? 'unknown'}/${Date.now()}-${safeFilename(file.name)}`
        const { error } = await supabase.storage
          .from('attachments')
          .upload(nextPath, file, { upsert: false })

        if (error) throw error
        newPaths.push(nextPath)
        void recordAttachmentOriginalName(pathPrefix.split('/')[0], nextPath, file.name, file.type)
      }

      if (newPaths.length) {
        await onAttachmentsChange([...attachments, ...newPaths])
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  function clearRecordTimer() {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recordedChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const extension = recorder.mimeType?.includes('ogg') ? 'ogg' : recorder.mimeType?.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `voice-comment-${Date.now()}.${extension}`, { type: blob.type })
        void uploadFiles([file])
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setRecordSeconds(0)
      setRecording(true)
      clearRecordTimer()
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
    clearRecordTimer()
  }

  useEffect(() => () => {
    clearRecordTimer()
    mediaRecorderRef.current?.stop()
  }, [])

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
    if (!canDelete(getAttachmentAuthorId(path))) return
    await supabase.storage.from(storageBucket(path)).remove([path])
    if (attachmentNotes[path]) void updateAttachmentNote(path, '')
    await onAttachmentsChange(attachments.filter((item) => item !== path))
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{t('task.attachments')}</p>
        <div className="flex items-center gap-5">
          {typeof MediaRecorder !== 'undefined' && (
            recording ? (
              <button
                type="button"
                onClick={stopRecording}
                className="flex items-center gap-1.5 text-sm font-medium text-rose-600"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-600" aria-hidden />
                {formatSeconds(recordSeconds)}
                <Square size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRecording()}
                title={t('task.recordVoiceComment')}
                aria-label={t('task.recordVoiceComment')}
                className="text-slate-400 transition hover:text-qira-pistachio"
              >
                <Mic size={16} />
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-sm font-medium text-qira-pistachio hover:text-qira-pistachio-dk"
          >
            {t('common.create')}
          </button>
        </div>
      </div>

      {signedAttachments.length > 0 ? (
        <>
          {signedAttachments.some(({ path }) => previewKind(path, attachmentNotes[path]?.mime_type) === 'audio') && (
            <div className="mb-3 space-y-1.5">
              {signedAttachments
                .filter(({ path }) => previewKind(path, attachmentNotes[path]?.mime_type) === 'audio')
                .map(({ path }) => (
                  <div key={path} className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setPreviewPath(path)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Music size={15} className="shrink-0 text-qira-pistachio" />
                      <span className="truncate text-sm text-slate-700">
                        {displayFilename(path, attachmentNotes[path]?.original_name)}
                      </span>
                    </button>
                    {canDelete(getAttachmentAuthorId(path)) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(path)}
                        className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-slate-700"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}

          {signedAttachments.some(({ path }) => previewKind(path, attachmentNotes[path]?.mime_type) !== 'audio') && (
            <div className={['mb-4 grid gap-3 sm:grid-cols-2', wide ? 'lg:grid-cols-3 xl:grid-cols-4' : ''].join(' ')}>
              {signedAttachments
                .filter(({ path }) => previewKind(path, attachmentNotes[path]?.mime_type) !== 'audio')
                .map(({ path, signedUrl }) => (
                  <div key={path} className="group rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {displayFilename(path, attachmentNotes[path]?.original_name)}
                        </p>
                      </div>
                      {canDelete(getAttachmentAuthorId(path)) && (
                        <button
                          type="button"
                          onClick={() => handleDelete(path)}
                          className="rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-slate-700"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-start gap-2">
                      {isImage(path) && signedUrl ? (
                        <button type="button" onClick={() => setPreviewPath(path)} className="block shrink-0">
                          <img
                            src={signedUrl}
                            alt={displayFilename(path, attachmentNotes[path]?.original_name)}
                            className="h-20 w-20 rounded-xl border border-slate-200 object-cover"
                          />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPreviewPath(path)}
                          className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white px-1 text-qira-pistachio transition hover:border-qira-pistachio hover:bg-qira-pistachio-lt/40"
                        >
                          <FileText size={18} />
                        </button>
                      )}

                      <textarea
                        key={path}
                        defaultValue={attachmentNotes[path]?.body ?? ''}
                        onBlur={(event) => {
                          const value = event.target.value
                          if (value !== (attachmentNotes[path]?.body ?? '')) void updateAttachmentNote(path, value)
                        }}
                        placeholder={t('task.attachmentNotePlaceholder')}
                        rows={3}
                        className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none transition focus:border-qira-pistachio"
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      ) : (
        <p className="mb-4 text-sm text-slate-500">{t('task.noFiles')}</p>
      )}

      {error && (
        <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={[
          'cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center transition',
          dragOver ? 'border-qira-pistachio bg-qira-pistachio-lt' : 'border-slate-200 bg-slate-50 hover:border-slate-300',
        ].join(' ')}
      >
        {uploading ? (
          <div className="flex justify-center">
            <Loader2 size={18} className="animate-spin text-qira-pistachio" />
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

      {previewPath && (
        <AttachmentPreview
          path={previewPath}
          signedUrl={signedAttachments.find((item) => item.path === previewPath)?.signedUrl ?? null}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  )
}
