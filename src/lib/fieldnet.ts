import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type FieldnetSystem = Database['public']['Tables']['fieldnet_systems']['Row']

async function authedFetch(path: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body
}

/** Live pivot/lateral status pulled from FieldNET (read-only). */
export function useFieldnetSystems() {
  return useQuery({
    queryKey: ['fieldnet_systems'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fieldnet_systems')
        .select('*')
        .order('name', { nullsFirst: false })
      if (error) throw error
      return data
    },
  })
}

export type FieldnetHistoryEvent = {
  timestamp: string
  status: string | null
  direction: string | null
  is_irrigating: boolean | null
  plan: string | null
  position: number | null
  pressure: number | null
}

/** Recent status-change activity for a pivot (from FieldNET history). */
export function useFieldnetHistory(fieldnetId: string | null | undefined) {
  return useQuery({
    queryKey: ['fieldnet_history', fieldnetId],
    enabled: Boolean(fieldnetId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch(`/api/fieldnet-history?id=${fieldnetId}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as {
        events?: FieldnetHistoryEvent[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      return body.events ?? []
    },
  })
}

/** Manually (re)link a FieldNET system to one of our fields (manager only). */
export function useSetFieldnetLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, field_id }: { id: string; field_id: string | null }) => {
      const { error } = await supabase.from('fieldnet_systems').update({ field_id }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['fieldnet_systems'] }),
  })
}

export type FieldnetCapabilities = {
  policies: { policy: string; grants: string | null }[]
  capabilities: {
    monitor: boolean
    appliedIrrigation: boolean
    plans: boolean
    endgunTables: boolean
    advisor: boolean
    satelliteImagery: boolean
    remoteStartStop: boolean
  }
  remoteControlNote: string
}

/**
 * Which FieldNET policies Lindsay has actually granted our app, read live.
 * Managers only. Worth showing rather than hardcoding — the granted set changes
 * on Lindsay's side, not ours.
 */
export function useFieldnetCapabilities(enabled: boolean) {
  return useQuery({
    queryKey: ['fieldnet_capabilities'],
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: () => authedFetch('/api/fieldnet-control') as Promise<FieldnetCapabilities>,
  })
}

export type FieldnetProbeResult = {
  pivot: { id: string; name: string | null; operational_status: string | null }
  note: string
  verdict: { field: string; why: string; status: number; differsFromUnknownField: boolean }[]
  raw: { field: string; why: string; status: number; response: unknown }[]
}

/**
 * Ask FieldNET whether the panel PATCH accepts direction/speed/service_stop.
 * Sends only type-invalid values, so it cannot actuate anything — see the
 * PROBES table in netlify/functions/fieldnet-control.mts.
 */
export function useFieldnetProbe() {
  return useMutation({
    mutationFn: (equipmentId: string) =>
      authedFetch('/api/fieldnet-control', {
        method: 'POST',
        body: JSON.stringify({ action: 'probe', equipmentId }),
      }) as Promise<FieldnetProbeResult>,
  })
}

/** Start FieldNET OAuth — returns the authorize URL to redirect the browser to. */
/** `from: 'setup'` brings the sign-in back to Farm setup's keys card instead of Integrations. */
export async function fieldnetConnect(from?: 'setup'): Promise<string> {
  const body = (await authedFetch(`/api/fieldnet-connect${from ? `?from=${from}` : ''}`)) as { authorizeUrl: string }
  return body.authorizeUrl
}

export function useFieldnetSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => authedFetch('/api/fieldnet-sync', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] })
      void queryClient.invalidateQueries({ queryKey: ['fieldnet_systems'] })
      void queryClient.invalidateQueries({ queryKey: ['irrigation_events'] })
    },
  })
}

/** field_id → its live FieldNET system (only systems linked to a field). */
export function useFieldnetByField() {
  const q = useFieldnetSystems()
  const map = new Map<string, FieldnetSystem>()
  for (const s of q.data ?? []) if (s.field_id) map.set(s.field_id, s)
  return { ...q, byField: map }
}

export type FnStatus = 'fault' | 'on' | 'off' | 'disconnected'

// operational_status values that indicate a fault / alarm worth flagging red
// (mirrors FAULT_STATES in netlify/shared/fieldnet-sync-core.ts).
export const FN_FAULT_STATES = new Set<string>([
  'alignment-fault',
  'low-pressure',
  'high-pressure',
  'low-voltage',
  'high-voltage',
  'low-flow',
  'high-flow',
  'high-wind-speed',
  'hardware-fault',
  'position-fault',
  'end-gun-error',
  'span-cable-broken',
  'span-cable-tampering',
  'two-second-timer-fault',
  'forward-reverse-shutdown',
  'pressurization-shutdown',
  'high-flow-shutdown',
  'aux-low-flow-shutdown',
  'aux-high-flow-shutdown',
  'low-auxiliary-pressure',
  'high-auxiliary-pressure',
  'missing-plan-shutdown',
  'cable-error',
  'geofence-error',
  'gps-reverse-rotation-shutdown',
  'engine-start-shutdown',
  'cart-safety-shutdown',
])

export function fnIsFault(s: FieldnetSystem): boolean {
  return !!s.operational_status && FN_FAULT_STATES.has(s.operational_status)
}

/** Map-colour state: fault (alarm), on (water running), off (idle), disconnected. */
export function fnStatus(s: FieldnetSystem): FnStatus {
  // A fault/alarm shows red even if comms are flaky — it's the loud case.
  if (fnIsFault(s)) return 'fault'
  const c = s.comms_status
  // Anything other than a healthy "online"/"not-applicable" comm state → grey.
  if (c == null || (c !== 'online' && c !== 'not-applicable')) return 'disconnected'
  return s.is_water_on ? 'on' : 'off'
}

export const FN_STATUS_COLOR: Record<FnStatus, string> = {
  fault: '#ef4444', // red — fault / alarm / error
  on: '#3b82f6', // blue — pivot running / water on
  off: '#22c55e', // green — connected but off
  disconnected: '#94a3b8', // grey — no comms
}
export const FN_STATUS_LABEL: Record<FnStatus, string> = {
  fault: 'Fault',
  on: 'Running',
  off: 'Off',
  disconnected: 'Disconnected',
}

// FieldNET web app. Per-pivot deep-link path is TBD (awaiting a sample URL from
// a real pivot); for now this opens the app, overridable once the path is known.
const FIELDNET_APP_BASE = 'https://nextgen.myfieldnet.com'
export function fieldnetAppUrl(s?: FieldnetSystem): string {
  void s // per-pivot deep-link path TBD (awaiting a sample URL); opens the app for now
  return `${FIELDNET_APP_BASE}/`
}

/** Typed view over the raw controller payload (pivot_angle, service_stop, …). */
export function fnRaw(s: FieldnetSystem): Record<string, unknown> {
  return (s.raw && typeof s.raw === 'object' ? s.raw : {}) as Record<string, unknown>
}
export const fnNum = (s: FieldnetSystem, key: string): number | null => {
  const v = fnRaw(s)[key]
  return typeof v === 'number' ? v : null
}
export const fnBool = (s: FieldnetSystem, key: string): boolean | null => {
  const v = fnRaw(s)[key]
  return typeof v === 'boolean' ? v : null
}
export const fnStr = (s: FieldnetSystem, key: string): string | null => {
  const v = fnRaw(s)[key]
  return typeof v === 'string' && v ? v : null
}

/** Motion summary for a system, e.g. "Running · forward · 62%". */
export function fieldnetMotion(s: FieldnetSystem): string {
  if (s.comms_status && s.comms_status !== 'online' && s.comms_status !== 'not-applicable') {
    return s.comms_status === 'offline' ? 'Offline' : 'Comms unreliable'
  }
  const dir = s.operational_status ?? s.direction ?? null
  const moving = dir && dir !== 'stopped'
  const parts: string[] = []
  parts.push(s.is_water_on ? 'Water on' : moving ? 'Dry moving' : 'Stopped')
  if (moving && dir) parts.push(dir.replace(/-/g, ' '))
  if (s.speed_pct != null && moving) parts.push(`${s.speed_pct}%`)
  return parts.join(' · ')
}
