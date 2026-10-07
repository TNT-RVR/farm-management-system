// The four auction markets the cattle prices come from, how their series are
// named, and how the Markets tab picks the one figure it puts at the top.
//
// Since 5 Oct 2026 these REPLACE the Alberta Agriculture review's markets
// (Clyde, Ponoka, Strathmore, Ontario) on the cattle tab. Those series are
// still stored and still ingested; they are just not drawn or used here.
//
// Pure: no imports, so the Netlify ingesters and the browser share it.

export type MarketKey = 'medicine-hat' | 'lethbridge' | 'calgary' | 'team-online'

export type AuctionMarket = {
  key: MarketKey
  /** Short, for a chart legend or a card. */
  label: string
  /** Who runs it, for the info text. */
  full: string
  /** market_series.source */
  source: 'mhfc' | 'perlich' | 'calgary-stockyards' | 'team'
  url: string
  colour: string
}

export const AUCTION_MARKETS: AuctionMarket[] = [
  {
    key: 'medicine-hat',
    label: 'Medicine Hat',
    full: 'Medicine Hat Feeder Co-op',
    source: 'mhfc',
    url: 'https://mhfc.ca/auction/report/market',
    colour: '#0f766e',
  },
  {
    key: 'lethbridge',
    label: 'Lethbridge',
    full: 'Perlich Bros, Lethbridge',
    source: 'perlich',
    url: 'https://perlich.auction/market-report/',
    colour: '#c2410c',
  },
  {
    // The yard is at Strathmore. Deliberately NOT called Strathmore here: the
    // Alberta review's "Strathmore" series is a different feed of the same
    // sale, and two lines both labelled Strathmore would be read as one.
    key: 'calgary',
    label: 'Calgary Stockyards',
    full: 'Calgary Stockyards (sale at Strathmore)',
    source: 'calgary-stockyards',
    url: 'https://www.calgarystockyards.com/',
    colour: '#4338ca',
  },
  {
    key: 'team-online',
    label: 'Team online',
    full: 'Team Auction Sales online feeder sale',
    source: 'team',
    url: 'https://www.teamauctionsales.com/',
    colour: '#a16207',
  },
]

export const MARKET_KEYS = AUCTION_MARKETS.map((m) => m.key)
export const marketByKey = (k: string): AuctionMarket | undefined => AUCTION_MARKETS.find((m) => m.key === k)

/** The farm's own markets — Home Ranch and East Ranch sell into these first. */
export const NEAREST_MARKETS: MarketKey[] = ['medicine-hat', 'lethbridge']

// ── Weight bands ────────────────────────────────────────────────────────────
//
// Every market writes its classes differently: Perlich "400 - 500", Calgary
// Stockyards and Team "400-499", Medicine Hat "401 to 500 lbs". They are all
// the same 100 lb band, so they are normalised to 400-500 before they become
// a series code — otherwise the same calves would be four different lines.
// Medicine Hat's heavy classes are not 100 lb wide (1001 to 1250, 1500 to
// 3999); those keep their own edges, rounded the same way (1000-1250,
// 1500-4000). "And over" classes (900+, +1000, 1000 and over) have no top.

export type Band = { lo: number; hi: number | null }

/** 501 → 500 and 499 → 500: the off-by-one each market writes its edges with. */
export function normaliseBand(lo: number, hi: number | null): Band {
  const l = lo % 50 === 1 ? lo - 1 : lo
  const h = hi == null ? null : hi % 50 === 49 ? hi + 1 : hi
  return { lo: l, hi: h }
}

export const bandKey = (b: Band) => (b.hi == null ? `${b.lo}-plus` : `${b.lo}-${b.hi}`)

export function parseBandKey(s: string): Band | null {
  const m = /^(\d{3,4})-(\d{3,4}|plus)$/.exec(s)
  if (!m) return null
  return { lo: Number(m[1]), hi: m[2] === 'plus' ? null : Number(m[2]) }
}

export const bandLabel = (b: Band) => (b.hi == null ? `${b.lo}+ lb` : `${b.lo}–${b.hi} lb`)
/** In a series' commodity, with a plain hyphen like the Alberta series. */
const bandText = (b: Band) => (b.hi == null ? `${b.lo}+ lb` : `${b.lo}-${b.hi} lb`)

export const inBand = (lb: number, b: Band) => lb >= b.lo && (b.hi == null || lb < b.hi)

/** The middle of a band; an open-topped one is taken as 100 lb wide. */
export const bandMid = (b: Band) => (b.hi == null ? b.lo + 50 : (b.lo + b.hi) / 2)

// ── Series codes ────────────────────────────────────────────────────────────
//
// Always five parts: ab.<class>.<kind>.<band>.<market>, the same shape as the
// Alberta review's ab.feeder.steers.500-600.strathmore, so the existing chart
// and price alerts read them unchanged.
//
//   ab.feeder.steers.400-500.lethbridge     feeder cattle by weight (calves,
//                                           and the yearlings a market sells
//                                           as plain feeders)
//   ab.yearling.steers.800-900.medicine-hat sold AS yearlings — kept apart so
//                                           they are never read as a calf price
//   ab.slaughter.heifers.900-1000.medicine-hat
//   ab.cows.d1-d2.all.lethbridge            a grade, no weight band
//   ab.cows.slaughter.1250-1500.medicine-hat
//   ab.bulls.mature.1500-4000.medicine-hat
//   ab.heiferettes.all.1000-1250.medicine-hat

export type AuctionClass = 'feeder' | 'yearling' | 'slaughter' | 'cows' | 'bulls' | 'heiferettes'

export type SeriesParts = {
  cls: AuctionClass
  /** steers | heifers | bulls for cattle by sex; a grade for cows; mature | yearling for bulls. */
  kind: string
  band: Band | null
  market: MarketKey
}

export const seriesCode = (p: SeriesParts) =>
  `ab.${p.cls}.${p.kind}.${p.band ? bandKey(p.band) : 'all'}.${p.market}`

const CLASSES = new Set<AuctionClass>(['feeder', 'yearling', 'slaughter', 'cows', 'bulls', 'heiferettes'])

/** The parts of one of the four markets' codes; null for anything else, the Alberta review's included. */
export function parseSeriesCode(code: string): SeriesParts | null {
  const parts = code.split('.')
  if (parts.length !== 5 || parts[0] !== 'ab') return null
  const [, cls, kind, band, market] = parts
  if (!CLASSES.has(cls as AuctionClass) || !marketByKey(market)) return null
  const b = band === 'all' ? null : parseBandKey(band)
  if (band !== 'all' && !b) return null
  return { cls: cls as AuctionClass, kind, band: b, market: market as MarketKey }
}

export const isAuctionSeries = (code: string) => parseSeriesCode(code) != null

const COW_GRADES: Record<string, string> = {
  'd1-d2': 'D1-D2 cows',
  'd3-d4': 'D3-D4 cows',
  'feeder': 'Feeder cows',
  'grain-fed': 'Grain-fed cows',
  'holstein': 'Holstein cows',
  'slaughter': 'Slaughter cows',
}

/** What is being priced, e.g. "Feeder steers 400-500 lb". Doubles as the chart's class picker. */
export function commodityFor(p: Omit<SeriesParts, 'market'>): string {
  const w = p.band ? ` ${bandText(p.band)}` : ''
  switch (p.cls) {
    case 'feeder':
      return `Feeder ${p.kind}${w}`
    case 'yearling':
      return `Yearling ${p.kind}${w}`
    case 'slaughter':
      return `Slaughter ${p.kind}${w}`
    case 'cows':
      return `${COW_GRADES[p.kind] ?? `${p.kind} cows`}${w}`
    case 'bulls':
      return `${p.kind === 'yearling' ? 'Yearling bulls' : 'Bulls'}${w}`
    case 'heiferettes':
      return `Heiferettes${w}`
  }
}

export const seriesName = (p: SeriesParts) =>
  `${commodityFor(p)} — ${marketByKey(p.market)?.label ?? p.market}`

// ── Dates ───────────────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-30" → "30 Sep". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MON[(m ?? 1) - 1]}`
}

export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

// ── The headline ────────────────────────────────────────────────────────────

/** One market's latest price for one class. $/cwt, as every market quotes it. */
export type AuctionQuote = { market: MarketKey; band: Band; perCwt: number; on: string }

/** How old a sale can be and still be "today's" price. */
export const HEADLINE_WINDOW_DAYS = 14

export type BandPrice = {
  band: Band
  perCwt: number
  /** The markets behind the figure, each with its own sale date. */
  sources: AuctionQuote[]
  /** 'nearest': Medicine Hat and/or Lethbridge sold it; 'week': the markets that sold it that week. */
  basis: 'nearest' | 'week'
}

/**
 * One class's price: the nearest markets if they sold it lately, otherwise the
 * average of every market that sold it in the same week.
 *
 * Never one market's row picked by sort order. Until 5 Oct 2026 the tab took
 * whichever 500-600 lb steer row happened to come first — Clyde, that week —
 * and called it the Alberta price.
 */
export function bandPrice(quotes: AuctionQuote[], today: string, windowDays = HEADLINE_WINDOW_DAYS): BandPrice | null {
  // Each market's newest sale of the class inside the window.
  const latest = new Map<MarketKey, AuctionQuote>()
  for (const q of quotes) {
    const age = daysBetween(q.on, today)
    if (age < 0 || age > windowDays) continue
    const cur = latest.get(q.market)
    if (!cur || q.on > cur.on) latest.set(q.market, q)
  }
  if (latest.size === 0) return null
  const all = [...latest.values()]
  const near = all.filter((q) => NEAREST_MARKETS.includes(q.market))
  const pick = near.length
    ? near
    : (() => {
        const newest = all.reduce((a, q) => (q.on > a ? q.on : a), all[0].on)
        return all.filter((q) => daysBetween(q.on, newest) <= 6)
      })()
  const order = (q: AuctionQuote) => MARKET_KEYS.indexOf(q.market)
  pick.sort((a, b) => order(a) - order(b))
  return {
    band: pick[0].band,
    perCwt: pick.reduce((s, q) => s + q.perCwt, 0) / pick.length,
    sources: pick,
    basis: near.length ? 'nearest' : 'week',
  }
}

export type Headline = {
  weightLb: number
  perCwt: number
  perLb: number
  /**
   * quote: a market sold the class the farm's weight falls in.
   * derived: no market sold it; read off the slide between the classes either side.
   * extrapolated: lighter (or heavier) than any class sold; the slide is run past the end.
   */
  kind: 'quote' | 'derived' | 'extrapolated'
  /** The class the farm's weight falls in. */
  band: Band
  /** The class (quote) or the two classes (derived/extrapolated) the figure stands on. */
  from: BandPrice[]
  /** $/cwt per lb between the two classes; negative when lighter cattle are dearer. */
  slope: number | null
  /** For extrapolated: past which end. */
  direction?: 'below' | 'above'
}

/** The 100 lb band a weight sits in, for a weight no market quoted. */
const bandAround = (lb: number): Band => ({ lo: Math.floor(lb / 100) * 100, hi: Math.floor(lb / 100) * 100 + 100 })

/**
 * The figure at the top of the tab, for one sex at the farm's sale weight.
 *
 * `quotes` is every observation of that sex's feeder classes at the four
 * markets — the window and the market preference are applied here.
 */
export function headlinePrice(quotes: AuctionQuote[], weightLb: number, today: string): Headline | null {
  const byBand = new Map<string, AuctionQuote[]>()
  for (const q of quotes) {
    const k = bandKey(q.band)
    const list = byBand.get(k) ?? []
    list.push(q)
    byBand.set(k, list)
  }
  const classes = [...byBand.values()]
    .map((qs) => bandPrice(qs, today))
    .filter((b): b is BandPrice => b != null)
    .sort((a, b) => a.band.lo - b.band.lo)
  if (classes.length === 0) return null

  const own = classes.find((c) => inBand(weightLb, c.band))
  if (own) {
    return {
      weightLb,
      perCwt: own.perCwt,
      perLb: own.perCwt / 100,
      kind: 'quote',
      band: own.band,
      from: [own],
      slope: null,
    }
  }

  // Nothing sold in the farm's own class: slide from the two classes nearest it.
  if (classes.length < 2) return null
  let a: BandPrice
  let b: BandPrice
  let kind: Headline['kind'] = 'derived'
  let direction: Headline['direction']
  if (weightLb < bandMid(classes[0].band)) {
    ;[a, b] = [classes[0], classes[1]]
    kind = 'extrapolated'
    direction = 'below'
  } else if (weightLb > bandMid(classes[classes.length - 1].band)) {
    ;[a, b] = [classes[classes.length - 2], classes[classes.length - 1]]
    kind = 'extrapolated'
    direction = 'above'
  } else {
    const i = classes.findIndex((c) => bandMid(c.band) > weightLb)
    ;[a, b] = [classes[i - 1], classes[i]]
  }
  const ma = bandMid(a.band)
  const mb = bandMid(b.band)
  if (mb === ma) return null
  const slope = (b.perCwt - a.perCwt) / (mb - ma)
  // Measured from the class nearer the farm's weight, so the arithmetic in the
  // info button starts from a number somebody actually paid.
  const anchor = Math.abs(weightLb - ma) <= Math.abs(weightLb - mb) ? a : b
  const perCwt = anchor.perCwt + (weightLb - bandMid(anchor.band)) * slope
  return {
    weightLb,
    perCwt,
    perLb: perCwt / 100,
    kind,
    band: bandAround(weightLb),
    from: anchor === a ? [a, b] : [b, a],
    slope,
    direction,
  }
}

const cwt = (v: number) => `$${v.toFixed(2)}/cwt`
const where = (b: BandPrice) =>
  b.sources.map((s) => `${marketByKey(s.market)?.label ?? s.market} ${shortDate(s.on)}`).join(', ')

/** "Medicine Hat 30 Sep" or "average of Calgary Stockyards 2 Oct, Team online 2 Oct". */
export function sourceLine(b: BandPrice): string {
  return b.sources.length > 1 ? `average of ${where(b)}` : where(b)
}

/** The one line under the figure. */
export function headlineSub(h: Headline): string {
  if (h.kind === 'quote') return `${bandLabel(h.band)} class · ${sourceLine(h.from[0])}`
  const [anchor] = h.from
  if (h.kind === 'extrapolated') {
    return h.direction === 'below'
      ? `extrapolated below the lightest class sold (${bandLabel(anchor.band)}, ${sourceLine(anchor)})`
      : `extrapolated above the heaviest class sold (${bandLabel(anchor.band)}, ${sourceLine(anchor)})`
  }
  return `derived from ${bandLabel(h.from[0].band)} and ${bandLabel(h.from[1].band)} · ${sourceLine(anchor)}`
}

/**
 * The info button, in plain words with the live numbers. Each paragraph is one
 * step a person could check with a pencil.
 */
export function explainHeadline(h: Headline, sex: 'steers' | 'heifers'): string[] {
  const out: string[] = []
  const pick = (b: BandPrice) =>
    b.basis === 'nearest'
      ? `Medicine Hat and Lethbridge are the nearest markets, so they come first: ${b.sources
          .map((s) => `${marketByKey(s.market)?.label} ${cwt(s.perCwt)} (${shortDate(s.on)})`)
          .join(', ')}.`
      : `Neither Medicine Hat nor Lethbridge sold it in the last ${HEADLINE_WINDOW_DAYS} days, so this is the average of the markets that did that week: ${b.sources
          .map((s) => `${marketByKey(s.market)?.label} ${cwt(s.perCwt)} (${shortDate(s.on)})`)
          .join(', ')}.`

  if (h.kind === 'quote') {
    const b = h.from[0]
    out.push(`${h.weightLb} lb ${sex} fall in the ${bandLabel(b.band)} class, and it sold — this is a quote, not an estimate.`)
    out.push(pick(b))
    out.push(
      `${b.sources.length > 1 ? `Average ${cwt(b.perCwt)}` : cwt(b.perCwt)}. Markets quote dollars per hundredweight (100 lb), so that is $${h.perLb.toFixed(2)}/lb.`,
    )
    return out
  }

  const [anchor, other] = h.from
  const ma = bandMid(anchor.band)
  const mo = bandMid(other.band)
  const gap = h.weightLb - ma
  out.push(
    `No market sold ${bandLabel(h.band)} ${sex} in the last ${HEADLINE_WINDOW_DAYS} days, so the price is worked out from the two classes nearest ${h.weightLb} lb that did.`,
  )
  out.push(`${bandLabel(anchor.band)}: ${cwt(anchor.perCwt)}. ${pick(anchor)}`)
  out.push(`${bandLabel(other.band)}: ${cwt(other.perCwt)}. ${pick(other)}`)
  const slope = h.slope ?? 0
  out.push(
    `Between the middles of those classes (${ma} and ${mo} lb) the price moves ${slope < 0 ? 'down' : 'up'} $${Math.abs(slope).toFixed(2)}/cwt for every extra pound.`,
  )
  out.push(
    `${h.weightLb} lb is ${Math.abs(gap)} lb ${gap < 0 ? 'lighter' : 'heavier'} than ${ma}, so: $${anchor.perCwt.toFixed(2)} ${gap * slope >= 0 ? '+' : '−'} ${Math.abs(gap)} × $${Math.abs(slope).toFixed(2)} = ${cwt(h.perCwt)}, or $${h.perLb.toFixed(2)}/lb.`,
  )
  if (h.kind === 'extrapolated') {
    out.push(
      h.direction === 'below'
        ? `This is extrapolated below the lightest class sold — the slide is carried past the last class anybody paid for. Treat it as a guide, not a bid.`
        : `This is extrapolated above the heaviest class sold. Treat it as a guide, not a bid.`,
    )
  }
  return out
}

// ── Cull cows ───────────────────────────────────────────────────────────────
//
// Sam (5 Oct 2026): "It is $215/lb right now [$/cwt], but see if there is
// some market price somewhere that we can get a live reading of latest
// pricing on cull cows." Lethbridge and Calgary Stockyards quote D1-D2 cows
// (the good cull cows) as a grade; Medicine Hat quotes "slaughter cows" by
// weight class. The nearest markets come first, as for the calves.

export type CowQuote = { market: MarketKey; kind: string; band: Band | null; perCwt: number; on: string }

export type CullCowPrice = {
  perCwt: number
  /** Each market behind the figure, with what it sold and when. */
  sources: (CowQuote & { what: string })[]
  basis: 'nearest' | 'week'
}

/** A cow series this reads: D1-D2 cows anywhere, or slaughter cows by weight. */
export const isCullCowSeries = (p: SeriesParts | null) => p != null && p.cls === 'cows' && (p.kind === 'd1-d2' || p.kind === 'slaughter')

/**
 * Today's cull cow price, $/cwt, for cows of `weightLb`. Per market: D1-D2 if
 * it quotes them; else its slaughter cows in the weight class the cows fall
 * in, or the nearest class sold that day. Then the nearest markets' average,
 * or the week's markets when neither of them sold cows in the last two weeks.
 */
export function cullCowPrice(quotes: CowQuote[], weightLb: number, today: string, windowDays = HEADLINE_WINDOW_DAYS): CullCowPrice | null {
  const fresh = quotes.filter((q) => {
    const age = daysBetween(q.on, today)
    return age >= 0 && age <= windowDays
  })
  const newestOf = (qs: CowQuote[]) => qs.reduce((a, q) => (q.on > a.on ? q : a), qs[0])
  const perMarket: (CowQuote & { what: string })[] = []
  for (const m of MARKET_KEYS) {
    const mine = fresh.filter((q) => q.market === m)
    const d12 = mine.filter((q) => q.kind === 'd1-d2')
    if (d12.length) {
      perMarket.push({ ...newestOf(d12), what: 'D1-D2 cows' })
      continue
    }
    const slaughter = mine.filter((q) => q.kind === 'slaughter')
    if (!slaughter.length) continue
    const day = newestOf(slaughter).on
    const sameDay = slaughter.filter((q) => q.on === day)
    const dist = (q: CowQuote) => (q.band ? (inBand(weightLb, q.band) ? 0 : Math.abs(bandMid(q.band) - weightLb)) : Number.POSITIVE_INFINITY)
    const best = sameDay.reduce((a, q) => (dist(q) < dist(a) ? q : a), sameDay[0])
    perMarket.push({ ...best, what: best.band ? `slaughter cows ${bandLabel(best.band)}` : 'slaughter cows' })
  }
  if (!perMarket.length) return null
  const near = perMarket.filter((q) => NEAREST_MARKETS.includes(q.market))
  const newest = perMarket.reduce((a, q) => (q.on > a ? q.on : a), perMarket[0].on)
  const pick = near.length ? near : perMarket.filter((q) => daysBetween(q.on, newest) <= 6)
  return { perCwt: pick.reduce((s, q) => s + q.perCwt, 0) / pick.length, sources: pick, basis: near.length ? 'nearest' : 'week' }
}

/** "Lethbridge D1-D2 cows $205.00/cwt 2 Oct · Medicine Hat slaughter cows 1250–1500 lb $192.15/cwt 1 Oct". */
export const cullCowSourceLine = (p: CullCowPrice) =>
  p.sources.map((s) => `${marketByKey(s.market)?.label ?? s.market} ${s.what} $${s.perCwt.toFixed(2)}/cwt ${shortDate(s.on)}`).join(' · ')
