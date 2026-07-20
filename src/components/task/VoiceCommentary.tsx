import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { displayFilename, previewKind } from '@/lib/attachments'
import { useI18n } from '@/lib/i18n'
import { useSignedAttachments } from '@/lib/useSignedAttachments'
import { useStore } from '@/store'

/**
 * Surfaces the most recently attached audio file as a prominent "voice
 * comment" — not shown at all when the task has no audio attachment (no
 * empty placeholder). Re-uploading a newer audio file via the regular
 * attachments picker replaces which one plays here.
 */
export function VoiceCommentary({ attachments }: { attachments: string[] }) {
  const { t } = useI18n()
  const attachmentNotes = useStore((state) => state.attachmentNotes)
  const audioPath = [...attachments].reverse().find(
    (path) => previewKind(path, attachmentNotes[path]?.mime_type) === 'audio',
  )
  const { urlByPath } = useSignedAttachments(audioPath ? [audioPath] : [])
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setPlaying(false)
  }, [audioPath])

  if (!audioPath) return null
  const signedUrl = urlByPath.get(audioPath)

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  return (
    <div className="mt-6 flex items-center gap-3 rounded-2xl border border-qira-pistachio/30 bg-qira-pistachio-lt/40 px-4 py-3">
      <button
        type="button"
        onClick={toggle}
        disabled={!signedUrl}
        aria-label={t(playing ? 'task.pauseVoiceComment' : 'task.playVoiceComment')}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-qira-pistachio text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
      >
        {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
      </button>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{t('task.voiceComment')}</p>
        <p className="truncate text-xs text-slate-500">
          {displayFilename(audioPath, attachmentNotes[audioPath]?.original_name)}
        </p>
      </div>
      {signedUrl && (
        <audio
          ref={audioRef}
          src={signedUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  )
}
