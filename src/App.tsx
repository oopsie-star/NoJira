import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthContext } from '@/auth/AuthContext'
import { useStore } from '@/store'
import { projectPath, sectionFromPathname } from '@/lib/projectRoutes'
import { savePostLoginRedirect } from '@/lib/postLoginRedirect'

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
    // would otherwise be lost — every sign-in method lands on /board once
    // done. Save it so AuthContext can send the user on to where they were
    // actually headed.
    savePostLoginRedirect(location.pathname + location.search + location.hash)
    return <Navigate to="/auth" replace />
  }
  if (isPendingApproval) return <Navigate to="/pending-approval" replace />
  return <>{children}</>
}

function PendingApprovalRoute() {
  const { session, profile, isLoading } = useAuthContext()
  if (isLoading) return <FullPageSpinner />
  if (!session) return <Navigate to="/auth" replace />
  if (profile?.approved) return <Navigate to="/board" replace />
  return <PendingApprovalPage />
}

// Resolves a bare/legacy path (e.g. /board or /) to the active project's scoped
// URL (/projects/<KEY>/<section>), so every project has unique, shareable links.
function ProjectRedirect() {
  const location = useLocation()
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const fetchProjects = useStore((state) => state.fetchProjects)
  const [ready, setReady] = useState(false)

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
        <Route
          path="/auth"
          element={
            isLoading ? <FullPageSpinner /> :
            session    ? <Navigate to="/board" replace /> :
            <AuthPage />
          }
        />
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
