export function getErrorMessage(error: unknown) {
  if (!error) return 'Something went wrong. Please try again.'
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object') {
    // Supabase / PostgrestError: { message, details, hint, code }
    const e = error as { message?: unknown; details?: unknown; hint?: unknown }
    const parts = [e.message, e.details, e.hint].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0,
    )
    if (parts.length) return parts.join(' — ')
  }
  return 'Something went wrong. Please try again.'
}
