/**
 * ACIS IMCIN AIMM climate-file parser — spec §3.1 + §15 "parsing resilience".
 * Verified against the real files at imcin.net/aimm/<Station><YY>.txt (2026-07).
 * The current home is agriculture.alberta.ca/acis/imcin/aimm/ — found 30 Sep
 * 2026 by watching where the AIMM desktop program downloads from. It carries
 * the CURRENT year, updated daily (the old imcin.net host stopped at 2024, so
 * the app had been running on modelled weather all season).
 *
 * Real header (fixed order):
 *   YEAR-<code>,MONTH,DAY,TMAXC,TMINC,WINDKM,PRECMM,RHMAX,RHMIN,SRKJD
 * where WINDKM = daily wind RUN (km/day) and SRKJD = solar radiation (kJ/m²/day).
 * We validate the header tokens on every run and throw (loud) rather than
 * mis-map columns, so the ingest caller falls back to Open-Meteo.
 *
 * NOTE: files are published per station per YEAR and lag (latest ≈ prior year),
 * so ACIS is the authoritative HISTORICAL source; Open-Meteo covers the current
 * season until that year's file exists (spec §3.4 precedence).
 */
export type AcisDailyRow = {
  date: string // YYYY-MM-DD
  tmax_c: number | null
  tmin_c: number | null
  rh_max: number | null
  rh_min: number | null
  wind_ms: number | null // converted from km/day wind run
  solar_mj: number | null // converted from kJ/m²/day
  precip_mm: number | null
}

export class AcisFormatError extends Error {}

// Header token → canonical field. YEAR column header carries a station suffix
// (e.g. "YEAR-387"), matched by prefix.
const TOKENS: Record<string, keyof AcisDailyRow | 'year' | 'month' | 'day'> = {
  month: 'month',
  day: 'day',
  tmaxc: 'tmax_c',
  tminc: 'tmin_c',
  windkm: 'wind_ms',
  precmm: 'precip_mm',
  rhmax: 'rh_max',
  rhmin: 'rh_min',
  srkjd: 'solar_mj',
}
// Every column the ET engine and balance depend on. Validated on each run so a
// changed layout fails loudly instead of silently mis-mapping (spec §15) —
// a dropped PRECMM would otherwise read as 0 mm of rain all season.
const REQUIRED = ['tmax_c', 'tmin_c', 'solar_mj', 'wind_ms', 'precip_mm'] as const

function num(v: string): number | null {
  const n = Number(v.trim())
  return v.trim() === '' || Number.isNaN(n) ? null : n
}

export function parseAcisClimateCsv(text: string): AcisDailyRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) throw new AcisFormatError('ACIS file has no data rows')

  // Map each header cell to a field (or year/month/day markers).
  type Col = keyof AcisDailyRow | 'year' | 'month' | 'day' | 'ignore'
  const header: Col[] = lines[0].split(',').map((h): Col => {
    const t = h.trim().toLowerCase()
    if (t.startsWith('year')) return 'year'
    return (TOKENS as Record<string, Col | undefined>)[t] ?? 'ignore'
  })
  if (!header.includes('year') || !header.includes('month') || !header.includes('day')) {
    throw new AcisFormatError('ACIS header missing YEAR/MONTH/DAY — file layout changed')
  }
  for (const req of REQUIRED) {
    if (!header.includes(req)) {
      throw new AcisFormatError(`ACIS header missing required column: ${req} — file layout changed`)
    }
  }

  const out: AcisDailyRow[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    let y = '',
      mo = '',
      da = ''
    const row: AcisDailyRow = {
      date: '',
      tmax_c: null,
      tmin_c: null,
      rh_max: null,
      rh_min: null,
      wind_ms: null,
      solar_mj: null,
      precip_mm: null,
    }
    header.forEach((field, i) => {
      const raw = cells[i] ?? ''
      if (field === 'ignore') return
      if (field === 'year') y = raw.trim()
      else if (field === 'month') mo = raw.trim()
      else if (field === 'day') da = raw.trim()
      else if (field === 'wind_ms') {
        const km = num(raw)
        row.wind_ms = km == null ? null : km / 86.4 // wind run km/day → mean m/s
      } else if (field === 'solar_mj') {
        const kj = num(raw)
        row.solar_mj = kj == null ? null : kj / 1000 // kJ/m²/day → MJ/m²/day
      } else {
        // remaining numeric columns (tmax_c, tmin_c, rh_max, rh_min, precip_mm)
        ;(row as unknown as Record<string, number | null>)[field] = num(raw)
      }
    })
    if (y && mo && da) {
      row.date = `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`
      out.push(row)
    }
  }
  if (out.length === 0) throw new AcisFormatError('ACIS file parsed to zero rows')
  return out
}

/** AIMM climate-file URL for a station file name + 2-digit year — where AIMM itself downloads them. */
export const AIMM_FILES_BASE = 'https://agriculture.alberta.ca/acis/imcin/aimm/'
export function acisFileUrl(fileName: string, year: number): string {
  return `${AIMM_FILES_BASE}${fileName}${String(year).slice(-2)}.txt`
}
