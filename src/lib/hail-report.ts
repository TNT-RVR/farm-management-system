/**
 * Reading an AFSC hail inspection summary.
 *
 * The report is a fixed-layout PDF whose text layer comes out interleaved —
 * "SE-10-71-13-W4M Beans, Dry - Pinto Complete0 not claimedBeans, Dry -
 * PintoSE-10-11-13-W4M" is one line of it. Parsing that string is hopeless, so
 * this works on positioned items instead: every fragment with the x and y it
 * was drawn at, grouped into rows and read by column.
 *
 * Positions also survive the thing plain text does not — the report draws some
 * strings twice, overlapping, and by x-position the duplicates land outside the
 * column they would otherwise pollute.
 */

export type TextItem = { x: number; y: number; s: string }

export type HailBand = {
  /** "Under 10%", "10% - 70%", "71% - 89%", "90% and over". */
  band: string
  acres: number | null
  /** The assessed loss for the acres in that band. */
  lossPct: number | null
}

export type HailReport = {
  inspectionNumber: string | null
  inspectionType: string | null
  businessName: string | null
  reportDate: string | null
  /** When the hail fell. The date that matters agronomically. */
  damageDate: string | null
  lossNoticeDate: string | null
  applicationDate: string | null
  adjuster: string | null
  landLocation: string | null
  crop: string | null
  bands: HailBand[]
  totalAcres: number | null
  /**
   * The headline number: acres-weighted loss across the assessed bands.
   *
   * On a single-band report — which every one of these has been — it is simply
   * that band's figure. Weighted rather than summed or averaged so a report
   * that does split across bands cannot read as 17% + 40% = 57%.
   */
  lossPct: number | null
}

/** Rows of items sharing a baseline, each sorted left to right. */
export function toRows(items: TextItem[], tolerance = 3): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: TextItem[][] = []
  for (const it of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - it.y) <= tolerance) row.push(it)
    else rows.push([it])
  }
  return rows.map((r) => [...r].sort((a, b) => a.x - b.x))
}

/**
 * The value to the right of a label on the same line.
 *
 * The labels carry their own colons in this report ("Adjuster:") and sometimes
 * do not ("Inspection Number" with a separate ":" fragment), so the match is on
 * the label text with any colon stripped.
 */
function after(rows: TextItem[][], label: string): string | null {
  const want = label.toLowerCase().replace(/:/g, '').trim()
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const s = row[i].s.toLowerCase().replace(/:/g, '').trim()
      if (s !== want) continue
      const rest = row
        .slice(i + 1)
        .filter((t) => t.s.trim() !== ':')
        .map((t) => t.s.trim())
        .filter(Boolean)
      if (rest.length) return rest[0]
    }
  }
  return null
}

const BANDS = ['Under 10%', '10% - 70%', '71% - 89%', '90% and over']

const numOrNull = (s: string | undefined): number | null => {
  if (!s) return null
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** dd-Mmm-yyyy or "August 07, 2026" to an ISO date. */
export function toISODate(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  }
  const pad = (n: number) => String(n).padStart(2, '0')

  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (dmy) {
    const m = MONTHS[dmy[2].toLowerCase()]
    if (m) return `${dmy[3]}-${pad(m)}-${pad(Number(dmy[1]))}`
  }
  const mdy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/)
  if (mdy) {
    const m = MONTHS[mdy[1].slice(0, 3).toLowerCase()]
    if (m) return `${mdy[3]}-${pad(m)}-${pad(Number(mdy[2]))}`
  }
  return null
}

export function parseHailReport(items: TextItem[]): HailReport {
  const rows = toRows(items)

  // The land location column starts at the left margin. Matching the SHAPE of
  // a legal description rather than a fixed x keeps this working if the layout
  // shifts, and the shape is unmistakable.
  const LLD = /^[NSEW]{0,2}\d?\/?\d?\s*-?\s*\d{1,2}-\d{1,3}-\d{1,2}-W\d M?$/i
  let landLocation: string | null = null
  for (const row of rows) {
    for (const it of row) {
      const s = it.s.trim()
      if (it.x < 60 && (LLD.test(s) || /^[NSEW]{2}-\d{1,2}-\d{1,3}-\d{1,2}-W\dM?$/i.test(s))) {
        landLocation = s
        break
      }
    }
    if (landLocation) break
  }

  // The crop sits in the second column of the same row. Taking it positionally
  // rather than by "the next thing after the location" avoids the duplicated
  // overlapping copies the report draws further right.
  let crop: string | null = null
  if (landLocation) {
    const row = rows.find((r) => r.some((t) => t.s.trim() === landLocation))
    crop = row?.find((t) => t.x >= 120 && t.x < 330)?.s.trim() ?? null
  }

  // Band table: acres on the left of the label, loss to the right of it.
  const bands: HailBand[] = []
  let totalAcres: number | null = null
  for (const row of rows) {
    const labelItem = row.find((t) => BANDS.includes(t.s.trim()))
    if (labelItem) {
      bands.push({
        band: labelItem.s.trim(),
        acres: numOrNull(row.find((t) => t.x < labelItem.x)?.s),
        lossPct: numOrNull(row.find((t) => t.x > labelItem.x + 40)?.s),
      })
      continue
    }
    const totalItem = row.find((t) => t.s.trim().toLowerCase() === 'total')
    if (totalItem) totalAcres = numOrNull(row.find((t) => t.x < totalItem.x)?.s)
  }

  const assessed = bands.filter((b) => b.acres != null && b.acres > 0 && b.lossPct != null)
  const acresTotal = assessed.reduce((sum, b) => sum + (b.acres ?? 0), 0)
  const lossPct = acresTotal
    ? Math.round((assessed.reduce((sum, b) => sum + (b.acres ?? 0) * (b.lossPct ?? 0), 0) / acresTotal) * 10) / 10
    : null

  return {
    inspectionNumber: after(rows, 'Inspection Number'),
    inspectionType: after(rows, 'InspectionType'),
    businessName: after(rows, 'Business Name'),
    reportDate: toISODate(after(rows, 'Date')),
    damageDate: toISODate(after(rows, 'Damage Date')),
    lossNoticeDate: toISODate(after(rows, 'Loss notice Date')),
    applicationDate: toISODate(after(rows, 'Application Date')),
    adjuster: after(rows, 'Adjuster'),
    landLocation,
    crop,
    bands,
    totalAcres,
    lossPct,
  }
}

/**
 * A legal land description reduced to what identifies the ground.
 *
 * The same quarter is written half a dozen ways across this farm's records,
 * AFSC's and the fertiliser retailer's: "SE 14-71-14", "SW-13-71-14-W4",
 * "SE-10-71-13-W4M", "NE 4 71 13", "Sec 16 71 13w4". Dashes and spaces are
 * therefore the same separator, and "Sec" is read as "no quarter given".
 *
 * Meridian is dropped because it is absent from some of ours and present in all
 * of theirs, and everything here is W4 regardless — keeping it would mean
 * failing to match a field over a suffix nobody typed.
 */
export type Legal = { quarter: string | null; section: number; township: number; range: number }

export function parseLegal(raw: string | null | undefined): Legal | null {
  if (!raw) return null
  const s = raw.toUpperCase().replace(/\s+/g, ' ').trim()
  // Strip a "W1/2 " style prefix: it narrows a quarter rather than naming a
  // different one, so it does not change which ground this is.
  const withoutHalf = s.replace(/^[NSEW]\s?1\/2\s+/, '')
  // The meridian may arrive attached to the range with no separator at all —
  // "13w4" — so it is optional on both counts.
  const m = withoutHalf.match(
    /^(?:SEC\s+|([NS][EW])\s*[- ]\s*)?(\d{1,2})\s*[- ]\s*(\d{1,3})\s*[- ]\s*(\d{1,2})(?:\s*-?\s*W\d\s*M?)?$/,
  )
  if (!m) {
    // Half-section forms like "N-35-71-11-W4" and "E 2 72 11 W4" have a single
    // letter where a quarter would be. Treated as no quarter rather than
    // discarded: they name a real section, and a half section overlapping one
    // of ours is a match worth reporting for somebody to confirm.
    const half = withoutHalf.match(
      /^([NSEW])\s*[- ]\s*(\d{1,2})\s*[- ]\s*(\d{1,3})\s*[- ]\s*(\d{1,2})(?:\s*-?\s*W\d\s*M?)?$/,
    )
    if (!half) return null
    return {
      quarter: null,
      section: Number(half[2]),
      township: Number(half[3]),
      range: Number(half[4]),
    }
  }
  return {
    quarter: m[1] ?? null,
    section: Number(m[2]),
    township: Number(m[3]),
    range: Number(m[4]),
  }
}

export type LegalMatch = 'exact' | 'section' | 'none'

/**
 * How confidently two descriptions name the same ground.
 *
 * 'section' means the section, township and range agree but one side did not
 * say which quarter — true of "2-72-11-W4" in our records. That is a real match
 * worth surfacing and a poor one to act on unattended, so it is reported
 * separately rather than folded into a yes.
 */
export function legalMatches(a: Legal | null, b: Legal | null): LegalMatch {
  if (!a || !b) return 'none'
  if (a.section !== b.section || a.township !== b.township || a.range !== b.range) return 'none'
  if (a.quarter && b.quarter) return a.quarter === b.quarter ? 'exact' : 'none'
  return 'section'
}

/** The field whose legal description names this ground, if exactly one does. */
export function matchField<T extends { id: string; name: string; legal_land_description: string | null }>(
  fields: T[],
  landLocation: string | null,
): { field: T; confidence: LegalMatch } | null {
  const want = parseLegal(landLocation)
  if (!want) return null
  const scored = fields
    .map((f) => ({ field: f, confidence: legalMatches(want, parseLegal(f.legal_land_description)) }))
    .filter((r) => r.confidence !== 'none')
  const exact = scored.filter((r) => r.confidence === 'exact')
  // One exact match is the answer. Two would mean two fields claim the same
  // quarter, which is a data problem worth stopping on rather than guessing at.
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const section = scored.filter((r) => r.confidence === 'section')
  return section.length === 1 ? section[0] : null
}
