import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { projectPath, sectionFromPathname } from '@/lib/projectRoutes'
import { LeftSidebar } from './LeftSidebar'
import { MobileBottomBar } from './MobileBottomBar'
import { TopNavbar } from './TopNavbar'
import { AiAssistant } from '@/components/ai/AiAssistant'
import { CommandPalette } from '@/components/common/CommandPalette'
import { RealtimeSync } from '@/components/common/RealtimeSync'
import { Toaster } from '@/components/common/Toaster'
import { useAuthContext } from '@/auth/AuthContext'
import { useStore } from '@/store'

interface GlobalLayoutProps {
  children: ReactNode
}

export function GlobalLayout({ children }: GlobalLayoutProps) {
  const { profile } = useAuthContext()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchPlaceholders = useStore((state) => state.fetchPlaceholders)
  const fetchProjectWebhooks = useStore((state) => state.fetchProjectWebhooks)
  const fetchTaskLinks = useStore((state) => state.fetchTaskLinks)
  const fetchAttachmentNotes = useStore((state) => state.fetchAttachmentNotes)
  const fetchProjectTaskCount = useStore((state) => state.fetchProjectTaskCount)
  const fetchPendingMembers = useStore((state) => state.fetchPendingMembers)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectName = useStore((state) => state.projects.find((p) => p.id === state.activeProjectId)?.name)
  const projects = useStore((state) => state.projects)
  const setActiveProjectId = useStore((state) => state.setActiveProjectId)
  const profileId = useStore((state) => state.profile?.id)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { projectKey } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects, profileId])

  // The URL is the source of truth for which project is active. When the key in
  // the path resolves to a project, make it active; if it points to an unknown
  // project, fall back to the active/first one's scoped URL.
  useEffect(() => {
    if (!projectKey || projects.length === 0) return
    const match = projects.find((p) => p.key === projectKey)
    if (match) {
      if (match.id !== activeProjectId) setActiveProjectId(match.id)
    } else {
      const fallback = projects.find((p) => p.id === activeProjectId) ?? projects[0]
      if (fallback) navigate(projectPath(fallback.key, sectionFromPathname(location.pathname)), { replace: true })
    }
  }, [projectKey, projects, activeProjectId, setActiveProjectId, navigate, location.pathname])

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([
        fetchMembers(),
        fetchPlaceholders(),
        fetchProjectWebhooks(),
        fetchTaskLinks(),
        fetchAttachmentNotes(),
        fetchProjectTaskCount(),
      ])
    }
  }, [
    activeProjectId,
    fetchMembers,
    fetchPlaceholders,
    fetchProjectWebhooks,
    fetchTaskLinks,
    fetchAttachmentNotes,
    fetchProjectTaskCount,
  ])

  useEffect(() => {
    if (isAdmin) void fetchPendingMembers()
  }, [isAdmin, fetchPendingMembers])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F7F8F9]">
      <TopNavbar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <LeftSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#F7F8F9] pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>
      <MobileBottomBar />
      <AiAssistant projectName={activeProjectName} />
      <CommandPalette />
      <RealtimeSync />
      <Toaster />
    </div>
  )
}
