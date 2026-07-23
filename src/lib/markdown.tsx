import { Fragment, type ReactNode } from 'react'
import type { Profile } from '@/types'
import { splitMentionParts } from './mentions'

// Lightweight Markdown renderer (no dependency) for native task descriptions and
// comments. Supports the common subset: headings, bold/italic/code/strikethrough,
// links + bare URLs, bullet/ordered lists, task checkboxes, blockquotes, fenced
// code blocks, horizontal rules — plus @mentions when members are provided.

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+?\*\*)|(~~[^~]+?~~)|(\*[^*\s][^*]*?\*)|(_[^_\s][^_]*?_)|(\[[^\]]+?\]\([^)\s]+?\))|(\bhttps?:\/\/[^\s<>()]+)/g

// A GFM table separator row, e.g. `| --- | :--: | --: |` (dashes, optional colons).
function isTableSeparator(line: string): boolean {
  return line.includes('|') && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line)
}

// Split a `| a | b |` row into trimmed cells, ignoring the outer pipes.
function splitTableRow(row: string): string[] {
  let s = row.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((cell) => cell.trim())
}

function renderText(text: string, members: Profile[] | undefined, keyPrefix: string): ReactNode[] {
  if (!members?.length) return [text]
  return splitMentionParts(text, members).map((part, i) =>
    part.type === 'mention' ? (
      <span key={`${keyPrefix}-m${i}`} className="rounded bg-qira-pistachio-lt px-1 font-medium text-qira-pistachio-dk">
        {part.value}
      </span>
    ) : (
      <Fragment key={`${keyPrefix}-t${i}`}>{part.value}</Fragment>
    ),
  )
}

function renderInline(text: string, members: Profile[] | undefined, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let i = 0
  // matchAll (not a shared exec()/lastIndex loop) — this function recurses
  // into matched bold/italic/strike spans, and a single mutable INLINE_RE
  // object shared across those recursive calls corrupts the outer loop's
  // scan position (a failed exec() resets lastIndex to 0), which re-matched
  // the same span forever — an infinite loop on any line with 2+ spans.
  for (const match of text.matchAll(INLINE_RE)) {
    if (match.index > last) nodes.push(...renderText(text.slice(last, match.index), members, `${keyPrefix}-${i}pre`))
    const [, code, bold, strike, italicA, italicB, link, url] = match
    const key = `${keyPrefix}-${i}`
    if (code) nodes.push(<code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{code.slice(1, -1)}</code>)
    else if (bold) nodes.push(<strong key={key} className="font-semibold">{renderInline(bold.slice(2, -2), members, key)}</strong>)
    else if (strike) nodes.push(<s key={key}>{renderInline(strike.slice(2, -2), members, key)}</s>)
    else if (italicA) nodes.push(<em key={key} className="italic">{renderInline(italicA.slice(1, -1), members, key)}</em>)
    else if (italicB) nodes.push(<em key={key} className="italic">{renderInline(italicB.slice(1, -1), members, key)}</em>)
    else if (link) {
      const m = /\[([^\]]+?)\]\(([^)\s]+?)\)/.exec(link)
      nodes.push(<a key={key} href={m?.[2] ?? '#'} target="_blank" rel="noreferrer" className="text-qira-pistachio underline hover:text-qira-pistachio-dk">{m?.[1] ?? link}</a>)
    } else if (url) {
      nodes.push(<a key={key} href={url} target="_blank" rel="noreferrer" className="break-all text-qira-pistachio underline hover:text-qira-pistachio-dk">{url}</a>)
    }
    last = match.index + match[0].length
    i++
  }
  if (last < text.length) nodes.push(...renderText(text.slice(last), members, `${keyPrefix}-end`))
  return nodes
}

export function MarkdownRenderer({ source, members, className = '' }: { source: string; members?: Profile[]; className?: string }) {
  const lines = (source ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  const para: string[] = []
  const flushPara = () => {
    if (!para.length) return
    const text = para.join('\n')
    blocks.push(
      <p key={`p${key++}`} className="my-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {text.split('\n').map((ln, idx) => (
          <Fragment key={idx}>{idx > 0 && <br />}{renderInline(ln, members, `p${key}-${idx}`)}</Fragment>
        ))}
      </p>,
    )
    para.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (/^```/.test(line)) {
      flushPara()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      blocks.push(<pre key={`c${key++}`} className="my-2 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-5 text-slate-100"><code>{code.join('\n')}</code></pre>)
      continue
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      const level = heading[1].length
      const sizes: Record<number, string> = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base', 4: 'text-sm', 5: 'text-sm', 6: 'text-xs' }
      const Tag = (`h${level}`) as keyof JSX.IntrinsicElements
      blocks.push(<Tag key={`h${key++}`} className={`mb-2 mt-4 font-semibold text-slate-900 ${sizes[level]}`}>{renderInline(heading[2], members, `h${key}`)}</Tag>)
      i++
      continue
    }

    // GFM pipe table: a header row followed by a |---|:--:| separator row.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara()
      const headers = splitTableRow(line)
      const aligns = splitTableRow(lines[i + 1]).map((cell) => {
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        return right && left ? 'text-center' : right ? 'text-right' : 'text-left'
      })
      const alignFor = (idx: number) => aligns[idx] ?? 'text-left'
      i += 2

      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '' && !isTableSeparator(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i++
      }

      blocks.push(
        // Shrinks to the container width (cells wrap); scrolls only if it truly
        // can't fit, so a wide table never pushes the task window wider.
        <div key={`tbl${key++}`} className="my-2 max-w-full overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {headers.map((cell, ci) => (
                  <th key={ci} className={`border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-900 ${alignFor(ci)}`}>
                    {renderInline(cell, members, `th${key}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="align-top">
                  {headers.map((_, ci) => (
                    <td key={ci} className={`break-words border-b border-slate-100 px-3 py-2 text-slate-700 ${alignFor(ci)}`}>
                      {renderInline(row[ci] ?? '', members, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara()
      blocks.push(<hr key={`hr${key++}`} className="my-4 border-slate-200" />)
      i++
      continue
    }

    // Blockquote (consecutive)
    if (/^>\s?/.test(line)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(<blockquote key={`q${key++}`} className="my-2 border-l-4 border-slate-200 pl-4 text-sm italic text-slate-600">{renderInline(quote.join(' '), members, `q${key}`)}</blockquote>)
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++ }
      blocks.push(
        <ol key={`ol${key++}`} className="my-2 list-decimal space-y-1 pl-6 text-sm leading-6 text-slate-700">
          {items.map((it, idx) => <li key={idx}>{renderInline(it, members, `ol${key}-${idx}`)}</li>)}
        </ol>,
      )
      continue
    }

    // Bullet / task list
    if (/^[-*+]\s+/.test(line)) {
      flushPara()
      const items: { text: string; checked: boolean | null }[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        const body = lines[i].replace(/^[-*+]\s+/, '')
        const task = /^\[([ xX])\]\s+(.*)$/.exec(body)
        items.push(task ? { text: task[2], checked: task[1].toLowerCase() === 'x' } : { text: body, checked: null })
        i++
      }
      blocks.push(
        <ul key={`ul${key++}`} className={`my-2 space-y-1 text-sm leading-6 text-slate-700 ${items.some((it) => it.checked !== null) ? '' : 'list-disc pl-6'}`}>
          {items.map((it, idx) => (
            <li key={idx} className={it.checked !== null ? 'flex items-start gap-2' : ''}>
              {it.checked !== null && (
                <input type="checkbox" checked={it.checked} readOnly className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-qira-pistachio" />
              )}
              <span className={it.checked ? 'text-slate-400 line-through' : ''}>{renderInline(it.text, members, `ul${key}-${idx}`)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // Blank line → paragraph break
    if (line.trim() === '') { flushPara(); i++; continue }

    para.push(line)
    i++
  }
  flushPara()

  return <div className={className}>{blocks}</div>
}
