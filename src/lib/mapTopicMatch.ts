import type { ProjectMapBlock } from '@/types'

/**
 * Cheap, offline "is this question actually about this block?" check.
 *
 * Deliberately not an LLM call: this runs on every keystroke-ish submit for a
 * project with hundreds of blocks, and the answer only ever produces a
 * *suggestion* the person can ignore. Term overlap is enough to catch the case
 * it exists for — someone parking a question about one thing under an
 * unrelated block — while staying silent on everything else.
 */

// Function words carry no topic signal and would otherwise match everywhere.
const STOPWORDS = new Set([
  'este', 'that', 'this', 'with', 'from', 'have', 'does', 'will', 'what', 'when',
  'where', 'which', 'should', 'would', 'could', 'about', 'there', 'their',
  'быть', 'если', 'этот', 'эта', 'это', 'эти', 'того', 'тому', 'так', 'как',
  'что', 'чтобы', 'где', 'когда', 'какой', 'какая', 'какие', 'нужно', 'надо',
  'можно', 'может', 'есть', 'нет', 'для', 'при', 'над', 'под', 'или', 'тоже',
  'уже', 'ещё', 'еще', 'вот', 'все', 'всё', 'этом', 'этого', 'будет', 'было',
])

/**
 * Crude stem: lowercase, fold ё, and keep the first 6 characters. Russian
 * inflects heavily ("авторизации" / "авторизацию" / "авторизация"), and a
 * prefix of this length collapses those to one key without needing a
 * morphology library.
 */
function stem(word: string): string {
  return word.toLowerCase().replace(/ё/g, 'е').slice(0, 6)
}

function termsOf(text: string): Set<string> {
  const words = (text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
  return new Set(words.map(stem))
}

function overlap(questionTerms: Set<string>, block: ProjectMapBlock): number {
  // Title terms count double — a block's heading is a much stronger topic
  // signal than a term buried once in a long body.
  const titleTerms = termsOf(block.title)
  const bodyTerms = termsOf(block.body)
  let score = 0
  for (const term of questionTerms) {
    if (titleTerms.has(term)) score += 2
    else if (bodyTerms.has(term)) score += 1
  }
  return score
}

export interface TopicMismatch {
  /** The block the question looks like it actually belongs to. */
  suggested: ProjectMapBlock
  suggestedScore: number
  currentScore: number
}

/** Below this, a "better" block isn't convincing enough to interrupt anyone. */
const MIN_SUGGESTION_SCORE = 4
/** How far the suggestion must beat the current block before we say anything. */
const MIN_MARGIN = 3

/**
 * Returns a suggestion only when the question clearly fits some other block
 * better than the one it's being written under. Silence is the default and the
 * common case: a short question, an ambiguous one, or one that matches the
 * current block at all produces nothing.
 */
export function findTopicMismatch(
  question: string,
  currentBlock: ProjectMapBlock,
  allBlocks: ProjectMapBlock[],
): TopicMismatch | null {
  const questionTerms = termsOf(question)
  // Too few distinctive words to judge — "а тут как?" is not a mismatch.
  if (questionTerms.size < 3) return null

  const currentScore = overlap(questionTerms, currentBlock)

  let best: ProjectMapBlock | null = null
  let bestScore = 0
  for (const block of allBlocks) {
    if (block.id === currentBlock.id) continue
    const score = overlap(questionTerms, block)
    if (score > bestScore) {
      best = block
      bestScore = score
    }
  }

  if (!best) return null
  if (bestScore < MIN_SUGGESTION_SCORE) return null
  if (bestScore - currentScore < MIN_MARGIN) return null

  return { suggested: best, suggestedScore: bestScore, currentScore }
}
