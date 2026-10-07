import type { SupabaseClient } from '@supabase/supabase-js'

// Mirrors the agricultural slice of Health Canada's Pesticide Product
// Information Database. Public API, no key, rebuilt every 24 h.
//
// The full extract is ~21,700 products going back to 1948 and includes swimming
// pool algicides, wood preservatives and insect repellents. We keep only what a
// farm would actually buy and apply — see AG_USE_SITES / BUYABLE below.

export const PPID_PRODUCT_URL =
  'https://pest-control.canada.ca/pesticide-registry-api/api/extract/product/?lang=en'

/** Official label search, verified to resolve by registration number. */
export const labelUrl = (registrationNumber: string) =>
  `https://pr-rp.hc-sc.gc.ca/ls-re/result-eng.php?p_search_label=&searchfield1=REGNU&operator1=CONTAIN&criteria1=${encodeURIComponent(registrationNumber)}`

/**
 * Use-site categories that mean "used on a farm". Deliberately excludes turf,
 * ornamentals, forestry, structural, pools and industrial vegetation control —
 * widening this is a one-line change if fenceline or yard products are wanted.
 */
export const AG_USE_SITES = new Set([
  '13-TERRESTRIAL FEED CROPS',
  '14-TERRESTRIAL FOOD CROPS',
  '7-INDUSTRIAL OIL SEED & FIBRE CROPS',
  '10-SEED TREATMENTS FOOD & FEED',
  '12-STORED FOOD & FEED',
  '8-LIVESTOCK FOR FOOD',
  '3-EMPTY FOOD STORAGE AREAS',
])

/** Things you can buy in a jug. Technical actives and manufacturing
 *  concentrates are feedstock for formulators, not products anyone sprays. */
export const BUYABLE = new Set(['COMMERCIAL', 'RESTRICTED', 'COMMERCIAL+RESTRICTED USES'])

/**
 * Product roles Prairie Creek has no use for: fumigants, bactericides, bird and
 * animal repellents, algaecides and acaricides.
 */
const UNWANTED_ROLE = [
  /^FUMIGANT$/,
  /BACTERICIDE$/,
  /^(BIRD|ANIMAL|MAMMAL) REPELLENT$/,
  /^ALGAECIDE/,
  /^ACARICIDE$/,
]

/**
 * True when a product does nothing except the roles above.
 *
 * `Product Type` is a comma-separated list of roles, and the useful ones are
 * routinely bundled with the unwanted ones: 58 products are
 * "ACARICIDE, INSECTICIDE" and 12 are "CROP BACTERICIDE, FUNGICIDE". Excluding
 * on a substring match would throw away 70-odd real insecticides and fungicides,
 * so a product only goes if EVERY role it has is unwanted.
 */
export function isExcludedType(productType: string | null | undefined): boolean {
  const roles = (productType ?? '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean)
  if (roles.length === 0) return false
  return roles.every((role) => UNWANTED_ROLE.some((re) => re.test(role)))
}

export type ChemicalRow = {
  registration_number: string
  name: string
  name_fr: string | null
  registration_status: string | null
  expiry_date: string | null
  marketing_type: string | null
  first_registered: string | null
  active_ingredients: string | null
  product_type: string | null
  registrant: string | null
  use_site_categories: string | null
  sites_of_use: string | null
  pests: string | null
}

/**
 * Minimal RFC-4180 CSV parser. The extract quotes fields containing commas and
 * escapes a quote by doubling it; product names genuinely contain both
 * (e.g. `"""103"" SIESTA"`), so splitting on commas would corrupt the data.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const asDate = (v: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)
const asText = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/** Filter the extract down to current, purchasable, agricultural products. */
export function toAgriculturalRows(csv: string): ChemicalRow[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const head = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim())
  const col = (name: string) => head.indexOf(name)

  const iReg = col('Registration number')
  const iName = col('Product name - English')
  const iCurrent = col('Current / Historical')
  const iMarketing = col('Marketing type')
  const iSites = col('Use Site Category')
  if (iReg < 0 || iName < 0 || iCurrent < 0) return []

  const out: ChemicalRow[] = []
  const seen = new Set<string>()
  for (let r = 1; r < rows.length; r++) {
    const v = rows[r]
    if (v.length < head.length) continue
    if ((v[iCurrent] ?? '').trim() !== 'Current') continue
    if (!BUYABLE.has((v[iMarketing] ?? '').trim())) continue
    const cats = (v[iSites] ?? '').split(',').map((c) => c.trim())
    if (!cats.some((c) => AG_USE_SITES.has(c))) continue
    if (isExcludedType(v[col('Product Type')] ?? '')) continue

    const reg = (v[iReg] ?? '').trim()
    const name = (v[iName] ?? '').trim()
    if (!reg || !name || seen.has(reg)) continue
    seen.add(reg)

    out.push({
      registration_number: reg,
      name,
      name_fr: asText(v[col('Product name - French')] ?? ''),
      registration_status: asText(v[col('Registration Status')] ?? ''),
      expiry_date: asDate(v[col('Expiry date')] ?? ''),
      marketing_type: asText(v[iMarketing] ?? ''),
      first_registered: asDate(v[col('Date first registered')] ?? ''),
      active_ingredients: asText(v[col('Active ingredients - English')] ?? ''),
      product_type: asText(v[col('Product Type')] ?? ''),
      registrant: asText(v[col('Registrant name')] ?? ''),
      use_site_categories: asText(v[iSites] ?? ''),
      sites_of_use: asText(v[col('Sites of Use')] ?? ''),
      pests: asText(v[col('Pests')] ?? ''),
    })
  }
  return out
}

export type ChemicalsSyncResult = { ok: boolean; parsed: number; written: number; detail: string }

export async function runChemicalsSync(sb: SupabaseClient): Promise<ChemicalsSyncResult> {
  let csv: string
  try {
    const res = await fetch(PPID_PRODUCT_URL, {
      headers: { 'User-Agent': 'RVR-Management/1.0 (farm management app)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    csv = await res.text()
  } catch (e) {
    return { ok: false, parsed: 0, written: 0, detail: `Could not fetch the registry: ${(e as Error).message}` }
  }

  const rows = toAgriculturalRows(csv)

  // Same fail-safe rule as the SMRID check: a parse that collapses must not wipe
  // a working lookup. ~2,300 rows is the normal size; anything under 500 means
  // the extract changed shape.
  if (rows.length < 500) {
    return {
      ok: false,
      parsed: rows.length,
      written: 0,
      detail: `Only parsed ${rows.length} agricultural products — the extract format has probably changed. Nothing was written.`,
    }
  }

  const now = new Date().toISOString()
  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: now }))
    const { error } = await sb.from('chemicals').upsert(batch, { onConflict: 'registration_number' })
    if (error) {
      return { ok: false, parsed: rows.length, written, detail: `Write failed after ${written}: ${error.message}` }
    }
    written += batch.length
  }

  // Products that left the registry (deregistered) stop being current, so drop
  // anything this run didn't touch — otherwise a cancelled product lingers and
  // someone sprays it.
  await sb.from('chemicals').delete().lt('synced_at', now)

  const detail = `${written} agricultural products in the lookup.`
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'chemicals_sync',
    p_detail: detail,
    p_data_at: null,
  })

  return { ok: true, parsed: rows.length, written, detail }
}
