/**
 * Reading an your retailer invoice.
 *
 * The arithmetic that matters is the pack size. ICI prices a jug, a tote, a
 * case or "each", and the pack size is written into the product name rather
 * than into a column: "InterLock (2x10L)" at $133 a jug is $6.65 a litre, and
 * filing $133 against a product measured in litres is twenty times out. Every
 * shape of pack size ICI writes is handled here, and a line whose pack cannot
 * be read is returned WITHOUT a price rather than with a guessed one.
 *
 * Pure — no PDF library, no database. The caller hands it the text.
 */

export type PackUnit =
  'Jug' | 'Case' | 'Tote' | 'Each' | 'Bag' | 'Drum' | 'Pail' | 'L' | 'mL' | 'gal' | 'kg' | 'g'

/** Units the app can price in, for the picker. */
export const PACK_UNITS: PackUnit[] = [
  'Jug',
  'Case',
  'Tote',
  'Each',
  'Bag',
  'Drum',
  'Pail',
  'L',
  'mL',
  'gal',
  'kg',
  'g',
]

/** One US gallon in litres. ICI is Alberta, but the jugs are filled in the US. */
export const L_PER_US_GAL = 3.785411784

export type PackSize = {
  /** How much one pack holds, in the canonical unit. */
  size: number
  unit: 'L' | 'kg'
  /** How it was read, so a wrong answer can be traced. */
  from: string
}

/**
 * The pack size hidden in a product description.
 *
 * Handles, in order of how much they claim:
 *   "(2x10L)"    two ten-litre jugs   → 20 L
 *   "450L"       a 450 litre tote     → 450 L
 *   "10 L"       spaced               → 10 L
 *   "4x5 kg"     four five-kilo bags  → 20 kg
 *   "500mL"      → 0.5 L
 *   "1 gal"      → 3.785 L
 *
 * Returns null when there is nothing to read. A missing pack size is a line
 * somebody has to look at, not a line to guess at.
 */
export function packSizeFrom(description: string): PackSize | null {
  const spaced = description.replace(/\u00a0/g, ' ')

  // A packaging word run straight onto the size with nothing between them:
  // "Authority 480 3.79LJug". Every match below ends on a word boundary and
  // "LJ" has none, so the size was invisible and the line priced at nothing.
  const text = spaced.replace(
    /(\d\s*(?:mL|ml|ML|Lt|lt|LT|L|l|kg|KG|g|G|gal))(jug|case|tote|bag|drum|pail|box|each)\b/gi,
    '$1 $2',
  )

  // A co-pack: several containers sold as one unit, their sizes added together.
  // Certitude ships as "(291mL+9.71L+8.1L)" and the single matcher below takes
  // the first of the three — 291 mL — which turned $360 a case into $1,237 a
  // litre instead of $19.89. Anything joined by "+" is one pack.
  if (/\d\s*(?:mL|ml|L|l|kg|g)\s*\+/i.test(text)) {
    const parts = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*(mL|ML|ml|Lt|lt|L|l|kg|KG|Kg|g|G)\b/g)]
    const sizes = parts
      .map((m) => toCanonical(Number(m[1].replace(/,/g, '')), m[2]))
      .filter((s): s is { size: number; unit: 'L' | 'kg' } => s != null)
    // Only sum a co-pack measured in ONE unit. A case holding both litres and
    // kilos has no single size, and adding them would invent a number.
    if (sizes.length > 1 && sizes.every((s) => s.unit === sizes[0].unit)) {
      return {
        size: sizes.reduce((n, s) => n + s.size, 0),
        unit: sizes[0].unit,
        from: `${sizes.length} parts summed`,
      }
    }
  }

  // Multipliers first: "2x10L" must not be read as the "10L" inside it.
  const multi = text.match(
    /([\d,]+(?:\.\d+)?)\s*[xX×]\s*([\d,]+(?:\.\d+)?)\s*(mL|ML|ml|Lt|lt|L|l|kg|KG|Kg|grams?|g|G)\b/,
  )
  if (multi) {
    const [, count, each, rawUnit] = multi
    const one = toCanonical(Number(String(each).replace(/,/g, '')), rawUnit)
    if (one)
      return {
        size: Number(String(count).replace(/,/g, '')) * one.size,
        unit: one.unit,
        from: multi[0].trim(),
      }
  }

  // Commas allowed: a 1,000 L tote is a thousand litres, and reading it as
  // "000" made the line price at nothing at all.
  // `Lt` before `L` and `gram` before `g`: an alternation takes the first
  // branch that matches and then the trailing \b fails, so "9Lt" read as "9L"
  // matched nothing and "320gram" read as "320g" matched nothing.
  const single = text.match(
    /([\d,]+(?:\.\d+)?)\s*(mL|ML|ml|Lt|lt|LT|L|l|kg|KG|Kg|grams?|g|G|gal|GAL|Gal)\b/,
  )
  if (single) {
    const one = toCanonical(Number(single[1].replace(/,/g, '')), single[2])
    if (one) return { size: one.size, unit: one.unit, from: single[0].trim() }
  }
  return null
}

/**
 * Pack units that ARE the canonical unit, and how much of it one is.
 *
 * ICI writes these in the Unit column rather than into the name, so there is no
 * pack size to read out of the description — a line reading "5 Metric" of
 * "Tonne 28-0-0-0 UAN" is five tonnes, and without this it priced at nothing at
 * all. Tonnes are the whole fertiliser side of the invoice.
 */
export const BULK_UNITS: Record<string, { size: number; unit: 'L' | 'kg' }> = {
  l: { size: 1, unit: 'L' },
  litre: { size: 1, unit: 'L' },
  litres: { size: 1, unit: 'L' },
  liter: { size: 1, unit: 'L' },
  liters: { size: 1, unit: 'L' },
  kg: { size: 1, unit: 'kg' },
  kilogram: { size: 1, unit: 'kg' },
  kilograms: { size: 1, unit: 'kg' },
  // "Metric" is how the invoice abbreviates a metric tonne.
  metric: { size: 1000, unit: 'kg' },
  tonne: { size: 1000, unit: 'kg' },
  tonnes: { size: 1000, unit: 'kg' },
  mt: { size: 1000, unit: 'kg' },
  // "US" is the head of "US Gallon", split by the column reader.
  us: { size: L_PER_US_GAL, unit: 'L' },
  gal: { size: L_PER_US_GAL, unit: 'L' },
  gallon: { size: L_PER_US_GAL, unit: 'L' },
}

/** A quantity in whatever the label says, as litres or kilograms. */
export function toCanonical(
  value: number,
  unit: string,
): { size: number; unit: 'L' | 'kg' } | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const u = unit.toLowerCase()
  // "Lt" is ICI's other spelling of a litre — Octtain XL is sold as "9Lt" —
  // and "gram" is written out in full on MusterTNG. Both priced at nothing
  // until they were read as units.
  if (u === 'l' || u === 'lt') return { size: value, unit: 'L' }
  if (u === 'ml') return { size: value / 1000, unit: 'L' }
  if (u === 'gal') return { size: value * L_PER_US_GAL, unit: 'L' }
  if (u === 'kg') return { size: value, unit: 'kg' }
  if (u === 'g' || u === 'gram' || u === 'grams') return { size: value / 1000, unit: 'kg' }
  return null
}

/**
 * Lines that are not a product.
 *
 * A tote deposit is $650 on the same invoice as the chemical and would price
 * "Deposit-RegloneION" as though it were something you spray. Freight, GST,
 * interest and returned-container credits are the same.
 */
const NOT_A_PRODUCT =
  /^(deposit|freight|delivery|interest|gst|credit|return|restocking|discount|core charge|custom app)/i

export function isProductLine(description: string): boolean {
  return !NOT_A_PRODUCT.test(description.trim())
}

export type InvoiceLine = {
  refNo: string | null
  quantity: number
  packUnit: string
  description: string
  unitPrice: number
  amount: number | null
  isProduct: boolean
  pack: PackSize | null
  /** unit_price ÷ pack size — what a litre or a kilogram cost. */
  pricePerCanonical: number | null
}

export type Invoice = {
  invoiceNo: string | null
  invoiceDate: string | null
  soldTo: string | null
  lines: InvoiceLine[]
  total: number | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "Sep 11, 2025" → "2025-09-11". */
export function parseInvoiceDate(text: string): string | null {
  const m = text.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const money = (s: string) => Number(s.replace(/[$,]/g, ''))

/**
 * Build a line, working out what a litre cost.
 *
 * The unit price is per PACK, so the canonical price is unit price divided by
 * pack size — not by quantity. Four jugs at $133 is still $6.65 a litre.
 */
export function buildLine(raw: {
  refNo?: string | null
  quantity: number
  packUnit: string
  description: string
  unitPrice: number
  amount?: number | null
}): InvoiceLine {
  const isProduct = isProductLine(raw.description)
  const pack = isProduct ? packSizeFrom(raw.description) : null
  // The unit column wins where it names the canonical unit itself. A tonne of
  // blend is priced per tonne, and the description carries an analysis
  // ("18-9-1.7") that must not be mistaken for a pack size.
  const bulk = BULK_UNITS[raw.packUnit.trim().toLowerCase()]
  const size = bulk ? bulk.size : (pack?.size ?? null)
  const unit = bulk ? bulk.unit : (pack?.unit ?? null)
  return {
    refNo: raw.refNo ?? null,
    quantity: raw.quantity,
    packUnit: raw.packUnit,
    description: raw.description.trim(),
    unitPrice: raw.unitPrice,
    amount: raw.amount ?? null,
    isProduct,
    pack: pack ?? (bulk && unit ? { size: bulk.size, unit, from: raw.packUnit } : null),
    pricePerCanonical:
      isProduct && size && size > 0 ? Number((raw.unitPrice / size).toFixed(6)) : null,
  }
}

/** Money and header fields off the flat text of an ICI invoice. */
export function parseHeader(text: string): Pick<Invoice, 'invoiceNo' | 'invoiceDate' | 'total'> {
  const invoiceNo = text.match(/\bINV\d{3,}\b/)?.[0] ?? null
  const invoiceDate = parseInvoiceDate(text)
  const total = text.match(/TOTAL DUE:[\s\S]{0,40}?\$([\d,]+\.\d{2})/)?.[1]
  return { invoiceNo, invoiceDate, total: total ? money(total) : null }
}

/**
 * A product name with the packaging taken off, for matching.
 *
 * "Reglone ION 450L", "InterLock (2x10L)", "Moddus 10L Jug" and "Finish 10L"
 * all reduce to the chemical itself, which is the point: ICI writes the pack
 * into the name and it drifts between years for the same product.
 *
 * Lives here rather than in the import scripts because two of them match on it
 * and they must agree exactly — a product created under one rule and matched
 * under another is a product that never matches.
 */
export function normaliseProductName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      // A thousands separator, before anything tries to read a size through
      // it. Left in, "1,000 L" strips as its "000 L" and leaves a bare "1"
      // stuck to the name — the same way it once priced a tote at nothing.
      // No trailing boundary: "1,000L" has none between the 0 and the L.
      .replace(/(\d),\s*(\d{3})/g, '$1$2')
      // A packaging word glued straight onto a size with no space between them:
      // "Authority 480 3.79LJug". The size rules below need a word boundary
      // after the unit and "LJ" has none, so without this the whole "3.79LJug"
      // survives into the name and matches no product on file.
      .replace(/(\d\s*(?:ml|lt|l|kg|g|gal))(jug|case|tote|bag|drum|pail|box|each)\b/g, '$1 $2')
      // Pack sizes: the multiplier first, so "2x10L" is not read as its "10L".
      //
      // `lt` before `l`, and `gram` before `g`, because an alternation takes the
      // first branch that matches and then the trailing \b fails: "9Lt" read as
      // "9L" leaves a stray "t", and "320gram" read as "320g" leaves "ram".
      // Both came off real ICI lines — Octtain XL and MusterTNG.
      .replace(/\b\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?\s*(ml|lt|l|kg|grams?|g)\b/g, ' ')
      .replace(/\b\d+(\.\d+)?\s*(ml|lt|l|kg|grams?|g|gal)\b/g, ' ')
      // Some suppliers size a case by what it covers rather than what it
      // holds — AgraCity sells an "Independence - 80 acre - Case". That is
      // packaging too, and leaving it in makes a name the pesticide registry
      // cannot match and a second copy of a product already on file.
      .replace(/\b\d+(\.\d+)?\s*(acres?|ac)\b/g, ' ')
      // "Case only" is one phrase and has to go as one. Stripping "case" on its
      // own leaves a bare "only" welded to the product name — ICI's Certitude
      // arrived as "certitude only", which matches nothing on file.
      .replace(/\b(jug|case|tote|bag|drum|pail|box)s?\s+only\b/g, ' ')
      // Packaging words wherever they sit: "Moddus 10L Jug" is Moddus. The word
      // boundaries are load-bearing — without them "each" matches inside
      // "Bleach" and "bag" inside "Basagran".
      .replace(
        /\b(jug|jugs|case|cases|tote|totes|bag|bags|drum|drums|pail|pails|each|box|boxes)\b/g,
        ' ',
      )
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
