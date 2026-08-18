import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthContext } from '@/auth/AuthContext'
import { useStore } from '@/store'
import { projectPath, sectionFromPathname } from '@/lib/projectRoutes'
import { clearPostLoginRedirect, peekPostLoginRedirect, savePostLoginRedirect } from '@/lib/postLoginRedirect'

const AuthPage = lazy(() => import('@/components/auth/AuthPage').then((module) => ({ default: module.AuthPage })))
const BoardPage = lazy(() => import('@/pages/BoardPage').then((module) => ({ default: module.BoardPage })))
const BacklogPage = lazy(() => import('@/pages/BacklogPage').then((module) => ({ default: module.BacklogPage })))
const ProjectMapPage = lazy(() => import('@/pages/ProjectMapPage').then((module) => ({ default: module.ProjectMapPage })))
const PeoplePage = lazy(() => import('@/pages/PeoplePage').then((module) => ({ default: module.PeoplePage })))
const OpsPage = lazy(() => import('@/pages/OpsPage').then((module) => ({ default: module.OpsPage })))
const ArchivePage = lazy(() => import('@/pages/ArchivePage').then((module) => ({ default: module.ArchivePage })))
const PendingApprovalPage = lazy(() => import('@/pages/PendingApprovalPage').then((module) => ({ default: module.PendingApprovalPage })))

function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-qira-pistachio border-t-transparent" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, isLoading, isPendingApproval } = useAuthContext()
  const location = useLocation()
  if (isLoading) return <FullPageSpinner />
  // No profile means no identity, and rendering the app without one showed
  // its sections with every field blank — and skipped the approval check
  // below, which needs the profile to reject anyone. AuthProvider already
  // refuses to set a session without a profile; this keeps that invariant
  // enforced at the gate itself.
  if (!session || !profile) {
    // A deep link (e.g. a Telegram notification) opened while logged out
    // would otherwise be lost — every sign-in path lands on the hardcoded
    // /board. Save it so AuthRoute/ProjectRedirect can send the user on to
    // where they were actually headed.
    savePostLoginRedirect(location.pathname + location.search + location.hash)
    return <Navigate to="/auth" replace />
  }
  if (isPendingApproval) return <Navigate to="/pending-approval" replace />
  return <>{children}</>
}

/**
 * The path a just-resolved session should land on: whatever ProtectedRoute
 * stashed before bouncing to /auth.
 *
 * `active` must be true only when the caller is about to navigate. Latching
 * (and clearing) any earlier — while the sign-in form is still on screen, say
 * — would drop the destination across Google's full-page round trip.
 */
function usePendingRedirect(active: boolean): string | null {
  const latched = useRef<string | null>(null)
  if (active && !latched.current) latched.current = peekPostLoginRedirect()
  const target = active ? latched.current : null

  // Clear only once it has actually been handed to a navigation, so a stale
  // entry can't hijack an unrelated visit later in the same tab.
  useEffect(() => {
    if (target) clearPostLoginRedirect()
  }, [target])

  return target
}

function PendingApprovalRoute() {
  const { session, profile, isLoading } = useAuthContext()
  if (isLoading) return <FullPageSpinner />
  if (!session) return <Navigate to="/auth" replace />
  if (profile?.approved) return <Navigate to="/board" replace />
  return <PendingApprovalPage />
}

/**
 * A session that resolves while sitting on /auth (a sign-in completing, or a
 * stored session being restored) used to go straight to /board, dropping the
 * deep link that sent the visitor here in the first place.
 */
function AuthRoute() {
  const { session, isLoading } = useAuthContext()
  // Only latch once the session is in hand and we're leaving this screen.
  const pending = usePendingRedirect(!isLoading && Boolean(session))
  if (isLoading) return <FullPageSpinner />
  if (session) return <Navigate to={pending ?? '/board'} replace />
  return <AuthPage />
}

// Resolves a bare/legacy path (e.g. /board or /) to the active project's scoped
// URL (/projects/<KEY>/<section>), so every project has unique, shareable links.
function ProjectRedirect() {
  const location = useLocation()
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const fetchProjects = useStore((state) => state.fetchProjects)
  const [ready, setReady] = useState(false)
  // Sign-in lands here via the hardcoded /board redirectTo, so this is the
  // last thing standing between a saved deep link and the board. Reaching
  // this component at all means a session already resolved, so latch now.
  const pending = usePendingRedirect(true)

  useEffect(() => {
    // Safety net: fetchProjects() opens with supabase.auth.getUser(), and
    // Supabase requests carry no timeout — on a flaky mobile connection one
    // can hang indefinitely, which used to pin this route on the spinner
    // with no way out. Give up waiting after 8s and render the board (its
    // own empty state); if projects do arrive later, this re-renders and
    // redirects normally.
    const giveUp = window.setTimeout(() => setReady(true), 8000)
    void fetchProjects().finally(() => {
      window.clearTimeout(giveUp)
      setReady(true)
    })
    return () => window.clearTimeout(giveUp)
  }, [fetchProjects])

  if (pending) return <Navigate to={pending} replace />

  if (!ready) return <FullPageSpinner />
  // Genuinely no projects — let the board render its empty state.
  if (projects.length === 0) return <BoardPage />

  const active = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  return <Navigate to={projectPath(active.key, sectionFromPathname(location.pathname))} replace />
}

export function App() {
  const { session, isLoading } = useAuthContext()

  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/auth" element={<AuthRoute />} />
        <Route path="/pending-approval" element={<PendingApprovalRoute />} />
        <Route
          path="/projects/:projectKey/board"
          element={<ProtectedRoute><BoardPage /></ProtectedRoute>}
        />
        <Route
          path="/projects/:projectKey/backlog"
          element={<ProtectedRoute><BacklogPage /></ProtectedRoute>}
        />
        <Route
          path="/projects/:projectKey/map"
          element={<ProtectedRoute><ProjectMapPage /></ProtectedRoute>}
        />
        <Route
          path="/projects/:projectKey/people"
          element={<ProtectedRoute><PeoplePage /></ProtectedRoute>}
        />
        <Route
          path="/projects/:projectKey/ops"
          element={<ProtectedRoute><OpsPage /></ProtectedRoute>}
        />
        <Route
          path="/projects/:projectKey/archive"
          element={<ProtectedRoute><ArchivePage /></ProtectedRoute>}
        />
        <Route path="*" element={<ProtectedRoute><ProjectRedirect /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  )
}
