import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthContext } from '@/auth/AuthContext'
import { useStore } from '@/store'
import { projectPath, sectionFromPathname } from '@/lib/projectRoutes'

const AuthPage = lazy(() => import('@/components/auth/AuthPage').then((module) => ({ default: module.AuthPage })))
const BoardPage = lazy(() => import('@/pages/BoardPage').then((module) => ({ default: module.BoardPage })))
const BacklogPage = lazy(() => import('@/pages/BacklogPage').then((module) => ({ default: module.BacklogPage })))
const PeoplePage = lazy(() => import('@/pages/PeoplePage').then((module) => ({ default: module.PeoplePage })))
const OpsPage = lazy(() => import('@/pages/OpsPage').then((module) => ({ default: module.OpsPage })))
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
  if (isLoading) return <FullPageSpinner />
  if (!session) return <Navigate to="/auth" replace />
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
    void fetchProjects().finally(() => setReady(true))
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
          path="/projects/:projectKey/people"
          element={<ProtectedRoute><PeoplePage /></ProtectedRoute>}
        />
        <Route
          path="/projects/:projectKey/ops"
          element={<ProtectedRoute><OpsPage /></ProtectedRoute>}
        />
        <Route path="*" element={<ProtectedRoute><ProjectRedirect /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  )
}
