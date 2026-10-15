import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Cast, Check, Loader2, Power, Tv, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/database.types'

/**
 * "Show on TV" — puts the conference-room TV on this page, the Firestick, or off.
 *
 * The app only queues a row in tv_commands; Node-RED on the shop server claims
 * it and drives the TV through Home Assistant (the Server Rack project). The
 * status shown here is that row, watched over Realtime with a slow poll behind
 * it, because a phone walking into the room drops sockets often.
 */

type TvRow = Database['public']['Tables']['tv_commands']['Row']
type Command = TvRow['command']

/** How long a command may sit unclaimed before we say the server is not answering. */
const NOT_RESPONDING_MS = 30_000
const POLL_MS = 3_000

const ACTIONS: { command: Command; label: string; icon: typeof Tv }[] = [
  { command: 'show_app', label: 'Show this page on TV', icon: Cast },
  { command: 'show_firestick', label: 'Switch TV to Firestick', icon: Tv },
  { command: 'tv_off', label: 'Turn TV off', icon: Power },
]

type Tracked = {
  id: string | null
  command: Command
  status: TvRow['status'] | 'sending'
  error: string | null
  stale: boolean
}

const DONE_TEXT: Record<Command, string> = {
  show_app: 'On the TV',
  show_firestick: 'TV on Firestick',
  tv_off: 'TV is off',
}

function statusText(t: Tracked): string {
  if (t.status === 'failed') return t.error === 'expired' ? 'TV controller not responding' : t.error || 'TV command failed'
  if (t.status === 'done') return DONE_TEXT[t.command]
  if (t.status === 'claimed') return t.command === 'tv_off' ? 'Turning TV off…' : 'TV is starting…'
  if (t.stale) return 'TV controller not responding'
  return 'Sending…'
}

function useTvCommand() {
  const [tracked, setTracked] = useState<Tracked | null>(null)
  const id = tracked?.id ?? null
  const terminal = tracked?.status === 'done' || tracked?.status === 'failed'

  // Watch the row: Realtime for speed, a poll in case the socket is down.
  useEffect(() => {
    if (!id || terminal) return
    const apply = (row: Pick<TvRow, 'status' | 'error'>) =>
      setTracked((t) => (t && t.id === id ? { ...t, status: row.status, error: row.error } : t))
    const channel = supabase
      .channel(`tv-command-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tv_commands', filter: `id=eq.${id}` },
        (payload) => apply(payload.new as TvRow),
      )
      .subscribe()
    const poll = window.setInterval(async () => {
      const { data } = await supabase.from('tv_commands').select('status, error').eq('id', id).maybeSingle()
      if (data) apply(data)
    }, POLL_MS)
    const stale = window.setTimeout(
      () => setTracked((t) => (t && t.id === id && t.status === 'pending' ? { ...t, stale: true } : t)),
      NOT_RESPONDING_MS,
    )
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(stale)
      void supabase.removeChannel(channel)
    }
  }, [id, terminal])

  const send = useCallback(async (command: Command) => {
    setTracked({ id: null, command, status: 'sending', error: null, stale: false })
    const { origin, pathname, search, hash } = window.location
    const url = command === 'show_app' ? `${origin}${pathname}${search}${hash}` : null
    const { data, error } = await supabase
      .from('tv_commands')
      .insert({ command, url })
      .select('id, status, error')
      .single()
    if (error || !data) {
      setTracked({ id: null, command, status: 'failed', error: error?.message ?? 'Could not reach the app', stale: false })
      return
    }
    setTracked({ id: data.id, command, status: data.status, error: data.error, stale: false })
  }, [])

  return { tracked, send, clear: () => setTracked(null) }
}

export function TvControl() {
  const [open, setOpen] = useState(false)
  const { tracked, send, clear } = useTvCommand()
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close the desktop menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A finished command clears itself after a while; a failure stays until dismissed.
  useEffect(() => {
    if (tracked?.status !== 'done') return
    const t = window.setTimeout(clear, 8_000)
    return () => window.clearTimeout(t)
  }, [tracked?.status, clear])

  const busy = tracked?.status === 'sending' || tracked?.status === 'pending' || tracked?.status === 'claimed'

  const choose = (command: Command) => {
    setOpen(false)
    void send(command)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn('relative rounded-md p-2 text-gray-500 hover:bg-gray-100', open && 'bg-gray-100')}
        aria-label="Show on conference room TV"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Conference room TV"
      >
        <Tv className="h-4 w-4" />
        {busy && <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
      </button>

      {open && (
        <>
          {/* Phone: a bottom sheet with big targets. Desktop: a small menu. */}
          <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={cn(
              'z-50 bg-white',
              'fixed inset-x-0 bottom-0 rounded-t-2xl p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl',
              'md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1 md:w-64 md:rounded-lg md:border md:border-gray-200 md:p-1 md:shadow-lg',
            )}
          >
            <p className="px-3 pb-2 pt-1 text-sm font-medium text-gray-900 md:pb-1 md:text-xs md:font-normal md:text-gray-400">
              Conference room TV
            </p>
            {ACTIONS.map(({ command, label, icon: Icon }) => (
              <button
                key={command}
                role="menuitem"
                disabled={busy}
                onClick={() => choose(command)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-4 text-left text-base text-gray-800 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-40 md:rounded-md md:py-2 md:text-sm"
              >
                <Icon className="h-5 w-5 shrink-0 text-gray-500 md:h-4 md:w-4" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {tracked && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'fixed inset-x-3 top-16 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg print:hidden',
            tracked.status === 'done' && 'border-green-200 bg-green-50 text-green-900',
            (tracked.status === 'failed' || tracked.stale) && 'border-amber-200 bg-amber-50 text-amber-900',
            !(tracked.status === 'done' || tracked.status === 'failed' || tracked.stale) && 'border-gray-200 bg-white text-gray-800',
          )}
        >
          {tracked.status === 'done' ? (
            <Check className="h-5 w-5 shrink-0" />
          ) : tracked.status === 'failed' || tracked.stale ? (
            <AlertTriangle className="h-5 w-5 shrink-0" />
          ) : (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600" />
          )}
          <span className="min-w-0 flex-1">{statusText(tracked)}</span>
          <button onClick={clear} className="-m-2 rounded-md p-2 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
