import { useEffect } from 'react'
import { GlobalLayout } from '@/components/layout/GlobalLayout'
import { BacklogView } from '@/components/backlog/BacklogView'
import { TaskDrawer } from '@/components/task/TaskDrawer'
import { useStore } from '@/store'

export function BacklogPage() {
  const fetchProjects = useStore((state) => state.fetchProjects)
  const fetchBacklog = useStore((state) => state.fetchBacklog)
  const fetchSprints = useStore((state) => state.fetchSprints)
  const fetchEpics = useStore((state) => state.fetchEpics)
  const fetchMembers = useStore((state) => state.fetchMembers)
  const fetchPortfolioItems = useStore((state) => state.fetchPortfolioItems)
  const fetchTaskLinks = useStore((state) => state.fetchTaskLinks)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const loadingBacklog = useStore((state) => state.loadingBacklog)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      Promise.all([fetchBacklog(), fetchSprints(), fetchEpics(), fetchMembers(), fetchPortfolioItems(), fetchTaskLinks()])
    }
  }, [activeProjectId, fetchBacklog, fetchSprints, fetchEpics, fetchMembers, fetchPortfolioItems, fetchTaskLinks])

  return (
    <GlobalLayout>
      {loadingBacklog && activeProjectId ? (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-qira-pistachio border-t-transparent" />
        </div>
      ) : (
        <BacklogView />
      )}
      <TaskDrawer />
    </GlobalLayout>
  )
}
