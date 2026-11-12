import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { WaterTestValues } from './livestock-water'

/**
 * Water the herd drinks that somebody else already tests.
 *
 * A dugout holds what ran into it and the only way to know what is in one is
 * to send a sample away. A trough on a pipeline off the canal, or a pasture
 * drinking the river, is not like that: the district and the province sample
 * that water several times every season, and the irrigation side of this app
 * has read those results since September 2026 to work out the sulphur and
 * nitrate credit. So a pin marked as fed by the river or the canal is judged
 * off the same samples instead of waiting for a lab sheet that would say the
 * same thing.
 *
 * The numbers come from the livestock_water_district view, which is the
 * irrigation credit's own window and stations — May to September, the last
 * five seasons, the stations marked for_credit — so a figure quoted here and a
 * figure quoted under irrigation cannot drift apart.
 */
export type FedBy = 'oldman' | 'smrid'

export const FED_BY: { value: FedBy; label: string; short: string }[] = [
  { value: 'oldman', label: 'The Oldman River', short: 'Oldman River' },
  { value: 'smrid', label: 'The SMRID canal', short: 'SMRID canal' },
]

export const fedByLabel = (v: FedBy | null | undefined) => FED_BY.find((f) => f.value === v)?.short ?? null

/**
 * The parameters the view carries, which are the ones Alberta's livestock
 * chart reads and the monitoring happens to test. Everything else on the
 * chart — microcystin, manganese — a station does not measure, and the page
 * lists it as not judged rather than inventing it.
 */
export const DISTRICT_KEYS = [
  'tds_mg_l',
  'so4_mg_l',
  'no3n_mg_l',
  'ph',
  'na_mg_l',
  'alkalinity_mg_l',
  'hardness_mg_l',
  'fe_mg_l',
  'cu_mg_l',
  'mo_mg_l',
  'se_mg_l',
  'f_mg_l',
] as const

export type DistrictWater = {
  water_source: FedBy
  samples: number
  stations: number
  station_names: string | null
  latest_sample: string | null
} & { [K in (typeof DISTRICT_KEYS)[number]]: number | null }

/** The medians as a sheet the chart can be run over. */
export function districtValues(row: DistrictWater): WaterTestValues {
  const out: WaterTestValues = {}
  for (const k of DISTRICT_KEYS) if (row[k] != null) out[k] = row[k]
  return out
}

/**
 * What a source's verdicts are read from, and where that came from.
 *
 * A lab sheet always beats the district. A sheet is this water — this dugout,
 * this trough — and the district median is the water upstream of it, so where
 * both exist the sheet is the better answer and the only honest one.
 */
export type Reading = {
  values: WaterTestValues
  from: 'lab' | 'district'
  /** The day the sample was drawn (a sheet), or the newest sample behind the median. */
  sampledOn: string | null
  fedBy: FedBy | null
  stationNames: string | null
  samples: number | null
}

export function readingFor(opts: {
  fedBy: FedBy | null | undefined
  test: WaterTestValues | null | undefined
  district: Map<FedBy, DistrictWater> | undefined
  /** A sheet's own date, which does not live in its chemistry. */
  sampledOn?: string | null
}): Reading | null {
  if (opts.test) {
    return { values: opts.test, from: 'lab', sampledOn: opts.sampledOn ?? null, fedBy: opts.fedBy ?? null, stationNames: null, samples: null }
  }
  const row = opts.fedBy ? opts.district?.get(opts.fedBy) : undefined
  if (!row) return null
  return {
    values: districtValues(row),
    from: 'district',
    sampledOn: row.latest_sample ? row.latest_sample.slice(0, 10) : null,
    fedBy: row.water_source,
    stationNames: row.station_names,
    samples: row.samples,
  }
}

/** The district rows, keyed by water source. Changes a few times a year. */
export function useDistrictWater() {
  return useQuery({
    queryKey: ['livestock-water-district'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('livestock_water_district').select('*')
      if (error) throw error
      const out = new Map<FedBy, DistrictWater>()
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const row = { ...r } as unknown as DistrictWater
        for (const k of DISTRICT_KEYS) row[k] = r[k] == null ? null : Number(r[k])
        row.samples = Number(r.samples ?? 0)
        row.stations = Number(r.stations ?? 0)
        out.set(row.water_source, row)
      }
      return out
    },
  })
}
