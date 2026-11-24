/**
 * Read a document and say where it probably belongs.
 *
 * A suggestion, not a decision: it fills the Add form in and the person
 * accepts or overrides it. So it says WHY, in the words it found — "AFSC,
 * statement of loss" — because a suggestion you cannot check is worse than
 * none, and the one thing worse than filing a document in the wrong place is
 * not knowing it was filed by a guess.
 *
 * The words come from the PDF itself where there is one, and from the file
 * name otherwise. unpdf is loaded only when a file is actually chosen; it
 * carries pdf.js with it and nobody browsing the library should pay for that.
 */

export type Suggestion = {
  area: string
  /** The words that decided it, for the line under the field. */
  why: string[]
  docType?: string
  party?: string
  docDate?: string
  cropYear?: number
}

/**
 * What each area sounds like. Weighted: a word that only ever appears in one
 * kind of document counts for more than one that turns up everywhere.
 */
const SIGNALS: { area: string; words: [string, number][] }[] = [
  {
    area: 'insurance',
    words: [
      ['statement of loss', 5], ['afsc', 4], ['crop insurance', 5], ['agriinsurance', 4],
      ['harvested production report', 5], ['confirmation of insurance', 5], ['land report', 4],
      ['subscription', 2], ['adjuster', 3], ['endorsement', 3], ['deductible', 2],
      ['coverage', 2], ['indemnity', 3], ['premium', 2], ['claim', 2],
      // AFSC names its statements by when they were assessed, and a file
      // called "Crop- Post Harvest - 50% Advance" says nothing else at all:
      // without these it scored nothing and landed in Everything else.
      ['post harvest', 4], ['post-harvest', 4], ['pre harvest', 4], ['pre-harvest', 4],
      ['harvested production', 5], ['50% advance', 5], ['unseeded acreage', 4],
    ],
  },
  {
    area: 'agronomy',
    words: [
      ['soil test', 5], ['soil sample', 4], ['nutrient', 3], ['organic matter', 4],
      ['cec', 3], ['ppm', 2], ['fertility', 3], ['lab report', 3], ['tissue test', 5],
      ['recommendation', 2], ['nitrate', 3], ['phosphate', 3],
    ],
  },
  {
    area: 'chemicals',
    words: [
      ['safety data sheet', 5], ['sds', 3], ['pmra', 4], ['registration number', 3],
      ['active ingredient', 4], ['herbicide', 4], ['fungicide', 4], ['insecticide', 4],
      ['re-entry', 3], ['label', 2], ['rate per acre', 2],
    ],
  },
  {
    area: 'grain',
    words: [
      ['scale ticket', 5], ['grain contract', 5], ['bushels', 3], ['dockage', 4],
      ['grade', 2], ['elevator', 3], ['delivery', 2], ['tonnes', 2], ['moisture', 2],
    ],
  },
  {
    area: 'land',
    words: [
      ['lease', 5], ['landlord', 4], ['tenant', 4], ['title', 2], ['easement', 4],
      ['quarter section', 4], ['rent', 3], ['purchase agreement', 4], ['caveat', 4],
    ],
  },
  {
    area: 'cattle',
    words: [
      ['manifest', 4], ['brand inspection', 5], ['cattle', 4], ['calf', 3], ['cow', 3],
      ['head', 2], ['auction', 3], ['veterinary', 4], ['pasture', 3],
    ],
  },
  {
    area: 'money',
    words: [
      ['invoice', 5], ['statement of account', 4], ['remittance', 4], ['gst', 3],
      ['amount due', 4], ['subtotal', 3], ['terms', 2], ['purchase order', 4],
    ],
  },
  {
    area: 'utilities',
    words: [
      ['electricity', 4], ['natural gas', 4], ['kilowatt', 4], ['meter reading', 4],
      ['utility', 3], ['fuel', 3], ['billing period', 4],
    ],
  },
  {
    area: 'irrigation',
    words: [
      ['pivot', 4], ['irrigation district', 5], ['water licence', 5], ['water license', 5],
      ['acre-feet', 4], ['allocation', 3], ['pump', 3],
    ],
  },
  {
    area: 'equipment',
    words: [
      ['work order', 4], ['serial number', 3], ['warranty', 4], ['service interval', 4],
      ['parts', 2], ['hydraulic', 3], ['john deere', 3],
    ],
  },
  {
    area: 'grants',
    words: [
      ['grant', 4], ['funding', 3], ['applicant', 3], ['eligible expenses', 5],
      ['program guidelines', 4], ['cap ', 2],
    ],
  },
  {
    area: 'people',
    words: [
      ['safety', 3], ['training', 3], ['certificate', 3], ['employment', 4],
      ['payroll', 4], ['inspection checklist', 4], ['wcb', 4],
    ],
  },
]

/** The kind of document, where the words say it plainly. */
const DOC_TYPES: [RegExp, string][] = [
  [/statement of loss/i, 'Statement of loss'],
  [/confirmation of insurance/i, 'Confirmation of insurance'],
  [/harvested production report/i, 'Harvested production report'],
  [/land report/i, 'Land report'],
  [/refund/i, 'Refund statement'],
  [/safety data sheet|\bsds\b/i, 'Safety data sheet'],
  [/soil (test|sample|analysis)/i, 'Soil test'],
  [/tissue test/i, 'Tissue test'],
  [/\binvoice\b/i, 'Invoice'],
  [/scale ticket/i, 'Scale ticket'],
  [/\blease\b/i, 'Lease'],
  [/work order/i, 'Work order'],
  [/manifest/i, 'Manifest'],
]

/** Who it is from, where the document names itself. */
const PARTIES: [RegExp, string][] = [
  [/\bAFSC\b|Agriculture Financial Services/i, 'AFSC'],
  [/Government of Alberta|Alberta Agriculture/i, 'Government of Alberta'],
  [/\bPMRA\b|Pest Management Regulatory/i, 'PMRA'],
]

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')

/** A date the document states, preferring the one it calls its own. */
function findDate(text: string): string | undefined {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // 20-Nov-2026 and Nov 6, 2026 both turn up on the same page.
  const dmy = /\b(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-,\s]\s*(20\d{2})\b/.exec(text)
  if (dmy) {
    const m = MONTHS.indexOf(dmy[2].toLowerCase())
    if (m >= 0) return `${dmy[3]}-${String(m + 1).padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const mdy = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/.exec(text)
  if (mdy) {
    const m = MONTHS.indexOf(mdy[1].toLowerCase())
    if (m >= 0) return `${mdy[3]}-${String(m + 1).padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  }
  return undefined
}

function findCropYear(text: string): number | undefined {
  const named = /crop\s*year[:\s]*(20\d{2})/i.exec(text)
  if (named) return Number(named[1])
  const year = /\b(20[2-4]\d)\b/.exec(text)
  return year ? Number(year[1]) : undefined
}

/**
 * Weigh the words. `filename` counts double: a file somebody named
 * "Hail Endorsement Statement of Loss" has been labelled by a person already.
 */
export function suggestFiling(filename: string, text: string): Suggestion {
  const hay = `${filename}\n${filename}\n${text}`.toLowerCase()
  let best = { area: 'other', score: 0, why: [] as string[] }
  for (const sig of SIGNALS) {
    let score = 0
    const why: string[] = []
    for (const [word, weight] of sig.words) {
      if (hay.includes(word)) {
        score += weight
        why.push(word.trim())
      }
    }
    if (score > best.score) best = { area: sig.area, score, why: why.slice(0, 3) }
  }

  const both = `${filename}\n${text}`
  return {
    area: best.score >= 5 ? best.area : 'other',
    why: best.score >= 5 ? best.why : [],
    docType: DOC_TYPES.find(([re]) => re.test(both))?.[1],
    party: PARTIES.find(([re]) => re.test(both))?.[1],
    docDate: findDate(text),
    cropYear: findCropYear(both),
  }
}

/**
 * Words a Postgres `text` column will actually take.
 *
 * A PDF can yield a NUL byte, and Postgres cannot hold one in text at all —
 * the write is rejected outright. Exactly one of the farm's 149 invoices had
 * exactly one NUL in it, which was enough to lose that document's words, with
 * no error anyone could have acted on. A lone surrogate goes the same way: it
 * is not valid UTF-8, so the write fails on that too.
 *
 * Spreading the string walks it by code point, so a proper surrogate pair
 * arrives as one element and survives; only an unpaired half is dropped.
 */
export function storableText(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0) {
      out += ' '
      continue
    }
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    out += ch
  }
  return out
}

/**
 * The words inside a file, where we can get at them. A PDF is read with
 * unpdf, the same reader the server-side importers use. Anything else returns
 * its name alone, which is still worth something.
 */
export async function readDocumentText(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return ''
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
    const { text } = await extractText(pdf, { mergePages: true })
    // Kept whole, not just the letterhead: the words are stored on the row as
    // well as weighed, so an invoice is findable by a product on line 30. The
    // cap is there only so a 400-page manual cannot overflow the row's search
    // vector (Postgres stops at 1 MB of tsvector).
    return storableText(String(text)).slice(0, 200_000)
  } catch {
    // A scan with no text layer, or a PDF unpdf will not open. The name still
    // gets a suggestion out of the caller.
    return ''
  }
}
