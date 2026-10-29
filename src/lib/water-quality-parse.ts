// Pure parsing for the provincial water-quality feeds. No imports, so the
// Netlify pull and the tests share it.

/**
 * "<0.01" → 0.01 below detection; "26.0" → 26; "ND" → not detected (value 0:
 * the canal programme gives no limit with it); junk → null.
 */
export function parseReading(raw: unknown): { value: number; below: boolean } | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (/^(nd|n\.d\.|not detected|bdl)$/i.test(s)) return { value: 0, below: true }
  const below = s.startsWith('<')
  const v = Number(s.replace(/^[<>]\s*/, ''))
  return Number.isFinite(v) ? { value: v, below } : null
}

/**
 * The IDWQ EC column is labelled dS/m but mostly holds µS/cm (272, 298…). A
 * canal is never 272 dS/m, and never 0.3 µS/cm, so anything under 10 is dS/m.
 */
export function ecToMicro(v: number): number {
  return v < 10 ? v * 1000 : v
}

/**
 * The province's water-quality data is stamped in Alberta's own local time,
 * whichever farm reads it, so this is Alberta's zone and not the farm's.
 */
const IDWQ_TZ = 'America/Edmonton'

/** How far Alberta's clock is from UTC at an instant, in ms (summer time -6 h, winter -7 h). */
function albertaOffsetMs(t: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: IDWQ_TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t
}

/** "2024-09-04 10:35", Alberta local time, to an ISO instant (summer or winter time, exactly). */
export function idwqTime(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim())
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? '12'), Number(m[5] ?? '0'))
  // Read the offset at the first guess, then again at the corrected time (they differ only across a change).
  const first = wall - albertaOffsetMs(wall)
  return new Date(wall - albertaOffsetMs(first)).toISOString()
}

/** SAR from sodium, calcium and magnesium in mg/L (meq/L inside). */
export function sarFrom(na: number, ca: number, mg: number): number | null {
  const denom = Math.sqrt((ca / 20.04 + mg / 12.15) / 2)
  return denom > 0 ? Math.round(((na / 22.99) / denom) * 100) / 100 : null
}
