import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { storageBucket } from '@/lib/attachments'

export interface SignedAttachment {
  path: string
  signedUrl: string | null
}

/**
 * Creates short-lived signed URLs for a list of attachment storage paths.
 * Resolves each against the correct bucket (user uploads vs Jira imports).
 * Returns the list plus a path→url lookup map for inline rendering.
 */
export function useSignedAttachments(attachments: string[]): {
  signed: SignedAttachment[]
  urlByPath: Map<string, string>
} {
  const [signed, setSigned] = useState<SignedAttachment[]>([])

  // Stable dependency key so re-renders with an equal array don't refetch.
  const key = attachments.join('|')

  useEffect(() => {
    let active = true

    async function load() {
      if (!attachments.length) {
        setSigned([])
        return
      }
      const results = await Promise.all(
        attachments.map(async (path) => {
          const { data } = await supabase.storage
            .from(storageBucket(path))
            .createSignedUrl(path, 3600)
          return { path, signedUrl: data?.signedUrl ?? null }
        }),
      )
      if (active) setSigned(results)
    }

    void load()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const urlByPath = new Map<string, string>()
  for (const s of signed) if (s.signedUrl) urlByPath.set(s.path, s.signedUrl)

  return { signed, urlByPath }
}
