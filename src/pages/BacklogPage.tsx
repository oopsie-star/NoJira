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
  const activeProjectId = useStore((state) => state.activeProjectId)
  const loadingBacklog = useStore((state) => state.loadingBacklog)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (activeProjectId) {
      Promise.all([fetchBacklog(), fetchSprints(), fetchEpics(), fetchMembers()])
    }
  }, [activeProjectId, fetchBacklog, fetchSprints, fetchEpics, fetchMembers])

  return (
    <GlobalLayout>
      {loadingBacklog && activeProjectId ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-jira-blue border-t-transparent" />
        </div>
      ) : (
        <BacklogView />
      )}
      <TaskDrawer />
    </GlobalLayout>
  )
}
