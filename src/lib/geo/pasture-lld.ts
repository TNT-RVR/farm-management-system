import type { Geometry } from 'geojson'
import { reverseLld, type TownshipTable } from './ats'
import { pointInGeometry } from './point-in'

/**
 * The quarter sections a pasture's fence takes in, read off its shape on the
 * map (Sam, 23 Nov 2026: the LLD beside each pasture on the Pasture use
 * report). No pasture has its legal land typed anywhere, so it is worked out:
 * points every 100 m inside the boundary, each named by the township survey
 * lookup, and every quarter with at least 10 acres inside counted. The 10
 * acres keeps out the slivers a fence a few metres over a section line would
 * otherwise add.
 *
 * Same caveat as the lookup itself: it says which quarters the pasture is
 * on, not where their boundaries run.
 */

const STEP_M = 100
const ACRES_PER_SAMPLE = (STEP_M * STEP_M) / 4046.86
export const MIN_QUARTER_ACRES = 10
const M_PER_DEG_LAT = 111_132
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
const QUARTER_ORDER = ['NE', 'NW', 'SE', 'SW']

export type PastureQuarter = { quarter: string | null; section: number; township: number; range: number; meridian: number; acres: number }

function eachPosition(g: Geometry, f: (lng: number, lat: number) => void) {
  const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []
  for (const ring of rings) for (const [lng, lat] of ring) f(lng, lat)
}

export function pastureQuarters(g: Geometry | null | undefined, table: TownshipTable | null | undefined): PastureQuarter[] {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return []
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  eachPosition(g, (lng, lat) => {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  })
  if (!(north > south) || !(east > west)) return []
  const latStep = STEP_M / M_PER_DEG_LAT
  const lngStep = STEP_M / mPerDegLng((north + south) / 2)
  // A pasture is a few square miles at most; refuse anything absurd rather than hang.
  if (((north - south) / latStep) * ((east - west) / lngStep) > 200_000) return []
  const found = new Map<string, PastureQuarter>()
  // Sampled at cell centres, so each point stands for one 100 m square.
  for (let lat = south + latStep / 2; lat < north; lat += latStep) {
    for (let lng = west + lngStep / 2; lng < east; lng += lngStep) {
      if (!pointInGeometry([lng, lat], g)) continue
      const r = reverseLld({ lat, lng }, table)
      if (!r) continue
      const q = found.get(r.text)
      if (q) q.acres += ACRES_PER_SAMPLE
      else found.set(r.text, { ...r.parts, acres: ACRES_PER_SAMPLE })
    }
  }
  const all = [...found.values()]
  const kept = all.filter((q) => q.acres >= MIN_QUARTER_ACRES)
  // A pasture smaller than the cut-off still sits on somewhere: its biggest quarter.
  return kept.length ? kept : all.sort((a, b) => b.acres - a.acres).slice(0, 1)
}

/**
 * Quarters as they are written on a land title, grouped by section:
 * "NE, NW 12-40-26; SE 13-40-26 W4". A whole section is its number alone.
 */
export function formatQuarters(qs: PastureQuarter[]): string {
  if (!qs.length) return ''
  const bySection = new Map<string, { s: PastureQuarter; quarters: string[] }>()
  for (const q of qs) {
    const key = `${q.section}-${q.township}-${q.range}-${q.meridian}`
    const entry = bySection.get(key) ?? { s: q, quarters: [] }
    if (q.quarter) entry.quarters.push(q.quarter)
    bySection.set(key, entry)
  }
  const sections = [...bySection.values()].sort((a, b) => a.s.meridian - b.s.meridian || a.s.township - b.s.township || a.s.range - b.s.range || a.s.section - b.s.section)
  const meridians = new Set(sections.map((x) => x.s.meridian))
  const parts = sections.map(({ s, quarters }) => {
    const body = `${s.section}-${s.township}-${s.range}${meridians.size > 1 ? `-W${s.meridian}` : ''}`
    const qq = [...new Set(quarters)].sort((a, b) => QUARTER_ORDER.indexOf(a) - QUARTER_ORDER.indexOf(b))
    return qq.length === 0 || qq.length === 4 ? body : `${qq.join(', ')} ${body}`
  })
  return `${parts.join('; ')}${meridians.size === 1 ? ` W${[...meridians][0]}` : ''}`
}
