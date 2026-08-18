import { useEffect, useState, type ReactNode } from 'react'
import { Code2, Download, ExternalLink, Eye, Loader2, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { displayFilename, officeViewerUrl, previewKind, taskIdFromPath } from '@/lib/attachments'
import { MarkdownRenderer } from '@/lib/markdown'
import { useStore } from '@/store'

interface AttachmentPreviewProps {
  path: string
  signedUrl: string | null
  onClose: () => void
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-slate-500">{children}</div>
}

// Big enough for reading, small enough that the <pre> text node stays cheap.
// Only caps the source view — the rendered page always gets the whole document.
const SOURCE_LIMIT = 500_000

// Sanity bound on what we will hold in memory for an HTML attachment.
const HTML_LIMIT = 20_000_000

function SourceView({ text, error, truncated, errorLabel, truncatedLabel }: { text: string | null; error: boolean; truncated: boolean; errorLabel: string; truncatedLabel: string }) {
  if (error) return <Centered>{errorLabel}</Centered>
  return (
    <>
      {truncated && (
        <p className="sticky top-0 bg-amber-50 px-4 py-2 text-xs text-amber-700">{truncatedLabel}</p>
      )}
      <pre className="min-h-full whitespace-pre-wrap break-words p-4 text-xs leading-relaxed text-slate-800">{text}</pre>
    </>
  )
}

export function AttachmentPreview({ path, signedUrl, onClose }: AttachmentPreviewProps) {
  const { locale, t } = useI18n()
  const note = useStore((state) => state.attachmentNotes[path])
  const logActivityEvent = useStore((state) => state.logActivityEvent)
  const kind = previewKind(path, note?.mime_type)
  const filename = displayFilename(path, note?.original_name)
  const taskId = taskIdFromPath(path)
  const [text, setText] = useState<string | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  // HTML renders by default; the toggle is for reading the markup behind it.
  const [showSource, setShowSource] = useState(false)
  const [textTruncated, setTextTruncated] = useState(false)
  const [textError, setTextError] = useState(false)

  function logDownload() {
    void logActivityEvent('download_attachment', { taskId, detail: filename })
  }

  function logPlay() {
    void logActivityEvent('play_audio', { taskId, detail: filename })
  }

  // Fetch textual bodies directly (kept private — no external service).
  const needsBody = kind === 'text' || kind === 'markdown' || kind === 'html'
  const bodyLimit = kind === 'html' ? HTML_LIMIT : SOURCE_LIMIT

  useEffect(() => {
    if (!needsBody || !signedUrl) return

    let active = true
    setTextLoading(true)
    setTextError(false)

    fetch(signedUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((body) => {
        if (!active) return
        setTextTruncated(body.length > bodyLimit)
        setText(body.slice(0, bodyLimit))
      })
      .catch(() => {
        if (!active) return
        setText(null)
        setTextError(true)
      })
      .finally(() => {
        if (active) setTextLoading(false)
      })

    return () => { active = false }
  }, [needsBody, bodyLimit, signedUrl])

  // Storage serves user-uploaded HTML with a neutralised content type (it will
  // not let arbitrary markup execute on its own domain), so pointing the iframe
  // at the signed URL just shows the source as plain text. Re-wrapping the body
  // in a Blob we label text/html puts the content type back under our control
  // and keeps working regardless of what the storage layer sends.
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null)

  useEffect(() => {
    if (kind !== 'html' || !text) {
      setHtmlUrl(null)
      return
    }

    const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }))
    setHtmlUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [kind, text])

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/70 p-2 sm:p-6" onClick={onClose}>
      <div
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{filename}</p>
          <div className="flex shrink-0 items-center gap-1">
            {kind === 'html' && (
              <button
                type="button"
                onClick={() => setShowSource((value) => !value)}
                title={t(showSource ? 'preview.showRendered' : 'preview.showSource')}
                aria-label={t(showSource ? 'preview.showRendered' : 'preview.showSource')}
                className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                {showSource ? <Eye size={16} /> : <Code2 size={16} />}
              </button>
            )}
            {signedUrl && (
              <>
                <a href={signedUrl} target="_blank" rel="noreferrer" title={t('preview.openTab')} aria-label={t('preview.openTab')} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
                  <ExternalLink size={16} />
                </a>
                <a href={signedUrl} download={filename} onClick={logDownload} title={t('preview.download')} aria-label={t('preview.download')} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
                  <Download size={16} />
                </a>
              </>
            )}
            <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
          {!signedUrl ? (
            <Centered>{t('preview.unavailable')}</Centered>
          ) : kind === 'image' ? (
            <div className="flex h-full items-center justify-center p-4">
              <img src={signedUrl} alt={filename} className="max-h-full max-w-full rounded-lg object-contain" />
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={signedUrl} title={filename} className="h-full w-full border-0" />
          ) : kind === 'office' ? (
            <iframe src={officeViewerUrl(signedUrl)} title={filename} className="h-full w-full border-0" />
          ) : kind === 'video' ? (
            <div className="flex h-full items-center justify-center p-4">
              <video src={signedUrl} controls className="max-h-full max-w-full rounded-lg" />
            </div>
          ) : kind === 'audio' ? (
            <div className="flex h-full items-center justify-center p-6">
              <audio src={signedUrl} controls onPlay={logPlay} className="w-full max-w-lg" />
            </div>
          ) : kind === 'markdown' ? (
            textLoading ? <Centered><Loader2 size={20} className="animate-spin" /></Centered> : (
              <div className="mx-auto max-w-3xl p-6"><MarkdownRenderer source={text ?? ''} /></div>
            )
          ) : kind === 'html' ? (
            textLoading ? <Centered><Loader2 size={20} className="animate-spin" /></Centered> : textError ? (
              <Centered>{t('preview.unavailable')}</Centered>
            ) : showSource ? (
              <SourceView text={text?.slice(0, SOURCE_LIMIT) ?? null} error={false} truncated={(text?.length ?? 0) > SOURCE_LIMIT} errorLabel={t('preview.unavailable')} truncatedLabel={t('preview.sourceTruncated', { limit: SOURCE_LIMIT.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US') })} />
            ) : !htmlUrl ? (
              <Centered><Loader2 size={20} className="animate-spin" /></Centered>
            ) : (
              /* Sandboxed without allow-same-origin: the page sits in an opaque
                 origin and cannot touch this app's session, storage, or cookies
                 — it can only draw itself. */
              <iframe
                title={filename}
                src={htmlUrl}
                sandbox="allow-scripts"
                className="h-full w-full border-0 bg-white"
              />
            )
          ) : kind === 'text' ? (
            textLoading ? <Centered><Loader2 size={20} className="animate-spin" /></Centered> : <SourceView text={text} error={textError} truncated={textTruncated} errorLabel={t('preview.unavailable')} truncatedLabel={t('preview.sourceTruncated', { limit: SOURCE_LIMIT.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US') })} />
          ) : (
            <Centered>
              <p className="text-sm">{t('preview.noInline')}</p>
              <a href={signedUrl} download={filename} onClick={logDownload} className="rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk">
                {t('preview.download')}
              </a>
            </Centered>
          )}
        </div>
      </div>
    </div>
  )
}
