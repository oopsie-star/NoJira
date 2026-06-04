import { Fragment, type ReactNode } from 'react'
import { FileArchive, FileText, Image as ImageIcon, Paperclip } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { classifyAttachment, getFilename } from '@/lib/attachments'
import { matchMediaToAttachment } from '@/lib/adf'
import { useSignedAttachments } from '@/lib/useSignedAttachments'
import type { AdfNode } from '@/types'

interface RenderCtx {
  attachments: string[]
  urlByPath: Map<string, string>
  used: Set<string>
  t: (key: string, vars?: Record<string, string | number>) => string
}

// ── Inline marks (strong / em / code / link / …) ──────────────────────────────

function applyMarks(text: ReactNode, marks: AdfNode[] | undefined): ReactNode {
  if (!marks?.length) return text
  let node = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        node = <strong className="font-semibold">{node}</strong>
        break
      case 'em':
        node = <em className="italic">{node}</em>
        break
      case 'code':
        node = <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{node}</code>
        break
      case 'strike':
        node = <s>{node}</s>
        break
      case 'underline':
        node = <u>{node}</u>
        break
      case 'subsup':
        node = (mark.attrs?.type === 'sub') ? <sub>{node}</sub> : <sup>{node}</sup>
        break
      case 'link': {
        const href = (mark.attrs?.href as string | undefined) ?? '#'
        node = (
          <a href={href} target="_blank" rel="noreferrer" className="text-qira-pistachio underline hover:text-qira-pistachio-dk">
            {node}
          </a>
        )
        break
      }
      default:
        break
    }
  }
  return node
}

// ── Media (image / file card / placeholder) ───────────────────────────────────

function MediaNode({ node, ctx, keyId }: { node: AdfNode; ctx: RenderCtx; keyId: string }) {
  const attrs = node.attrs ?? {}

  // External media (e.g. pasted URL) renders straight from its url.
  if (attrs.type === 'external' && typeof attrs.url === 'string') {
    return (
      <a key={keyId} href={attrs.url} target="_blank" rel="noreferrer" className="block">
        <img src={attrs.url} alt={(attrs.alt as string) ?? ''} className="max-h-96 max-w-full rounded-xl border border-slate-200 object-contain" />
      </a>
    )
  }

  const path = matchMediaToAttachment(attrs, ctx.attachments, ctx.used)
  const filename = path ? getFilename(path) : ((attrs.alt as string | undefined) ?? null)
  const url = path ? ctx.urlByPath.get(path) ?? null : null
  const kind = filename ? classifyAttachment(filename) : 'file'

  // Unmatched media — never show raw JSON or an empty hole.
  if (!path) {
    return (
      <span key={keyId} className="my-1 inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        <Paperclip size={15} />
        {filename ?? ctx.t('task.jira.fileFromJira')}
      </span>
    )
  }

  if (kind === 'image' && url) {
    return (
      <a key={keyId} href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt={filename ?? ''} loading="lazy" className="max-h-96 max-w-full rounded-xl border border-slate-200 object-contain" />
      </a>
    )
  }

  const Icon = kind === 'archive' ? FileArchive : kind === 'image' ? ImageIcon : FileText
  return (
    <a
      key={keyId}
      href={url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="my-1 inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      <Icon size={16} className="shrink-0 text-qira-pistachio" />
      <span className="truncate">{filename ?? ctx.t('task.jira.fileFromJira')}</span>
    </a>
  )
}

// ── Recursive node renderer ───────────────────────────────────────────────────

function renderChildren(node: AdfNode, ctx: RenderCtx, keyPrefix: string): ReactNode[] {
  return (node.content ?? []).map((child, i) => (
    <Fragment key={`${keyPrefix}-${i}`}>{renderNode(child, ctx, `${keyPrefix}-${i}`)}</Fragment>
  ))
}

function renderNode(node: AdfNode, ctx: RenderCtx, keyId: string): ReactNode {
  switch (node.type) {
    case 'doc':
      return <>{renderChildren(node, ctx, keyId)}</>

    case 'paragraph':
      return <p className="my-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{renderChildren(node, ctx, keyId)}</p>

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6)
      const Tag = (`h${level}`) as keyof JSX.IntrinsicElements
      const sizes: Record<number, string> = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base', 4: 'text-sm', 5: 'text-sm', 6: 'text-xs' }
      return <Tag className={`mb-2 mt-4 font-semibold text-slate-900 ${sizes[level]}`}>{renderChildren(node, ctx, keyId)}</Tag>
    }

    case 'text':
      return applyMarks(node.text ?? '', node.marks)

    case 'hardBreak':
      return <br />

    case 'bulletList':
      return <ul className="my-2 list-disc space-y-1 pl-6 text-sm leading-6 text-slate-700">{renderChildren(node, ctx, keyId)}</ul>

    case 'orderedList':
      return <ol className="my-2 list-decimal space-y-1 pl-6 text-sm leading-6 text-slate-700">{renderChildren(node, ctx, keyId)}</ol>

    case 'listItem':
      return <li>{renderChildren(node, ctx, keyId)}</li>

    case 'blockquote':
      return <blockquote className="my-2 border-l-4 border-slate-200 pl-4 text-sm italic text-slate-600">{renderChildren(node, ctx, keyId)}</blockquote>

    case 'codeBlock':
      return (
        <pre className="my-2 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-5 text-slate-100">
          <code>{(node.content ?? []).map((c) => c.text ?? '').join('')}</code>
        </pre>
      )

    case 'rule':
      return <hr className="my-4 border-slate-200" />

    case 'mention':
      return <span className="rounded bg-qira-pistachio-lt px-1 font-medium text-qira-pistachio-dk">@{(node.attrs?.text as string) ?? (node.attrs?.id as string) ?? 'mention'}</span>

    case 'emoji':
      return <span>{(node.attrs?.text as string) ?? (node.attrs?.shortName as string) ?? ''}</span>

    case 'date': {
      const ts = Number(node.attrs?.timestamp)
      const label = Number.isFinite(ts) ? new Date(ts).toLocaleDateString() : ''
      return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{label}</span>
    }

    case 'status':
      return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">{(node.attrs?.text as string) ?? ''}</span>

    case 'panel':
      return <div className="my-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{renderChildren(node, ctx, keyId)}</div>

    case 'mediaSingle':
    case 'mediaGroup':
      return <div className="my-3 flex flex-wrap gap-3">{renderChildren(node, ctx, keyId)}</div>

    case 'media':
    case 'mediaInline':
      return <MediaNode node={node} ctx={ctx} keyId={keyId} />

    case 'expand':
    case 'nestedExpand':
      return (
        <details className="my-2 rounded-xl border border-slate-200 bg-white px-4 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">{(node.attrs?.title as string) ?? '…'}</summary>
          <div className="mt-2">{renderChildren(node, ctx, keyId)}</div>
        </details>
      )

    case 'table':
      return <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-sm">{renderChildren(node, ctx, keyId)}</table></div>
    case 'tableRow':
      return <tr>{renderChildren(node, ctx, keyId)}</tr>
    case 'tableHeader':
      return <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700">{renderChildren(node, ctx, keyId)}</th>
    case 'tableCell':
      return <td className="border border-slate-200 px-3 py-2 align-top text-slate-700">{renderChildren(node, ctx, keyId)}</td>

    case 'inlineCard':
    case 'blockCard':
    case 'embedCard': {
      const href = (node.attrs?.url as string | undefined) ?? '#'
      return <a href={href} target="_blank" rel="noreferrer" className="text-qira-pistachio underline hover:text-qira-pistachio-dk">{href}</a>
    }

    default:
      // Unknown node: render its children if any, otherwise nothing (never JSON).
      return node.content ? <>{renderChildren(node, ctx, keyId)}</> : null
  }
}

// ── Public component ──────────────────────────────────────────────────────────

export function JiraDescriptionRenderer({
  adf,
  attachments,
}: {
  adf: AdfNode
  attachments: string[]
}) {
  const { t } = useI18n()
  const { urlByPath } = useSignedAttachments(attachments)

  const ctx: RenderCtx = {
    attachments,
    urlByPath,
    used: new Set<string>(),
    t,
  }

  return <div className="jira-adf">{renderNode(adf, ctx, 'root')}</div>
}
