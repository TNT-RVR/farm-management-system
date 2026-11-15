// The nearest real rain gauge's season total, for reading beside the gridded
// figure the forage model plans on.
//
// Why both numbers belong on screen (Sam, 12 Nov 2026: "show both").
//
// The model runs on Open-Meteo, and has to. What it computes is a ratio — this
// season over a 30-year normal — and both halves must come off one instrument,
// or the instrument's own offset is read as weather. Our gauge records cannot
// supply the bottom half: weather_daily holds one or two ACIS seasons per
// station, every day of 2025 is Open-Meteo at all three, and East Ranch starts
// in 2026. Upstream ACIS begins in 2005 at Home Ranch and Westfield, which is
// twenty-one years, and has nothing at all for East Ranch. The offset is not
// even consistent in sign: over 2024 Open-Meteo ran 7.5% above the Home Ranch
// gauge and 8% below Westfield's, so there is nothing to correct for either.
//
// But a reanalysis grid cell cannot see where the rain actually fell. Over the
// 2026 season the three ACIS gauges spread 93 mm — Westfield 373, Home Ranch
// 353, East Ranch 281 — while Open-Meteo put those same three points within
// 12 mm of each other (396 / 385 / 387), on 84 wet days against the gauges' 47.
// At East Ranch that gap is the difference between 131% of a normal season and
// 95%: a wet year against an ordinary one, over 2,923 grazeable acres.
//
// So the gauge does not drive anything. It sits beside the figure that does,
// and says so loudly when the two part company.
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type GaugeStation = { id: string; name: string; lat: number; lon: number }

/**
 * Two instruments more than this far apart are not measuring the same weather,
 * and the screen stops being quiet about it.
 *
 * 15% clears the ordinary disagreement between a point gauge and a grid cell
 * (Home Ranch ran 8% under in 2026, Westfield 6%) and catches the kind that
 * changes a decision (East Ranch, 27% under).
 */
export const GAUGE_GAP_FLAG = 0.15

/**
 * A season total is only comparable if nearly all of its days are there. A
 * gauge with a fortnight missing always reads low, and a low total is exactly
 * what a drought looks like — the same 90% rule the rain normals use.
 */
const MIN_COVERAGE = 0.9

/** Degrees to km at this latitude, as dry-down's station picker does it. */
export function nearestStation(
  stations: GaugeStation[],
  lat: number,
  lon: number,
): (GaugeStation & { km: number }) | null {
  let best: (GaugeStation & { km: number }) | null = null
  for (const s of stations) {
    const km = Math.hypot((s.lon - lon) * 71.6, (s.lat - lat) * 111.1)
    if (!best || km < best.km) best = { ...s, km }
  }
  return best
}

/** Calendar days from `start` to `end`, both counted. */
export function daysInWindow(start: string, end: string): number {
  const a = Date.parse(start + 'T00:00:00Z')
  const b = Date.parse(end + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0
  return Math.round((b - a) / 86_400_000) + 1
}

/**
 * How far the gauge sits from the gridded total, as a fraction of the grid —
 * negative when the gauge is the drier of the two. Null when there is no grid
 * total to compare against, so nothing is claimed.
 */
export function gaugeGap(gaugeMm: number, gridMm: number | null | undefined): number | null {
  if (gridMm == null || !(gridMm > 0) || !Number.isFinite(gaugeMm)) return null
  return (gaugeMm - gridMm) / gridMm
}

export type RanchGauge = {
  /** The station the total came from, and how far it is from the ranch. */
  station: string
  km: number
  /** Measured total over the same window the model's figure covers. */
  mm: number
  /** Gauge days found, against the days in the window. */
  days: number
  expected: number
}

type GaugeRow = { date: string; precip_mm: number | null }

/**
 * The gauge's own total for a window, from the ACIS rows only.
 *
 * Source matters more than it looks: weather_daily is a patchwork, ACIS where
 * a real station reported and Open-Meteo filling the rest, and the splices
 * land near the season edge (31 Oct 2024, 10 Nov 2026). Summing the column
 * without filtering would compare Open-Meteo against itself and always agree.
 */
export function gaugeTotal(rows: GaugeRow[]): { mm: number; days: number } {
  let mm = 0
  let days = 0
  for (const r of rows) {
    if (r.precip_mm == null) continue
    mm += Number(r.precip_mm)
    days++
  }
  return { mm: Math.round(mm * 10) / 10, days }
}

/** Enough of the window measured to be worth showing. */
export function gaugeUsable(g: Pick<RanchGauge, 'days' | 'expected'>): boolean {
  return g.expected > 0 && g.days >= g.expected * MIN_COVERAGE
}

/**
 * The nearest gauge's total over the same window the grid figure covers, or
 * null when there is no station near enough with the days to back it.
 *
 * `through` is the model's own last measured day, so the two totals cover the
 * same ground; passing anything else would turn an instrument comparison into
 * a calendar one.
 */
export function useRanchGauge(
  ranch: { id: string; latitude: number | null; longitude: number | null; precip_start_month: number } | null | undefined,
  through: string | null | undefined,
) {
  const lat = ranch?.latitude ?? null
  const lon = ranch?.longitude ?? null
  const start = ranch ? `${(through ?? '').slice(0, 4)}-${String(ranch.precip_start_month).padStart(2, '0')}-01` : null
  const ready = Boolean(lat != null && lon != null && through && start && start.length === 10 && !start.startsWith('-'))
  return useQuery({
    queryKey: ['ranch_gauge', ranch?.id, start, through],
    enabled: ready,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<RanchGauge | null> => {
      const { data: st, error: stErr } = await supabase.from('weather_stations').select('id, name, lat, lon, active')
      if (stErr) throw stErr
      const stations: GaugeStation[] = (st ?? [])
        .filter((s) => s.active !== false && s.lat != null && s.lon != null)
        .map((s) => ({ id: s.id as string, name: s.name as string, lat: Number(s.lat), lon: Number(s.lon) }))
      const near = nearestStation(stations, lat!, lon!)
      if (!near) return null
      // One station's season is ~214 rows. The explicit limit is there so a
      // fourth station or a longer window fails visibly rather than being
      // trimmed to PostgREST's own 1,000 without a word.
      const { data, error } = await supabase
        .from('weather_daily')
        .select('date, precip_mm')
        .eq('station_id', near.id)
        .eq('source', 'acis')
        .gte('date', start!)
        .lte('date', through!)
        .order('date')
        .limit(400)
      if (error) throw error
      const { mm, days } = gaugeTotal((data ?? []) as GaugeRow[])
      const g: RanchGauge = {
        station: near.name,
        km: Math.round(near.km * 10) / 10,
        mm,
        days,
        expected: daysInWindow(start!, through!),
      }
      return gaugeUsable(g) ? g : null
    },
  })
}
