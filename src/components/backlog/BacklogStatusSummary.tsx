import type { TaskStatus } from '@/types'

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done']

const statusClasses: Record<TaskStatus, string> = {
  todo: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-qira-pistachio',
  done: 'bg-emerald-100 text-emerald-700',
}

interface BacklogStatusSummaryProps {
  counts: Record<TaskStatus, number>
}

export function BacklogStatusSummary({ counts }: BacklogStatusSummaryProps) {
  return (
    <div className="flex items-center gap-1.5">
      {STATUS_ORDER.map((status) => (
        <span
          key={status}
          className={`inline-flex min-w-[28px] items-center justify-center rounded-md px-1.5 py-1 text-[11px] font-semibold ${statusClasses[status]}`}
        >
          {counts[status] ?? 0}
        </span>
      ))}
    </div>
  )
}
