import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { binsQuery } from './bins'
import { cattleQuery } from './cattle'
import { chemicalSearchQuery } from './chemicals'
import { allCropZonesQuery } from './cropZones'
import { jdEquipmentQuery } from './equipment'
import { farmQuery, fieldPivotsQuery, soilProfilesQuery } from './irrigation'
import {
  allBoundariesQuery,
  allFieldsQuery,
  cropHistoryByYearQuery,
  cropInputsQuery,
  cropPlansQuery,
  cropPricesQuery,
  cropVarietiesQuery,
  cropsQuery,
  fieldsQuery,
  hailEventsQuery,
  usersQuery,
} from './queries'
import { binAirAlertsQuery, moistureTestsQuery } from './moisture-queries'
import { ranchesQuery } from './ranches'
import { contactsQuery } from './sales'
import { tasksQuery } from './tasks'

/**
 * Pulling the important things down on purpose, before you need them.
 *
 * Persisting the cache only keeps what has been opened, which is the wrong half
 * of the problem: you find out which record you wanted once you are already
 * standing in the field. This fetches the reference set outright, so "I have
 * driven out to Coulee and need the chemical label" works whether or not
 * anybody happened to open that screen this week.
 *
 * Reference data only, and deliberately. It is the part that is small, changes
 * slowly, and is worth having a day out of date rather than absent. Live
 * readings are excluded for the reason set out in offline.ts.
 *
 * Every entry is the SAME query definition the screen uses — imported, not
 * rewritten. The first cut of this file wrote its own fetches, and they were
 * subtly wrong in a way nothing could catch: a plain select('*') cached under
 * ['fields'], where the hook returns active fields only, in name order. Online
 * you would never see it. Offline, every field picker on the farm listed
 * archived fields in database order.
 */

type Warm = { label: string; key: readonly unknown[]; run: () => Promise<unknown> }

const entry = (
  label: string,
  q: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> },
): Warm => ({ label, key: q.queryKey, run: q.queryFn })

export function warmSet(cropYear: number): Warm[] {
  return [
    entry('Fields', fieldsQuery()),
    entry('Fields, including archived', allFieldsQuery()),
    entry('Field boundaries', allBoundariesQuery()),
    entry('Crops', cropsQuery()),
    entry('Crop varieties', cropVarietiesQuery()),
    entry(`Crop plan ${cropYear}`, cropPlansQuery(cropYear)),
    // The Crop Plan screen needs six queries and shows a spinner until it has
    // all of them, so a warm-up that stops at the plan itself leaves the page
    // loading for ever with no signal. Prices and inputs are what it was
    // missing; the rest of these are the same story on the dashboard, the
    // fields list and the irrigation setup tab.
    entry(`Crop prices ${cropYear}`, cropPricesQuery(cropYear)),
    entry(`Crop input costs ${cropYear}`, cropInputsQuery(cropYear)),
    entry(`Crop history ${cropYear}`, cropHistoryByYearQuery(cropYear)),
    entry(`Hail ${cropYear}`, hailEventsQuery(cropYear)),
    entry('Farm settings', farmQuery()),
    entry('Soil profiles', soilProfilesQuery()),
    entry('Crop zones', allCropZonesQuery()),
    entry('Chemical labels', chemicalSearchQuery('', '', 'any')),
    entry('Contacts', contactsQuery()),
    // jd_equipment, not the `equipment` table — there are two hooks called
    // useEquipment and the first warm-up picked the wrong one, so it cached
    // nought rows from an empty legacy table while the Equipment page read
    // eighty-four machines from the other. Offline it showed "0 machines",
    // which is what an empty table and an uncached query look like alike.
    entry('Equipment', jdEquipmentQuery(false)),
    entry('People', usersQuery()),
    entry('Pivots', fieldPivotsQuery()),
    entry('Tasks', tasksQuery()),
    // The Cattle page will not render at all without its ranches — it gates the
    // whole screen on them, so with no signal it sat on "Loading ranches…".
    entry('Ranches', ranchesQuery()),
    entry(`Moisture tests ${cropYear}`, moistureTestsQuery(cropYear)),
    entry('Bins needing air', binAirAlertsQuery()),
    entry('Cattle', cattleQuery(null)),
    entry('Bins', binsQuery()),
  ]
}

/**
 * Field boxes for the tile download, and the file paths to save.
 *
 * Read straight from the cache the warm-up has just filled, so this works
 * offline-to-offline: press save, and both lists come from what was fetched a
 * moment ago rather than from another round trip.
 */
export async function mapAndFileTargets(qc: QueryClient) {
  const boundaries = (qc.getQueryData(allBoundariesQuery().queryKey) ?? []) as {
    geometry?: unknown
  }[]
  const boxes: { w: number; s: number; e: number; n: number }[] = []
  for (const b of boundaries) {
    const box = bboxOf(b.geometry)
    if (box) boxes.push(box)
  }
  const { data: files } = await supabase
    .from('field_files')
    .select('storage_path, filename')
  return { boxes, files: files ?? [] }
}

/** Bounding box of a GeoJSON geometry, however deeply the rings are nested. */
function bboxOf(geom: unknown): { w: number; s: number; e: number; n: number } | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (v: unknown): void => {
    if (!Array.isArray(v)) return
    if (typeof v[0] === 'number' && typeof v[1] === 'number') {
      const [lon, lat] = v as [number, number]
      if (lon < w) w = lon
      if (lon > e) e = lon
      if (lat < s) s = lat
      if (lat > n) n = lat
      return
    }
    for (const c of v) walk(c)
  }
  walk((geom as { coordinates?: unknown } | null)?.coordinates)
  return Number.isFinite(w) ? { w, s, e, n } : null
}

export type WarmProgress = { done: number; total: number; label: string; failed: string[] }

/**
 * Runs the set, reporting as it goes.
 *
 * One at a time rather than all at once: this gets run on a phone on whatever
 * signal the yard has, and a dozen parallel requests on two bars is slower than
 * a dozen in a row as well as being harder to report honestly. A failure is
 * collected and named rather than stopping the rest — eleven of twelve is worth
 * having, and knowing which one is missing is worth more than "it failed".
 */
export async function warmOffline(
  qc: QueryClient,
  cropYear: number,
  onProgress?: (p: WarmProgress) => void,
): Promise<WarmProgress> {
  const set = warmSet(cropYear)
  const failed: string[] = []
  let done = 0
  for (const item of set) {
    onProgress?.({ done, total: set.length, label: item.label, failed: [...failed] })
    try {
      await qc.fetchQuery({ queryKey: item.key, queryFn: item.run, staleTime: 0 })
    } catch {
      failed.push(item.label)
    }
    done += 1
  }
  const final = { done, total: set.length, label: '', failed }
  onProgress?.(final)
  return final
}
