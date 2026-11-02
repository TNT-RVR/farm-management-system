/**
 * Canola bloom from the satellite: when a canola field starts to flower, and
 * when it is done.
 *
 * Worked out on nine canola field-seasons, 2024-26, against each field's first
 * fungicide (sprayed at roughly 20-50 % bloom):
 *
 * - Each satellite look gives the share of the field's clear pixels that are
 *   YELLOW — a plant, red high next to green, blue low next to green. The test
 *   itself runs in the satellite request (netlify/shared/sat-ingest.ts); this
 *   file decides what the shares mean.
 * - Flowering starts at 40 % yellow on one clear look. Five of seven fields
 *   called within a week of the spray; the two late ones were cloud gaps.
 * - It is over when the share falls below 10 % after flowering began: the
 *   petals drop and the canopy goes back to plain green, 1-2 weeks after the
 *   spray on every field.
 * - Three guards. Ripening pods go yellow in late August, so no new start is
 *   called past 1,150 degree days (15 August without a seeding date). Smoke the cloud mask lets through washes blue up and every
 *   pixel fails the test, so a look with blue over 0.08 is skipped rather than
 *   read as "not flowering". And a canopy just closing can pass the test for a
 *   look or two, so nothing is called before 450 degree days (base 5 C) from
 *   seeding — 6-Kellers 2025 read 69 % yellow at 404, two weeks before its
 *   spray. That gate is set from one field; seeding to the first fungicide ran
 *   575-900 degree days across the four fields with seeding records.
 */

export const BLOOM_START_FRACTION = 0.4
export const BLOOM_END_FRACTION = 0.1
/** Field mean blue reflectance above which a look is treated as hazy. */
export const HAZE_BLUE_MAX = 0.08
/** Degree days (base 5 C) from seeding before a yellow look counts. */
export const BLOOM_GDD_GATE = 450
/**
 * And after which a NEW start is not called. Ripening pods turn the field
 * yellow again in late August (90 %+ on 2026's fields at ~1,700 degree days),
 * which would read as flowering wherever the real bloom was hidden by cloud.
 * The latest first fungicide on record was at 900; 1,150 leaves room for a
 * late field. With no seeding date, 15 August stands in for it.
 */
export const BLOOM_GDD_LATEST = 1150
export const BLOOM_LATEST_DAY = '08-15'
export const GDD_BASE_C = 5
/** The months worth watching: June to August. Outside them nothing is called. */
export const WATCH_FROM_MONTH = 6
export const WATCH_TO_MONTH = 8

export type BloomStatus = 'waiting' | 'watching' | 'flowering' | 'over'

export type BloomLook = {
  sensedOn: string
  yellow: number | null
  blue: number | null
}

export type BloomState = {
  status: BloomStatus
  lastClearOn: string | null
  yellowNow: number | null
  startedOn: string | null
  peakFraction: number | null
  peakOn: string | null
  endedOn: string | null
}

/** A look that can be read: has a yellow share, is not hazy, and is in the watch months. */
export function usableLook(l: BloomLook): boolean {
  if (l.yellow == null) return false
  if (l.blue != null && l.blue > HAZE_BLUE_MAX) return false
  const m = Number(l.sensedOn.slice(5, 7))
  return m >= WATCH_FROM_MONTH && m <= WATCH_TO_MONTH
}

/** Degree days (base 5 C) accumulated on each date, from daily max/min. */
export function gddByDate(days: { date: string; tmax: number | null; tmin: number | null }[], from: string): Map<string, number> {
  const out = new Map<string, number>()
  let total = 0
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (d.date < from) continue
    if (d.tmax != null && d.tmin != null) total += Math.max(0, (d.tmax + d.tmin) / 2 - GDD_BASE_C)
    out.set(d.date, total)
  }
  return out
}

/** Degree days reached by `date`: the newest weather day on or before it. */
export function gddOn(gdd: Map<string, number>, date: string): number | null {
  let best: string | null = null
  for (const d of gdd.keys()) if (d <= date && (best == null || d > best)) best = d
  return best == null ? null : gdd.get(best)!
}

/**
 * The season so far, from every look in date order.
 *
 * `gddAt` gives the degree days on a date, or null when there is no seeding
 * date — then the gate is skipped rather than holding the field forever, and
 * the June-August window is the only guard.
 */
export function bloomState(looks: BloomLook[], gddAt: (date: string) => number | null, gddNow: number | null): BloomState {
  const usable = looks.filter(usableLook).sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
  const s: BloomState = {
    status: gddNow != null && gddNow < BLOOM_GDD_GATE ? 'waiting' : 'watching',
    lastClearOn: null,
    yellowNow: null,
    startedOn: null,
    peakFraction: null,
    peakOn: null,
    endedOn: null,
  }
  for (const l of usable) {
    const y = l.yellow!
    s.lastClearOn = l.sensedOn
    s.yellowNow = y
    const g = gddAt(l.sensedOn)
    const pastGate = g == null || g >= BLOOM_GDD_GATE
    const tooLate = g != null ? g > BLOOM_GDD_LATEST : l.sensedOn.slice(5) > BLOOM_LATEST_DAY
    if (!s.startedOn) {
      if (pastGate && !tooLate && y >= BLOOM_START_FRACTION) {
        s.startedOn = l.sensedOn
        s.status = 'flowering'
      }
    } else if (!s.endedOn && (y < BLOOM_END_FRACTION || tooLate)) {
      // Ripening pods turn yellow again in August; once over, it stays over.
      // A seed field whose rows flower in turn can stay yellow until the pods
      // take over, so the ripening cut-off ends it too.
      s.endedOn = l.sensedOn
      s.status = 'over'
    }
    if (s.startedOn && !s.endedOn && (s.peakFraction == null || y > s.peakFraction)) {
      s.peakFraction = y
      s.peakOn = l.sensedOn
    }
  }
  return s
}

export const BLOOM_LABEL: Record<BloomStatus, string> = {
  waiting: 'Too early to flower',
  watching: 'Watching for flowers',
  flowering: 'Flowering',
  over: 'Flowering over',
}
