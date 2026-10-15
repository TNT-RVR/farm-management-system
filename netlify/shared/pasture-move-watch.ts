import type { SupabaseClient } from '@supabase/supabase-js'
import { computePasture, type PastureRow } from '../../src/lib/forage-yield.ts'
import { calvesAtSideAU, median, mobClass, moveVerdict, type Look, type MoveVerdict } from '../../src/lib/pasture-move.ts'
import { pastureLabel } from '../../src/lib/pastureLabel.ts'
import { RAIN_NORMAL_YEARS, rainOutlook } from '../../src/lib/rain-normals.ts'
import { seasonNormal, seasonToDate } from './ranch-rain.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

/**
 * The daily "move them out?" check (kind 'pasture_move').
 *
 * For every paddock with a herd on it now (open grazing_events, written by the
 * eShepherd collar import), work out days of grazing left, how the satellite
 * says it is holding up against the paddocks nobody grazed, and how this
 * year's rain compares with the last ten — then tell the managers once when
 * the answer is "move". The arithmetic is src/lib/pasture-move.ts; this file
 * only gathers what it needs.
 *
 * Said once per paddock per three days. A herd left on a grazed-out paddock is
 * worth a reminder, but not a fresh one every morning.
 */

const REPEAT_DAYS = 3

type Ranch = {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  precip_start_month: number
  precip_end_month: number
  grazing_utilization_rate: number | null
  grazing_precip_mm: number
  move_alerts_on: boolean
  move_days_left_min: number
  move_forage_index_min: number
  move_decline_pct: number
  move_dry_pct: number
  move_count_calves: boolean
  weaning_date: string | null
}

type Event = {
  pasture_id: string
  head_count: number | null
  avg_animal_weight_lb: number | null
  turned_in_on: string
  moved_out_on: string | null
  notes: string | null
}

const n = (v: unknown) => (v == null ? null : Number(v))
const mobOf = (notes: string | null) => notes?.replace(/^eShepherd\s*·\s*/, '').trim() || 'Herd'

/** Start of the unbroken run of strips this mob has spent on this paddock. */
function runStart(events: Event[], pastureId: string, mob: string, openIn: string): string {
  const mine = events.filter((e) => e.pasture_id === pastureId && mobOf(e.notes) === mob)
  let start = openIn
  // Step back while some earlier strip ran up to the day this run began. Not a
  // single backwards walk: the import writes same-day zero-length strips
  // ("09-02 to 09-02") beside the real ones, and whichever sorts first would
  // otherwise end the walk early.
  for (;;) {
    const joins = mine.filter((e) => e.turned_in_on < start && e.moved_out_on != null && e.moved_out_on >= addDays(start, -1))
    if (!joins.length) return start
    start = joins.map((e) => e.turned_in_on).sort()[0]
  }
}

function addDays(d: string, k: number): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + k)
  return t.toISOString().slice(0, 10)
}

export type MoveCheck = { stocked: number; move: number; sent: number; detail: string }

export async function runPastureMoveWatch(sb: SupabaseClient, today = new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })): Promise<MoveCheck> {
  const year = Number(today.slice(0, 4))
  const [ranchesQ, eventsQ, pasturesQ, gpQ, countsQ, importQ] = await Promise.all([
    sb.from('ranches').select('*'),
    sb.from('grazing_events').select('pasture_id, head_count, avg_animal_weight_lb, turned_in_on, moved_out_on, notes').gte('turned_in_on', `${year - 1}-01-01`),
    sb.from('pastures').select('id, name, area_acres'),
    sb.from('grazing_pastures').select('*'),
    sb.from('herd_counts').select('ranch_id, class_name, au_equivalent, head_count, feed_class, background_head'),
    sb.from('eshepherd_activations').select('imported_at').order('imported_at', { ascending: false }).limit(1),
  ])
  for (const q of [ranchesQ, eventsQ, pasturesQ, gpQ, countsQ]) if (q.error) throw new Error(q.error.message)
  const ranches = (ranchesQ.data ?? []) as unknown as Ranch[]
  const events = (eventsQ.data ?? []) as Event[]
  const open = events.filter((e) => e.moved_out_on == null)
  const collarsAsOf = (importQ.data?.[0]?.imported_at as string | undefined)?.slice(0, 10) ?? null

  if (!open.length) {
    const detail = 'no herd on a paddock right now'
    await sb.rpc('record_integration_heartbeat', { p_key: 'pasture_move', p_detail: detail, p_data_at: null })
    return { stocked: 0, move: 0, sent: 0, detail }
  }

  // The season's satellite looks, every paddock (paged: the view can pass 1,000 rows).
  const seasonStart = `${year}-04-01`
  const looks: { pasture_id: string; sensed_on: string; forage_index: number }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pasture_forage_index')
      .select('pasture_id, sensed_on, forage_index')
      .gte('sensed_on', seasonStart)
      .order('sensed_on')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    looks.push(...((data ?? []) as typeof looks))
    if (!data || data.length < 1000) break
  }
  const looksBy = new Map<string, Look[]>()
  for (const l of looks) {
    const fi = n(l.forage_index)
    // An index pinned at the top of its scale is a scene artifact, not grass:
    // whole scenes (5–6 Aug, 23 Sep 2026) read 1.00 on every paddock at an
    // NDVI of 0.35. Kept, one of them would become every paddock's "season best".
    if (fi == null || fi >= 0.99) continue
    const list = looksBy.get(l.pasture_id) ?? []
    list.push({ on: l.sensed_on, fi })
    looksBy.set(l.pasture_id, list)
  }
  // Paddocks no herd touched this season: what the grass did on its own.
  const grazedThisSeason = new Set(events.filter((e) => (e.moved_out_on ?? today) >= seasonStart).map((e) => e.pasture_id))
  const restedByDate = new Map<string, number[]>()
  for (const [pid, ls] of looksBy) {
    if (grazedThisSeason.has(pid)) continue
    for (const l of ls) restedByDate.set(l.on, [...(restedByDate.get(l.on) ?? []), l.fi])
  }
  const rested: Look[] = [...restedByDate.entries()].map(([on, xs]) => ({ on, fi: median(xs)! }))

  // Rain per ranch: this season to date against the last ten (the 10-year average, Sam 5 Oct 2026).
  const rainBy = new Map<string, { toDate: number; pct: number | null; projected: number; normalSeason: number; normalToDate: number } | null>()
  await Promise.all(
    ranches.map(async (r) => {
      if (r.latitude == null || r.longitude == null) {
        rainBy.set(r.id, null)
        return
      }
      const start = `${year}-${String(r.precip_start_month).padStart(2, '0')}-01`
      try {
        const series = await seasonToDate(r.latitude, r.longitude, start, today)
        const toDate = series.reduce((s, p) => s + p.mm, 0)
        const through = series.at(-1)?.t ?? today
        const normal = await seasonNormal(r.latitude, r.longitude, {
          thisYear: year,
          startMonth: r.precip_start_month,
          endMonth: r.precip_end_month,
          n: RAIN_NORMAL_YEARS,
          cutoffMd: through.slice(5),
        })
        if (!normal) {
          rainBy.set(r.id, null)
          return
        }
        const o = rainOutlook(toDate, normal)
        rainBy.set(r.id, {
          toDate: Math.round(toDate),
          pct: o.pctOfNormal,
          projected: o.projectedSeasonMm,
          normalSeason: normal.avg_season_mm,
          normalToDate: normal.avg_to_date_mm,
        })
      } catch {
        rainBy.set(r.id, null)
      }
    }),
  )

  const pastureName = new Map((pasturesQ.data ?? []).map((p) => [p.id as string, p as { id: string; name: string; area_acres: number | null }]))
  // Numeric columns can arrive as strings; the sum in computePasture must not concatenate.
  const gps = ((gpQ.data ?? []) as PastureRow[]).map((g) => ({
    ...g,
    km2: Number(g.km2),
    non_grazeable_ac: Number(g.non_grazeable_ac),
    irrigated_ac: Number(g.irrigated_ac),
    grazeable_irrigated_ac: Number(g.grazeable_irrigated_ac),
  }))
  const auFor = (ranchId: string, cls: string) =>
    n((countsQ.data ?? []).find((c) => c.ranch_id === ranchId && c.class_name === cls)?.au_equivalent) ?? 1
  // Calves at side wear no collars: the cows' mob carries them until weaning.
  const calvesFor = (ranchId: string) => {
    const rows = (countsQ.data ?? []).filter((c) => c.ranch_id === ranchId)
    const cows = rows.filter((c) => c.class_name === 'Cows').reduce((a, c) => a + (n(c.head_count) ?? 0), 0)
    const calf = rows.find((c) => c.background_head != null) ?? rows.find((c) => /calf|calves/i.test(String(c.class_name)))
    return { cows, calves: n(calf?.head_count) ?? 0, calfAu: n(calf?.au_equivalent) ?? 0 }
  }

  // One verdict per stocked paddock, with every mob on it.
  const byPasture = new Map<string, Event[]>()
  for (const e of open) byPasture.set(e.pasture_id, [...(byPasture.get(e.pasture_id) ?? []), e])

  let moves = 0
  let sent = 0
  const notes: string[] = []
  // Where a herd is comes only from the collar import. Two weeks old, the
  // herd has likely been moved since, and telling every manager to move it
  // off a paddock it already left is worse than saying nothing: hold the
  // alerts and ask for a fresh import instead.
  const collarDays = collarsAsOf ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${collarsAsOf}T00:00:00Z`)) / 86_400_000) : null
  const collarsStale = collarDays != null && collarDays > 14
  if (collarsStale) notes.push(`alerts held: collar positions are ${collarDays} days old — import the new eShepherd Status file`)
  for (const [pid, evs] of byPasture) {
    const p = pastureName.get(pid)
    if (!p) continue
    const mobs = evs.map((e) => mobOf(e.notes))
    const ranch = ranches.find((r) => mobs.some((m) => m.toLowerCase().startsWith(r.name.toLowerCase()))) ?? ranches[0]
    if (!ranch) continue
    const util = n(ranch.grazing_utilization_rate) ?? 0.8
    const rain = rainBy.get(ranch.id) ?? null

    // The Grazing tab's row for this paddock, matched by letter, for grass
    // quality and grazeable acres (river, yard and irrigated corners out).
    const label = pastureLabel(p.name)
    const gp = label
      ? gps.find((g) => g.ranch_id === ranch.id && pastureLabel(g.name)?.letter === label.letter && (pastureLabel(g.name)?.part ?? null) === label.part)
      : undefined
    const acres = gp ? computePasture(gp, 0, util).totalGrazeableAc : (n(p.area_acres) ?? 0)
    const quality = gp?.grass_quality ?? 'Fair'

    const herdCalves = calvesFor(ranch.id)
    let calfAU = 0
    const animalUnits = evs.reduce((a, e) => {
      const head = e.head_count ?? 0
      const w = n(e.avg_animal_weight_lb)
      const cls = mobClass(mobOf(e.notes))
      const withCalves = calvesAtSideAU({
        mobClass: cls,
        mobHead: head,
        ...herdCalves,
        countCalves: ranch.move_count_calves !== false,
        weaningDate: ranch.weaning_date ?? null,
        today,
      })
      calfAU += withCalves
      return a + head * (w ? w / 1000 : auFor(ranch.id, cls)) + withCalves
    }, 0)
    const turnedInOn = evs
      .map((e) => runStart(events, pid, mobOf(e.notes), e.turned_in_on))
      .sort()[0]

    const v: MoveVerdict = moveVerdict({
      pasture: p.name,
      acres,
      quality,
      utilisation: util,
      // No rain figure: plan on the manual season figure, as the Grazing tab does.
      projectedSeasonMm: rain?.projected ?? Number(ranch.grazing_precip_mm),
      pctOfNormal: rain?.pct ?? null,
      animalUnits,
      turnedInOn,
      today,
      looks: looksBy.get(pid) ?? [],
      rested,
      thresholds: {
        daysLeftMin: ranch.move_days_left_min,
        forageIndexMin: Number(ranch.move_forage_index_min),
        declinePct: Number(ranch.move_decline_pct),
        dryPct: Number(ranch.move_dry_pct),
      },
    })
    notes.push(`${p.name}: ${v.move ? 'MOVE' : 'stay'}${v.daysLeft != null ? ` (${Math.round(v.daysLeft)} d left)` : ''}`)
    if (!v.move) continue
    moves++
    if (!ranch.move_alerts_on) continue

    const since = new Date(Date.now() - REPEAT_DAYS * 86_400_000).toISOString()
    const { data: recent } = await sb
      .from('notifications')
      .select('id')
      .eq('kind', 'pasture_move')
      .eq('details->>pasture_id', pid)
      .gte('created_at', since)
      .limit(1)
    if (recent?.length) continue
    if (collarsStale) continue

    const head = evs.reduce((a, e) => a + (e.head_count ?? 0), 0)
    const herdName = mobs.length === 1 ? `the ${mobs[0]}` : `${mobs.join(' + ')} (${head} head)`
    const collarAge = collarsAsOf ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${collarsAsOf}T00:00:00Z`)) / 86_400_000) : null
    const body = [
      ...v.reasons,
      `${head} head (${Math.round(animalUnits)} AU${calfAU > 0 ? `, ${Math.round(calfAU)} of them the calves at side` : ''}) on ${p.name} since ${turnedInOn}, ${v.daysOn} days.`,
      rain ? `Rain this season ${rain.toDate} mm, ${rain.pct ?? '–'}% of the ${RAIN_NORMAL_YEARS}-year average to date.` : null,
      v.daysSinceLook != null && v.daysSinceLook > 10 ? `Newest satellite look is ${v.daysSinceLook} days old — walk it before trusting the index.` : null,
      // Where the herd is comes from the last collar import. Days old, it may
      // already have moved; saying so beats a confident alert about an empty paddock.
      collarAge != null && collarAge > 7 ? `Collar positions are from the ${collarsAsOf} import — if the herd has moved since, import the new Status file.` : null,
    ]
      .filter(Boolean)
      .join('\n')
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'pasture_move',
      p_title: `Move ${herdName} off ${p.name}`,
      p_body: body,
      p_link: '/cattle',
      p_details: {
        pasture_id: pid,
        pasture: p.name,
        ranch: ranch.name,
        mobs,
        head,
        animal_units: Math.round(animalUnits * 10) / 10,
        turned_in_on: turnedInOn,
        days_on: v.daysOn,
        days_left: v.daysLeft,
        days_left_threshold: v.daysLeftMin,
        grazeable_acres: Math.round(acres),
        grass_quality: quality,
        utilisation_pct: Math.round(util * 100),
        expected_lb_per_acre: v.expectedLbAc,
        share_standing_at_turn_in: v.shareStanding,
        forage_available_lb: v.availableLb,
        forage_eaten_lb: v.eatenLb,
        forage_remaining_lb: v.remainingLb,
        herd_eats_lb_per_day: v.dailyLb,
        forage_index_now: v.fiNow,
        forage_index_on: v.fiNowOn,
        forage_index_at_turn_in: v.fiAtTurnIn,
        forage_index_season_best: v.fiPeak,
        rested_paddocks_index_now: v.restedNow,
        decline_beyond_rested_pct: v.excessDeclinePct,
        rain_to_date_mm: rain?.toDate ?? null,
        rain_normal_to_date_mm: rain?.normalToDate ?? null,
        rain_pct_of_normal: rain?.pct ?? null,
        rain_normal_season_mm: rain?.normalSeason ?? null,
        rain_projected_season_mm: rain?.projected ?? null,
        dry_year: v.dry,
        collars_imported_on: collarsAsOf,
        reasons: v.reasons,
      },
    })
    if (error) console.warn('[pasture-move] notify failed: ' + error.message)
    else sent++
  }

  const detail = `${byPasture.size} stocked paddock${byPasture.size === 1 ? '' : 's'}, ${moves} to move, ${sent} new alert${sent === 1 ? '' : 's'}` +
    (collarsAsOf ? ` · collars as of ${collarsAsOf}` : '') + (notes.length ? ` · ${notes.join('; ')}` : '')
  await sb.rpc('record_integration_heartbeat', { p_key: 'pasture_move', p_detail: detail, p_data_at: null })
  return { stocked: byPasture.size, move: moves, sent, detail }
}
