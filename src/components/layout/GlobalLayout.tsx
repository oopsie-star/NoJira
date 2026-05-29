import { useEffect, useState, type ReactNode } from 'react'
import { LeftSidebar } from './LeftSidebar'
import { MobileBottomBar } from './MobileBottomBar'
import { TopNavbar } from './TopNavbar'
import { useStore } from '@/store'

interface GlobalLayoutProps {
  children: ReactNode
}

export function GlobalLayout({ children }: GlobalLayoutProps) {
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchProjectWebhooks = useStore((state) => state.fetchProjectWebhooks)
  const fetchTaskLinks = useStore((state) => state.fetchTaskLinks)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const profileId = useStore((state) => state.profile?.id)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects, profileId])

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([fetchMembers(), fetchProjectWebhooks(), fetchTaskLinks()])
    }
  }, [activeProjectId, fetchMembers, fetchProjectWebhooks, fetchTaskLinks])

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
        <main className="flex min-h-0 flex-1 overflow-hidden bg-[#F7F8F9] pb-24 lg:pb-0">
          {children}
        </main>
      </div>
      <MobileBottomBar />
    </div>
  )
}
