/**
 * The feed records, as a spreadsheet.
 *
 * A backup that lives in the same database it is protecting is not much of a
 * backup, and the cattle manager works on paper and in Sheets rather than in
 * this app. So the records are mirrored to a Google Sheet: readable by somebody
 * who has never logged in, and still there if this project is not.
 *
 * One row per feed line rather than per record. A row per record would need a
 * column per feed type, and the feed types change from month to month — silage
 * every month, durum silage twice, sainfoin when there is sainfoin. Long and
 * narrow survives that; wide does not.
 */

export type SheetRecord = {
  ranch: string
  herdGroup: string
  periodStart: string
  periodEnd: string
  headCount: number | null
  notes: string | null
  lines: {
    feedTypeName: string
    quantity: number
    unit: 'lb' | 'big_square' | 'round'
    lbPerBale: number | null
    purpose: 'feed' | 'bedding' | 'self_feeder'
  }[]
}

export const SHEET_HEADER = [
  'Ranch',
  'Group',
  'Period start',
  'Period end',
  'Days',
  'Head',
  'Feed',
  'Quantity',
  'Counted in',
  'lb per bale',
  'Pounds',
  'Purpose',
  'Period lb fed',
  'lb per head per day',
  'Notes',
]

const UNIT_WORD = { lb: 'lb', big_square: 'big square bales', round: 'round bales' } as const
const PURPOSE_WORD = { feed: 'Fed', bedding: 'Bedding', self_feeder: 'Self-feeder' } as const

function days(start: string, end: string): number {
  const a = Date.parse(start + 'T00:00:00Z')
  const b = Date.parse(end + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86_400_000) + 1
}

function poundsFor(l: SheetRecord['lines'][number]): number | null {
  if (l.unit === 'lb') return l.quantity
  if (l.lbPerBale == null || !(l.lbPerBale > 0)) return null
  return l.quantity * l.lbPerBale
}

/**
 * Rows for the sheet, header first.
 *
 * The period totals repeat on every line of that period. That is redundant in a
 * database and right in a spreadsheet: somebody sorting or filtering the sheet
 * gets rows that still say what they are, rather than rows whose meaning was in
 * a cell that has scrolled away.
 *
 * A bale with no weight writes an empty Pounds cell, never a nought. A nought
 * would sum into the period total and understate what was fed.
 */
export function feedRecordsToRows(records: SheetRecord[]): (string | number)[][] {
  const rows: (string | number)[][] = [SHEET_HEADER]

  for (const r of records) {
    const d = days(r.periodStart, r.periodEnd)
    let fed = 0
    for (const l of r.lines) {
      const lb = poundsFor(l)
      if (lb != null && l.purpose !== 'bedding') fed += lb
    }
    const perHead = r.headCount && d ? fed / r.headCount / d : null

    for (const l of r.lines) {
      const lb = poundsFor(l)
      rows.push([
        r.ranch,
        r.herdGroup,
        r.periodStart,
        r.periodEnd,
        d,
        r.headCount ?? '',
        l.feedTypeName,
        l.quantity,
        UNIT_WORD[l.unit],
        l.lbPerBale ?? '',
        lb ?? '',
        PURPOSE_WORD[l.purpose],
        Math.round(fed),
        perHead == null ? '' : Number(perHead.toFixed(2)),
        r.notes ?? '',
      ])
    }
  }
  return rows
}

/**
 * The private key, however it survived being put in an environment variable.
 *
 * Three shapes reach us and all three have to work. A PEM with real newlines,
 * which is what the JSON file holds. A PEM with the newlines escaped, which is
 * what most dashboards store. And base64 of the whole PEM, which is what you
 * fall back to when a command line refuses the key for starting with a dash —
 * "-----BEGIN PRIVATE KEY-----" is indistinguishable from an option.
 */
export function normalisePrivateKey(raw: string): string {
  const value = raw.trim()
  if (value.includes('BEGIN')) {
    return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
  }
  // No header, so it is the PEM itself in base64.
  const decoded = Buffer.from(value, 'base64').toString('utf8')
  if (!decoded.includes('BEGIN'))
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is neither a PEM nor base64 of one')
  return decoded.includes('\\n') ? decoded.replace(/\\n/g, '\n') : decoded
}

/**
 * An access token for a Google service account.
 *
 * The service account signs a JWT asserting who it is and what it wants, and
 * Google exchanges it for a token. No browser and nobody to log in, which is
 * what a nightly job needs.
 */
export async function googleAccessToken(
  clientEmail: string,
  privateKey: string,
  scope = 'https://www.googleapis.com/auth/spreadsheets',
): Promise<string> {
  const { createSign } = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const claim = b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({
      iss: clientEmail,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })

  const pem = normalisePrivateKey(privateKey)
  const signature = createSign('RSA-SHA256').update(claim).sign(pem, 'base64url')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${claim}.${signature}`,
    }),
  })
  const body = (await res.json()) as { access_token?: string; error_description?: string }
  if (!res.ok || !body.access_token)
    throw new Error(`Google refused the service account: ${body.error_description ?? res.status}`)
  return body.access_token
}

/**
 * Which tab a record belongs on: one per year, by the year it STARTED in.
 *
 * A period that crosses new year — feeding through December into January —
 * lands wholly on the year it began, rather than being split or duplicated. A
 * feed record is one reading of one stretch of days and cutting it in half at
 * midnight on the 31st would produce two averages that are each about nothing,
 * which is the same reason the periods exist as they do.
 */
export function tabForRecord(r: Pick<SheetRecord, 'periodStart'>): string {
  return r.periodStart.slice(0, 4)
}

export function groupByYear(records: SheetRecord[]): Map<string, SheetRecord[]> {
  const byYear = new Map<string, SheetRecord[]>()
  for (const r of records) {
    const year = tabForRecord(r)
    const list = byYear.get(year) ?? []
    list.push(r)
    byYear.set(year, list)
  }
  return new Map([...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/** The tabs the spreadsheet already has. */
export async function listTabs(token: string, spreadsheetId: string): Promise<string[]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Could not read the spreadsheet: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { sheets?: { properties?: { title?: string } }[] }
  return (body.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean)
}

/**
 * Add any tab that is missing, so a new year starts its own without anybody
 * remembering to make it. Existing tabs are left exactly as they are.
 */
export async function ensureTabs(
  token: string,
  spreadsheetId: string,
  wanted: string[],
): Promise<string[]> {
  const existing = new Set(await listTabs(token, spreadsheetId))
  const missing = wanted.filter((w) => !existing.has(w))
  if (!missing.length) return []

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    },
  )
  if (!res.ok) throw new Error(`Could not add tab(s): ${res.status} ${await res.text()}`)
  return missing
}

/**
 * Replace the sheet's contents with these rows.
 *
 * Clear first, then write. Writing over the top would leave the tail of a
 * longer previous export below the new data, which reads as real records that
 * no longer exist — the worst possible failure for a backup.
 */
export async function replaceSheet(
  token: string,
  spreadsheetId: string,
  tab: string,
  rows: (string | number)[][],
): Promise<void> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  const range = encodeURIComponent(`${tab}!A:Z`)

  const clear = await fetch(`${base}/values/${range}:clear`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!clear.ok) throw new Error(`Could not clear ${tab}: ${clear.status} ${await clear.text()}`)

  const write = await fetch(
    `${base}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  )
  if (!write.ok) throw new Error(`Could not write ${tab}: ${write.status} ${await write.text()}`)
}
