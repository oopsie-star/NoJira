// Where an unauthenticated visit to a protected route should end up once the
// session resolves. ProtectedRoute saves it before bouncing to /auth; a full
// OAuth round-trip reloads the page, so this has to survive that
// (sessionStorage does, in-memory router state wouldn't).
//
// Consuming it on the SIGNED_IN auth event alone was not enough: restoring an
// existing session fires INITIAL_SESSION (or resolves through AuthContext's
// storage fallback, which emits no event at all), and even on a real sign-in
// the landing route's own redirect could overwrite the navigation a moment
// later. So consumption belongs at the render-time decision points that would
// otherwise send the user to /board — see App.tsx.
const STORAGE_KEY = 'qira-post-login-path'
// Guards against a path saved long ago (abandoned sign-in, say) hijacking an
// unrelated navigation much later in the same tab.
const MAX_AGE_MS = 10 * 60 * 1000

interface StoredRedirect {
  path: string
  savedAt: number
}

/** Paths that carry no destination of their own — every sign-in lands here. */
const GENERIC_LANDING = new Set(['/', '/board'])

export function savePostLoginRedirect(path: string): void {
  // Returning from Google lands on …/board?code=… — never a real
  // destination. Worse, the session can read as "not established" for an
  // instant while the code is still being exchanged, which sends this
  // through the save path and would clobber the destination saved before
  // the round trip. Ignore the callback URL, and never let a bare landing
  // route overwrite a genuine deep link that is already waiting.
  if (/[?&#](code|access_token)=/.test(path)) return
  const bare = path.split('?')[0].split('#')[0]
  if (GENERIC_LANDING.has(bare) && peekPostLoginRedirect()) return

  try {
    const entry: StoredRedirect = { path, savedAt: Date.now() }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Storage can be unavailable (private mode, quota) — losing the deep
    // link is a minor inconvenience, not worth failing the page over.
  }
}

/**
 * Reads the stored path WITHOUT clearing it. Reading must not consume:
 * signing in with Google reloads the whole page, and a value cleared while
 * the sign-in form was merely on screen would be gone by the time the user
 * comes back. Clear it with clearPostLoginRedirect once actually navigating.
 */
export function peekPostLoginRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const entry = JSON.parse(raw) as Partial<StoredRedirect>
    if (typeof entry?.path !== 'string' || typeof entry?.savedAt !== 'number') return null
    if (Date.now() - entry.savedAt > MAX_AGE_MS) return null
    // Only ever hand back same-origin app paths: this value ends up in a
    // router navigation, and anything else is a redirect worth refusing.
    if (!entry.path.startsWith('/') || entry.path.startsWith('//')) return null
    return entry.path
  } catch {
    return null
  }
}

export function clearPostLoginRedirect(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // See savePostLoginRedirect.
  }
}
