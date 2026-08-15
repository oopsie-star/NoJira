// Project Map notifications. Content normally arrives from an AI agent over
// MCP, which never touches a browser — so the fan-out has to happen here on
// the server rather than in the store the way task notifications do.
//
// Delivery itself is NOT reimplemented: this hands off to the existing
// send-task-notification function (email + Telegram + the in-app rows all
// live there), authenticating as the trusted internal caller with the
// service-role key and naming the audience as a group so the recipient query
// stays in one place. Everything is best-effort — a notification failure must
// never fail the tool call that produced the content.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

async function deliver(payload: Record<string, unknown>): Promise<void> {
  if (!supabaseUrl || !serviceRoleKey) return
  try {
    await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-task-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, task_id: null, link_path: 'map' }),
    })
  } catch (error) {
    console.error('[mcp-server] Project Map notification failed', error)
  }
}

function truncate(text: string, limit: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

const DISCIPLINE_LABELS: Record<string, string> = {
  backend: 'Бекенд',
  frontend: 'Фронтенд',
  design: 'Дизайн',
  qa: 'QA',
}

function sectionLabel(discipline: string) {
  return DISCIPLINE_LABELS[discipline] ?? discipline
}

/** Everyone on the project — new material is for the whole team to see. */
export async function notifyProjectMapBlock(options: {
  projectId: string
  discipline: string
  title: string
  agentName: string
  isNew: boolean
}): Promise<void> {
  const section = sectionLabel(options.discipline)
  const verb = options.isNew ? 'Новый материал' : 'Обновлён материал'

  await deliver({
    recipient_group: 'project_members',
    project_id: options.projectId,
    subject: `Карта проекта · ${section}: ${truncate(options.title, 120)}`,
    body_text: `${verb} в разделе «${section}» карты проекта. Автор: ${options.agentName}.`,
  })
}

/** Questions go to the global super admins, who field them. */
export async function notifyProjectMapQuestion(options: {
  projectId: string
  discipline: string
  blockTitle: string
  body: string
  askedBy: string
}): Promise<void> {
  const section = sectionLabel(options.discipline)

  await deliver({
    recipient_group: 'super_admins',
    project_id: options.projectId,
    subject: `Вопрос по карте проекта · ${section}: ${truncate(options.blockTitle, 100)}`,
    body_text: `${options.askedBy} спрашивает: ${truncate(options.body, 400)}`,
  })
}
