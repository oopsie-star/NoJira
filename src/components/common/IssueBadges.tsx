import { AlertTriangle, BookOpenText, CheckSquare, Circle } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { IssuePriority, IssueType, TaskStatus } from '@/types'

const statusClasses: Record<TaskStatus, string> = {
  todo: 'bg-slate-200 text-slate-700',
  in_progress: 'bg-blue-100 text-qira-pistachio',
  done: 'bg-emerald-100 text-emerald-700',
}

const priorityClasses: Record<IssuePriority, string> = {
  lowest: 'bg-slate-100 text-slate-500',
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  highest: 'bg-red-100 text-red-700',
}

const typeClasses: Record<IssueType, string> = {
  task: 'bg-slate-100 text-slate-700',
  story: 'bg-indigo-100 text-indigo-700',
  bug: 'bg-rose-100 text-rose-700',
}

function TypeIcon({ type }: { type: IssueType }) {
  if (type === 'story') return <BookOpenText size={12} />
  if (type === 'bug') return <AlertTriangle size={12} />
  return <CheckSquare size={12} />
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${statusClasses[status]}`}>
      <Circle size={8} className="fill-current stroke-current" />
      {t(`status.${status}`)}
    </span>
  )
}

export function IssueTypeBadge({ type }: { type: IssueType }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${typeClasses[type]}`}>
      <TypeIcon type={type} />
      {t(`issueType.${type}`)}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${priorityClasses[priority]}`}>
      {t(`priority.${priority}`)}
    </span>
  )
}
