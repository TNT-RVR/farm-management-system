import { STATUS_LABEL, type ConnectionStatus } from '@/lib/connections'
import { cn } from '@/lib/utils'
import { STATUS_CLASS } from './status-style'

export function StatusPill({ status, className }: { status: ConnectionStatus; className?: string }) {
  return (
    <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CLASS[status].pill, className)}>
      {STATUS_LABEL[status]}
    </span>
  )
}
