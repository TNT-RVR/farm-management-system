import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { MultiPolygon, Position } from 'geojson'
import { locate } from './geo/point-in'
import { labelPointOf } from './geo/area'
import { useAllBoundaries, useAllFields } from './queries'

/**
 * The field the phone is standing in.
 *
 * Anything entered from a phone — a moisture test, a task, a note — can start
 * with the field underfoot filled in, rather than a dropdown of twenty-three
 * names worked through with a wet thumb. Boundaries are already drawn for
 * every field, so it is one lookup.
 *
 * ASKED FOR ONCE, KEPT FOR THE SESSION. The browser's permission prompt is the
 * expensive part, and a position a few minutes old is still the right field:
 * nobody crosses a section line between opening the form and saving it. A
 * fresh fix is taken when a form asks again after ten minutes.
 *
 * Never a guess from the shop. Past 500 m from any field it offers nothing,
 * because a wrong field pre-filled is worse than an empty box — it gets saved.
 */
type Fix = { at: number; lngLat: Position } | { at: number; error: string }

let fix: Fix | null = null
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

const FRESH_MS = 10 * 60_000

function refresh() {
  if (pending) return pending
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    fix = { at: Date.now(), error: 'no location on this device' }
    notify()
    return Promise.resolve()
  }
  pending = new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fix = { at: Date.now(), lngLat: [pos.coords.longitude, pos.coords.latitude] }
        pending = null
        notify()
        resolve()
      },
      (err) => {
        fix = { at: Date.now(), error: err.message || 'location refused' }
        pending = null
        notify()
        resolve()
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: FRESH_MS },
    )
  })
  return pending
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const snapshot = () => fix

export type Here = {
  /** The field underfoot, or the nearest one within 500 m. */
  fieldId: string | null
  fieldName: string | null
  /** True when actually inside the boundary rather than beside it. */
  inside: boolean
  distanceM: number
  lngLat: Position | null
  status: 'idle' | 'locating' | 'located' | 'nowhere' | 'error'
  error: string | null
  /** Ask the phone (again). Safe to call on every mount; it is throttled. */
  ask: () => void
}

/**
 * @param enabled  Whether to ask the phone at all. A form on a desktop in the
 *                 office should not put up a location prompt for a field pick.
 */
export function useHere(enabled = true): Here {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const { data: boundaries } = useAllBoundaries()
  const { data: fields } = useAllFields()

  // Asked for from an effect, not during render: it is a side effect with a
  // permission prompt on the end of it.
  useEffect(() => {
    if (!enabled) return
    const stale = !current || Date.now() - current.at > FRESH_MS
    if (stale && !pending) void refresh()
  }, [enabled, current])

  const shapes = useMemo(
    () =>
      (boundaries ?? [])
        .filter((b) => b.valid_to == null && b.geometry)
        .map((b) => {
          const shape = b.geometry as unknown as MultiPolygon
          return { item: b.field_id, shape, anchor: labelPointOf(shape) }
        }),
    [boundaries],
  )

  return useMemo<Here>(() => {
    const ask = () => void refresh()
    if (!enabled || !current) return { ...NOWHERE, status: enabled ? 'locating' : 'idle', ask }
    if ('error' in current) return { ...NOWHERE, status: 'error', error: current.error, ask }
    const hit = locate(current.lngLat, shapes)
    if (!hit) return { ...NOWHERE, status: 'nowhere', lngLat: current.lngLat, ask }
    const field = fields?.find((f) => f.id === hit.item)
    return {
      fieldId: hit.item,
      fieldName: field?.name ?? null,
      inside: hit.inside,
      distanceM: hit.distanceM,
      lngLat: current.lngLat,
      status: 'located',
      error: null,
      ask,
    }
  }, [enabled, current, shapes, fields])
}

const NOWHERE = {
  fieldId: null,
  fieldName: null,
  inside: false,
  distanceM: Infinity,
  lngLat: null,
  error: null,
} as const
