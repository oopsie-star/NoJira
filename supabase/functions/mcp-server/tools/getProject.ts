import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { displayFilename } from './attachmentPaths.ts'
import { ToolError } from './errors.ts'
import { resolveProjectByKey } from './resolvers.ts'

interface GetProjectArgs {
  project?: string
}

interface LastAgent {
  agent_name: string
  action_type: string
  at: string
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
  const epicIds = epics.map((e) => e.id)
  const sprintIds = sprints.map((s) => s.id)

  const [allPathsNotesRes, epicAgentRes, sprintAgentRes] = await Promise.all([
    (async () => {
      const allPaths = [...epics.flatMap((e) => e.attachments ?? []), ...sprints.flatMap((s) => s.attachments ?? [])]
      if (!allPaths.length) return { data: [], error: null }
      return admin.from('attachment_notes').select('path, original_name, mime_type').eq('project_id', project.id).in('path', allPaths)
    })(),
    epicIds.length
      ? admin
          .from('agent_audit_log')
          .select('epic_id, agent_name, action_type, created_at')
          .in('epic_id', epicIds)
          .not('agent_name', 'is', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    sprintIds.length
      ? admin
          .from('agent_audit_log')
          .select('sprint_id, agent_name, action_type, created_at')
          .in('sprint_id', sprintIds)
          .not('agent_name', 'is', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  if (allPathsNotesRes.error) throw new ToolError(`Failed to load attachment names: ${allPathsNotesRes.error.message}`)
  if (epicAgentRes.error) throw new ToolError(`Failed to load epic agent history: ${epicAgentRes.error.message}`)
  if (sprintAgentRes.error) throw new ToolError(`Failed to load sprint agent history: ${sprintAgentRes.error.message}`)

  const noteByPath = new Map<string, { path: string; original_name: string | null; mime_type: string | null }>()
  for (const n of allPathsNotesRes.data ?? []) noteByPath.set(n.path, n)

  function withAttachmentNames(paths: string[]) {
    return paths.map((path) => {
      const note = noteByPath.get(path)
      return { path, name: displayFilename(path, note?.original_name), mime_type: note?.mime_type ?? null }
    })
  }

  // Rows arrive newest-first, so the first row seen per id is the latest.
  const lastAgentByEpic = new Map<string, LastAgent>()
  for (const row of epicAgentRes.data ?? []) {
    if (!lastAgentByEpic.has(row.epic_id)) {
      lastAgentByEpic.set(row.epic_id, { agent_name: row.agent_name, action_type: row.action_type, at: row.created_at })
    }
  }
  const lastAgentBySprint = new Map<string, LastAgent>()
  for (const row of sprintAgentRes.data ?? []) {
    if (!lastAgentBySprint.has(row.sprint_id)) {
      lastAgentBySprint.set(row.sprint_id, { agent_name: row.agent_name, action_type: row.action_type, at: row.created_at })
    }
  }

  const members = (membersRes.data ?? []).map((m) => {
    const profile = m.profiles as unknown as { email: string; full_name: string } | null
    return { email: profile?.email ?? null, full_name: profile?.full_name ?? null, project_role: m.project_role }
  })

  return {
    key: project.key,
    name: project.name,
    epics: epics.map((e) => ({
      ...e,
      attachments: withAttachmentNames(e.attachments ?? []),
      last_ai_agent: lastAgentByEpic.get(e.id) ?? null,
    })),
    sprints: sprints.map((s) => ({
      ...s,
      attachments: withAttachmentNames(s.attachments ?? []),
      last_ai_agent: lastAgentBySprint.get(s.id) ?? null,
    })),
    members,
  }
}
