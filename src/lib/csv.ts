/** Minimal CSV parser: handles quoted fields, commas, and escaped quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const s = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += c
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''))
  if (nonEmpty.length < 1) return []
  const headers = nonEmpty[0].map((h) => h.trim())
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()))
    return obj
  })
}
