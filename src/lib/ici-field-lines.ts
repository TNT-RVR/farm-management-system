/**
 * Tying ICI's invoice lines to fields, from the notes printed under each line.
 *
 * ICI prints what a blend was for under its line — the field's legal land
 * description and crop, then "Density, Rate lbs/acres, acres, Cost/acres" and
 * the nutrient target. Each line becomes one ici_field_lines row: its field (by
 * quarter-section-township-range on the note, or the field's name when the
 * ticket has no legal), crop, rate, acres, $/ac and nutrient target. Edge,
 * floating and delivery lines take the field of the blend on the same LOT.
 *
 * Shared by scripts/import-ici-field-lines.mjs (the emailed PDFs in Drive) and
 * netlify/shared/ici-qb-read.ts (the PDFs attached in QuickBooks), so the two
 * paths file a line the same way. Pure: the caller hands it the read lines.
 */

export type FieldRef = { id: string; name: string | null; lld: string | null }

/** The input: one line with its note (src/lib/ici-invoice-pdf.ts invoiceNotes, or the Python reader). */
export type NotedLine = {
  refNo: string
  quantity: number | null
  unit: string | null
  description: string
  amount: number
  note: string
}

export type FieldLineKind = 'blend' | 'edge' | 'floating' | 'delivery' | 'fertilizer' | 'other'

export type FieldLine = {
  ref_no: string
  kind: FieldLineKind
  description: string
  quantity: number | null
  unit: string | null
  amount: number
  field_id: string | null
  field_text: string | null
  crop_text: string | null
  density: number | null
  rate_lb_ac: number | null
  ticket_acres: number | null
  cost_per_ac: number | null
  target: Record<string, number> | null
  note: string | null
}

/** "SW-13-40-26-W4", "SE 14-40-26", "2-41-23-W4" → quarter + section-township-range. */
export function legal(s: string | null | undefined): { qtr: string | null; str: string } | null {
  const m = String(s || '')
    .toUpperCase()
    .match(/\b(NE|NW|SE|SW|N|S|E|W)?[\s-]*(\d{1,2})-(\d{1,2})-(\d{1,2})\b/)
  return m ? { qtr: m[1] || null, str: `${+m[2]}-${+m[3]}-${+m[4]}` } : null
}

const letters = (s: string | null | undefined) =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim()

/** The field a ticket names: by legal (quarter where two share a section), else by name if exactly one fits. */
export function fieldMatcher(fields: FieldRef[]): (text: string) => string | null {
  const fieldLegal = fields.map((f) => ({ ...f, l: legal(f.lld) })).filter((f) => f.l)
  return (text) => {
    const l = legal(text)
    if (!l) {
      // No legal on the ticket ("CROWN HILL BARLEY N/P"): the field's name, if it's in it.
      const t = ` ${letters(text)} `
      const hit = fields.filter((f) => letters(f.name).length >= 4 && t.includes(` ${letters(f.name)} `))
      return hit.length === 1 ? hit[0].id : null
    }
    const same = fieldLegal.filter((f) => f.l!.str === l.str)
    if (same.length <= 1) return same[0]?.id ?? null
    return (
      (same.find((f) => f.l!.qtr && l.qtr && f.l!.qtr === l.qtr) ?? same.find((f) => f.l!.qtr && l.qtr && f.l!.qtr[0] === l.qtr[0]))?.id ?? null
    )
  }
}

const num = (re: RegExp, s: string) => {
  const m = s.match(re)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

export function kindOf(d: string, unit: string | null): FieldLineKind {
  return /edge/i.test(d)
    ? 'edge'
    : /floating/i.test(d)
      ? 'floating'
      : /delivery/i.test(d) && /fert/i.test(d)
        ? 'delivery'
        : /blend/i.test(d) && /tonne|metric/i.test(`${unit} ${d}`)
          ? 'blend'
          : /\b(UAN|28-0-0|21-0-0|46-0-0|11-52|ESN|urea|potash|0-0-60)\b|releaf/i.test(d)
            ? 'fertilizer'
            : 'other'
}

/** One invoice's lines as ici_field_lines rows (without crop_year / invoice_no / invoice_date). */
export function fieldLines(items: NotedLine[], matchField: (text: string) => string | null): { rows: FieldLine[]; noField: number } {
  // The blend's field, by LOT, for the lines that follow it.
  const lotField = new Map<string, { field: string; head: string; crop: string | null }>()
  const read = items.map((it) => {
    const note = (it.note || '').replace(/\bSubtotal:.*$/i, '').trim()
    const kind = kindOf(it.description, it.unit)
    const head = note.split(/Density:/i)[0].trim()
    const l = legal(head)
    const field = kind === 'blend' || kind === 'fertilizer' ? matchField(head) : null
    const crop = l
      ? head
          .slice(head.toUpperCase().search(/\d{1,2}-\d{1,2}-\d{1,2}/))
          .replace(/^[\d-]+(-W\d)?\s*/, '')
          .trim() || null
      : null
    const target: Record<string, number> = {}
    const t = note.split(/Cost\/acres:\s*\$[\d,.]+,?/i)[1] || ''
    for (const m of t.matchAll(/([\d.]+)\s*(N|P|K|S|Ca|Zn|Fe|Mg|B|Cu|Mn)\b/g)) target[m[2]] = Number(m[1])
    if (field) lotField.set(it.refNo, { field, head, crop })
    return {
      kind,
      it,
      note,
      field,
      head: head || null,
      crop,
      density: num(/Density:\s*([\d.]+)/i, note),
      rate: num(/Rate:\s*([\d.,]+)\s*lbs/i, note),
      acres: num(/([\d.,]+)\s*acres(?!:)/i, note.replace(/Rate:\s*[\d.,]+\s*lbs\/acres,?/i, '')),
      cpa: num(/Cost\/acres:\s*\$([\d,.]+)/i, note),
      target: Object.keys(target).length ? target : null,
    }
  })
  let noField = 0
  const rows = read.map((r): FieldLine => {
    const lf = !r.field ? lotField.get(r.it.refNo) : undefined
    const field = r.field ?? (lf ? lf.field : null)
    if ((r.kind === 'blend' || r.kind === 'fertilizer') && !field) noField++
    return {
      ref_no: r.it.refNo,
      kind: r.kind,
      description: r.it.description,
      quantity: r.it.quantity,
      unit: r.it.unit,
      amount: r.it.amount,
      field_id: field,
      field_text: r.head ?? (lf ? lf.head : null),
      crop_text: r.crop ?? (lf ? lf.crop : null),
      density: r.density,
      rate_lb_ac: r.rate,
      ticket_acres: r.acres,
      cost_per_ac: r.cpa,
      target: r.target,
      note: r.note || null,
    }
  })
  return { rows, noField }
}
