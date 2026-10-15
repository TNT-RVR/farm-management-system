/**
 * The reservoirs and snowpacks that decide this farm's water, in the two
 * systems it draws from (Sam, 30 Sep 2026):
 *
 *   Oldman River (the licences on the river): the Oldman Reservoir, and the
 *   Gardiner Creek and South Racehorse Creek snow pillows above it.
 *
 *   Canals (SMRID): St. Mary, Milk River Ridge and Chin reservoirs, and the
 *   two snowpacks SMRID reports on — Many Glacier (the early water, melting
 *   from about April 1) and Flat Top Mountain (the late water, not melting
 *   until about May 1). Waterton Reservoir is left out: it doesn't matter here.
 *
 * Used by the daily history job (netlify/functions/water-daily-*) and by the
 * rotation's Season ahead panel, so both read one list.
 */
export type WaterStation = {
  key: string
  name: string
  kind: 'reservoir' | 'snow'
  section: 'oldman' | 'canals'
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

const ab = (station: string) => `https://rivers.alberta.ca/ — search station ${station}`
const wiskiData = (tsId: string) => `https://rivers.alberta.ca/WiskiLiveDataService/Download?tsId=${tsId}&filename=data&zip=false&json=true`
const snotelPage = (id: string) => `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${id}`
const snotelData = (triplet: string) => `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=${triplet}&elements=WTEQ&duration=DAILY&centralTendencyType=MEDIAN`

export const WATER_STATIONS: WaterStation[] = [
  { key: '05AA032', name: 'Oldman River Reservoir', kind: 'reservoir', section: 'oldman', source: 'wiski', tsId: '248017042', unit: '%', pageUrl: ab('05AA032'), dataUrl: wiskiData('248017042') },
  { key: '05AA809', name: 'Gardiner Creek snowpack', kind: 'snow', section: 'oldman', source: 'wiski', tsId: '235384042', unit: 'mm', pageUrl: ab('05AA809'), dataUrl: wiskiData('235384042') },
  { key: '05AA817', name: 'South Racehorse Creek snowpack', kind: 'snow', section: 'oldman', source: 'wiski', tsId: '235433042', unit: 'mm', pageUrl: ab('05AA817'), dataUrl: wiskiData('235433042') },
  { key: '05AE025', name: 'St. Mary Reservoir', kind: 'reservoir', section: 'canals', source: 'wiski', tsId: '248122042', unit: '%', pageUrl: ab('05AE025'), dataUrl: wiskiData('248122042') },
  { key: '05AF030', name: 'Milk River Ridge Reservoir', kind: 'reservoir', section: 'canals', source: 'wiski', tsId: '248150042', unit: '%', pageUrl: ab('05AF030'), dataUrl: wiskiData('248150042') },
  { key: '05AG901', name: 'Chin Reservoir', kind: 'reservoir', section: 'canals', source: 'wiski', tsId: '296888042', unit: '%', pageUrl: ab('05AG901'), dataUrl: wiskiData('296888042') },
  { key: '613:MT:SNTL', name: 'Many Glacier snowpack', kind: 'snow', section: 'canals', source: 'snotel', triplet: '613:MT:SNTL', unit: 'mm', note: 'early water — melting from about April 1', pageUrl: snotelPage('613'), dataUrl: snotelData('613:MT:SNTL') },
  { key: '482:MT:SNTL', name: 'Flat Top Mountain snowpack', kind: 'snow', section: 'canals', source: 'snotel', triplet: '482:MT:SNTL', unit: 'mm', note: 'late water — melting from about May 1', pageUrl: snotelPage('482'), dataUrl: snotelData('482:MT:SNTL') },
]

export const SECTION_LABEL = { oldman: 'Oldman River — the river licences', canals: 'Canals — SMRID' } as const

/** Pretty page link: the Alberta map has no per-station address, so it opens the map. */
export const pageHref = (s: WaterStation) => (s.source === 'wiski' ? 'https://rivers.alberta.ca/' : s.pageUrl)
