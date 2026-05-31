export type SandboxDeliveryInfo = {
  deliveredTo: string
  intendedRecipient: string | null
}

const SANDBOX_NOTE_PREFIX = 'sandbox:'

export function parseSandboxDeliveryNote(note: string | null | undefined): SandboxDeliveryInfo | null {
  if (!note?.startsWith(SANDBOX_NOTE_PREFIX)) return null

  const [deliveredTo, intendedRecipient] = note.slice(SANDBOX_NOTE_PREFIX.length).split('|')
  if (!deliveredTo) return null

  return {
    deliveredTo,
    intendedRecipient: intendedRecipient || null,
  }
}
