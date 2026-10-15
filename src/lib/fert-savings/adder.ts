/**
 * The Alberta adder, worked out from the farm's own prices.
 *
 * DTN's weekly series is US Midwest retail. What a tonne costs here sits above
 * (or below) it by freight, the retailer's margin and where the product is made,
 * and that gap is the "adder" the Savings tools put on a DTN price to make it an
 * Alberta price. Typing it in meant guessing; the app has both sides of the
 * subtraction, so it does the sum itself, one product and one month at a time:
 *
 *   adder = what it cost here that month − DTN that month in CA$/tonne
 *
 * "What it cost here" is ICI's invoices where the farm bought the straight that
 * month — the price this farm actually pays — and otherwise Alberta's monthly
 * Farm Input Prices survey, which is a provincial average but is there every
 * month. Each month says which it used.
 *
 * Pure: the hook in data.ts hands it rows it already has loaded.
 */

import { KG_PER_SHORT_TON } from './straights'
import { farmRetailer } from '../farm-context'

/**
 * How many months the current adder is the median of.
 *
 * One month is too noisy to carry: the survey and DTN sample different weeks,
 * a single ICI invoice can be a contract price set months earlier, and the
 * survey's figure for a month lands weeks late. Six months covers a spring and
 * a fall booking without reaching back into last year's market, and a median
 * (not a mean) means one odd invoice moves it by a step, not by its size.
 */
export const ADDER_WINDOW_MONTHS = 6

/**
 * Below this, a month's adder is flagged rather than used.
 *
 * Alberta can legitimately sit under the US Midwest — nitrogen is made at
 * Redwater and Medicine Hat and potash in Saskatchewan, so the freight runs the
 * other way — which is why the floor is not zero. Past this, it is more likely a
 * mismatch: a contract price, a wrong unit, or a product mapped to the wrong DTN
 * series.
 */
export const ADDER_FLOOR_PER_TONNE = -250

/** A month's adder above this share of the DTN price is flagged as wildly off. */
export const ADDER_CEILING_SHARE = 0.6

/**
 * ICI lines smaller than this are not a bulk price and are left out. A tote of
 * filtered UAN or a pallet of jugs costs several times the bulk tonne, and one
 * of them would read as a huge adder.
 */
export const MIN_ICI_TONNES = 2

export type LocalSource = 'ICI' | 'Alberta survey'

/** One ICI invoice line for a straight, already in CA$/tonne of product. */
export type IciPriceLine = { key: string; on: string; perTonne: number; tonnes: number | null }
/** One Alberta survey figure for a straight, CA$/tonne, dated the 1st of its month. */
export type SurveyPrice = { key: string; on: string; perTonne: number }
/** One DTN week, US$ per short ton. */
export type DtnWeek = { on: string; usd: number }
/** One day's Bank of Canada rate, CA$ per US$. */
export type FxDay = { on: string; rate: number }

export type AdderMonth = {
  key: string
  /** 'YYYY-MM'. */
  month: string
  /** CA$/tonne paid here that month. */
  local: number
  localSource: LocalSource
  /** ICI: tonnes the average is weighted over. Survey: null. */
  localTonnes: number | null
  /** The DTN weeks averaged, US$/short ton. */
  dtnUsd: number
  dtnWeeks: number
  fx: number
  /** Null when the rate is that month's own average; otherwise the day it was borrowed from. */
  fxBorrowedFrom: string | null
  /** DTN converted, CA$/tonne. */
  dtnCad: number
  adder: number
  /** Why this month is not counted, when it is not. */
  flag: string | null
}

export type ProductAdder = {
  key: string
  /** CA$/tonne, or null when no month is usable. */
  perTonne: number | null
  /** The months the median is over, oldest first. */
  used: AdderMonth[]
  /** Every month both sides have, oldest first, flagged ones included. */
  months: AdderMonth[]
  /** "from ICI invoices, Jul–Sep 2026", for the page. */
  basis: string | null
}

/**
 * Which straight an Alberta survey row is, by its item_key.
 *
 * Only the bulk straights DTN also prices. Anhydrous is left out on purpose: the
 * survey's line is "full service with applicator", which includes the toolbar
 * rental DTN's product price does not. The survey called MAP 11-51-0 until
 * mid-2025 and 11-52-0 after; it is the same product.
 */
export function surveyKeyOf(itemKey: string): string | null {
  const k = itemKey.toLowerCase()
  if (!k.startsWith('fertilizer-') || !k.endsWith('bulk-tonne')) return null
  if (k.includes('anhydrous')) return null
  if (/^fertilizer-46-0-0-/.test(k)) return '46-0-0'
  if (/^fertilizer-11-5[12]-0-/.test(k)) return '11-52-0'
  if (/^fertilizer-0-0-60-/.test(k)) return '0-0-60'
  if (/^fertilizer-21-0-0-24-/.test(k)) return '21-0-0-24'
  return null
}

const monthOf = (on: string) => on.slice(0, 7)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const monthsBetween = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1]

/** "Jul–Sep 2026", "Nov 2025–Feb 2026", "Jul 2026". */
export function monthSpan(months: string[]): string {
  if (!months.length) return ''
  const s = [...months].sort()
  const a = s[0]
  const b = s[s.length - 1]
  if (a === b) return `${monthLabel(a)} ${a.slice(0, 4)}`
  if (a.slice(0, 4) === b.slice(0, 4)) return `${monthLabel(a)}–${monthLabel(b)} ${b.slice(0, 4)}`
  return `${monthLabel(a)} ${a.slice(0, 4)}–${monthLabel(b)} ${b.slice(0, 4)}`
}

function basisOf(used: AdderMonth[]): string | null {
  if (!used.length) return null
  const ici = used.filter((m) => m.localSource === 'ICI').map((m) => m.month)
  const survey = used.filter((m) => m.localSource === 'Alberta survey').map((m) => m.month)
  if (!survey.length) return `from ${farmRetailer()} invoices, ${monthSpan(ici)}`
  if (!ici.length) return `from Alberta's input price survey, ${monthSpan(survey)}`
  return `from ${farmRetailer()} invoices (${monthSpan(ici)}) and Alberta's survey (${monthSpan(survey)})`
}

/**
 * The exchange rate for a month: that month's average where there are days in
 * it, else the nearest day there is — said, because a borrowed rate is a guess.
 */
function fxForMonth(month: string, fx: FxDay[]): { rate: number; borrowedFrom: string | null } | null {
  const inMonth = fx.filter((f) => monthOf(f.on) === month)
  if (inMonth.length) return { rate: mean(inMonth.map((f) => f.rate)), borrowedFrom: null }
  if (!fx.length) return null
  const mid = Date.parse(`${month}-15`)
  const near = fx.reduce((best, f) => (Math.abs(Date.parse(f.on) - mid) < Math.abs(Date.parse(best.on) - mid) ? f : best))
  return { rate: near.rate, borrowedFrom: near.on }
}

/**
 * Every product's monthly adders and the one to use now.
 *
 * Only products with a DTN series are worked out; a month needs a local price
 * and at least one DTN week inside it.
 */
export function computeAdders(input: {
  ici: IciPriceLine[]
  survey: SurveyPrice[]
  /** DTN weeks by straight key. */
  dtn: Map<string, DtnWeek[]>
  fx: FxDay[]
}): Map<string, ProductAdder> {
  const out = new Map<string, ProductAdder>()
  for (const [key, weeks] of input.dtn) {
    const dtnByMonth = new Map<string, number[]>()
    for (const w of weeks) {
      if (!(w.usd > 0)) continue
      const m = monthOf(w.on)
      dtnByMonth.set(m, [...(dtnByMonth.get(m) ?? []), w.usd])
    }

    // ICI per month, weighted by tonnes so a 30 t load outweighs a 3 t top-up.
    const iciByMonth = new Map<string, { cost: number; tonnes: number }>()
    for (const l of input.ici) {
      if (l.key !== key || l.tonnes == null || l.tonnes < MIN_ICI_TONNES || !(l.perTonne > 0)) continue
      const m = monthOf(l.on)
      const cur = iciByMonth.get(m) ?? { cost: 0, tonnes: 0 }
      iciByMonth.set(m, { cost: cur.cost + l.perTonne * l.tonnes, tonnes: cur.tonnes + l.tonnes })
    }
    const surveyByMonth = new Map<string, number[]>()
    for (const s of input.survey) {
      if (s.key !== key || !(s.perTonne > 0)) continue
      const m = monthOf(s.on)
      surveyByMonth.set(m, [...(surveyByMonth.get(m) ?? []), s.perTonne])
    }

    const months: AdderMonth[] = []
    for (const [month, usds] of [...dtnByMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ici = iciByMonth.get(month)
      const survey = surveyByMonth.get(month)
      if (!ici && !survey) continue
      const fx = fxForMonth(month, input.fx)
      if (!fx) continue
      const dtnUsd = mean(usds)
      const dtnCad = dtnUsd * (1000 / KG_PER_SHORT_TON) * fx.rate
      const local = ici ? ici.cost / ici.tonnes : mean(survey!)
      const adder = local - dtnCad
      const flag =
        adder < ADDER_FLOOR_PER_TONNE
          ? `$${Math.round(-adder)}/t under DTN — more than freight explains`
          : adder > dtnCad * ADDER_CEILING_SHARE
            ? `$${Math.round(adder)}/t over DTN — over ${Math.round(ADDER_CEILING_SHARE * 100)}% of the price`
            : null
      months.push({
        key,
        month,
        local,
        localSource: ici ? 'ICI' : 'Alberta survey',
        localTonnes: ici ? ici.tonnes : null,
        dtnUsd,
        dtnWeeks: usds.length,
        fx: fx.rate,
        fxBorrowedFrom: fx.borrowedFrom,
        dtnCad,
        adder,
        flag,
      })
    }

    const good = months.filter((m) => !m.flag)
    const latest = good[good.length - 1]?.month
    const used = latest ? good.filter((m) => monthsBetween(m.month, latest) < ADDER_WINDOW_MONTHS) : []
    out.set(key, {
      key,
      perTonne: used.length ? median(used.map((m) => m.adder)) : null,
      used,
      months,
      basis: basisOf(used),
    })
  }
  return out
}
