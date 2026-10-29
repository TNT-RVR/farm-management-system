/**
 * The reservoirs and snowpacks that decide the farm's water, in the two
 * systems a farm can draw from: its river (the licences on the river) and
 * its irrigation district's canals.
 *
 * Each farm keeps its own list in water_supply_stations, edited on the Season
 * ahead panel (Sam, 27 Oct 2026; until then this farm's eight were built in
 * here). This farm's (30 Sep 2026): the Oldman Reservoir with the Gardiner
 * Creek and South Racehorse Creek snow pillows above it for the river; St.
 * Mary, Milk River Ridge and Chin reservoirs and SMRID's two snowpacks, Many
 * Glacier (early water) and Flat Top Mountain (late water), for the canals.
 *
 * Used by the daily history job (netlify/functions/water-daily-*) and by the
 * rotation's Season ahead panel, so both read one list.
 */
export type WaterStation = {
  key: string
  name: string
  kind: 'reservoir' | 'snow'
  section: 'river' | 'canals'
  source: 'wiski' | 'snotel'
  /** Alberta Rivers time-series id (reservoir % full, or snow water equivalent). */
  tsId?: string
  /** NRCS SNOTEL station triplet. */
  triplet?: string
  /** What the number is: % full, or mm of snow water equivalent. */
  unit: '%' | 'mm'
  note?: string
  /** Where a person can look at it. */
  pageUrl: string
  /** The feed the app reads. */
  dataUrl: string
}

/** A water_supply_stations row, as stored. */
export type WaterStationRow = {
  id: string
  key: string
  name: string
  kind: 'reservoir' | 'snow'
  section: 'river' | 'canals'
  source: 'wiski' | 'snotel'
  ts_id: string | null
  triplet: string | null
  note: string | null
  sort: number
}

export const STATION_COLUMNS = 'id, key, name, kind, section, source, ts_id, triplet, note, sort'

const ab = (station: string) => `https://rivers.alberta.ca/ — search station ${station}`
const wiskiData = (tsId: string) => `https://rivers.alberta.ca/WiskiLiveDataService/Download?tsId=${tsId}&filename=data&zip=false&json=true`
const snotelPage = (id: string) => `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${id}`
const snotelData = (triplet: string) => `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=${triplet}&elements=WTEQ&duration=DAILY&centralTendencyType=MEDIAN`

/** A stored row as the station the panel and the daily pull work with. */
export function stationOf(r: WaterStationRow): WaterStation {
  const unit = r.kind === 'reservoir' ? '%' : 'mm'
  const base = { key: r.key, name: r.name, kind: r.kind, section: r.section, unit, note: r.note ?? undefined } as const
  if (r.source === 'snotel') {
    const triplet = r.triplet ?? r.key
    return { ...base, source: 'snotel', triplet, pageUrl: snotelPage(triplet.split(':')[0]), dataUrl: snotelData(triplet) }
  }
  const tsId = r.ts_id ?? ''
  return { ...base, source: 'wiski', tsId, pageUrl: ab(r.key), dataUrl: wiskiData(tsId) }
}

/** The heading over each system: the farm's river and district by name. */
export const sectionLabel = (section: WaterStation['section'], names: { river: string; district: string }) =>
  section === 'river' ? `${names.river} — the river licences` : `Canals — ${names.district}`

/** Pretty page link: the Alberta map has no per-station address, so it opens the map. */
export const pageHref = (s: WaterStation) => (s.source === 'wiski' ? 'https://rivers.alberta.ca/' : s.pageUrl)
