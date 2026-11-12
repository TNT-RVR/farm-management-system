/**
 * Pollinators in the canola, and what would hurt them.
 *
 * From Alberta's two 2019 communication guides in the research library, "Seed
 * canola pollinators: a communication guide for seed companies and growers"
 * and the matching one for agronomists and beekeepers. They are the same
 * guidance written for the two sides of one conversation, and almost all of it
 * is timing:
 *
 *  - leafcutters in at five per cent bloom, honey bees at ten, because honey
 *    bees with nothing to forage on learn to forage somewhere else;
 *  - blooming canola is never sprayed with an insecticide;
 *  - be cautious with fungicides, or tank mixes containing one, while bees are
 *    in the field;
 *  - whatever has to go on, goes on in the evening after flight has ceased;
 *  - after leafcutters are stocked, the pivot stays off until they have
 *    hatched -- weather-dependent, but at least 36 hours;
 *  - pivot end guns must not hit the hives, which sit on the field corners;
 *  - a hailed-out field has nothing to forage, and the beekeeper must hear
 *    within 24 hours;
 *  - honey bees are usually removed in stages as bloom wanes.
 *
 * The app already holds the bloom share, the sprays, the pivot passes and the
 * hail reports. What it could not know until bee_placements existed was
 * whether there were bees in the field at all, which is why none of these
 * checks were being made.
 *
 * Nothing here decides anything on the farm's behalf. Every warning is a
 * sentence with a date and a product in it, because the guides' whole point is
 * that the grower and the beekeeper talk to each other.
 */

/** The guides, for the citation on screen. */
export const BEE_PAPERS = {
  growers: {
    title: 'Seed canola pollinators : a communication guide for seed companies and growers',
    find: 'Seed canola pollinators communication guide seed companies growers',
  },
  beekeepers: {
    title: 'Seed canola pollinators : a communication guide for agronomists and beekeepers',
    find: 'Seed canola pollinators communication guide agronomists beekeepers',
  },
} as const

export const beePaperLink = (p: { find: string }) => `/research?tab=search&q=${encodeURIComponent(p.find)}`

export type BeeKind = 'honey' | 'leafcutter'

/**
 * What each kind of bee does, in the guides' own figures.
 *
 * The foraging distances are why the two kinds take different warnings: a
 * honey bee hive on a field corner is working 800 m of country, so a spray on
 * the next field over is its business too, while a leafcutter shelter is
 * working the hundred metres around itself.
 */
export const BEE_FACTS: Record<BeeKind, { label: string; unit: string; forageM: number; flightC: number; stockAtPct: number }> = {
  leafcutter: { label: 'Leafcutter bees', unit: 'shelters', forageM: 100, flightC: 20, stockAtPct: 5 },
  honey: { label: 'Honey bees', unit: 'hives', forageM: 800, flightC: 13, stockAtPct: 10 },
}

/** "a minimum of 36 hours is required" after stocking, until the leafcutters have hatched. */
export const LEAFCUTTER_HATCH_HOURS = 36

/** "communicate any hail to beekeepers and leafcutter bee producers within 24 hours". */
export const HAIL_NOTICE_HOURS = 24

export type Placement = {
  id: string
  field_id: string
  kind: BeeKind
  placed_on: string
  removed_on: string | null
  units: number | null
  contact_id: string | null
  contactName: string | null
  note: string | null
}

/** Whether a placement has bees in the field on a given day. */
export const inFieldOn = (p: Placement, day: string) => p.placed_on <= day && (p.removed_on == null || p.removed_on >= day)

/** The days a placement covers, as a closed range; open-ended while they are still there. */
export const placementRange = (p: Placement, today: string) => ({ from: p.placed_on, to: p.removed_on ?? today })

// ---------------------------------------------------------------------------
// The stocking guide
// ---------------------------------------------------------------------------

export type StockingAdvice =
  | { state: 'too early'; pct: number; next: BeeKind }
  | { state: 'stock leafcutters'; pct: number }
  | { state: 'stock honey bees'; pct: number }
  | { state: 'both due'; pct: number }
  | { state: 'in'; pct: number }
  | { state: 'waning'; pct: number }
  | { state: 'over'; pct: number }
  | { state: 'unknown' }

/**
 * What the bloom share says about bringing bees in, or starting to take them out.
 *
 * "The best practice is to bring in leafcutter bees at five per cent bloom and
 * honey bees at 10 per cent bloom." The share is the satellite's, so it can be
 * missing — which comes back as 'unknown' rather than as a nudge built on
 * nothing.
 */
export function stockingAdvice(args: {
  /** The satellite's share of the canopy showing petals, 0–1. */
  yellowNow: number | null
  /** The bloom model's stage, so a falling crop is not read as a rising one. */
  stage: string | null
  placements: Placement[]
  today: string
}): StockingAdvice {
  if (args.yellowNow == null) return { state: 'unknown' }
  const pct = args.yellowNow * 100
  const inField = args.placements.filter((p) => inFieldOn(p, args.today))
  const has = (k: BeeKind) => inField.some((p) => p.kind === k)

  // A crop that is over is a record, not a decision: "start taking the hives
  // out in stages" is the right line in August and a silly one in November,
  // and the two stages are told apart so the page says the right one.
  if (args.stage === 'over') return { state: 'over', pct }
  if (args.stage === 'falling') return { state: 'waning', pct }
  if (pct < BEE_FACTS.leafcutter.stockAtPct) return { state: 'too early', pct, next: 'leafcutter' }

  const leafcutterDue = !has('leafcutter')
  const honeyDue = !has('honey') && pct >= BEE_FACTS.honey.stockAtPct
  if (leafcutterDue && honeyDue) return { state: 'both due', pct }
  if (leafcutterDue) return { state: 'stock leafcutters', pct }
  if (honeyDue) return { state: 'stock honey bees', pct }
  return { state: 'in', pct }
}

// ---------------------------------------------------------------------------
// What would hurt them
// ---------------------------------------------------------------------------

export type Severity = 'never' | 'caution' | 'tell them'

export type BeeWarning = {
  severity: Severity
  /** One sentence, with the date and the thing in it. */
  text: string
  /** Which guidance it comes from, for the popover. */
  why: string
  on: string
}

export type SprayPass = {
  applied_on: string
  product_name: string
  /** 'herbicide' | 'fungicide' | 'insecticide', or null when the product could not be placed. */
  scheme: string | null
}

/** One row as either source gives it, before the two are merged. */
export type RawPass = {
  field_id: string
  operation_id: string
  product_id: string | null
  name: string
  applied_on: string
  scheme: string | null
}

/**
 * The two spray sources merged into one pass per product per operation.
 *
 * `field_moa_history_v` has a row per active ingredient and only for products
 * whose chemistry is known; `product_applications` has every pass but no
 * chemistry. Both are needed — an unplaced jug is not a cleared one — so they
 * are merged, with the placed row winning where the same pass is in both.
 *
 * Keyed on the operation and the product, never on the product's name: the two
 * sources name the same jug differently ("Cotegra" in the view, "Cotegra
 * Fungicide" in the application record), and a name-keyed merge warned about
 * one spray twice, once as a fungicide and once as a product of unknown
 * chemistry.
 */
export function mergePasses(placed: RawPass[], all: RawPass[]): Map<string, SprayPass[]> {
  const key = (p: RawPass) => `${p.field_id}|${p.operation_id}|${p.product_id ?? p.name}`
  const merged = new Map<string, RawPass>()
  for (const p of placed) merged.set(key(p), p)
  for (const p of all) if (!merged.has(key(p))) merged.set(key(p), p)

  const byField = new Map<string, SprayPass[]>()
  for (const p of merged.values()) {
    const pass: SprayPass = { applied_on: p.applied_on, product_name: p.name, scheme: p.scheme }
    byField.set(p.field_id, [...(byField.get(p.field_id) ?? []), pass])
  }
  for (const list of byField.values()) list.sort((a, b) => a.applied_on.localeCompare(b.applied_on))
  return byField
}

/**
 * Sprays that went on while there were bees in the field.
 *
 * An insecticide is the guides' one flat prohibition — "blooming canola should
 * never be sprayed with insecticides" — and so is reported as 'never' however
 * it got there, because the record is what the beekeeper would be shown. A
 * fungicide is 'caution', in the guides' own words. A product whose chemistry
 * the app could not place is reported too, rather than passed over: an
 * unplaced product is not a safe one.
 */
export function sprayWarnings(passes: SprayPass[], placements: Placement[]): BeeWarning[] {
  const out: BeeWarning[] = []
  for (const s of passes) {
    const covering = placements.filter((p) => inFieldOn(p, s.applied_on))
    if (!covering.length) continue
    const kinds = [...new Set(covering.map((p) => p.kind))].map((k) => BEE_FACTS[k].label.toLowerCase()).join(' and ')
    if (s.scheme === 'insecticide') {
      out.push({
        severity: 'never',
        on: s.applied_on,
        text: `${s.product_name}, an insecticide, went on with ${kinds} in the field`,
        why: 'Blooming canola should never be sprayed with insecticides: it is harmful to all bees and can leave residues in honey.',
      })
    } else if (s.scheme === 'fungicide') {
      out.push({
        severity: 'caution',
        on: s.applied_on,
        text: `${s.product_name}, a fungicide, went on with ${kinds} in the field`,
        why: 'The guides ask for caution with fungicides, and with tank mixes containing one, while bees are in the field — newer research indicates they can be harmful to honey bees.',
      })
    } else if (s.scheme == null) {
      out.push({
        severity: 'caution',
        on: s.applied_on,
        text: `${s.product_name} went on with ${kinds} in the field, and its chemistry is not on record`,
        why: 'A product the app cannot place in a group is not a product it can clear. Enter its actives, or check the label yourself before the next pass.',
      })
    }
  }
  return out
}

/**
 * Pivot passes inside the leafcutters' hatching window.
 *
 * "After the field is stocked with leafcutter bees, refrain from turning on the
 * irrigation pivot until the leafcutter bees have hatched (this is
 * weather-dependent, but a minimum of 36 hours is required)." Thirty-six hours
 * is the floor the guide gives, not the answer; the warning says so.
 */
export function pivotWarnings(
  events: { date: string; gross_mm: number | null }[],
  placements: Placement[],
): BeeWarning[] {
  const out: BeeWarning[] = []
  for (const p of placements) {
    if (p.kind !== 'leafcutter') continue
    const opens = p.placed_on
    const closes = addDays(p.placed_on, Math.ceil(LEAFCUTTER_HATCH_HOURS / 24))
    for (const e of events) {
      if (e.date < opens || e.date > closes) continue
      out.push({
        severity: 'never',
        on: e.date,
        text: `The pivot ran on ${e.date}${e.gross_mm == null ? '' : ` (${Math.round(e.gross_mm)} mm)`}, within ${LEAFCUTTER_HATCH_HOURS} hours of the leafcutters going in on ${p.placed_on}`,
        why: `After a field is stocked with leafcutters the pivot stays off until they have hatched. The guide gives ${LEAFCUTTER_HATCH_HOURS} hours as the minimum, and says the real figure depends on the weather.`,
      })
    }
  }
  return out
}

/**
 * A hailed-out field with bees in it, which the beekeeper has to hear about.
 *
 * "In the event a field is hailed out, leafcutter bees and honey bee hives may
 * need to be removed due to lack of forage. The agronomist should communicate
 * any hail to beekeepers and leafcutter bee producers within 24 hours."
 */
export function hailWarnings(
  events: { event_date: string; loss_pct: number | null }[],
  placements: Placement[],
): BeeWarning[] {
  const out: BeeWarning[] = []
  for (const h of events) {
    const covering = placements.filter((p) => inFieldOn(p, h.event_date))
    if (!covering.length) continue
    const who = [...new Set(covering.map((p) => p.contactName).filter((n): n is string => !!n))]
    out.push({
      severity: 'tell them',
      on: h.event_date,
      text:
        `Hail on ${h.event_date}${h.loss_pct == null ? '' : `, ${Math.round(h.loss_pct)}% loss`}, with bees in the field` +
        (who.length ? ` — ${who.join(' and ')} to hear within ${HAIL_NOTICE_HOURS} hours` : ''),
      why: `A hailed-out field has nothing left to forage, so the hives and shelters may have to come out. The guides ask for the beekeeper and the leafcutter producer to be told within ${HAIL_NOTICE_HOURS} hours.`,
    })
  }
  return out
}

const RANK: Record<Severity, number> = { never: 0, 'tell them': 1, caution: 2 }

/** Worst first, then most recent, so the thing to deal with is at the top. */
export function sortWarnings(ws: BeeWarning[]): BeeWarning[] {
  return [...ws].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.on.localeCompare(a.on))
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  never: 'Should not have happened',
  'tell them': 'Tell the beekeeper',
  caution: 'Caution',
}

export const SEVERITY_STYLE: Record<Severity, string> = {
  never: 'bg-red-100 text-red-800',
  'tell them': 'bg-amber-100 text-amber-800',
  caution: 'bg-yellow-100 text-yellow-800',
}

// ---------------------------------------------------------------------------
// The note that goes to the beekeeper
// ---------------------------------------------------------------------------

export type NoteField = {
  fieldName: string
  pct: number | null
  stage: string | null
  placements: Placement[]
  /** Sprays already booked or applied from today on, which is what they need warning about. */
  upcoming: SprayPass[]
}

/**
 * The note to send the beekeeper, as plain text to copy.
 *
 * The guides make this the grower's job and give no form for it, so this is the
 * shortest thing that carries what they ask for: which fields the bees are in,
 * what bloom is doing, and what is going on the crop and when. It is generated
 * rather than stored, so it cannot go stale, and it says nothing the records do
 * not already say.
 */
export function beekeeperNote(fields: NoteField[], today: string): string {
  const withBees = fields.filter((f) => f.placements.some((p) => inFieldOn(p, today)))
  if (!withBees.length) return ''
  const lines = [`Bee update, ${today}`, '']
  for (const f of withBees) {
    const inField = f.placements.filter((p) => inFieldOn(p, today))
    const kinds = inField
      .map((p) => `${p.units ?? '?'} ${BEE_FACTS[p.kind].unit} of ${BEE_FACTS[p.kind].label.toLowerCase()} since ${p.placed_on}`)
      .join('; ')
    lines.push(`${f.fieldName}: ${f.pct == null ? 'bloom share not read yet' : `${Math.round(f.pct)}% bloom`}${f.stage ? `, ${f.stage}` : ''}.`)
    lines.push(`  In the field: ${kinds}.`)
    if (f.upcoming.length) {
      lines.push(
        `  Going on: ${f.upcoming.map((s) => `${s.product_name} (${s.scheme ?? 'chemistry not on record'}) on ${s.applied_on}`).join('; ')}.`,
      )
    } else {
      lines.push('  Nothing booked to go on.')
    }
    lines.push('')
  }
  lines.push('Anything that has to go on will go on in the evening, after flight has ceased, and not over the hives.')
  return lines.join('\n')
}

function addDays(date: string, n: number) {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export { addDays as addDaysISO }
