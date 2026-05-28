import { useEffect, type ReactNode } from 'react'
import { LeftSidebar } from './LeftSidebar'
import { TopNavbar } from './TopNavbar'
import { useStore } from '@/store'

interface GlobalLayoutProps {
  children: ReactNode
}

export function GlobalLayout({ children }: GlobalLayoutProps) {
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const profileId = useStore((state) => state.profile?.id)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects, profileId])

  useEffect(() => {
    if (activeProjectId) {
      fetchMembers()
    }
  }, [activeProjectId, fetchMembers])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F7F8F9]">
      <TopNavbar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftSidebar />
        <main className="min-h-0 flex-1 overflow-y-auto bg-[#F7F8F9]">
          {children}
        </main>
      </div>
    </div>
  )
}
