import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { displayFilename } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveProjectByKey } from './resolvers.ts'

interface GetProjectArgs {
  project?: string
}

export async function getProject(admin: SupabaseClient, args: GetProjectArgs) {
  const projectKey = args.project?.trim()
  if (!projectKey) throw new ToolError('"project" is required.')

  const project = await resolveProjectByKey(admin, projectKey)

  const [epicsRes, sprintsRes, membersRes] = await Promise.all([
    admin
      .from('epics')
      .select('id, key, title, status, is_vision, attachments')
      .eq('project_id', project.id)
      .order('created_at'),
    admin
      .from('sprints')
      .select('id, name, status, epic_id, start_date, end_date, attachments')
      .eq('project_id', project.id)
      .order('created_at'),
    admin
      .from('project_members')
      .select('project_role, profiles(email, full_name)')
      .eq('project_id', project.id),
  ])

  if (epicsRes.error) throw new ToolError(`Failed to load epics: ${epicsRes.error.message}`)
  if (sprintsRes.error) throw new ToolError(`Failed to load sprints: ${sprintsRes.error.message}`)
  if (membersRes.error) throw new ToolError(`Failed to load members: ${membersRes.error.message}`)

  const epics = epicsRes.data ?? []
  const sprints = sprintsRes.data ?? []

  const allPaths = [...epics.flatMap((e) => e.attachments ?? []), ...sprints.flatMap((s) => s.attachments ?? [])]
  const noteByPath = new Map<string, { path: string; original_name: string | null; mime_type: string | null }>()
  if (allPaths.length) {
    const { data: notes, error: notesError } = await admin
      .from('attachment_notes')
      .select('path, original_name, mime_type')
      .eq('project_id', project.id)
      .in('path', allPaths)
    if (notesError) throw new ToolError(`Failed to load attachment names: ${notesError.message}`)
    for (const n of notes ?? []) noteByPath.set(n.path, n)
  }

  function withAttachmentNames(paths: string[]) {
    return paths.map((path) => {
      const note = noteByPath.get(path)
      return { path, name: displayFilename(path, note?.original_name), mime_type: note?.mime_type ?? null }
    })
  }

  const members = (membersRes.data ?? []).map((m) => {
    const profile = m.profiles as unknown as { email: string; full_name: string } | null
    return { email: profile?.email ?? null, full_name: profile?.full_name ?? null, project_role: m.project_role }
  })

  return {
    key: project.key,
    name: project.name,
    epics: epics.map((e) => ({ ...e, attachments: withAttachmentNames(e.attachments ?? []) })),
    sprints: sprints.map((s) => ({ ...s, attachments: withAttachmentNames(s.attachments ?? []) })),
    members,
  }
}
