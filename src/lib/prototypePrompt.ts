// Builds the "product-aware UI brief" behind the task drawer's Create prototype
// action. The brief is assembled once and then consumed by two destinations:
//
//   • Stitch (stitch.withgoogle.com) — copied to the clipboard, pasted by hand.
//     Stitch has no public API, so a round trip back into the task isn't
//     possible; this path buys Stitch's design quality at the cost of manual
//     paste-in/paste-back.
//   • The in-app generator (see prototype.ts) — same brief, sent through the
//     configured LLM, result stored as an HTML attachment on the task.
//
// Section headers are deliberately English even when the content is Russian:
// they're scaffolding both Stitch and the LLM parse reliably, while the product
// content itself stays verbatim in whatever language the team writes in.

import type { Epic, Project, ProjectMapBlock, Sprint, Task } from '@/types'

export type PrototypePlatform = 'mobile' | 'desktop'

export interface PrototypeContext {
  project:   Project | null
  /** The project's vision epic (Epic.is_vision) — the standing product idea, not this feature. */
  vision:    Epic | null
  epic:      Epic | null
  sprint:    Sprint | null
  task:      Task
  subtasks:  Task[]
  mapBlocks: ProjectMapBlock[]
  platform:  PrototypePlatform
}

// Per-section budgets. Kept tight on purpose: this is a PROMPT, not a spec
// document — the in-app generator sends it as the request body verbatim, and
// with a non-streaming call every extra character of input is time the model
// spends reading before it can start (and still has to finish) the response.
// The whole brief now targets well under 2k characters.
const VISION_LIMIT = 300
const EPIC_LIMIT = 300
const TASK_LIMIT = 500
const BLOCK_LIMIT = 220
const BLOCKS_TOTAL_LIMIT = 700
const MAX_SUBTASKS = 8

function clamp(text: string, limit: number): string {
  const trimmed = (text ?? '').trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit).trimEnd()}…`
}

/**
 * Which Project Map blocks are worth spending prompt budget on for a *UI*
 * prototype. Blocks wired to this exact task or its epic win outright; beyond
 * that, design and frontend blocks carry UI-relevant canon while backend/QA
 * blocks generally don't (they're only pulled in when explicitly linked).
 */
function scoreBlock(block: ProjectMapBlock, taskId: string, epicId: string | null): number {
  let score = 0
  if ((block.linked_task_ids ?? []).includes(taskId)) score += 100
  if (epicId && (block.linked_epic_ids ?? []).includes(epicId)) score += 50
  if (block.discipline === 'design') score += 20
  if (block.discipline === 'frontend') score += 10
  return score
}

export function selectMapBlocks(
  blocks: ProjectMapBlock[],
  taskId: string,
  epicId: string | null
): ProjectMapBlock[] {
  const ranked = blocks
    .map((block) => ({ block, score: scoreBlock(block, taskId, epicId) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.block.position - right.block.position)

  const picked: ProjectMapBlock[] = []
  let spent = 0

  for (const { block } of ranked) {
    const cost = clamp(block.body, BLOCK_LIMIT).length
    if (spent + cost > BLOCKS_TOTAL_LIMIT) continue
    picked.push(block)
    spent += cost
  }

  return picked
}

const PLATFORM_BRIEF: Record<PrototypePlatform, string> = {
  mobile: 'mobile app screen, portrait, ~390×844',
  desktop: 'desktop web screen, ~1440px wide, responsive down to tablet',
}

/**
 * The single editable artifact the prototype modal shows. Whatever the operator
 * ends up with in that textarea is what both destinations receive verbatim —
 * nothing is re-assembled downstream.
 *
 * Deliberately written as a short flowing PROMPT — the kind of paragraph a
 * designer would type into Stitch by hand — rather than a headed spec
 * document. An earlier version quoted full epic/vision descriptions and every
 * matching Project Map block verbatim, which could run to 10k+ characters for
 * a task under a heavily-documented epic; sent as the request body to a
 * non-streaming LLM call, that's pure latency before generation even starts.
 * Each fact below is compressed to a clause, not copied wholesale.
 */
export function buildPrototypeBrief(ctx: PrototypeContext): string {
  const { task, epic, vision, sprint, project, subtasks, mapBlocks, platform } = ctx
  const sentences: string[] = []

  const productName = project?.name?.trim() || 'the product'
  sentences.push(`Design a high-fidelity ${PLATFORM_BRIEF[platform]} for one screen of ${productName}.`)

  const visionText = clamp(vision?.description ?? project?.description ?? '', VISION_LIMIT)
  if (visionText) sentences.push(`Product: ${visionText}`)

  if (epic) {
    const epicText = clamp(epic.description ?? '', EPIC_LIMIT)
    sentences.push(`Feature area — ${epic.title}${epicText ? `: ${epicText}` : ''}.`)
  }

  if (sprint?.goal?.trim()) {
    sentences.push(`Current sprint goal: ${clamp(sprint.goal, 200)}.`)
  }

  const taskText = clamp(task.description ?? '', TASK_LIMIT)
  sentences.push(`Screen to design — ${task.key} ${task.title}.${taskText ? ` ${taskText}` : ''}`)

  if (subtasks.length) {
    const list = subtasks.slice(0, MAX_SUBTASKS).map((subtask) => subtask.title).join('; ')
    sentences.push(`Must cover: ${list}.`)
  }

  if (task.labels?.length) {
    sentences.push(`Labels: ${task.labels.join(', ')}.`)
  }

  if (mapBlocks.length) {
    let spent = 0
    const facts: string[] = []
    for (const block of mapBlocks) {
      const fact = clamp(block.body, BLOCK_LIMIT)
      if (spent + fact.length > BLOCKS_TOTAL_LIMIT) continue
      facts.push(`${block.title} — ${fact}`)
      spent += fact.length
    }
    if (facts.length) sentences.push(`Visual/product language: ${facts.join(' | ')}.`)
  }

  sentences.push(
    'Use real, plausible content in the same language as this brief (never lorem ipsum), '
    + 'design the whole screen including empty/loading states where relevant, stay consistent '
    + 'with the product language above, and keep it modern, clean and accessible.'
  )

  return sentences.join('\n\n')
}

/**
 * System prompt for the in-app generator. Deliberately strict about producing a
 * single self-contained document — the result is stored as one .html attachment
 * and rendered in a sandboxed iframe, so anything split across files is useless.
 */
export function prototypeSystemPrompt(platform: PrototypePlatform): string {
  return [
    'You are a senior product designer who ships production-quality UI mockups as code.',
    '',
    'Return ONE complete, self-contained HTML document and nothing else — no explanation, no markdown fences, no commentary before or after.',
    '',
    'Rules:',
    '- Start with <!DOCTYPE html> and end with </html>.',
    '- Style with the Tailwind Play CDN: <script src="https://cdn.tailwindcss.com"></script> in <head>. Put anything Tailwind cannot express in a single inline <style> block.',
    '- No other external resources: no image hosts, no icon packs, no font CDNs, no fetch/XHR. Draw icons as inline SVG and use CSS gradients or solid blocks where an image would go.',
    '- Write realistic domain content in the same language as the brief. Real names, real numbers, real copy.',
    '- Static mockup only: interactivity is limited to what plain CSS (:hover, :focus) gives you. No application logic.',
    platform === 'mobile'
      ? '- Render a single mobile screen centred in the viewport inside a ~390px-wide phone frame with rounded corners on a neutral backdrop.'
      : '- Render a full desktop layout at ~1440px, degrading sensibly on narrower viewports.',
  ].join('\n')
}

/** Stitch takes a plain prompt box — the brief goes in as-is. */
export const STITCH_URL = 'https://stitch.withgoogle.com/'
