import { useEffect, useState, type ReactNode } from 'react'
import { LeftSidebar } from './LeftSidebar'
import { MobileBottomBar } from './MobileBottomBar'
import { TopNavbar } from './TopNavbar'
import { AiAssistant } from '@/components/ai/AiAssistant'
import { useAuthContext } from '@/auth/AuthContext'
import { useStore } from '@/store'

interface GlobalLayoutProps {
  children: ReactNode
}

export function GlobalLayout({ children }: GlobalLayoutProps) {
  const { profile } = useAuthContext()
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchProjectWebhooks = useStore((state) => state.fetchProjectWebhooks)
  const fetchTaskLinks = useStore((state) => state.fetchTaskLinks)
  const fetchPendingMembers = useStore((state) => state.fetchPendingMembers)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeProjectName = useStore((state) => state.projects.find((p) => p.id === state.activeProjectId)?.name)
  const profileId = useStore((state) => state.profile?.id)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects, profileId])

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([fetchMembers(), fetchProjectWebhooks(), fetchTaskLinks()])
    }
  }, [activeProjectId, fetchMembers, fetchProjectWebhooks, fetchTaskLinks])

  useEffect(() => {
    if (isAdmin) void fetchPendingMembers()
  }, [isAdmin, fetchPendingMembers])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F7F8F9]">
      <TopNavbar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <LeftSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#F7F8F9] pb-24 lg:pb-0">
          {children}
        </main>
      </div>
      <MobileBottomBar />
      <AiAssistant projectName={activeProjectName} />
    </div>
  )
}
