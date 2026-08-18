// Where an unauthenticated visit to a protected route should end up after
// sign-in. ProtectedRoute saves it before bouncing to /auth; a full OAuth
// round-trip reloads the page, so this has to survive that (sessionStorage
// does, in-memory router state wouldn't). AuthContext consumes it once, on
// the SIGNED_IN event, and navigates there instead of the hardcoded /board
// every sign-in method otherwise lands on.
const STORAGE_KEY = 'qira-post-login-path'

export function savePostLoginRedirect(path: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, path)
  } catch {
    // Storage can be unavailable (private mode, quota) — losing the deep
    // link is a minor inconvenience, not worth failing the page over.
  }
}

/** Reads and clears the stored path — call once, right when it's used. */
export function consumePostLoginRedirect(): string | null {
  try {
    const path = sessionStorage.getItem(STORAGE_KEY)
    if (path) sessionStorage.removeItem(STORAGE_KEY)
    return path
  } catch {
    return null
  }
}
