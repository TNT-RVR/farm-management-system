import type { SoilReport, SoilSampleRow } from '@/lib/soilTests'

/** How the two sampled depths are combined onto the chart. */
export type DepthMode = 'top' | 'sub' | 'both' | 'average'

export const DEPTH_MODES: { id: DepthMode; label: string; hint: string }[] = [
  { id: 'top', label: '0–6″', hint: 'Topsoil only — where P, K and the micros sit' },
  { id: 'sub', label: '6–24″', hint: 'Subsoil only — nitrate and sulphate reach here' },
  { id: 'both', label: 'Both', hint: 'One line per depth, so the two can be compared' },
  { id: 'average', label: 'Average', hint: 'The two depths averaged into one line' },
]

export type HistoryPoint = {
  year: number
  crop: string | null
  /** `${nutrientKey}` or `${nutrientKey}__top` / `__sub` when split by depth. */
  [series: string]: number | string | null
}

const isTop = (s: SoilSampleRow) => s.depth_top_in === 0

function mean(vals: number[]) {
  return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null
}

function pick(samples: SoilSampleRow[], key: string) {
  return samples
    .map((s) => (s as unknown as Record<string, number | null>)[key])
    .filter((v): v is number => v != null && Number.isFinite(v))
}

/** Series keys a mode produces for one nutrient, and how to label them. */
export function seriesFor(key: string, mode: DepthMode): { id: string; suffix: string }[] {
  if (mode === 'both') {
    return [
      { id: `${key}__top`, suffix: ' 0–6″' },
      { id: `${key}__sub`, suffix: ' 6–24″' },
    ]
  }
  return [{ id: key, suffix: '' }]
}

/**
 * One row per crop year, with a value per selected nutrient.
 *
 * Averaging is across the field's sample SITES, which is what makes years
 * comparable — the number of cores taken has varied between reports, so a sum
 * would move with sampling effort rather than with the soil.
 *
 * A year the lab did not run a test for reports null rather than zero. Charting
 * a missing micronutrient panel as zero would draw a cliff to the floor and
 * read as a collapse in fertility that never happened, which is the single
 * easiest way to make this graph lie.
 */
export function buildHistory(
  reports: SoilReport[],
  nutrients: string[],
  mode: DepthMode,
  years?: { from: number; to: number },
): HistoryPoint[] {
  const byYear = new Map<number, SoilReport[]>()
  for (const r of reports) {
    if (years && (r.crop_year < years.from || r.crop_year > years.to)) continue
    if (!byYear.has(r.crop_year)) byYear.set(r.crop_year, [])
    byYear.get(r.crop_year)!.push(r)
  }

  const out: HistoryPoint[] = []
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    // A field sampled in halves has two reports for the year; pooling their
    // samples averages the halves, which is the field-level figure wanted here.
    const samples = byYear.get(year)!.flatMap((r) => r.samples)
    const crop = byYear.get(year)!.map((r) => r.crop_label).find(Boolean) ?? null
    const row: HistoryPoint = { year, crop }

    for (const key of nutrients) {
      if (mode === 'both') {
        row[`${key}__top`] = mean(pick(samples.filter(isTop), key))
        row[`${key}__sub`] = mean(pick(samples.filter((s) => !isTop(s)), key))
      } else if (mode === 'top') {
        row[key] = mean(pick(samples.filter(isTop), key))
      } else if (mode === 'sub') {
        row[key] = mean(pick(samples.filter((s) => !isTop(s)), key))
      } else {
        // Average the two DEPTH means rather than every core, so a year with
        // four topsoil samples and two subsoil ones is not pulled toward the
        // surface by the extra cores.
        const top = mean(pick(samples.filter(isTop), key))
        const sub = mean(pick(samples.filter((s) => !isTop(s)), key))
        const both = [top, sub].filter((v): v is number => v != null)
        row[key] = both.length ? both.reduce((a, c) => a + c, 0) / both.length : null
      }
    }
    out.push(row)
  }
  return out
}

/** The full span of years a field has tests for — the default range. */
export function yearSpan(reports: SoilReport[]) {
  const years = reports.map((r) => r.crop_year)
  return years.length ? { from: Math.min(...years), to: Math.max(...years) } : null
}

/** Nutrients this field actually has data for, so the picker offers no dead options. */
export function availableNutrients(reports: SoilReport[], candidates: string[]) {
  const all = reports.flatMap((r) => r.samples)
  return candidates.filter((key) => pick(all, key).length > 0)
}
