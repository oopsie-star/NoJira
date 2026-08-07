// Small self-contained line-level diff (classic LCS backtrack) — no need for a
// dependency just to highlight what changed between two description/title
// snapshots. Fine for typical task-text sizes; not meant for huge documents.

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  text: string
}

export function diffLines(oldText: string | null, newText: string | null): DiffLine[] {
  const oldLines = (oldText ?? '').split('\n')
  const newLines = (newText ?? '').split('\n')
  const n = oldLines.length
  const m = newLines.length

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'unchanged', text: oldLines[i] })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'removed', text: oldLines[i] })
      i += 1
    } else {
      result.push({ type: 'added', text: newLines[j] })
      j += 1
    }
  }
  while (i < n) {
    result.push({ type: 'removed', text: oldLines[i] })
    i += 1
  }
  while (j < m) {
    result.push({ type: 'added', text: newLines[j] })
    j += 1
  }

  return result
}
