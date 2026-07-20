import { Component, type ErrorInfo, type ReactNode } from 'react'

// After a deploy, chunk hashes change. A tab that's been open since before the
// deploy (very common on mobile, where tabs stay backgrounded for a long time)
// will 404 the first time it tries to lazy-load a chunk that no longer exists
// under its old hash — React has no built-in recovery for that, so without
// this boundary the whole app just goes blank. Reload once to pick up the
// fresh build. Bounded by a cooldown (rather than a one-shot flag) so it can
// recover again after a *later* deploy, but won't reload-loop forever if the
// same error keeps happening within a short window (a real bug, not a stale cache).
const RELOAD_TIMESTAMP_KEY = 'nojira:last-chunk-reload-at'
const RELOAD_COOLDOWN_MS = 30_000

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|failed to fetch|importing a module script failed|chunkloaderror|loading chunk/i.test(message)
}

function canAttemptReload(): boolean {
  const last = Number(sessionStorage.getItem(RELOAD_TIMESTAMP_KEY) ?? 0)
  return Date.now() - last > RELOAD_COOLDOWN_MS
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null })
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    if (isChunkLoadError(error) && canAttemptReload()) {
      sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()))
      window.location.reload()
      return (
        <div className="flex h-screen items-center justify-center bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-qira-pistachio border-t-transparent" />
        </div>
      )
    }

    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}\n${componentStack ?? ''}`.trim()

    return (
      <div className="flex h-screen flex-col items-center gap-4 overflow-y-auto bg-white p-6 text-center">
        <p className="mt-8 text-lg font-semibold text-slate-900">Something went wrong / Что-то пошло не так</p>
        <p className="max-w-sm text-sm text-slate-500">
          Please reload the page. / Пожалуйста, обновите страницу.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-2xl bg-qira-pistachio px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk"
          >
            Reload / Обновить
          </button>
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(details) }}
            className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            Copy error details
          </button>
        </div>
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-left text-xs text-slate-500">
          {details}
        </pre>
      </div>
    )
  }
}
