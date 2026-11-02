import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * The yard truck scale's live weight, and taking a weight off it.
 *
 * The scale is shared with Grand Forks Gravel and reports to Gravel's own
 * Supabase project (handoff docs/scale/HANDOFF-rvr.md in that repo). Watching
 * the weight needs only that project's public anon key, which /api/scale
 * hands to signed-in staff; taking a weight needs the farm's scale key, which
 * stays in that function. The weight shown here is a convenience — the
 * scale's own indicator is the legal weight.
 */

/** Nothing received for this long and the scale counts as offline (the reader heartbeats every ~3 s). */
export const SCALE_STALE_MS = 8000

export type ScaleReading = {
  /** null = overload or an indicator error */
  weightKg: number | null
  stable: boolean
  mode: 'gross' | 'net'
  seq: number
  /** server receive time (ISO) */
  updatedAt: string
}

export type ScaleState = 'offline' | 'motion' | 'empty' | 'net' | 'stable'

/**
 * What the reading says. `receivedAt` is this device's own clock when it got
 * the reading, so a phone whose clock is off does not call a live scale dead.
 */
export function scaleState(reading: ScaleReading | null, receivedAt: number | null, now: number): ScaleState {
  if (!reading || receivedAt == null || now - receivedAt > SCALE_STALE_MS) return 'offline'
  if (!reading.stable) return 'motion'
  if (reading.weightKg == null || reading.weightKg <= 0) return 'empty'
  // A tared indicator: a net weight, which a full-and-empty load cannot use.
  if (reading.mode !== 'gross') return 'net'
  return 'stable'
}

export const canTakeWeight = (s: ScaleState) => s === 'stable'

export const SCALE_STATE_TEXT: Record<ScaleState, string> = {
  offline: 'Scale offline',
  motion: 'Settling…',
  empty: 'Nothing on the scale',
  net: 'Indicator is on net — set it to gross',
  stable: 'Steady',
}

export type ScaleConfig =
  | { configured: false }
  | { configured: true; url: string; anonKey: string; device: string; canCapture: boolean }

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token ?? ''}` }
}

/** Where to watch the scale, or `configured: false` for a farm without one. */
export function useScaleConfig() {
  return useQuery({
    queryKey: ['scale-config'],
    queryFn: async (): Promise<ScaleConfig> => {
      const res = await fetch('/api/scale', { headers: await authHeader() })
      if (!res.ok) return { configured: false }
      return (await res.json()) as ScaleConfig
    },
    staleTime: 30 * 60_000,
    retry: 1,
  })
}

// One client per scale project for the whole app: the realtime socket is shared.
let scaleClient: { url: string; client: SupabaseClient } | null = null
function clientFor(url: string, anonKey: string): SupabaseClient {
  if (scaleClient?.url !== url) {
    scaleClient = {
      url,
      client: createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'rvr-yard-scale' },
      }),
    }
  }
  return scaleClient.client
}

type Row = Record<string, unknown>
const toReading = (r: Row): ScaleReading => ({
  weightKg: r.weight_kg == null ? null : Number(r.weight_kg),
  stable: !!r.stable,
  mode: r.mode === 'net' ? 'net' : 'gross',
  seq: Number(r.seq ?? 0),
  updatedAt: String(r.updated_at),
})

export type ScaleLive = {
  reading: ScaleReading | null
  /** When this device last received a reading (local ms). */
  receivedAt: number | null
  state: ScaleState
}

/**
 * The scale's live reading, kept current by Realtime. Realtime can drop
 * without a word (a sleeping phone, a weak link), so it is re-read when
 * nothing has come for a while and whenever the screen wakes. Live readings
 * are never cached for offline use: an old weight shown as current is worse
 * than none.
 */
export function useScaleLive(config: ScaleConfig | undefined): ScaleLive {
  const [live, setLive] = useState<{ reading: ScaleReading | null; receivedAt: number | null }>({
    reading: null,
    receivedAt: null,
  })
  const [now, setNow] = useState(() => Date.now())
  const lastRx = useRef(0)
  const url = config?.configured ? config.url : null
  const anonKey = config?.configured ? config.anonKey : null
  const device = config?.configured ? config.device : null

  useEffect(() => {
    if (!url || !anonKey || !device) return
    const client = clientFor(url, anonKey)
    let alive = true
    const accept = (row: Row, fromFetch: boolean) => {
      if (!alive) return
      const reading = toReading(row)
      // A fetched row may already be old: judge it by the server's time.
      // A pushed one is now by definition.
      const receivedAt = fromFetch ? Math.min(Date.now(), Date.parse(reading.updatedAt)) : Date.now()
      lastRx.current = Date.now()
      setLive({ reading, receivedAt })
    }
    const fetchNow = () =>
      client
        .from('scale_live')
        .select('*')
        .eq('device_id', device)
        .maybeSingle()
        .then(({ data }) => {
          if (data) accept(data as Row, true)
        })
    void fetchNow()
    const channel = client
      .channel(`scale_live:${device}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scale_live', filter: `device_id=eq.${device}` },
        (p) => {
          if (p.new) accept(p.new as Row, false)
        },
      )
      .subscribe()
    const poll = setInterval(() => {
      setNow(Date.now())
      if (Date.now() - lastRx.current > 6000) void fetchNow()
    }, 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      void client.removeChannel(channel)
    }
  }, [url, anonKey, device])

  return { ...live, state: scaleState(live.reading, live.receivedAt, now) }
}

export type ScaleCapture = { id: string; weightKg: number; readingAt: string }

/**
 * Take the weight on the scale now as a load's full or empty weight. Throws
 * with the scale's own reason (offline, in motion, nothing on it).
 */
export async function takeScaleWeight(kind: 'full' | 'empty', loadId: string | null): Promise<ScaleCapture> {
  const res = await fetch('/api/scale', {
    method: 'POST',
    headers: { ...(await authHeader()), 'content-type': 'application/json' },
    body: JSON.stringify({ kind, loadId }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<ScaleCapture> & { error?: string }
  if (!res.ok || !body.id || body.weightKg == null) throw new Error(body.error ?? `The scale did not answer (${res.status})`)
  return { id: body.id, weightKg: body.weightKg, readingAt: body.readingAt ?? new Date().toISOString() }
}
