import { supabase } from '@/lib/supabase'
import { currentAcres, inPacks, shedStock, type InvAdjustment, type InvOp, type InvProduct, type InvPurchase, type StockLine } from '@/lib/chem-inventory'
import { fetchAll, longDate, type Cell, type GatherContext, type ParamValues, type ReportData } from './framework'

/**
 * What is in the chem shed and how dangerous it is: every chemical with
 * stock on hand (Chemicals → Inventory's ledger — bought on invoices, less
 * what the sprayer put out, set by any count), with its PCP number, active
 * ingredients, the kind of product, and the hazard words its label carries.
 *
 * A registered pesticide's label is its hazard communication — the Pest
 * Control Products Act keeps it out of WHMIS's SDS rules — so the signal
 * word and the warnings in the label's principal panel are what a WHMIS
 * storage list, a fire department pre-plan or an insurer asks for. They are
 * read from the label text the app already holds; a label not read yet says
 * so. No storage location is recorded in the app, so none is printed.
 */

export const WHMIS_COLUMNS = [
  { label: 'Product' },
  { label: 'PCP no.' },
  { label: 'Active ingredients' },
  { label: 'Type' },
  { label: 'Group' },
  { label: 'On hand', decimals: 1 },
  { label: 'Unit' },
  { label: 'In packs' },
  { label: 'Hazard (label)' },
  { label: 'Stock from' },
]

/** The warnings a Canadian pesticide label prints on its principal panel. */
const HAZARD_WORDS: [RegExp, string][] = [
  [/\bCORROSIVE\b/i, 'corrosive'],
  [/\bFLAMMABLE\b/i, 'flammable'],
  [/\bEXPLOSIVE\b/i, 'explosive'],
  [/\bEYE AND SKIN IRRITANT\b/i, 'eye and skin irritant'],
  [/\bSKIN SENSITI[SZ]ER\b/i, 'skin sensitizer'],
  [/\bEYE IRRITANT\b/i, 'eye irritant'],
  [/\bSKIN IRRITANT\b/i, 'skin irritant'],
]

/** A label's principal display panel: everything before the first of the sections that follow it. */
function principalPanel(text: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const ends = ['PRECAUTIONS', 'NOTICE TO USER', 'DIRECTIONS FOR USE', 'FIRST AID'].map((w) => flat.indexOf(w, 100)).filter((i) => i > 0)
  return flat.slice(0, Math.min(3000, ...ends))
}

/**
 * The hazard a label declares: its signal word (DANGER, WARNING, CAUTION),
 * with POISON or the statement after it where the label gives one, then
 * corrosive, flammable, irritant and the like. Read from the principal
 * panel, in capitals, which is where and how the Act puts them: "poisoning"
 * in an emergency phone line, "Warning, contains the allergen soy" and "use
 * caution" in the directions are not a classification.
 */
export function labelHazards(text: string | null | undefined): string | null {
  if (!text) return null
  const panel = principalPanel(text)
  let signal: string | null = null
  for (const m of panel.matchAll(/\b(DANGER|WARNING|CAUTION)\b/g)) {
    const word = m[1][0] + m[1].slice(1).toLowerCase()
    const after = panel.slice(m.index + m[0].length, m.index + m[0].length + 100)
    if (/^\s*[–—-]?\s*POISON\b/.test(after)) {
      signal = `${word} poison`
      break
    }
    const sep = /^\s*[:,–—-]\s*/.exec(after)
    if (!sep) {
      signal = word
      break
    }
    // "WARNING: EYE and SKIN IRRITANT" is a hazard statement; "Warning,
    // contains the allergen soy" is a sentence about something else.
    const rest = after.slice(sep[0].length)
    if (/^contains\b/i.test(rest) || /^[a-z]/.test(rest)) continue
    // The panel runs straight on ("…IRRITANT KEEP OUT OF REACH OF CHILDREN"):
    // the statement is the words in capitals up to the next line of it.
    const caps: string[] = []
    for (const t of rest.split(/\s+(?=KEEP OUT|READ THE|REGISTRATION|PEST CONTROL|NET CONTENTS|PROTECT FROM|DANGER|WARNING|CAUTION)/)[0].split(/\s+/)) {
      if (!(/^[A-Z0-9]/.test(t) && t === t.toUpperCase()) && !/^(and|or|&)$/i.test(t)) break
      caps.push(t)
    }
    signal = caps.length ? `${word}: ${caps.join(' ').toLowerCase()}` : word
    break
  }
  const words = signal ? [signal] : []
  for (const [re, w] of HAZARD_WORDS) if (re.test(panel) && !words.some((x) => x.includes(w))) words.push(w)
  // "eye and skin irritant" already says the other two.
  const both = words.some((w) => w.includes('eye and skin irritant'))
  const out = words.filter((w) => !(both && (w === 'eye irritant' || w === 'skin irritant')))
  return out.length ? out.join('; ') : null
}

/** "GROUP 4 HERBICIDE", "GROUP 3 FUNGICIDE" → "4 herbicide". */
export function labelGroup(text: string | null | undefined): string | null {
  if (!text) return null
  const m = /\bGROUPS?\s+([0-9A-Z]{1,3}(?:\s*(?:,|AND|&)\s*[0-9A-Z]{1,3})*)\s+(HERBICIDE|FUNGICIDE|INSECTICIDE)/i.exec(text.slice(0, 4000))
  return m ? `${m[1].replace(/\s+/g, ' ').trim()} ${m[2].toLowerCase()}` : null
}

const titleCase = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/(^|[\s;,(])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : null)

export type LabelLite = { registration_number: string; label_text: string | null }
export type RegistryLite = { registration_number: string; product_type: string | null; active_ingredients: string | null }

/** The shed's chemicals with stock on hand, as the list's rows. */
export function storageRows(lines: StockLine[], regOf: (productId: string) => string | null, registry: Map<string, RegistryLite>, labels: Map<string, LabelLite>): { rows: Cell[][]; noLabel: number } {
  let noLabel = 0
  const rows = lines
    .filter((l) => (l.product.category ?? 'chemical') === 'chemical' && l.onHand > 0.05)
    .map((l) => {
      const reg = regOf(l.product.id)
      const r = reg ? registry.get(reg) : undefined
      const label = reg ? labels.get(reg) : undefined
      if (!label?.label_text) noLabel++
      return [
        l.product.name,
        reg,
        titleCase(r?.active_ingredients?.replace(/;/g, '; ')),
        titleCase(r?.product_type),
        labelGroup(label?.label_text),
        l.onHand,
        l.product.unit,
        inPacks(l.onHand, l.packSize, l.packUnit),
        label?.label_text ? (labelHazards(label.label_text) ?? 'no signal word on the label') : 'label not read yet',
        l.countedOn ? `counted ${l.countedOn}` : l.lastBought ? `invoices less sprayed` : 'sprayed only',
      ]
    })
  return { rows, noLabel }
}

const STARTS: Record<string, string> = { '2024-07-01': 'July 2024 (the first Deere records)', '2025-01-01': 'January 2025 (the first full season)', '2026-01-01': 'January 2026' }

export async function gatherChemicalStorage(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const start = STARTS[p.start] ? p.start : '2025-01-01'
  const [products, aliases, purchases, ops, adjustments, bounds] = await Promise.all([
    fetchAll<InvProduct & { pmra_registration: string | null }>((a, b) => supabase.from('jd_products').select('id, name, unit, category, pmra_registration').order('id').range(a, b)),
    fetchAll<{ deere_name: string; product_id: string | null; ignored: boolean | null }>((a, b) => supabase.from('jd_product_aliases').select('deere_name, product_id, ignored').order('deere_name').range(a, b)),
    fetchAll<InvPurchase>((a, b) =>
      supabase
        .from('product_purchases')
        .select('product_id, invoice_no, invoice_date, description, amount, price_per_canonical, quantity, pack_size, pack_unit, canonical_unit')
        .eq('is_product', true)
        .not('product_id', 'is', null)
        .order('id')
        .range(a, b),
    ),
    // The tab relies on row security to hide a hand-entered copy of a logged
    // job; said again here so the shed is never drawn down twice.
    fetchAll<InvOp>((a, b) =>
      supabase
        .from('jd_field_operations')
        .select('id, field_id, started_at, applied_area_ha, as_applied, products, sessions, cost_acres_override, not_ours')
        .eq('operation_type', 'application')
        .is('duplicate_of', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
        .range(a, b),
    ),
    fetchAll<InvAdjustment>((a, b) => supabase.from('chem_stock_adjustments').select('id, product_id, kind, quantity, occurred_on, note').order('occurred_on').order('id').range(a, b)),
    fetchAll<{ field_id: string; acres: number | string | null; valid_to: string | null }>((a, b) => supabase.from('field_boundaries').select('field_id, acres, valid_to').order('id').range(a, b)),
  ])
  const acresOf = currentAcres(bounds)
  const { lines } = shedStock({ products, aliases, purchases, ops, adjustments, acresOf: (fid) => (fid ? (acresOf.get(fid) ?? 0) : 0), start })
  const regById = new Map(products.map((x) => [x.id, x.pmra_registration]))
  // Only the labels of what is on the shelf: a label's text runs to tens of
  // pages, and the registry holds every product registered in Canada.
  const regs = [...new Set(lines.filter((l) => l.onHand > 0.05).map((l) => regById.get(l.product.id)).filter((r): r is string => !!r))]
  const [registry, labels] = regs.length
    ? await Promise.all([
        fetchAll<RegistryLite>((a, b) => supabase.from('chemicals').select('registration_number, product_type, active_ingredients').in('registration_number', regs).order('id').range(a, b)),
        fetchAll<LabelLite>((a, b) => supabase.from('chemical_labels').select('registration_number, label_text').in('registration_number', regs).order('registration_number').range(a, b)),
      ])
    : [[], []]
  const { rows, noLabel } = storageRows(
    lines,
    (id) => regById.get(id) ?? null,
    new Map(registry.map((r) => [r.registration_number, r])),
    new Map(labels.map((l) => [l.registration_number, l])),
  )
  if (!rows.length) throw new Error('No chemical is on hand by the inventory’s count.')
  const short = lines.filter((l) => (l.product.category ?? 'chemical') === 'chemical' && l.onHand < -0.05).length
  const summary = [
    'Every chemical the inventory has on hand: bought on invoices, less what the sprayer put out, set by any count since. Hazard words are the signal word and warnings on the front of the product’s label; a pesticide label is its hazard communication under the Pest Control Products Act, which keeps it out of WHMIS’s safety-data-sheet rules.',
    `Counted from ${STARTS[start]}. No storage location is recorded in the app, so none is shown; write it in by the shed.`,
  ]
  if (short) summary.push(`${short} product${short === 1 ? ' shows' : 's show'} less than nothing (more sprayed than invoiced) and ${short === 1 ? 'is' : 'are'} left off; count ${short === 1 ? 'it' : 'them'} on Chemicals → Inventory.`)
  if (noLabel) summary.push(`${noLabel} product${noLabel === 1 ? '' : 's'} with no label read yet: open ${noLabel === 1 ? 'it' : 'them'} on Chemicals → Registry to fetch the label.`)
  return {
    title: 'Chemical storage list',
    subtitle: `On hand at ${longDate(ctx.today)}`,
    meta: [
      ['Products on hand', rows.length],
      ['Counted from', longDate(start)],
      ['Without a label read', noLabel],
    ],
    summary,
    columns: WHMIS_COLUMNS,
    groups: [{ title: '', rows }],
    orientation: 'landscape',
    filename: `Chemical storage list ${ctx.today}`,
  }
}
