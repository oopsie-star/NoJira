import { useEffect, useState, type ReactNode } from 'react'
import { Download, ExternalLink, Loader2, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { getFilename, officeViewerUrl, previewKind } from '@/lib/attachments'
import { MarkdownRenderer } from '@/lib/markdown'

interface AttachmentPreviewProps {
  path: string
  signedUrl: string | null
  onClose: () => void
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-slate-500">{children}</div>
}

export function AttachmentPreview({ path, signedUrl, onClose }: AttachmentPreviewProps) {
  const { t } = useI18n()
  const kind = previewKind(path)
  const filename = getFilename(path)
  const [text, setText] = useState<string | null>(null)
  const [textLoading, setTextLoading] = useState(false)

  // Fetch textual bodies directly (kept private — no external service).
  useEffect(() => {
    if ((kind === 'text' || kind === 'markdown') && signedUrl) {
      setTextLoading(true)
      fetch(signedUrl)
        .then((response) => response.text())
        .then((body) => setText(body.slice(0, 500_000)))
        .catch(() => setText(null))
        .finally(() => setTextLoading(false))
    }
  }, [kind, signedUrl])

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
            {signedUrl && (
              <>
                <a href={signedUrl} target="_blank" rel="noreferrer" title={t('preview.openTab')} aria-label={t('preview.openTab')} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
                  <ExternalLink size={16} />
                </a>
                <a href={signedUrl} download={filename} title={t('preview.download')} aria-label={t('preview.download')} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
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
              <audio src={signedUrl} controls className="w-full max-w-lg" />
            </div>
          ) : kind === 'markdown' ? (
            textLoading ? <Centered><Loader2 size={20} className="animate-spin" /></Centered> : (
              <div className="mx-auto max-w-3xl p-6"><MarkdownRenderer source={text ?? ''} /></div>
            )
          ) : kind === 'text' ? (
            textLoading ? <Centered><Loader2 size={20} className="animate-spin" /></Centered> : (
              <pre className="min-h-full whitespace-pre-wrap break-words p-4 text-xs leading-relaxed text-slate-800">{text}</pre>
            )
          ) : (
            <Centered>
              <p className="text-sm">{t('preview.noInline')}</p>
              <a href={signedUrl} download={filename} className="rounded-2xl bg-qira-pistachio px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk">
                {t('preview.download')}
              </a>
            </Centered>
          )}
        </div>
      </div>
    </div>
  )
}
