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

/** "2024-09-04 10:35", Alberta local time, to an ISO instant. */
export function idwqTime(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim())
  if (!m) return null
  const month = Number(m[2])
  // Mountain Daylight Time roughly mid-March to early November.
  const offset = month >= 4 && month <= 10 ? '-06:00' : '-07:00'
  const hh = (m[4] ?? '12').padStart(2, '0')
  return `${m[1]}-${m[2]}-${m[3]}T${hh}:${m[5] ?? '00'}:00${offset}`
}

/** SAR from sodium, calcium and magnesium in mg/L (meq/L inside). */
export function sarFrom(na: number, ca: number, mg: number): number | null {
  const denom = Math.sqrt((ca / 20.04 + mg / 12.15) / 2)
  return denom > 0 ? Math.round(((na / 22.99) / denom) * 100) / 100 : null
}
