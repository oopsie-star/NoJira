import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store'

/**
 * Live "multiplayer" updates via Supabase Realtime. Subscribes to postgres_changes
 * on the active project's tasks/sprints/epics/comments (and the current user's
 * notifications) and refetches the affected slice — no more manual refresh.
 *
 * Refetch (rather than applying the raw payload) keeps joined data correct and
 * respects the active view: the board loads only its sprint's tasks, the backlog
 * loads all of them. Changes are debounced to coalesce bursts (e.g. drag-reorder).
 */
export function RealtimeSync() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const profileId = useStore((s) => s.profile?.id ?? null)
  const location = useLocation()
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname

  // Project-scoped channel: tasks / sprints / epics / comments.
  useEffect(() => {
    if (!activeProjectId) return
    let cancelled = false

    const timers: Record<string, number | undefined> = {}
    const debounce = (key: string, fn: () => void) => {
      window.clearTimeout(timers[key])
      timers[key] = window.setTimeout(fn, 250)
    }

    const refetchTasks = () =>
      debounce('tasks', () => {
        const s = useStore.getState()
        if (pathRef.current.includes('/board') && s.activeSprintId) void s.fetchBoard(s.activeSprintId)
        else void s.fetchBacklog()
      })

    async function subscribe() {
      // Ensure Realtime uses the current session token so RLS filters apply.
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) supabase.realtime.setAuth(data.session.access_token)

      const filter = `project_id=eq.${activeProjectId}`
      const channel = supabase
        .channel(`project-${activeProjectId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter }, refetchTasks)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sprints', filter }, () =>
          debounce('sprints', () => void useStore.getState().fetchSprints()),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'epics', filter }, () =>
          debounce('epics', () => void useStore.getState().fetchEpics()),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'attachment_notes', filter }, () =>
          debounce('attachmentNotes', () => void useStore.getState().fetchAttachmentNotes()),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments', filter }, (payload) => {
          const s = useStore.getState()
          const newRow = payload.new as { task_id?: string } | null
          const oldRow = payload.old as { task_id?: string } | null
          const taskId = newRow?.task_id ?? oldRow?.task_id
          if (taskId && s.openTaskId === taskId) void s.fetchTaskContext(taskId)
        })
        .subscribe()

      return channel
    }

    const channelPromise = subscribe()
    return () => {
      cancelled = true
      Object.values(timers).forEach((id) => window.clearTimeout(id))
      void channelPromise.then((channel) => { if (channel) void supabase.removeChannel(channel) })
    }
  }, [activeProjectId])

  // Personal channel: live notifications (e.g. @mentions) for the navbar bell.
  useEffect(() => {
    if (!profileId) return
    let cancelled = false

    async function subscribe() {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) supabase.realtime.setAuth(data.session.access_token)

      const channel = supabase
        .channel(`notif-${profileId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
          () => void useStore.getState().fetchNotifications(),
        )
        .subscribe()
      return channel
    }

    const channelPromise = subscribe()
    return () => {
      cancelled = true
      void channelPromise.then((channel) => { if (channel) void supabase.removeChannel(channel) })
    }
  }, [profileId])

  return null
}
