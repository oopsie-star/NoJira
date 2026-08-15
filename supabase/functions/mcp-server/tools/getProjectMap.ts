import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { ToolError } from './errors.ts'
import { resolveProjectByKey } from './resolvers.ts'

interface GetProjectMapArgs {
  project?: string
  discipline?: string
}

const DISCIPLINES = ['backend', 'frontend', 'design', 'qa']

interface QaRow {
  id: string
  block_id: string
  parent_id: string | null
  body: string
  author_agent: string | null
  created_at: string
  author: { full_name: string | null; email: string | null } | null
}

export async function getProjectMap(admin: SupabaseClient, args: GetProjectMapArgs) {
  const projectKey = args.project?.trim()
  if (!projectKey) throw new ToolError('"project" is required.')

  const discipline = args.discipline?.trim().toLowerCase()
  if (discipline && !DISCIPLINES.includes(discipline)) {
    throw new ToolError(`"discipline" must be one of: ${DISCIPLINES.join(', ')}`)
  }

  const project = await resolveProjectByKey(admin, projectKey)

  let blocksQuery = admin
    .from('project_map_blocks')
    .select('id, discipline, title, body, attachments, linked_task_ids, linked_epic_ids, position, last_ai_agent, updated_at')
    .eq('project_id', project.id)
    .order('position')
    .order('created_at')
  if (discipline) blocksQuery = blocksQuery.eq('discipline', discipline)

  const { data: blocks, error: blocksError } = await blocksQuery
  if (blocksError) throw new ToolError(`Failed to read the project map: ${blocksError.message}`)

  const blockIds = (blocks ?? []).map((block) => block.id)
  let qaRows: QaRow[] = []
  if (blockIds.length > 0) {
    const { data, error } = await admin
      .from('project_map_qa')
      .select('id, block_id, parent_id, body, author_agent, created_at, author:profiles!project_map_qa_author_id_fkey(full_name, email)')
      .in('block_id', blockIds)
      .order('created_at')
    if (error) throw new ToolError(`Failed to read project map questions: ${error.message}`)
    qaRows = (data ?? []) as unknown as QaRow[]
  }

  // Resolve linked ids back to human-meaningful keys so an agent reading the
  // map sees "PROJ-42" rather than a uuid it would have to look up again.
  const allTaskIds = [...new Set((blocks ?? []).flatMap((block) => block.linked_task_ids ?? []))]
  const allEpicIds = [...new Set((blocks ?? []).flatMap((block) => block.linked_epic_ids ?? []))]

  interface LinkedRow { id: string; key: string; title: string }

  async function loadLinked(table: 'tasks' | 'epics', ids: string[]): Promise<Map<string, LinkedRow>> {
    if (ids.length === 0) return new Map()
    const { data, error } = await admin.from(table).select('id, key, title').in('id', ids)
    if (error) throw new ToolError(`Failed to resolve linked ${table}: ${error.message}`)
    return new Map(((data ?? []) as LinkedRow[]).map((row) => [row.id, row]))
  }

  const [taskById, epicById] = await Promise.all([
    loadLinked('tasks', allTaskIds),
    loadLinked('epics', allEpicIds),
  ])

  const authorLabel = (row: QaRow) =>
    row.author_agent ?? row.author?.full_name ?? row.author?.email ?? 'unknown'

  return {
    project: project.key,
    blocks: (blocks ?? []).map((block) => {
      const forBlock = qaRows.filter((row) => row.block_id === block.id)
      return {
        id: block.id,
        discipline: block.discipline,
        title: block.title,
        body: block.body,
        position: block.position,
        attachment_count: (block.attachments ?? []).length,
        last_ai_agent: block.last_ai_agent,
        updated_at: block.updated_at,
        linked_tasks: (block.linked_task_ids ?? []).map((id: string) => taskById.get(id)).filter(Boolean),
        linked_epics: (block.linked_epic_ids ?? []).map((id: string) => epicById.get(id)).filter(Boolean),
        questions: forBlock
          .filter((row) => !row.parent_id)
          .map((question) => ({
            id: question.id,
            body: question.body,
            asked_by: authorLabel(question),
            asked_at: question.created_at,
            answers: forBlock
              .filter((row) => row.parent_id === question.id)
              .map((answer) => ({
                body: answer.body,
                answered_by: authorLabel(answer),
                answered_at: answer.created_at,
              })),
          })),
      }
    }),
  }
}
