import { Suspense, lazy, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthContext } from '@/auth/AuthContext'

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
          path="/board"
          element={<ProtectedRoute><BoardPage /></ProtectedRoute>}
        />
        <Route
          path="/backlog"
          element={<ProtectedRoute><BacklogPage /></ProtectedRoute>}
        />
        <Route
          path="/people"
          element={<ProtectedRoute><PeoplePage /></ProtectedRoute>}
        />
        <Route
          path="/ops"
          element={<ProtectedRoute><OpsPage /></ProtectedRoute>}
        />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
    </Suspense>
  )
}
