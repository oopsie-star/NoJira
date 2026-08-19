import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import { resolveProjectByKey } from './resolvers.ts'

interface ListDesignScreensArgs {
  project?: string
  only_ready?: boolean
}

interface ScreenRow {
  id: string
  key: string
  title: string
  description: string
  status: string
  attachments: string[]
  updated_at: string
}

/**
 * The project's screens and how far the design has got with each.
 *
 * Screens live as tasks inside the epic flagged as the screen registry, so a
 * designer marking a screen task done is the signal that it's drawn and ready
 * to build. Read this before writing frontend tasks: a screen that isn't `done`
 * has no settled design to implement yet.
 */
export async function listDesignScreens(admin: SupabaseClient, args: ListDesignScreensArgs) {
  const projectKey = args.project?.trim()
  if (!projectKey) throw new ToolError('"project" is required.')

  const project = await resolveProjectByKey(admin, projectKey)

  const { data: epic, error: epicError } = await admin
    .from('epics')
    .select('id, key, title')
    .eq('project_id', project.id)
    .eq('is_screen_registry', true)
    .maybeSingle()

  if (epicError) throw new ToolError(`Failed to look up the screen registry: ${epicError.message}`)
  if (!epic) {
    throw new ToolError(
      'This project has no screen registry yet. A project manager marks one epic as the screen registry in the backlog, and each task in it is a screen.',
    )
  }

  const { data: screens, error: screensError } = await admin
    .from('tasks')
    .select('id, key, title, description, status, attachments, updated_at')
    .eq('project_id', project.id)
    .eq('epic_id', epic.id)
    .not('status', 'in', '(cancelled,archived,deleted)')
    .order('position')

  if (screensError) throw new ToolError(`Failed to read screens: ${screensError.message}`)

  const screenIds = (screens ?? []).map((row) => row.id)

  // Frontend tasks already pointed at these screens — so a re-run adds what's
  // missing instead of duplicating work that already exists.
  let implementations: { id: string; key: string; title: string; status: string; implements_screen_task_id: string }[] = []
  if (screenIds.length > 0) {
    const { data, error } = await admin
      .from('tasks')
      .select('id, key, title, status, implements_screen_task_id')
      .in('implements_screen_task_id', screenIds)
      .not('status', 'in', '(cancelled,archived,deleted)')
    if (error) throw new ToolError(`Failed to read screen implementations: ${error.message}`)
    implementations = (data ?? []) as typeof implementations
  }

  const rows = ((screens ?? []) as ScreenRow[])
    .map((screen) => ({
      id: screen.id,
      key: screen.key,
      title: screen.title,
      description: screen.description,
      // The whole point of the registry: `done` means the designer finished it.
      design_ready: screen.status === 'done',
      design_status: screen.status,
      mockup_count: (screen.attachments ?? []).length,
      updated_at: screen.updated_at,
      implemented_by: implementations
        .filter((task) => task.implements_screen_task_id === screen.id)
        .map(({ key, title, status }) => ({ key, title, status })),
    }))
    .filter((screen) => !args.only_ready || screen.design_ready)

  return {
    project: project.key,
    registry_epic: { key: epic.key, title: epic.title },
    screens: rows,
  }
}
