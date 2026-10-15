/**
 * The line items and the notes off an ICI invoice PDF, by position.
 *
 * A TypeScript port of scripts/ici-invoice-items.py and
 * scripts/ici-invoice-notes.py, so a Netlify function can read the invoice
 * PDFs attached in QuickBooks without Python. Reading order will not do it:
 * the header block and the money column interleave in the text layer, so the
 * columns are matched by X position against the header row ("Quantity",
 * "Description", "Amount"), exactly as the Python readers do.
 *
 * Pure: it takes positioned words (one array per page, top-down Y) and the
 * caller supplies them — netlify/shared/qb-attachments.ts gets them from
 * pdf.js. The two readers are kept as two functions because they differ in
 * small ways that the existing data depends on (which money column is the
 * unit price, how the GST flag is spotted, what a line with no ref is called).
 */

export type Word = { x: number; y: number; text: string }
type Row = { y: number; w: [number, string][] }

/**
 * Words into rows: a word joins the first row whose first word is within `tol`
 * of it, as PyMuPDF's readers did. Rows top to bottom, words left to right.
 */
export function groupRows(words: Word[], tol = 3): Row[] {
  const out: Row[] = []
  for (const { x, y, text } of words) {
    const r = out.find((row) => Math.abs(row.y - y) <= tol)
    if (r) r.w.push([x, text])
    else out.push({ y, w: [[x, text]] })
  }
  for (const r of out) r.w.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return out.sort((a, b) => a.y - b.y)
}

const MONEY = /^\(?\$[\d,]+\.\d{2}\)?$/
const ITEM = /^(LOT|REF|[A-Z]{2,4})\d/
const QTY_FIRST = /^-?\d+(\.\d+)?\s+[A-Za-z]/
const NUMBER = /^-?\d+(\.\d+)?$/
const STOP = /^(Return Dates|TOTAL|We appreciate|Page \d)/

/** $1,234.56 → 1234.56; ($600.00), a credit, → -600. */
export function moneyValue(t: string): number {
  const v = Number(t.replace(/^\(|\)$/g, '').replace(/[$,]/g, ''))
  return t.startsWith('(') ? -v : v
}

/** Python's str.isalpha(): letters only, at least one. */
const isAlpha = (t: string) => /^\p{L}+$/u.test(t)

/** The header row: the X of every column, and its Y. */
function headerOf(rows: Row[]): { head: Map<string, number>; hy: number } | null {
  for (const r of rows) {
    // A word seen twice keeps its last X, as a Python dict comprehension does.
    const head = new Map(r.w.map(([x, t]) => [t, x] as const))
    if (head.has('Quantity') && head.has('Description') && head.has('Amount')) return { head, hy: r.y }
  }
  return null
}

export type RawItem = {
  refNo: string | null
  quantity: number
  packUnit: string
  description: string
  unitPrice: number
  amount: number
}

/**
 * A line that runs off the foot of a page is printed again at the top of the
 * next, clipped to its notes. PyMuPDF drops clipped text; pdf.js keeps it, so
 * the repeat would read as a second purchase. It is the first line on its page
 * and has the ref, quantity and both amounts of the last line on the page before.
 */
const sameLine = (a: { refNo: string | null; quantity: number | null; amount: number }, b: typeof a, aPrice: number, bPrice: number) =>
  a.refNo === b.refNo && a.quantity === b.quantity && a.amount === b.amount && aPrice === bPrice

/** scripts/ici-invoice-items.py: the priced lines. */
export function invoiceItems(pages: Word[][]): RawItem[] {
  const items: RawItem[] = []
  for (const page of pages) {
    const rows = groupRows(page)
    const h = headerOf(rows)
    if (!h) continue
    const priceX = h.head.get('Price') ?? h.head.get('Unit Price') ?? null
    const lastBefore = items.length ? items[items.length - 1] : null
    let first = true
    for (const r of rows) {
      if (r.y <= h.hy) continue
      const words = r.w
      const joined = words.map(([, t]) => t).join(' ')
      // A line item starts with a lot/ref code — or straight with its
      // quantity — and carries two amounts. A credit prints them in brackets.
      const hasRef = ITEM.test(joined)
      if (!hasRef && !QTY_FIRST.test(joined)) continue
      const money = words.filter(([, t]) => MONEY.test(t))
      if (money.length < 2) continue
      const moneyX = new Set(money.map(([x]) => x))

      const ref = hasRef ? words[0][1] : null
      let qty: number | null = null
      let unit: string | null = null
      const desc: string[] = []
      for (const [x, t] of hasRef ? words.slice(1) : words) {
        if (moneyX.has(x)) continue
        if (qty == null && NUMBER.test(t)) {
          qty = Number(t)
          continue
        }
        if (qty != null && unit == null && isAlpha(t)) {
          unit = t
          continue
        }
        if (qty != null && unit != null) {
          // "Y"/"N" is the GST column, not part of the name.
          if ((t === 'Y' || t === 'N') && x > (priceX ?? 1e9) - 120) continue
          desc.push(t)
        }
      }
      if (qty == null || unit == null || !desc.length) continue
      const item = {
        refNo: ref,
        quantity: qty,
        packUnit: unit,
        description: desc.join(' ').trim(),
        unitPrice: moneyValue(money[money.length - 2][1]),
        amount: moneyValue(money[money.length - 1][1]),
      }
      const carried = first && lastBefore && sameLine(item, lastBefore, item.unitPrice, lastBefore.unitPrice)
      first = false
      if (!carried) items.push(item)
    }
  }
  return items
}

export type NoteItem = {
  /** "NOREF" where the line has none, as the field-lines table expects. */
  refNo: string
  quantity: number | null
  unit: string | null
  description: string
  amount: number
  note: string
}

/** scripts/ici-invoice-notes.py: each line with the notes printed under it. */
export function invoiceNotes(pages: Word[][]): NoteItem[] {
  const items: (Omit<NoteItem, 'note'> & { note: string[]; price: number })[] = []
  for (const page of pages) {
    const rows = groupRows(page)
    const h = headerOf(rows)
    if (!h) continue
    const descX = h.head.get('Description')!
    let current: (typeof items)[number] | null = null
    const lastBefore = items.length ? items[items.length - 1] : null
    let first = true
    for (const r of rows) {
      if (r.y <= h.hy) continue
      const words = r.w
      const joined = words.map(([, t]) => t).join(' ')
      const money = words.filter(([, t]) => MONEY.test(t))
      const hasRef = ITEM.test(joined)
      if ((hasRef || QTY_FIRST.test(joined)) && money.length >= 2) {
        const moneyX = new Set(money.map(([x]) => x))
        let qty: number | null = null
        let unit: string | null = null
        const desc: string[] = []
        for (const [x, t] of hasRef ? words.slice(1) : words) {
          if (moneyX.has(x)) continue
          if (qty == null && NUMBER.test(t)) {
            qty = Number(t)
            continue
          }
          if (qty != null && unit == null && isAlpha(t)) {
            unit = t
            continue
          }
          if (qty != null && unit != null) {
            if ((t === 'Y' || t === 'N') && x > money[0][0] - 60) continue
            desc.push(t)
          }
        }
        const line = {
          refNo: hasRef ? words[0][1] : 'NOREF',
          quantity: qty,
          unit,
          description: desc.join(' ').trim(),
          amount: moneyValue(money[money.length - 1][1]),
          price: moneyValue(money[money.length - 2][1]),
          note: [] as string[],
        }
        const carried = first && lastBefore && sameLine(line, lastBefore, line.price, lastBefore.price)
        first = false
        if (carried && lastBefore) {
          // The line carried over: its notes are printed again here in full,
          // where the page before cut them off.
          current = lastBefore
          current.note = []
        } else {
          current = line
          items.push(current)
        }
        continue
      }
      if (STOP.test(joined)) {
        current = null
        continue
      }
      if (!current) continue
      // Notes: the words in the Description column, left of the prices.
      const note = words.filter(([x, t]) => x >= descX - 40 && !MONEY.test(t) && t !== 'Y' && t !== 'N').map(([, t]) => t)
      if (note.length) current.note.push(note.join(' '))
    }
  }
  return items.map((it) => ({
    refNo: it.refNo,
    quantity: it.quantity,
    unit: it.unit,
    description: it.description,
    amount: it.amount,
    note: it.note
      .join(' ')
      .replace(/\s*Continued on next page\.*/gi, '')
      .trim(),
  }))
}

/** Helvetica's advance widths (per 1000 em) for printable ASCII, space to tilde. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
]
const charWidth = (c: string) => {
  const n = c.charCodeAt(0)
  return n >= 32 && n <= 126 ? HELVETICA[n - 32] : 556
}

/** Text fragments as pdf.js gives them: a run of text, where it starts, how wide and tall. */
export type Fragment = { str: string; x: number; y: number; width: number; height: number }

/**
 * pdf.js text runs into words with an X each, the way PyMuPDF hands them over.
 *
 * pdf.js gives runs, not words: one run can hold several words ("1 Jug"), and
 * one word can come as two runs with no space between them. Runs on a line are
 * joined left to right — glued where one ends where the next begins — then
 * split on whitespace, each word placed by its characters' share of the run's
 * width. Good to a point or two, and every rule here has tens of points of room.
 */
export function wordsFromFragments(frags: Fragment[]): Word[] {
  const lines: { y: number; f: Fragment[] }[] = []
  for (const f of frags) {
    if (!f.str) continue
    const l = lines.find((x) => Math.abs(x.y - f.y) <= 1.5)
    if (l) l.f.push(f)
    else lines.push({ y: f.y, f: [f] })
  }
  const words: Word[] = []
  for (const l of lines) {
    l.f.sort((a, b) => a.x - b.x)
    // Characters with their X, a null for a gap between words.
    const chars: ({ c: string; x: number; y: number } | null)[] = []
    let end = -Infinity
    for (const f of l.f) {
      const gap = f.x - end
      if (chars.length && gap > Math.max(1, 0.2 * (f.height || 10))) chars.push(null)
      // Each character's share of the run's width, by Helvetica's widths
      // scaled to the run: an "i" is narrower than an "m", and counting them
      // as equal put a word late in a long run ten points out.
      const cs = [...f.str]
      const ws = cs.map(charWidth)
      const scale = f.width / (ws.reduce((s, w) => s + w, 0) || 1)
      let at = f.x
      cs.forEach((c, k) => {
        chars.push(/\s/.test(c) ? null : { c, x: at, y: f.y })
        at += ws[k] * scale
      })
      end = f.x + f.width
    }
    let cur: { x: number; y: number; text: string } | null = null
    for (const ch of [...chars, null]) {
      if (ch == null) {
        if (cur) words.push(cur)
        cur = null
      } else if (cur) cur.text += ch.c
      else cur = { x: ch.x, y: ch.y, text: ch.c }
    }
  }
  return words
}

/** Money with two to four decimals: the blend tickets price to the hundredth of a cent. */
const MONEY4 = /^\(?\$[\d,]+\.\d{2,4}\)?$/
/** "13.8000 Metric Tonne | $812.5000 / Metric Tonne" under Comments, after the ticket's note. */
const TICKET = /^(.*?)\s*\|\s*([\d,]+(?:\.\d+)?)\s+([A-Za-z][A-Za-z ]*?)\s*\|\s*(\$[\d,]+\.\d{2,4})\s*\/\s*(.+)$/
/** "28.9-8.2-6.1-4.1-0.4B-0.1Zn Blend <what it was for>" */
const BLEND = /^(\d[\d.]*(?:-[\d.]+[A-Za-z]*)+)\s+Blend\b\s*(.*)$/
/** "2 Fertilizer Blends": a sum of blend tickets, not a product. */
export const FERT_SUM = /^\d+ Fertilizer Blends?$/i

type OnlineLine = { y: number; desc: string[]; qty: number; units: string[]; price: number; amount: number; note: string[] }

/**
 * The other way ICI prints an invoice: "Description · Qty · Unit Price ·
 * Total $ · Taxes", dates as 06/20/2025, no LOT numbers.
 *
 * It is what the bookkeeper attached in QuickBooks for most of 2024 and 2025;
 * the emailed copies of the same invoices are the printed layout above. Its
 * lines are written the printed layout's way, so the two paths agree on a line
 * and on a product name:
 *
 * - the first word of the unit is the pack unit and the rest goes in front of
 *   the description — "Metric Tonne" is pack unit "Metric" and a description
 *   starting "Tonne", "US Gallon" is "US" and "Gallon …", as the printed
 *   layout's columns come out;
 * - a blend's description carries what it was for on the same line ("… Blend
 *   #10 DURUM DRILL NW 13-40-26"): the analysis and "Blend" are the product,
 *   the rest is the note;
 * - "2 Fertilizer Blends" is a sum of tickets listed under Comments; where the
 *   tickets add up to it, they are the lines instead.
 *
 * A description that wraps sits just above its numbers (the cell is centred),
 * a note just below.
 */
export function onlineInvoice(pages: Word[][]): { items: RawItem[]; notes: NoteItem[] } | null {
  let found = false
  const lines: OnlineLine[] = []
  const comments: string[] = []
  for (const page of pages) {
    const rows = groupRows(page)
    const hi = rows.findIndex((r) => {
      const t = new Set(r.w.map(([, w]) => w))
      return t.has('Description') && t.has('Qty') && t.has('Total')
    })
    if (hi < 0) continue
    found = true
    const qtyX = rows[hi].w.find(([, t]) => t === 'Qty')![0]
    // The totals box on the right of the comments: SubTotal, GST, Amount Due.
    const subX = rows.flatMap((r) => r.w.filter(([, t]) => t === 'SubTotal').map(([x]) => x))
    const rightX = subX.length ? Math.min(...subX) - 5 : Infinity

    type Parsed = { y: number; item: OnlineLine | null; text: string[] }
    const parsed: Parsed[] = []
    let section: 'items' | 'after' | 'comments' = 'items'
    for (const r of rows.slice(hi + 1)) {
      if (r.w.length === 1 && r.w[0][1] === 'Comments') {
        section = 'comments'
        continue
      }
      if (section === 'comments') {
        const t = r.w.filter(([x]) => x < rightX).map(([, w]) => w)
        if (t.length) comments.push(t.join(' '))
        continue
      }
      if (r.w.some(([, t]) => t === 'SubTotal')) section = 'after'
      if (section !== 'items') continue
      const money = r.w.filter(([, t]) => MONEY4.test(t))
      const qty = money.length >= 2 ? r.w.find(([x, t]) => NUMBER.test(t) && x >= qtyX - 15 && x < money[0][0]) : undefined
      if (qty) {
        parsed.push({
          y: r.y,
          text: [],
          item: {
            y: r.y,
            desc: r.w.filter(([x]) => x < qty[0] - 2).map(([, t]) => t),
            qty: Number(qty[1]),
            units: r.w.filter(([x, t]) => x > qty[0] && x < money[0][0] && isAlpha(t)).map(([, t]) => t),
            price: moneyValue(money[0][1]),
            amount: moneyValue(money[money.length - 1][1]),
            note: [],
          },
        })
      } else {
        const t = r.w.filter(([x]) => x < qtyX - 2).map(([, w]) => w)
        if (t.length) parsed.push({ y: r.y, item: null, text: t })
      }
    }
    let last: OnlineLine | null = null
    parsed.forEach((p, k) => {
      if (p.item) {
        last = p.item
        lines.push(p.item)
        return
      }
      const next = parsed[k + 1]
      // A wrapped description: the item just below has its numbers but no words.
      if (next?.item && !next.item.desc.length && next.y - p.y <= 8) next.item.desc = p.text
      else if (last) last.note.push(p.text.join(' '))
    })
  }
  if (!found) return null

  // The tickets under Comments, each a product line then its "note | qty unit | $price / unit".
  const tickets: { product: string; note: string; qty: number; units: string[]; price: number }[] = []
  comments.forEach((c, k) => {
    const m = c.match(TICKET)
    if (!m || k === 0 || TICKET.test(comments[k - 1])) return
    tickets.push({ product: comments[k - 1], note: m[1], qty: Number(m[2].replace(/,/g, '')), units: m[3].split(/\s+/), price: moneyValue(m[4]) })
  })
  let used = 0
  const expanded: OnlineLine[] = lines.flatMap((l) => {
    if (!FERT_SUM.test(l.desc.join(' '))) return [l]
    // As many tickets as add up to the line, in order.
    const take: typeof tickets = []
    let sum = 0
    for (let k = used; k < tickets.length && sum < l.qty - 0.005; k++) {
      take.push(tickets[k])
      sum += tickets[k].qty
    }
    if (!take.length || Math.abs(sum - l.qty) > 0.011) return [l]
    used += take.length
    return take.map((t) => ({
      y: l.y,
      desc: t.product.split(/\s+/),
      qty: t.qty,
      units: t.units,
      price: t.price,
      amount: Math.round(t.qty * t.price * 100) / 100,
      note: [t.note],
    }))
  })

  const items: RawItem[] = []
  const notes: NoteItem[] = []
  expanded.forEach((l, k) => {
    let description = l.desc.join(' ').trim()
    const note = [...l.note]
    const b = description.match(BLEND)
    if (b) {
      description = `${b[1]} Blend`
      if (b[2]) note.unshift(b[2])
    }
    const [unit = '', ...rest] = l.units
    // A blend sum left unspread keeps its own words: "Tonne 2 Fertilizer
    // Blends" would read as a blend product to the insert trigger.
    if (!FERT_SUM.test(description)) description = [...rest, description].join(' ').trim()
    if (!description) return
    items.push({ refNo: null, quantity: l.qty, packUnit: unit, description, unitPrice: l.price, amount: l.amount })
    // No LOT numbers on this layout, so each line is its own: an Edge line
    // cannot take the field of whichever blend happened to be last.
    notes.push({ refNo: `NOREF-${k + 1}`, quantity: l.qty, unit: unit || null, description, amount: l.amount, note: note.join(' ').trim() })
  })
  return { items, notes }
}

export type IciPdfReading = { layout: 'printed' | 'online'; items: RawItem[]; notes: NoteItem[] }

/** Whichever layout the invoice is in; null when it is neither (a statement, a receipt, a scan). */
export function readIciPages(pages: Word[][]): IciPdfReading | null {
  if (pages.some((p) => headerOf(groupRows(p)))) return { layout: 'printed', items: invoiceItems(pages), notes: invoiceNotes(pages) }
  const online = onlineInvoice(pages)
  return online ? { layout: 'online', ...online } : null
}
