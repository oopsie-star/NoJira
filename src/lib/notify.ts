/** Dedupe recipient ids, dropping nulls/undefined and the actor themselves. */
export function dedupeRecipients(ids: (string | null | undefined)[], excludeId: string | null): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id) && id !== excludeId))]
}
