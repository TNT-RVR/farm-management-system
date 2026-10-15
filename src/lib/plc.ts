import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

/**
 * The app's side of the PLC bridge.
 *
 * Everything here is a read except one thing: queueing a write. The browser
 * cannot reach the panel and never will — it puts a row in `plc_commands` and
 * the on-site agent picks it up on its next poll. So a control in this app is
 * always a *request*, and the UI has to say so, because the gap between asking
 * and the equipment moving is real and can be seconds.
 */

export type PlcTagRow = Database['public']['Views']['plc_live']['Row']
export type PlcCommandRow = Database['public']['Tables']['plc_commands']['Row']
export type PlcAgentRow = Database['public']['Views']['plc_agent_health']['Row']

/** The value of a tag, whichever of the three typed columns it landed in. */
export function plcValue(row: PlcTagRow): number | boolean | string | null {
  if (row.value_num != null) return Number(row.value_num)
  if (row.value_bool != null) return row.value_bool
  return row.value_text
}

/**
 * The value, whether or not the last poll succeeded.
 *
 * A failed read no longer blanks the gauge. The number stays, and how old it is
 * carries the warning — see plcValueAge. A dash tells an operator nothing; "72
 * PSI, four minutes ago" tells them the link is down AND what it was doing when
 * it went.
 */
export function plcDisplay(row: PlcTagRow): string {
  const v = plcValue(row)
  if (v == null) return row.quality === 'bad' ? '—' : 'never read'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'number') return `${round(v)}${row.unit ? ` ${row.unit}` : ''}`
  return v
}

function round(n: number): string {
  return Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(2)
}

/**
 * How old a reading is, in words.
 *
 * Prominent on purpose. A number from a PLC looks live whether it is two
 * seconds or two days old, and a stale one read as current is how somebody
 * concludes a pump is running when it stopped last night.
 */
export function plcAge(seconds: number | null): string {
  if (seconds == null) return 'never'
  if (seconds < 10) return 'just now'
  if (seconds < 90) return `${Math.round(seconds)}s ago`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} days ago`
}

/**
 * How old the value on screen is, in seconds.
 *
 * Deliberately NOT the age of the last attempt. If the link died four minutes
 * ago, the reading is four minutes old however many times the agent has tried
 * since, and it is the reading's age a person needs.
 */
export function plcValueAge(row: PlcTagRow): number | null {
  return row.value_age_seconds ?? row.age_seconds
}

/**
 * Which pump record sits behind each PLC turbine, and what it feeds.
 *
 * The panel calls them pump1 and pump2; the farm calls them North and South and
 * knows their horsepower and their fields. The join lives in a database column
 * rather than in code, so a mapping that turns out to be backwards is one row
 * edit and not a deploy.
 */
export function usePlcTurbines() {
  return useQuery({
    queryKey: ['plc_turbine_fields'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('plc_turbine_fields').select('*')
      if (error) throw error
      return data
    },
  })
}

/** Every tag with its latest value. Polled, because that is what it is. */
export function usePlcTags() {
  return useQuery({
    queryKey: ['plc_live'],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('plc_live').select('*').order('tag')
      if (error) throw error
      return data
    },
  })
}

/**
 * The agents, with the age of each heartbeat measured by the database.
 *
 * Not by the browser: "has the agent gone quiet" is a question about elapsed
 * time, and a phone with a wrong clock answers it wrongly in both directions —
 * a live agent read as silent, or a silent one read as live.
 */
export function usePlcAgents() {
  return useQuery({
    queryKey: ['plc_agent_health'],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('plc_agent_health').select('*')
      if (error) throw error
      return data
    },
  })
}

/** Recent write requests, so an operator can see what happened to theirs. */
export function usePlcCommands(limit = 10) {
  return useQuery({
    queryKey: ['plc_commands', limit],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plc_commands')
        .select('*')
        .order('requested_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data
    },
  })
}

/**
 * Ask the agent to write a value.
 *
 * The expiry is the safety property, and it is short deliberately. A command
 * queued while the agent is unreachable must not fire when it comes back —
 * whoever asked has long since done something else, and equipment moving on a
 * request nobody remembers making is the thing this design exists to prevent.
 */
export function useQueuePlcWrite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      deviceId,
      tag,
      value,
      reason,
      expiresInMinutes = 10,
    }: {
      deviceId: string
      tag: string
      value: number | boolean | string
      reason?: string
      expiresInMinutes?: number
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      const { error } = await supabase.from('plc_commands').insert({
        device_id: deviceId,
        tag,
        value_num: typeof value === 'number' ? value : null,
        value_bool: typeof value === 'boolean' ? value : null,
        value_text: typeof value === 'string' ? value : null,
        reason: reason ?? null,
        requested_by: user.id,
        expires_at: new Date(Date.now() + expiresInMinutes * 60_000).toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plc_commands'] }),
  })
}

/** A tag's stored samples, for a trend. */
export function usePlcHistory(tag: string, hours = 24) {
  return useQuery({
    queryKey: ['plc_history', tag, hours],
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - hours * 3600_000).toISOString()
      const { data, error } = await supabase
        .from('plc_reading_history')
        .select('read_at, value_num')
        .eq('tag', tag)
        .gte('read_at', since)
        .order('read_at')
      if (error) throw error
      return (data ?? []).map((r) => ({
        at: new Date(r.read_at as string).getTime(),
        value: r.value_num == null ? null : Number(r.value_num),
      }))
    },
  })
}

export type PlcAlarm = {
  tag: string
  label: string
  raisedAt: Date
  /** Null while still active. */
  clearedAt: Date | null
  /** How many times this alarm raised inside the run. */
  count: number
  /** The last raise in a collapsed run, when count > 1. */
  lastRaisedAt: Date
}

/**
 * The alarm log, rebuilt from stored readings.
 *
 * The panel keeps its own log, and it is awkward to read over Modbus. It does
 * not need to be: the agent only writes a history row when a value CHANGES, so
 * a `true` row is the moment an alarm raised and the next `false` is the moment
 * it cleared. That is the log, with better timestamps than the panel's, and it
 * arrives here in time to raise a notification.
 *
 * Repeats collapse. Four "failed to run" entries inside ninety minutes is one
 * pump trying four times, and listing them separately — which is what the panel
 * does — reads like four separate faults.
 */
export function usePlcAlarmLog(labels: Record<string, string>, withinMinutes = 180) {
  const tags = Object.keys(labels)
  return useQuery({
    queryKey: ['plc_alarms', tags.join(','), withinMinutes],
    refetchInterval: 60_000,
    enabled: tags.length > 0,
    queryFn: async (): Promise<PlcAlarm[]> => {
      const { data, error } = await supabase
        .from('plc_reading_history')
        .select('tag, value_bool, read_at')
        .in('tag', tags)
        .order('read_at', { ascending: true })
        .limit(2000)
      if (error) throw error

      const out: PlcAlarm[] = []
      const open = new Map<string, PlcAlarm>()
      for (const row of (data ?? []) as { tag: string; value_bool: boolean | null; read_at: string }[]) {
        const at = new Date(row.read_at)
        const live = open.get(row.tag)
        if (row.value_bool === true) {
          // A re-raise soon after the last one is the same episode, not a new
          // fault — the pump retrying.
          const recent = out.find(
            (a) => a.tag === row.tag && at.getTime() - a.lastRaisedAt.getTime() < withinMinutes * 60_000,
          )
          if (recent && recent.clearedAt) {
            recent.count += 1
            recent.lastRaisedAt = at
            recent.clearedAt = null
            open.set(row.tag, recent)
          } else if (!live) {
            const alarm: PlcAlarm = {
              tag: row.tag,
              label: labels[row.tag] ?? row.tag,
              raisedAt: at,
              lastRaisedAt: at,
              clearedAt: null,
              count: 1,
            }
            out.unshift(alarm)
            open.set(row.tag, alarm)
          }
        } else if (row.value_bool === false && live) {
          live.clearedAt = at
          open.delete(row.tag)
        }
      }
      return out.sort((a, b) => b.lastRaisedAt.getTime() - a.lastRaisedAt.getTime())
    },
  })
}

export function useCancelPlcCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('plc_commands').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plc_commands'] }),
  })
}

export type PlcLineRow = Database['public']['Views']['plc_line_integrity']['Row']

/**
 * Whether each line holds water when nobody is asking for any.
 *
 * The verdict is computed in the database rather than here because the raw
 * material is six days of history, which is not something to ship to a phone to
 * work out one word. See the migration for why pressure and the line-full bit
 * are the signals and flow is not: the meter reads 0 with a pivot watering.
 */
export function usePlcLineIntegrity() {
  return useQuery({
    queryKey: ['plc_line_integrity'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('plc_line_integrity').select('*').order('plc_pump')
      if (error) throw error
      return data
    },
  })
}

/**
 * Silence a line we already know leaks.
 *
 * Muting is per turbine and carries a reason, because "why is this alarm off"
 * is the question somebody asks a year later when the pipeline has been fixed
 * and nobody remembers turning it back on.
 */
export function useSetLineMute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pump, muted, reason }: { pump: number; muted: boolean; reason?: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      const { error } = await supabase
        .from('plc_line_watch')
        .update({
          muted,
          muted_reason: muted ? (reason ?? null) : null,
          muted_by: muted ? user.id : null,
          muted_at: muted ? new Date().toISOString() : null,
        })
        .eq('plc_pump', pump)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plc_line_integrity'] }),
  })
}

/**
 * Start a turbine in one press: AUTO, and a line fill behind it if the line is
 * empty.
 *
 * The two writes go in as separate rows one second apart rather than as one
 * command, and that ordering is load-bearing. The panel's fill rung is gated on
 * the AUTO bit — `ANDN line_full AND auto AND start_fill` — so a fill press that
 * arrives before AUTO has landed does nothing at all, silently. The agent takes
 * pending commands in requested_at order and runs them strictly in sequence,
 * pulsing and releasing each one, so a second of separation is far more than the
 * few milliseconds a Twido scan needs.
 *
 * Nothing here decides when to STOP filling. The panel does that itself: once
 * pressure holds above the latch setting the line-full bit sets, which drops the
 * fill and hands over to pressure control. That is why this is safe to automate
 * and why it is only ever two button presses, never a supervised sequence.
 */
export function useStartTurbine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      deviceId,
      pump,
      fillFirst,
      expiresInMinutes = 10,
    }: {
      deviceId: string
      pump: number
      fillFirst: boolean
      expiresInMinutes?: number
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      const expires = new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
      const press = async (tag: string, reason: string) => {
        const { error } = await supabase.from('plc_commands').insert({
          device_id: deviceId,
          tag,
          value_bool: true,
          reason,
          requested_by: user.id,
          expires_at: expires,
        })
        if (error) throw error
      }

      // Two separate inserts, awaited in turn, so the rows carry two different
      // server timestamps and the agent cannot take them in the wrong order.
      // A single multi-row insert would stamp both with the same now().
      await press(`pump${pump}.pb_auto`, 'One-press start: into AUTO')
      if (!fillFirst) return

      try {
        await press(`pump${pump}.fill_start`, 'One-press start: line was empty, filling')
      } catch (cause) {
        // The half-done state is inert, which is why this is only a message and
        // not a rollback. The panel will not run on AUTO alone with an empty
        // line — its run rung needs line-full or line-filling — so the turbine
        // sits there doing nothing until somebody presses Start fill.
        throw new Error(
          `Turbine ${pump} was put into AUTO, but the line fill request did not go through, so it will not start yet. Press "Start fill" on the line fill panel.`,
          { cause },
        )
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plc_commands'] }),
  })
}
