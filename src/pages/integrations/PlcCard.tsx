import { useState } from 'react'
import { CheckCircle2, CircuitBoard, XCircle } from 'lucide-react'
import {
  plcAge,
  plcDisplay,
  useCancelPlcCommand,
  usePlcAgents,
  usePlcCommands,
  usePlcTags,
  useQueuePlcWrite,
  type PlcTagRow,
} from '@/lib/plc'
import { cn } from '@/lib/utils'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'

/**
 * The Schneider panel, as far as this application can see it.
 *
 * Every value here came off a Modbus register on a machine at the shop and
 * travelled through the agent. Two things are therefore said out loud on every
 * row, because neither is visible in the number itself: how old the reading is,
 * and that a control is a *request* rather than an action. The browser cannot
 * touch the equipment; it can only leave a note for the agent.
 */
export function PlcCard({ isManager }: { isManager: boolean }) {
  const { data: tags, isLoading } = usePlcTags()
  const { data: agents } = usePlcAgents()
  const { data: commands } = usePlcCommands(6)
  const agent = agents?.[0]

  const linkUp = agent?.connection_state === 'online'
  // Measured by the database, not this device — see usePlcAgents. The agent
  // process and the Modbus link are separate questions, and an agent that is
  // running but cannot reach the panel is the failure this splits out.
  const seenSecondsAgo = agent?.seen_seconds_ago ?? null
  const agentUp = seenSecondsAgo != null && seenSecondsAgo < 120

  return (
    // Folded to its status line like the other integrations; a request
    // waiting on the agent opens it, so a queued write is never out of sight.
    <Fold
      key={commands?.some((c) => c.status === 'pending') ? 'pending' : 'calm'}
      defaultOpen={!!commands?.some((c) => c.status === 'pending')}
      title={
        <span className="flex items-center gap-1.5">
          {linkUp && agentUp ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <XCircle className="h-4 w-4 text-gray-300" />
          )}
          <CircuitBoard className="h-4 w-4 text-gray-400" /> PLC panel (Modbus TCP)
        </span>
      }
      summary={
        !agent
          ? 'not set up'
          : `agent ${agentUp ? 'reporting' : 'silent'} · link ${agent.connection_state}`
      }
    >
      {!agent ? (
        <HelpNote title="PLC panel" summary="No agent has reported yet.">
          <p>
            No agent has reported yet. The agent runs on a PC at the shop — nothing hosted can reach
            the panel, so this stays empty until that machine is set up and pointed at{' '}
            <code>/api/plc-sync</code>.
          </p>
        </HelpNote>
      ) : (
        <p className="text-xs text-gray-500">
          Agent {agentUp ? 'reporting' : 'silent'}{' '}
          {seenSecondsAgo != null && `(${plcAge(seenSecondsAgo)})`} from{' '}
          {agent.agent_host ?? 'an unnamed machine'} · Modbus link{' '}
          <strong className={linkUp ? 'text-green-700' : 'text-red-600'}>
            {agent.connection_state}
          </strong>
          {agent.tags_bad ? ` · ${agent.tags_bad} tag(s) not reading` : ''}
          {agent.last_error && !linkUp ? ` · ${agent.last_error}` : ''}
        </p>
      )}

      {isLoading ? (
        <p className="mt-3 text-xs text-gray-400">Loading…</p>
      ) : !tags?.length ? null : (
        <ul className="mt-3 divide-y divide-gray-100">
          {tags.map((t) => (
            <TagRow key={`${t.device_id}:${t.tag}`} row={t} isManager={isManager} />
          ))}
        </ul>
      )}

      {!!commands?.length && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Recent write requests
          </p>
          <ul className="mt-1 space-y-0.5">
            {commands.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[11px] text-gray-600">
                <span className={cn('font-medium', STATUS_COLOUR[c.status] ?? 'text-gray-500')}>
                  {c.status}
                </span>
                <span className="truncate">
                  {c.tag} → {String(c.value_num ?? c.value_bool ?? c.value_text)}
                </span>
                {c.error && <span className="truncate text-red-600">{c.error}</span>}
                {c.status === 'pending' && isManager && <CancelButton id={c.id} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Fold>
  )
}

const STATUS_COLOUR: Record<string, string> = {
  done: 'text-green-700',
  failed: 'text-red-600',
  expired: 'text-amber-700',
  cancelled: 'text-gray-400',
  pending: 'text-sky-700',
  claimed: 'text-sky-700',
}

function CancelButton({ id }: { id: string }) {
  const cancel = useCancelPlcCommand()
  return (
    <button
      onClick={() => cancel.mutate(id)}
      disabled={cancel.isPending}
      className="text-[11px] font-medium text-gray-500 underline underline-offset-2 hover:text-gray-800"
    >
      cancel
    </button>
  )
}

function TagRow({ row, isManager }: { row: PlcTagRow; isManager: boolean }) {
  const queue = useQueuePlcWrite()
  const [draft, setDraft] = useState('')
  const min = row.min_value != null ? Number(row.min_value) : null
  const max = row.max_value != null ? Number(row.max_value) : null
  const isBool = row.data_type === 'bool'
  const stale = row.age_seconds != null && row.age_seconds > 120

  const send = (value: number | boolean) => {
    queue.mutate({ deviceId: row.device_id, tag: row.tag, value })
    setDraft('')
  }

  const outOfRange =
    draft !== '' && ((min != null && Number(draft) < min) || (max != null && Number(draft) > max))

  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-gray-800" title={row.description ?? undefined}>
          {row.tag_label}
        </span>
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              row.quality === 'bad' ? 'text-red-600' : stale ? 'text-amber-700' : 'text-gray-900',
            )}
          >
            {plcDisplay(row)}
          </span>
          <span className={cn('text-[11px]', stale ? 'text-amber-700' : 'text-gray-400')}>
            {plcAge(row.age_seconds)}
          </span>
        </span>
      </div>

      {row.quality === 'bad' && row.error && (
        <p className="text-[11px] text-red-600">{row.error}</p>
      )}

      {row.writable && isManager && (
        <div className="mt-1 flex items-center gap-1.5">
          {isBool ? (
            <>
              <WriteButton onClick={() => send(true)} disabled={queue.isPending} label="Turn on" />
              <WriteButton
                onClick={() => send(false)}
                disabled={queue.isPending}
                label="Turn off"
              />
            </>
          ) : (
            <>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                inputMode="decimal"
                placeholder={min != null && max != null ? `${min} – ${max}` : 'value'}
                className={cn(
                  'w-24 rounded-md border px-2 py-1 text-xs',
                  outOfRange ? 'border-red-400 text-red-700' : 'border-gray-200',
                )}
              />
              <WriteButton
                onClick={() => send(Number(draft))}
                disabled={
                  draft === '' || outOfRange || Number.isNaN(Number(draft)) || queue.isPending
                }
                label="Request"
              />
              {/* The limits come from the agent's tag map, and the agent checks
                  them again before writing. This copy is a courtesy, not the
                  guard. */}
              {outOfRange && (
                <span className="text-[11px] text-red-600">
                  outside {min} – {max}
                </span>
              )}
            </>
          )}
          <span className="text-[11px] text-gray-400">
            queued for the agent · expires in 10 min
          </span>
        </div>
      )}
      {queue.isError && (
        <p className="text-[11px] text-red-600">{(queue.error as Error).message}</p>
      )}
    </li>
  )
}

function WriteButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void
  disabled: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
    >
      {label}
    </button>
  )
}
