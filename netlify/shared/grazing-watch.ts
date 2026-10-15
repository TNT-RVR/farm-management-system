import type { SupabaseClient } from '@supabase/supabase-js'
import { loadGrazingData } from '../../src/lib/grazing-data.ts'
import {
  addDays,
  describeRestriction,
  fmtDay,
  grazingPicture,
  type Clash,
  type GrazingRule,
  type Place,
  type Restriction,
} from '../../src/lib/grazing-restrictions.ts'
import { albertaDay } from '../../src/lib/spray-products.ts'

/**
 * Sprays that keep livestock off a field, told to the managers.
 *
 * Two alerts (the logic is src/lib/grazing-restrictions.ts):
 *   grazing_restriction — a spray not told before, still in force, on ground
 *     livestock eat from: a feed crop, a field with stubble grazing planned
 *     after it, a pasture. One notification per field, every product on it.
 *   grazing_conflict — cattle on the ground (or planned to be) inside a
 *     restriction: stubble grazing that starts too soon, a pasture move into a
 *     sprayed pasture or one whose fence takes in a sprayed field. Once per
 *     clash.
 * grazing_restriction_alerts is the memory: a row means it has been said.
 * Clashes whose restriction ended more than a month ago are history, not news.
 */

export type PlannedNotice = { kind: 'grazing_restriction' | 'grazing_conflict'; title: string; body: string; link: string; details: Record<string, unknown> }

const PAST_NEWS_DAYS = 30

const restrictionFinding = (place: Place, r: Restriction) => ({
  source: `${r.product} (Reg. ${r.registration}) on ${place.name}`,
  problem: 'restricted',
  note:
    `${describeRestriction(r)}.` +
    (r.condition ? ` Applies when: ${r.condition}.` : '') +
    (r.quote ? ` Label: "${r.quote}"` : ''),
  registration: r.registration,
  product: r.product,
  applied_on: r.appliedOn,
  kind: r.kind,
  until: r.until,
  never: r.never,
  assumed: r.assumed,
})

const placeLink = (p: Place) => (p.kind === 'field' ? `/fields/${p.id}` : '/grazing-restrictions')

/** "11 Aug 2026", or "spring 2027" for a not-at-all (it runs to 1 May). */
const untilText = (r: Restriction) => (r.never ? `spring ${r.until!.slice(0, 4)}` : fmtDay(r.until!))

/** Whole days from `today` to `until` — how long is left, not how long it was. */
const daysLeft = (until: string, today: string) =>
  Math.max(0, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000))

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * One sentence for the body: what is off, for how long after which spray,
 * and how many days that leaves. "No grazing for 30 days after spraying —
 * Liberty, sprayed 14 Sep 2026, so not until 14 Oct 2026 (12 days from now)."
 * The label's count runs from the spray, and saying so is what stops it being
 * read as 30 days from the alert.
 */
const ruleLine = (r: Restriction, what: string, today: string) =>
  r.never
    ? `${what} on this crop at all — ${r.product}'s label says not the treated crop (counted to ${fmtDay(r.until!)}).`
    : `${what} for ${plural(r.days ?? 0, 'day')} after spraying — ${r.product}, sprayed ${fmtDay(r.appliedOn)}, so not until ${fmtDay(r.until!)} (${plural(daysLeft(r.until!, today), 'day')} from now).`

/** "for 12 more days (until 14 Oct 2026)", or the spring for a not-at-all. */
const forHowLong = (r: Restriction, today: string) =>
  r.never ? `until ${untilText(r)}` : `for ${plural(daysLeft(r.until!, today), 'more day')} (until ${fmtDay(r.until!)})`

export function planGrazingNotices(pic: ReturnType<typeof grazingPicture>, told: Set<string>, today: string) {
  const notices: PlannedNotice[] = []
  const remember: { alert_key: string; kind: 'spray' | 'conflict'; field_id: string | null; pasture_id: string | null; registration_number: string; applied_on: string; restricted_until: string | null }[] = []

  // ── new sprays on ground livestock eat from
  for (const p of pic.places) {
    const fresh = p.restrictions.filter(
      (r) => (r.kind === 'graze' || r.kind === 'feed') && r.until && r.until > today && r.eatenBecause.length && !told.has(`spray:${r.sourceId}:${r.registration}`),
    )
    if (!fresh.length) continue
    // Everything still in force here goes in the message, not just the new
    // spray: "until" has to be the latest of them all.
    const inForce = p.restrictions.filter((r) => r.until && r.until > today && (r.kind === 'graze' || r.kind === 'feed'))
    const last = [...inForce].sort((a, b) => (a.until! < b.until! ? 1 : -1))[0]
    const products = [...new Set(fresh.map((r) => r.product))]
    const graze = inForce.filter((r) => r.kind === 'graze').sort((a, b) => (a.until! < b.until! ? 1 : -1))[0]
    const feed = inForce.filter((r) => r.kind === 'feed').sort((a, b) => (a.until! < b.until! ? 1 : -1))[0]
    const why = [...new Set(fresh.flatMap((r) => r.eatenBecause))]
    const slaughter = p.restrictions.filter((r) => r.kind === 'slaughter' && fresh.some((f) => f.sourceId === r.sourceId && f.registration === r.registration))
    notices.push({
      kind: 'grazing_restriction',
      title: `Don't graze or feed ${p.name} ${forHowLong(last, today)} — ${products.join(', ')}`,
      body:
        [
          // One product shutting both for the same time reads as one sentence.
          graze && feed && graze.until === feed.until && graze.product === feed.product
            ? ruleLine(graze, 'No grazing and no cutting it for hay, silage or green feed', today)
            : [graze ? ruleLine(graze, 'No grazing', today) : '', feed ? ruleLine(feed, 'No cutting it for hay, silage or green feed', today) : ''].filter(Boolean).join(' '),
          ...slaughter.map((s) => `Animals that graze it come off ${s.days} days before slaughter (${s.product}).`),
          `Why it matters here: ${why.join('; ')}.`,
        ]
          .filter(Boolean)
          .join(' '),
      link: placeLink(p),
      details: {
        place: { kind: p.kind, id: p.id, name: p.name },
        findings: [...inForce, ...slaughter].map((r) => restrictionFinding(p, r)),
      },
    })
    for (const r of fresh) {
      const key = `spray:${r.sourceId}:${r.registration}`
      if (remember.some((x) => x.alert_key === key)) continue
      remember.push({
        alert_key: key,
        kind: 'spray',
        field_id: p.kind === 'field' ? p.id : null,
        pasture_id: p.kind === 'pasture' ? p.id : null,
        registration_number: r.registration,
        applied_on: r.appliedOn,
        restricted_until: r.until,
      })
    }
  }

  // ── cattle inside a restriction
  const news = (c: Clash) => !told.has(c.key) && c.restriction.until! >= addDays(today, -PAST_NEWS_DAYS)
  const byGrazing = new Map<string, Clash[]>()
  for (const c of pic.clashes.filter(news)) {
    const k = `${c.grazing.kind}:${c.grazing.id}:${c.place.kind}:${c.place.id}`
    byGrazing.set(k, [...(byGrazing.get(k) ?? []), c])
  }
  for (const list of byGrazing.values()) {
    const c = list[0]
    const r = [...list].sort((a, b) => (a.restriction.until! < b.restriction.until! ? 1 : -1))[0].restriction
    const products = [...new Set(list.map((x) => x.restriction.product))]
    const where = c.via ? `${c.place.name} (inside ${c.via.name})` : c.place.name
    // "(30 days after spraying)" beside the date, so the date is checkable
    // against the label's own wording.
    const after = r.never ? '' : ` (${plural(r.days ?? 0, 'day')} after spraying)`
    const title =
      c.grazing.kind === 'stubble'
        ? `Stubble grazing on ${c.place.name} starts ${fmtDay(c.grazing.start)} — the spray says no grazing until ${untilText(r)}${after}`
        : c.grazing.end && c.grazing.end <= today
          ? `Cattle grazed ${where} inside a spray restriction (${products.join(', ')})`
          : `Cattle on ${where} inside a spray restriction — no grazing ${forHowLong(r, today)}`
    const body =
      (c.grazing.kind === 'stubble'
        ? `"${c.grazing.name}" is planned to start ${fmtDay(c.grazing.start)}. Move the date past ${untilText(r)} or graze somewhere else.`
        : `${c.grazing.head ? `${c.grazing.head} head ` : 'Cattle '}in ${c.grazing.name} from ${fmtDay(c.grazing.start)}${c.grazing.end ? ` to ${fmtDay(c.grazing.end)}` : ' (still there)'}.` +
          (c.via ? ` That pasture's fence takes in ${c.place.name}; if they can reach it, move them or fence it off.` : ' Move them, or check the label before leaving them.')) +
      ` Sprayed: ${list
        .map(
          (x) =>
            `${x.restriction.product} on ${fmtDay(x.restriction.appliedOn)}` +
            (x.restriction.never ? ' (not this crop at all)' : ` (no grazing for ${plural(x.restriction.days ?? 0, 'day')} after spraying)`),
        )
        .join(', ')}.`
    const slaughter = c.place.restrictions.filter((s) => s.kind === 'slaughter' && list.some((x) => x.restriction.sourceId === s.sourceId && x.restriction.registration === s.registration))
    notices.push({
      kind: 'grazing_conflict',
      title,
      body: body + (slaughter.length ? ` Animals that grazed it come off ${Math.max(...slaughter.map((s) => s.days ?? 0))} days before slaughter.` : ''),
      link: placeLink(c.place),
      details: {
        place: { kind: c.place.kind, id: c.place.id, name: c.place.name },
        via: c.via,
        grazing: c.grazing,
        findings: [...list.map((x) => x.restriction), ...slaughter].map((x) => restrictionFinding(c.place, x)),
      },
    })
    for (const x of list) {
      remember.push({
        alert_key: x.key,
        kind: 'conflict',
        field_id: x.place.kind === 'field' ? x.place.id : null,
        pasture_id: x.place.kind === 'pasture' ? x.place.id : (x.via?.id ?? null),
        registration_number: x.restriction.registration,
        applied_on: x.restriction.appliedOn,
        restricted_until: x.restriction.until,
      })
    }
  }
  return { notices, remember }
}

export async function runGrazingWatch(
  sb: SupabaseClient,
  opts: { dryRun?: boolean; today?: string; rules?: GrazingRule[] } = {},
): Promise<{ ok: boolean; detail: string; notices: PlannedNotice[]; picture: ReturnType<typeof grazingPicture> }> {
  const today = opts.today ?? albertaDay(new Date().toISOString())
  const data = await loadGrazingData(sb, today)
  if (opts.rules) data.rules = opts.rules
  const pic = grazingPicture(data, today)

  const told = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data: rows, error } = await sb.from('grazing_restriction_alerts').select('alert_key').order('alert_key').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of rows ?? []) told.add(r.alert_key as string)
    if ((rows ?? []).length < 1000) break
  }
  const { notices, remember } = planGrazingNotices(pic, told, today)

  if (!opts.dryRun) {
    // A pasture spray of a product nobody has read the label of: put it in
    // line for the label reader (the John Deere products get there through
    // chemical_registrations_in_use). Its grazing rules follow once it is read.
    const missing = [...new Set(data.pastureSprays.map((s) => s.registration_number).filter((r): r is string => Boolean(r) && !(r! in data.labelStatus)))]
    if (missing.length) {
      const { error } = await sb
        .from('chemical_labels')
        .upsert(missing.map((registration_number) => ({ registration_number, extraction_status: 'queued' })), { onConflict: 'registration_number', ignoreDuplicates: true })
      if (error) console.warn(`[grazing-watch] could not queue labels: ${error.message}`)
    }
    // Remember first: a notification sent twice is worse than one missed and
    // caught by the screens.
    if (remember.length) {
      const { error } = await sb.from('grazing_restriction_alerts').upsert(remember, { onConflict: 'alert_key', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    for (const n of notices) {
      const { error } = await sb.rpc('fn_notify_managers', { p_kind: n.kind, p_title: n.title, p_body: n.body, p_link: n.link, p_details: n.details })
      if (error) console.warn(`[grazing-watch] notify failed: ${error.message}`)
    }
  }

  const active = pic.places.filter((p) => p.restrictions.some((r) => (r.kind === 'graze' || r.kind === 'feed') && r.until && r.until > today))
  const detail =
    `${active.length} field${active.length === 1 ? '' : 's'}/pastures under a grazing restriction` +
    ` · ${notices.filter((n) => n.kind === 'grazing_restriction').length} new-spray and ${notices.filter((n) => n.kind === 'grazing_conflict').length} clash alert(s)` +
    (pic.unread.length ? ` · ${pic.unread.length} sprayed label(s) not read for grazing yet` : '') +
    (pic.unmatched.length ? ` · ${pic.unmatched.length} sprayed name(s) not in the price book` : '')
  if (!opts.dryRun) await sb.rpc('record_integration_heartbeat', { p_key: 'grazing_watch', p_detail: detail, p_data_at: new Date().toISOString() })
  return { ok: true, detail, notices, picture: pic }
}
