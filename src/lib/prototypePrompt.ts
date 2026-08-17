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

// Per-section budgets. The whole brief lands around 6–12k characters, which is
// comfortable for Stitch's prompt box and cheap enough to send on every retry.
const VISION_LIMIT = 2500
const EPIC_LIMIT = 2000
const TASK_LIMIT = 3000
const BLOCK_LIMIT = 1200
const BLOCKS_TOTAL_LIMIT = 6000
const MAX_SUBTASKS = 15

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
  mobile: 'Mobile app screen (portrait, ~390×844 viewport).',
  desktop: 'Desktop web screen (~1440px wide, responsive down to tablet).',
}

function section(heading: string, body: string): string {
  return `## ${heading}\n${body}`
}

/**
 * The single editable artifact the prototype modal shows. Whatever the operator
 * ends up with in that textarea is what both destinations receive verbatim —
 * nothing is re-assembled downstream.
 */
export function buildPrototypeBrief(ctx: PrototypeContext): string {
  const { task, epic, vision, sprint, project, subtasks, mapBlocks, platform } = ctx
  const parts: string[] = []

  const productName = project?.name?.trim() || 'the product'
  parts.push(
    `Design a high-fidelity UI prototype for one screen of ${productName}.\n`
    + `Target: ${PLATFORM_BRIEF[platform]}`
  )

  if (vision?.description?.trim()) {
    parts.push(section('Product vision', clamp(vision.description, VISION_LIMIT)))
  } else if (project?.description?.trim()) {
    parts.push(section('Product', clamp(project.description, VISION_LIMIT)))
  }

  if (epic) {
    const epicBody = [epic.title, clamp(epic.description, EPIC_LIMIT)].filter(Boolean).join('\n')
    parts.push(section('Feature area this screen belongs to', epicBody))
  }

  if (sprint?.goal?.trim()) {
    parts.push(section('Current sprint goal', clamp(sprint.goal, 500)))
  }

  const taskBody = [
    `${task.key} — ${task.title}`,
    clamp(task.description, TASK_LIMIT) || '(no description written yet)',
  ].join('\n')
  parts.push(section('Screen to design', taskBody))

  if (subtasks.length) {
    const list = subtasks
      .slice(0, MAX_SUBTASKS)
      .map((subtask) => `- ${subtask.title}`)
      .join('\n')
    parts.push(section('Must cover (subtasks)', list))
  }

  if (task.labels?.length) {
    parts.push(section('Labels', task.labels.join(', ')))
  }

  if (mapBlocks.length) {
    const canon = mapBlocks
      .map((block) => `### [${block.discipline}] ${block.title}\n${clamp(block.body, BLOCK_LIMIT)}`)
      .join('\n\n')
    parts.push(section('Product canon (Project Map)', canon))
  }

  parts.push(section(
    'Design requirements',
    [
      '- Show real, plausible content in the same language as the brief above — never lorem ipsum or placeholder boxes.',
      '- Design the whole screen: navigation, headers, empty/loading states where they matter.',
      '- Stay consistent with the product canon above; do not invent features it contradicts.',
      '- Modern, clean, accessible: legible contrast, comfortable touch targets, clear visual hierarchy.',
    ].join('\n')
  ))

  return parts.join('\n\n')
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
