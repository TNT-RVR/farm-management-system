import { cropKey } from './rotation-engine'
import { albertaDay, productResolver, sprayedProducts, type PriceBookAlias, type PriceBookProduct } from './spray-products'

/**
 * When cattle may graze a sprayed field again, and when what is cut off it may
 * be fed.
 *
 * Each label's grazing sentence is read into rules (chemical_grazing_rules) by
 * netlify/shared/grazing-rules-core.ts. This turns a field's sprays and those
 * rules into dates: no grazing until, no feeding until, not this crop at all,
 * and the two that are about the animals rather than the field (meat animals
 * off N days before slaughter, lactating dairy). Pure, so the daily alert job
 * and the screens say the same thing.
 *
 * A crop-specific line beats the label's general one for that crop ("Except
 * for alfalfa, do not graze…"; Lontrel's 40 days for corn, nothing for the
 * rest). Where the label names crops but not this one and has no line for
 * every crop, its strictest line is used and marked assumed — a label silent
 * about a crop is not permission to graze it. A crop with a feeding line but
 * no grazing line (or the reverse) uses its own line for both.
 */

/** Crop keys the grazing extraction uses. */
export const GRAZING_CROP_KEYS = [
  'wheat', 'durum', 'barley', 'oats', 'triticale', 'corn', 'canola', 'pea', 'dry_bean', 'soybean', 'lentil', 'chickpea',
  'flax', 'alfalfa', 'sainfoin', 'clover', 'grass', 'potato', 'sugar_beet', 'carrot', 'sunflower', 'mustard',
] as const

export type GrazingKind = 'graze' | 'feed' | 'slaughter' | 'dairy'
export const GRAZING_KINDS: GrazingKind[] = ['graze', 'feed', 'slaughter', 'dairy']

export type GrazingRule = {
  registration_number: string
  crop: string | null
  crop_key: string | null
  kind: GrazingKind
  days: number | null
  never: boolean
  condition: string | null
  quote: string | null
}

/** The label keys for one of our crops, by name — a crop on the plan or Deere's treated crop (EDIBLE_BEANS, CORN_WET). */
export function grazingKeys(cropName: string | null | undefined): string[] {
  if (!cropName) return []
  const n = cropName.toLowerCase().replace(/_/g, ' ')
  if (/alfalfa/.test(n)) return ['alfalfa']
  if (/grass|pasture|fescue|timothy|brome|\brange/.test(n)) return ['grass']
  if (/clover/.test(n)) return ['clover']
  if (/triticale/.test(n)) return ['triticale']
  if (/sugar ?beet/.test(n)) return ['sugar_beet']
  if (/lentil/.test(n)) return ['lentil']
  if (/chickpea/.test(n)) return ['chickpea']
  if (/flax/.test(n)) return ['flax']
  if (/sunflower/.test(n)) return ['sunflower']
  if (/mustard/.test(n)) return ['mustard']
  const k = cropKey(n)
  if (k === 'seed_canola') return ['canola']
  // Green feed is barley or oats (sometimes triticale) cut green.
  if (k === 'green_feed') return ['barley', 'oats', 'triticale']
  // A label's "wheat" takes in durum unless it says otherwise.
  if (k === 'durum') return ['durum', 'wheat']
  if (k === 'other') return []
  return [k]
}

/** One product put on one field (or pasture) on one day. */
export type Spray = {
  /** The pass (jd_field_operations.id) or the pasture spray it came from. */
  sourceId: string
  product: string
  registration: string | null
  appliedOn: string
  /** The crop it went on, as named (Deere's treated crop, else the plan). */
  cropName: string | null
  cropKeys: string[]
  /**
   * Why livestock will eat from where it went: the crop it went on is a feed
   * crop, stubble grazing is planned after it, it is a pasture. Empty when
   * nothing says they will.
   */
  eatenBecause?: string[]
}

export type Restriction = {
  kind: GrazingKind
  product: string
  registration: string
  appliedOn: string
  sourceId: string
  days: number | null
  never: boolean
  /**
   * First day it is allowed again. For "not at all" it is the spring after:
   * the label means the treated crop — its stubble and swaths through the
   * winter — not the field for ever. Null for slaughter, which is a rule
   * about the animals, not a date on the field.
   */
  until: string | null
  /** The label's crop for the line used (null = every crop). */
  crop: string | null
  condition: string | null
  quote: string | null
  /**
   * Null when the label has a line for this crop and kind. Otherwise how the
   * line was chosen: the crop's line for the other of grazing/feeding, or —
   * the label naming other crops only — its strictest line.
   */
  assumed: string | null
  /** The spray's reasons livestock eat from here (see Spray). */
  eatenBecause: string[]
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Stricter first: "not at all", then the longest wait. */
const strictness = (r: Pick<GrazingRule, 'never' | 'days'>) => (r.never ? 1e6 : (r.days ?? 0))

/** What each product sprayed says, for the crop it went on. */
export function restrictionsFor(sprays: Spray[], rulesByReg: Map<string, GrazingRule[]>): Restriction[] {
  const out: Restriction[] = []
  for (const s of sprays) {
    if (!s.registration) continue
    const rules = rulesByReg.get(s.registration) ?? []
    const forCrop = (rs: GrazingRule[]) => (s.cropKeys.length ? rs.filter((r) => r.crop_key && s.cropKeys.includes(r.crop_key)) : [])
    for (const kind of GRAZING_KINDS) {
      const mine = rules.filter((r) => r.kind === kind)
      if (!mine.length) continue
      const specific = forCrop(mine)
      const general = mine.filter((r) => !r.crop_key)
      // Grazing and feeding are both the animal eating the crop: a label
      // whose line for this crop covers only one of them (Delaro Complete's
      // beans: "7 days of cutting for forage") is closer to the truth for the
      // other than its strictest line for some other crop is.
      const sibling = kind === 'graze' || kind === 'feed' ? forCrop(rules.filter((r) => r.kind === (kind === 'graze' ? 'feed' : 'graze'))) : []
      const pool = specific.length ? specific : general.length ? general : sibling.length ? sibling : mine
      const assumed =
        pool === sibling
          ? `the label's line for this crop is about ${kind === 'graze' ? 'feeding' : 'grazing'}; used for ${kind === 'graze' ? 'grazing' : 'feeding'} too`
          : pool === mine && !specific.length && !general.length
            ? 'the label does not name this crop; its strictest line is used'
            : null
      const rule = [...pool].sort((a, b) => strictness(b) - strictness(a))[0]
      // days 0 is the label saying there is no restriction for this crop.
      if (!rule.never && !(rule.days != null && rule.days > 0)) continue
      const until =
        kind === 'slaughter' ? null : rule.never ? `${Number(s.appliedOn.slice(0, 4)) + 1}-05-01` : addDays(s.appliedOn, rule.days!)
      out.push({
        kind,
        product: s.product,
        registration: s.registration,
        appliedOn: s.appliedOn,
        sourceId: s.sourceId,
        days: rule.days,
        never: rule.never,
        until,
        crop: rule.crop,
        condition: rule.condition,
        quote: rule.quote,
        assumed,
        eatenBecause: s.eatenBecause ?? [],
      })
    }
  }
  return out
}

/** How long after a spray its slaughter withdrawal is still worth showing. */
const SLAUGHTER_SHOWN_DAYS = 30

/**
 * The restrictions still running on `today`. Slaughter withdrawals have no end
 * date of their own; they show for a month after the spray, which is when an
 * animal that grazed the field might be sold.
 */
export function activeRestrictions(rs: Restriction[], today: string): Restriction[] {
  return rs.filter((r) => (r.kind === 'slaughter' ? addDays(r.appliedOn, SLAUGHTER_SHOWN_DAYS) > today && r.appliedOn <= today : r.until != null && r.until > today))
}

/** The latest-ending restriction of one kind, or null. */
export function longest(rs: Restriction[], kind: GrazingKind): Restriction | null {
  return rs.filter((r) => r.kind === kind && r.until).sort((a, b) => (a.until! < b.until! ? 1 : -1))[0] ?? null
}

/** A stretch of time animals are (or will be) on the ground. end null = still there. */
export type GrazingWindow = { start: string; end: string | null }

/**
 * The grazing restrictions a stretch of grazing falls inside: on the ground on
 * a day the label says no, including cattle already there when it was sprayed.
 * Grazing that ended on or before the spray day is not a clash.
 */
export function clashes(rs: Restriction[], w: GrazingWindow): Restriction[] {
  return rs.filter((r) => r.kind === 'graze' && r.until != null && w.start < r.until && (w.end == null || w.end > r.appliedOn))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "12 Jun 2026" — spelled out by hand: the server's and the phone's locale data word dates differently. */
export const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** One line for a restriction: what, from which spray, until when. */
export function describeRestriction(r: Restriction): string {
  return `${r.product}, sprayed ${fmtDay(r.appliedOn)}: ${restrictionText(r)}`
}

/**
 * What a restriction keeps off, and for how long: "no grazing for 60 days
 * after spraying, until 11 Aug 2026".
 *
 * The count is said as days AFTER SPRAYING, because that is how the label
 * puts it and what someone checks against the jug; a bare "60 days" read as
 * if it might be from today, or for good.
 */
export function restrictionText(r: Restriction): string {
  const what =
    r.kind === 'graze'
      ? 'no grazing'
      : r.kind === 'feed'
        ? 'no cutting or feeding it to livestock'
        : r.kind === 'dairy'
          ? 'no lactating dairy animals'
          : `meat animals off it ${r.days} days before slaughter`
  const when =
    r.kind === 'slaughter'
      ? ''
      : r.never
        ? ' — not this crop at all (its stubble too, until next spring)'
        : ` for ${r.days} days after spraying, until ${fmtDay(r.until!)}`
  return `${what}${when}${r.assumed ? ` — ${r.assumed}` : ''}`
}

/** Restrictions in force on `today` that keep animals off or the crop out of the feed (not the slaughter / dairy notes). */
export const blocking = (rs: Restriction[], today: string) =>
  rs.filter((r) => (r.kind === 'graze' || r.kind === 'feed') && r.until != null && r.until > today)

/** The latest "until" of the restrictions keeping animals off: a date, or the spring for a not-at-all. */
export function untilWord(rs: Restriction[]): string {
  const last = [...rs].filter((r) => r.until).sort((a, b) => (a.until! < b.until! ? 1 : -1))[0]
  if (!last) return ''
  return last.never ? `spring ${last.until!.slice(0, 4)} (not this crop at all)` : fmtDay(last.until!)
}

/** One place's state, as a sentence: what is off and until when. */
export function headlineFor(p: Place, today: string): string | null {
  const b = blocking(p.restrictions, today)
  if (!b.length) return null
  const graze = b.filter((r) => r.kind === 'graze')
  const feed = b.filter((r) => r.kind === 'feed')
  if (graze.length && feed.length) return `No grazing until ${untilWord(graze)}; no cutting it for feed until ${untilWord(feed)}`
  if (graze.length) return `No grazing until ${untilWord(graze)}`
  return `No cutting it for hay, silage or green feed until ${untilWord(feed)}`
}

// ------------------------------------------------------------------ the farm

export type GrazingData = {
  ops: { id: string; field_id: string | null; started_at: string | null; ended_at?: string | null; products: unknown; treated_crop: string | null }[]
  products: PriceBookProduct[]
  aliases: PriceBookAlias[]
  rules: GrazingRule[]
  /** registration → grazing_rules_status, for "this label has not been read". */
  labelStatus: Record<string, string | null>
  crops: { id: string; name: string; feed_dm_pct: number | string | null }[]
  /** crop_plans and crop_history, together: what was on each field each year. */
  fieldCrops: { field_id: string; crop_year: number; crop_id: string | null }[]
  /** grazed_after_harvest: cattle graze whatever was grown once it is off; open_to_pasture: not fenced off from the pasture around it. */
  fields: { id: string; name: string; grazed_after_harvest?: boolean | null; open_to_pasture?: boolean | null }[]
  pastures: { id: string; name: string }[]
  pastureSprays: { id: string; pasture_id: string; applied_on: string; product: string; registration_number: string | null }[]
  overlaps: { field_id: string; pasture_id: string; overlap_acres: number | string; field_acres: number | string }[]
  stubble: { id: string; field_id: string | null; name: string; start_date: string | null }[]
  events: { id: string; pasture_id: string; turned_in_on: string; moved_out_on: string | null; head_count: number | null }[]
}

export type Place = {
  kind: 'field' | 'pasture'
  id: string
  name: string
  sprays: Spray[]
  restrictions: Restriction[]
  /** Why livestock eat from here (a feed crop, stubble grazing, a pasture), empty if nothing says they do. */
  eaten: string[]
  /** Pastures whose fence takes this field in and that it is open to (not fenced off). */
  inPastures: { id: string; name: string }[]
}

export type Clash = {
  /** Stable across runs: the notification memory's key. */
  key: string
  place: Place
  /** The pasture the cattle are in, when the clash is a field inside it. */
  via: { id: string; name: string } | null
  grazing: { kind: 'stubble' | 'event'; id: string; name: string; start: string; end: string | null; head: number | null }
  restriction: Restriction
}

/** A field counts as inside a pasture when most of it is within the fence. */
const INSIDE_SHARE = 0.5
/** Stubble grazing has a start and no end; a winter on it is the most it runs. */
const STUBBLE_DAYS = 180

/** Crops that are themselves feed whatever the plan says. */
const FORAGE = new Set(['alfalfa', 'sainfoin', 'clover', 'grass'])

/**
 * Every field and pasture with its sprays, restrictions and reasons livestock
 * eat from it, plus every clash between a restriction and cattle on the
 * ground, the sprayed names the price book could not match, and the sprayed
 * products whose label has not been read for grazing yet. The caller bounds
 * the sprays (from 1 Jan last year: a "not at all" from last season runs
 * until this spring).
 */
export function grazingPicture(d: GrazingData, today: string) {
  const resolve = productResolver(d.products, d.aliases)
  const rulesByReg = new Map<string, GrazingRule[]>()
  for (const r of d.rules) rulesByReg.set(r.registration_number, [...(rulesByReg.get(r.registration_number) ?? []), r])
  const cropById = new Map(d.crops.map((c) => [c.id, c]))
  const cropsOn = new Map<string, { name: string; feed: boolean }[]>()
  for (const fc of d.fieldCrops) {
    const c = fc.crop_id ? cropById.get(fc.crop_id) : null
    if (!c) continue
    const k = `${fc.field_id}:${fc.crop_year}`
    const list = cropsOn.get(k) ?? []
    if (!list.some((x) => x.name === c.name)) list.push({ name: c.name, feed: c.feed_dm_pct != null })
    cropsOn.set(k, list)
  }
  const pastureName = new Map(d.pastures.map((p) => [p.id, p.name]))

  const places = new Map<string, Place>()
  const placeFor = (kind: 'field' | 'pasture', id: string, name: string) => {
    const k = `${kind}:${id}`
    let p = places.get(k)
    if (!p) {
      p = { kind, id, name, sprays: [], restrictions: [], eaten: [], inPastures: [] }
      places.set(k, p)
    }
    return p
  }
  for (const f of d.fields) placeFor('field', f.id, f.name)
  for (const p of d.pastures) placeFor('pasture', p.id, p.name).eaten.push('pasture')

  /** Names Deere sent that the price book could not turn into a registration. */
  const unmatched = new Map<string, { name: string; passes: number; lastOn: string }>()
  for (const o of d.ops) {
    if (!o.field_id || !o.started_at) continue
    const on = albertaDay(o.ended_at ?? o.started_at)
    const place = places.get(`field:${o.field_id}`)
    if (!place) continue
    const planned = cropsOn.get(`${o.field_id}:${on.slice(0, 4)}`) ?? []
    // Deere's treated crop is the pass's own; the plan is the field's, and a
    // split field has two.
    const cropName = o.treated_crop ?? (planned.length === 1 ? planned[0].name : null)
    const cropKeys = o.treated_crop ? grazingKeys(o.treated_crop) : [...new Set(planned.flatMap((c) => grazingKeys(c.name)))]
    for (const hit of sprayedProducts(o.products, resolve)) {
      if (!hit.registration) {
        // Fertilizer has no label; water and Deere's "---" placeholder are not products.
        if (hit.productType !== 'FERTILIZER' && !/^(water|carrier|-+)$/i.test(hit.deereName)) {
          const u = unmatched.get(hit.deereName.toLowerCase()) ?? { name: hit.deereName, passes: 0, lastOn: on }
          u.passes++
          if (on > u.lastOn) u.lastOn = on
          unmatched.set(hit.deereName.toLowerCase(), u)
        }
        continue
      }
      if (place.sprays.some((s) => s.registration === hit.registration && s.appliedOn === on)) continue
      place.sprays.push({ sourceId: o.id, product: hit.product, registration: hit.registration, appliedOn: on, cropName, cropKeys })
    }
  }
  for (const s of d.pastureSprays) {
    const name = pastureName.get(s.pasture_id)
    if (!name) continue
    placeFor('pasture', s.pasture_id, name).sprays.push({
      sourceId: s.id,
      product: s.product,
      registration: s.registration_number,
      appliedOn: s.applied_on,
      cropName: 'pasture',
      cropKeys: ['grass'],
    })
  }

  // Why livestock eat from where each spray went: the crop it went on is a
  // feed crop (that year's plan, or Deere logged it on a forage), stubble
  // grazing is planned after it, or it is a pasture. Per spray, not per
  // field: alfalfa last year says nothing about this year's canola.
  const feedOn = (fieldId: string, y: number) => (cropsOn.get(`${fieldId}:${y}`) ?? []).filter((c) => c.feed)
  const stubbleAfter = (fieldId: string, on: string) =>
    d.stubble.filter((g) => g.field_id === fieldId && (!g.start_date || (g.start_date >= on && g.start_date < addDays(on, 365))))
  const stubbleWhy = (g: { start_date: string | null }) => (g.start_date ? `stubble grazing planned from ${fmtDay(g.start_date)}` : 'stubble grazing planned')
  // Fields cattle get onto whatever the crop: grazed once harvested, or open
  // to the pasture around them (Sam, 1 Oct 2026).
  const fieldById = new Map(d.fields.map((f) => [f.id, f]))
  const accessWhy = (fieldId: string) => {
    const f = fieldById.get(fieldId)
    const why: string[] = []
    if (f?.open_to_pasture) why.push('it is open to the pasture around it')
    if (f?.grazed_after_harvest) why.push('cattle graze it after harvest')
    return why
  }
  for (const p of places.values()) {
    for (const s of p.sprays) {
      if (p.kind === 'pasture') {
        s.eatenBecause = ['it is a pasture']
        continue
      }
      const why = feedOn(p.id, Number(s.appliedOn.slice(0, 4))).map((c) => `${c.name} is a feed crop`)
      if (!why.length && s.cropKeys.some((k) => FORAGE.has(k))) why.push(`it went on ${s.cropName ?? 'a forage'}`)
      why.push(...stubbleAfter(p.id, s.appliedOn).map(stubbleWhy))
      why.push(...accessWhy(p.id))
      s.eatenBecause = why
    }
  }
  // And this season's, for the screens.
  const year = Number(today.slice(0, 4))
  for (const p of places.values()) {
    if (p.kind !== 'field') continue
    p.eaten.push(...feedOn(p.id, year).map((c) => `${c.name} (${year}) is a feed crop`))
    p.eaten.push(...d.stubble.filter((g) => g.field_id === p.id).map(stubbleWhy))
    p.eaten.push(...accessWhy(p.id))
  }
  for (const o of d.overlaps) {
    if (Number(o.overlap_acres) < INSIDE_SHARE * Number(o.field_acres)) continue
    // Inside the fence but fenced off from the pasture: cattle there are not on it.
    if (!fieldById.get(o.field_id)?.open_to_pasture) continue
    const p = places.get(`field:${o.field_id}`)
    const name = pastureName.get(o.pasture_id)
    if (p && name) p.inPastures.push({ id: o.pasture_id, name })
  }

  for (const p of places.values()) p.restrictions = restrictionsFor(p.sprays, rulesByReg)

  const clashList: Clash[] = []
  for (const s of d.stubble) {
    if (!s.field_id || !s.start_date) continue
    const p = places.get(`field:${s.field_id}`)
    if (!p) continue
    const end = addDays(s.start_date, STUBBLE_DAYS)
    for (const r of clashes(p.restrictions, { start: s.start_date, end })) {
      clashList.push({
        key: `conflict:stubble:${s.id}:${r.registration}:${r.appliedOn}:${s.start_date}`,
        place: p,
        via: null,
        grazing: { kind: 'stubble', id: s.id, name: s.name, start: s.start_date, end: null, head: null },
        restriction: r,
      })
    }
  }
  const fieldsIn = new Map<string, Place[]>()
  for (const p of places.values()) for (const pa of p.inPastures) fieldsIn.set(pa.id, [...(fieldsIn.get(pa.id) ?? []), p])
  for (const e of d.events) {
    const pasture = places.get(`pasture:${e.pasture_id}`)
    if (!pasture) continue
    const w = { start: e.turned_in_on, end: e.moved_out_on }
    for (const p of [pasture, ...(fieldsIn.get(e.pasture_id) ?? [])]) {
      for (const r of clashes(p.restrictions, w)) {
        clashList.push({
          key: `conflict:event:${e.id}:${p.kind === 'field' ? p.id : 'pasture'}:${r.registration}:${r.appliedOn}`,
          place: p,
          via: p === pasture ? null : { id: pasture.id, name: pasture.name },
          grazing: { kind: 'event', id: e.id, name: pasture.name, start: e.turned_in_on, end: e.moved_out_on, head: e.head_count },
          restriction: r,
        })
      }
    }
  }

  // Sprays on a product whose label the grazing extraction has not read: not
  // clear, unknown.
  const unread = new Map<string, { product: string; registration: string; places: string[] }>()
  for (const p of places.values()) {
    for (const s of p.sprays) {
      if (!s.registration || s.appliedOn < `${year - 1}-01-01`) continue
      const st = d.labelStatus[s.registration]
      if (st === 'read' || st === 'none_on_label') continue
      const u = unread.get(s.registration) ?? { product: s.product, registration: s.registration, places: [] }
      if (!u.places.includes(p.name)) u.places.push(p.name)
      unread.set(s.registration, u)
    }
  }

  return { places: [...places.values()], clashes: clashList, unmatched: [...unmatched.values()], unread: [...unread.values()] }
}

/**
 * What a label says about grazing and feeding one crop, in a few words for
 * the label's crop table ("No grazing or feeding 30 d · slaughter 3 d"), with
 * the wording behind it. The same reading the alerts use: the crop's own line,
 * else the label's general one. Null when the label sets nothing for it.
 */
export function cropGrazingSummary(rules: GrazingRule[], registration: string, cropName: string): { text: string; quote: string | null; assumed: boolean } | null {
  const rs = restrictionsFor(
    [{ sourceId: 'label', product: '', registration, appliedOn: '2000-06-01', cropName, cropKeys: grazingKeys(cropName) }],
    new Map([[registration, rules]]),
  )
  if (!rs.length) return null
  const part = (kind: GrazingKind) => rs.find((r) => r.kind === kind)
  const span = (r: Restriction | undefined) => (!r ? null : r.never ? 'not at all' : `${r.days} d`)
  const graze = span(part('graze'))
  const feed = span(part('feed'))
  const bits: string[] = []
  if (graze && graze === feed) bits.push(`No grazing or feeding: ${graze}`)
  else {
    if (graze) bits.push(`No grazing: ${graze}`)
    if (feed) bits.push(`No feeding: ${feed}`)
  }
  const slaughter = part('slaughter')
  if (slaughter?.days) bits.push(`off ${slaughter.days} d before slaughter`)
  if (!bits.length) return null
  return { text: bits.join(' · '), quote: (part('graze') ?? part('feed') ?? slaughter)?.quote ?? null, assumed: rs.some((r) => r.assumed) }
}
