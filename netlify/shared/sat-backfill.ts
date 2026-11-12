import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bboxOf,
  getToken,
  logApiCall,
  numOrNull,
  runSatelliteIngest,
  searchScenes,
  FULL_QUALITY,
  PARTIAL_QUALITY,
} from './sat-ingest.ts'
import {
  captureImage,
  fieldScale,
  DEFAULT_NDRE_SCALE,
  DEFAULT_NDVI_SCALE,
  type ImageKind,
  type NdviScale,
} from './sat-imagery.ts'
import { runHarmonization } from './sat-harmonize.ts'
import { rebuildDaily } from './sat-daily.ts'

/**
 * Catching the record up over a past season.
 *
 * The nightly runs look back a fortnight. That is right for keeping up and no
 * use for catching up, and the pasture record shows the difference: the pasture
 * stage stalled from 25 August 2026 until runPastureIngest was given its own
 * cron in October, so there is no picture of any paddock before 4 August --
 * while the herd was out from 29 April to 17 September. A grazed paddock cannot
 * be compared before and after for most of the season it was grazed in.
 *
 * This is the SAME run over a fixed date range, not a second one. It calls
 * runSatelliteIngest with `from`/`to` for the observations and captureImage for
 * the pictures, so the scene selection, the cloud mask, the quality grading and
 * the stretch handling are whatever the nightly run uses, and a change to one
 * is a change to both. What differs is only the shape of the work:
 *
 *   - It walks the range in windows rather than asking for it all at once. The
 *     catalog answers at most 100 features in a page and a season over this
 *     farm is several hundred, so one request for seven months would quietly
 *     return the first few weeks and the rest would look like clear sky.
 *   - It draws EVERY full-quality look, not only the newest. runImageryCapture
 *     deliberately takes one picture per subject -- the newest -- because that
 *     is what a map shows. A history needs all of them.
 *   - It is a job with a cursor, because it cannot finish inside one function.
 *
 * Nothing here writes a row the nightly run would not have written, so the
 * existing hooks pick the result up with no app change.
 */

/** How much of the range one observation pass asks for at a time. */
export const WINDOW_DAYS = 30

/**
 * What each raster costs, measured rather than guessed.
 *
 * From sat_api_usage across 5,400 Process calls: true colour is 4.000
 * processing units every time -- it renders at a fixed 1024 square, so paddock
 * size does not enter into it -- and the index rasters are 0.06 to 0.102,
 * because those render at Sentinel-2's native 10 m and a small paddock is a
 * small image. The free Copernicus tier is 30,000 units a month and this farm
 * already spends around 9,000, so the true colour is the only line in a
 * backfill estimate that really matters.
 */
export const UNITS_PER_KIND: Record<ImageKind, number> = {
  truecolour: 4.0,
  ndvi: 0.102,
  ndvi_field: 0.102,
  ndre: 0.06,
  yellow: 0.04,
}

/** Roughly what each kind takes in storage, from the pasture images on file. */
export const BYTES_PER_KIND: Record<ImageKind, number> = {
  truecolour: 956_000,
  ndvi: 6_800,
  ndvi_field: 13_000,
  ndre: 8_100,
  yellow: 8_000,
}

/**
 * The kinds a backfill draws.
 *
 * The same four the pastures already carry. `yellow` is the canola flower map
 * and is only ever drawn for a flowering canola field, so it is not here.
 */
export const BACKFILL_KINDS: ImageKind[] = ['truecolour', 'ndvi', 'ndvi_field', 'ndre']

/**
 * The phases, in the order they must run.
 *
 * `grading` before `images` is not a tidiness preference, it is the whole
 * correctness of the thing. A fresh observation carries only a PROVISIONAL
 * grade, because the honest valid fraction cannot be known from one look: the
 * masked pixel count includes every pixel outside the paddock as well as every
 * pixel under cloud, and only the paddock's clearest look ever separates them.
 * sat_rescore_observations settles it, and captureHistory photographs only a
 * look that reads `full`.
 *
 * Drawn first, the pictures are chosen on grades that are about to change. The
 * first 2026 run did exactly that: 912 observations landed, 158 looks read
 * `full` at that moment and were photographed, and the regrade then promoted
 * some 370 more -- which the job had already walked past and declared
 * finished. Clear days in May, every paddock above 0.96 valid fraction, four
 * pictures out of seventeen. sat-run.ts states the same rule in its header.
 */
export const BACKFILL_PHASES = ['observations', 'grading', 'images', 'finishing', 'done'] as const

export type BackfillPhase = (typeof BACKFILL_PHASES)[number]

export type Window = { from: string; to: string }

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** The range, cut into windows the catalog can answer in one page. */
export function windowsOver(from: string, to: string, days = WINDOW_DAYS): Window[] {
  const out: Window[] = []
  for (let start = from; start <= to; start = addDays(start, days)) {
    const end = addDays(start, days - 1)
    out.push({ from: start, to: end > to ? to : end })
  }
  return out
}

export type BackfillPlan = {
  subjectType: 'field' | 'pasture'
  from: string
  to: string
  subjects: number
  /** Distinct Sentinel-2 pass dates over the subjects' combined extent. */
  passDates: string[]
  /** Pass dates in the range with no observation on file yet. */
  newPassDates: string[]
  /** Images missing against full-quality looks ALREADY on file, by kind. */
  missingNow: Partial<Record<ImageKind, number>>
  /** The share of pass days on which anything graded full, measured on what is on file. */
  fullRate: number
  /** Mean subjects graded full on a day when any did, measured on what is on file. */
  subjectsPerFullPass: number
  estimate: { images: number; units: number; megabytes: number }
  detail: string
}

/**
 * What a backfill would cost, before a single processing unit is spent.
 *
 * Catalog searches are free of units, so the pass dates are counted for real
 * rather than extrapolated. How many of those passes will grade full-quality is
 * NOT knowable without buying the statistics -- cloud decides it -- so that one
 * part is a rate measured on the looks already on file, and it is reported as a
 * rate so the arithmetic can be checked rather than taken on trust.
 */
export async function planBackfill(
  sb: SupabaseClient,
  opts: { from: string; to: string; subjectType?: 'field' | 'pasture'; kinds?: ImageKind[] },
): Promise<BackfillPlan> {
  const subjectType = opts.subjectType ?? 'pasture'
  const kinds = opts.kinds ?? BACKFILL_KINDS
  const { data: subjects, error } = await sb.rpc(
    subjectType === 'pasture' ? 'sat_pasture_geometries' : 'sat_field_geometries',
    { p_limit: null },
  )
  if (error) throw new Error(error.message)
  const list = (subjects ?? []) as { field_id: string; name: string; geojson: unknown }[]
  if (!list.length) throw new Error(`no ${subjectType} geometries`)

  // One bounding box over every subject. A pass either crosses the farm or it
  // does not; asking per paddock would be seventeen times the requests for the
  // same answer.
  let box: [number, number, number, number] | null = null
  for (const s of list) {
    const b = bboxOf(s.geojson as { coordinates: number[][][][] })
    if (!b) continue
    box = box
      ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])]
      : b
  }
  if (!box) throw new Error(`no usable ${subjectType} geometry`)

  const passes = new Set<string>()
  for (const w of windowsOver(opts.from, opts.to)) {
    // Fresh per window: a plan over several seasons is a few dozen calls and
    // can outlive one token, same as the work does.
    const scenes = await searchScenes(await getToken(), box, w.from, w.to)
    for (const sc of scenes) passes.add(sc.sensedAt.slice(0, 10))
  }
  const passDates = [...passes].sort()

  // Which of those days the record already knows about.
  const { data: known } = await sb
    .from('sat_observations')
    .select('sensed_on')
    .eq('subject_type', subjectType)
    .gte('sensed_on', opts.from)
    .lte('sensed_on', opts.to)
  const seen = new Set(((known ?? []) as { sensed_on: string }[]).map((r) => r.sensed_on))
  const newPassDates = passDates.filter((d) => !seen.has(d))

  // How often a pass grades full, and over how many paddocks, measured on the
  // looks already on file. This is the only estimated quantity in the plan.
  const { data: graded } = await sb
    .from('sat_observations')
    .select('sensed_on, subject_id, quality')
    .eq('subject_type', subjectType)
  const rows = (graded ?? []) as { sensed_on: string; subject_id: string; quality: string }[]
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (r.quality !== 'full') continue
    byDay.set(r.sensed_on, (byDay.get(r.sensed_on) ?? 0) + 1)
  }
  const allDays = new Set(rows.map((r) => r.sensed_on))
  const fullRate = allDays.size ? byDay.size / allDays.size : 0.6
  const subjectsPerFullPass = byDay.size
    ? [...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size
    : list.length * 0.75

  // What is missing against the full-quality looks ALREADY on file -- exact, not
  // estimated. The ndre kind arrived later than the others, so there is a real
  // backlog here even inside the range that was ingested at the time.
  const missingNow = await countMissingImages(sb, subjectType, opts.from, opts.to, kinds)

  const newPairs = Math.round(newPassDates.length * fullRate * subjectsPerFullPass)
  const existingMissing = Object.values(missingNow).reduce((a, b) => a + (b ?? 0), 0)
  const perPairUnits = kinds.reduce((a, k) => a + UNITS_PER_KIND[k], 0)
  const perPairBytes = kinds.reduce((a, k) => a + BYTES_PER_KIND[k], 0)
  const missingUnits = kinds.reduce((a, k) => a + (missingNow[k] ?? 0) * UNITS_PER_KIND[k], 0)
  const missingBytes = kinds.reduce((a, k) => a + (missingNow[k] ?? 0) * BYTES_PER_KIND[k], 0)
  // Statistics, for the windows that still have to be bought: measured at about
  // 4.5 units per subject per 30-day window across 3,543 requests.
  const statsUnits = newPassDates.length ? list.length * windowsOver(opts.from, opts.to).length * 4.5 : 0

  return {
    subjectType,
    from: opts.from,
    to: opts.to,
    subjects: list.length,
    passDates,
    newPassDates,
    missingNow,
    fullRate: Number(fullRate.toFixed(3)),
    subjectsPerFullPass: Number(subjectsPerFullPass.toFixed(1)),
    estimate: {
      images: newPairs * kinds.length + existingMissing,
      units: Math.round(newPairs * perPairUnits + missingUnits + statsUnits),
      megabytes: Math.round((newPairs * perPairBytes + missingBytes) / 1_000_000),
    },
    detail:
      `${opts.from}..${opts.to}: ${passDates.length} Sentinel-2 pass dates over ${list.length} ${subjectType}s, ` +
      `${newPassDates.length} of them with nothing on file yet · ` +
      `${existingMissing} pictures missing against looks already on file`,
  }
}

/** Images missing against full-quality Sentinel-2 looks in range, by kind. */
export async function countMissingImages(
  sb: SupabaseClient,
  subjectType: 'field' | 'pasture',
  from: string,
  to: string,
  kinds: ImageKind[],
): Promise<Partial<Record<ImageKind, number>>> {
  const looks = await fullLooks(sb, subjectType, from, to)
  const have = await imagesOnFile(sb, subjectType, from, to)
  const out: Partial<Record<ImageKind, number>> = {}
  for (const k of kinds) out[k] = 0
  for (const look of looks) {
    for (const k of wantedKinds(look, have.get(`${look.subject_id}|${look.scene_id}`) ?? [], kinds)) {
      out[k] = (out[k] ?? 0) + 1
    }
  }
  return out
}

type Look = {
  subject_id: string
  scene_id: string
  sensed_on: string
  ndvi_p10: number | string | null
  ndvi_p90: number | string | null
  ndvi_mean: number | string | null
}

/** Every full-quality Sentinel-2 look in the range, oldest first. */
async function fullLooks(
  sb: SupabaseClient,
  subjectType: 'field' | 'pasture',
  from: string,
  to: string,
): Promise<Look[]> {
  const out: Look[] = []
  const page = 1000
  for (let at = 0; ; at += page) {
    const { data, error } = await sb
      .from('sat_observations')
      .select('subject_id, scene_id, sensed_on, ndvi_p10, ndvi_p90, ndvi_mean, sat_scenes!inner(collection)')
      .eq('subject_type', subjectType)
      .eq('quality', 'full')
      .eq('sat_scenes.collection', 'sentinel-2-l2a')
      .gte('sensed_on', from)
      .lte('sensed_on', to)
      .order('sensed_on', { ascending: true })
      .range(at, at + page - 1)
    if (error) throw new Error(`reading looks: ${error.message}`)
    const rows = (data ?? []) as unknown as Look[]
    out.push(...rows)
    if (rows.length < page) return out
  }
}

/** The pictures already on file in the range, keyed subject|scene. */
async function imagesOnFile(
  sb: SupabaseClient,
  subjectType: 'field' | 'pasture',
  from: string,
  to: string,
): Promise<Map<string, { kind: string }[]>> {
  const map = new Map<string, { kind: string }[]>()
  const page = 1000
  for (let at = 0; ; at += page) {
    const { data, error } = await sb
      .from('sat_images')
      .select('subject_id, scene_id, kind')
      .eq('subject_type', subjectType)
      .gte('sensed_on', from)
      .lte('sensed_on', to)
      .range(at, at + page - 1)
    if (error) throw new Error(`reading sat_images: ${error.message}`)
    const rows = (data ?? []) as { subject_id: string; scene_id: string; kind: string }[]
    for (const r of rows) {
      const key = `${r.subject_id}|${r.scene_id}`
      const list = map.get(key) ?? []
      list.push({ kind: r.kind })
      map.set(key, list)
    }
    if (rows.length < page) return map
  }
}

/**
 * Which kinds this look still wants.
 *
 * A HISTORICAL raster is judged only on whether it exists, not on whether its
 * stretch still matches today's shared scale. The nightly run re-renders a
 * stale stretch on purpose, because the newest picture of every paddock has to
 * be comparable across the farm. A backfill doing the same would redraw its
 * whole output every time the farm's range drifted a thousandth, which over
 * three seasons is thousands of rasters bought twice for no new information.
 */
function wantedKinds(look: Look, have: { kind: string }[], kinds: ImageKind[]): ImageKind[] {
  const own = fieldScale(numOrNull(look.ndvi_p10), numOrNull(look.ndvi_p90), numOrNull(look.ndvi_mean))
  const present = new Set(have.map((h) => h.kind))
  return kinds.filter((k) => !present.has(k)).filter((k) => k !== 'ndvi_field' || own != null)
}

export type BackfillProgress = {
  id: string
  phase: BackfillPhase
  status: 'running' | 'done' | 'failed' | 'cancelled'
  observations: number
  images: number
  units: number
  cursor: string | null
  detail: string
  /** Whether another run is needed to finish the job. */
  more: boolean
}

export type JobRow = {
  id: string
  subject_type: 'field' | 'pasture'
  from_date: string
  to_date: string
  phase: BackfillPhase
  cursor_date: string | null
  observations: number
  images: number
  units: number
  runs: number
  stalls: number
  updated_at?: string
}

/**
 * How many runs in a row may get nowhere before the job gives up.
 *
 * Making a failed raster block `done` is right -- counting a failure as
 * finished is how a job reports success over a gap. But taken alone it creates
 * the opposite fault: a look that can NEVER be drawn keeps the job `running`
 * for ever, the pasture cron restarts it every four hours, and the live-job
 * index blocks a backfill over any other range.
 *
 * Three stalls is twelve hours at the watchdog's pace: long enough for a rate
 * limit or an outage to clear, short enough that nobody is waiting on it. The
 * job then finishes and names what it could not draw.
 */
export const MAX_STALLED_RUNS = 3

/** The job still running for this subject type, if there is one. */
export async function liveJob(
  sb: SupabaseClient,
  subjectType: 'field' | 'pasture' = 'pasture',
): Promise<JobRow | null> {
  const { data } = await sb
    .from('sat_backfill_runs')
    .select(
      'id, subject_type, from_date, to_date, phase, cursor_date, observations, images, units, runs, stalls, updated_at',
    )
    .eq('subject_type', subjectType)
    .eq('status', 'running')
    .maybeSingle()
  return (data as JobRow | null) ?? null
}

/**
 * Start a job, or resume the one already running.
 *
 * A live job over a DIFFERENT range is refused rather than quietly ignored.
 * Two jobs over the same paddocks would buy the same statistics twice and race
 * on the same storage paths, so there can only be one -- and silently working
 * on the old range after being asked for a new one is the kind of thing that
 * gets discovered a thousand rasters later.
 */
export async function startJob(
  sb: SupabaseClient,
  opts: { from: string; to: string; subjectType?: 'field' | 'pasture'; createdBy?: string | null },
): Promise<JobRow> {
  const subjectType = opts.subjectType ?? 'pasture'
  const live = await liveJob(sb, subjectType)
  if (live) {
    if (live.from_date !== opts.from || live.to_date !== opts.to) {
      throw new Error(
        `a ${subjectType} backfill over ${live.from_date}..${live.to_date} is already running ` +
          `(${live.phase}, cursor ${live.cursor_date ?? 'none'}); cancel it before starting another`,
      )
    }
    return live
  }
  const { data, error } = await sb
    .from('sat_backfill_runs')
    .insert({
      subject_type: subjectType,
      from_date: opts.from,
      to_date: opts.to,
      phase: 'observations',
      cursor_date: opts.from,
      created_by: opts.createdBy ?? null,
    })
    .select('id, subject_type, from_date, to_date, phase, cursor_date, observations, images, units, runs, stalls')
    .single()
  if (error) throw new Error(`starting the backfill: ${error.message}`)
  return data as JobRow
}

/** Mark the running job cancelled, so no further run picks it up. */
export async function cancelJob(
  sb: SupabaseClient,
  subjectType: 'field' | 'pasture' = 'pasture',
): Promise<boolean> {
  const job = await liveJob(sb, subjectType)
  if (!job) return false
  await finish(sb, job.id, 'cancelled', 'cancelled by hand')
  return true
}

async function finish(sb: SupabaseClient, id: string, status: string, detail: string) {
  await sb
    .from('sat_backfill_runs')
    .update({ status, detail: detail.slice(0, 1000), updated_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * One run of the job: work to the deadline, write down where it got to.
 *
 * Every step is resumable by construction rather than by bookkeeping.
 * runSatelliteIngest already refuses to re-buy statistics for a scene-and-
 * paddock pair it has computed, and a picture already in sat_images is a row
 * this skips -- so a run killed mid-paddock costs a delay, never a gap and
 * never a second charge for the same raster. The cursor only saves the catalog
 * calls for windows that are finished with.
 */
export async function workBackfill(
  sb: SupabaseClient,
  opts: { subjectType?: 'field' | 'pasture'; deadline: number; kinds?: ImageKind[] },
): Promise<BackfillProgress | null> {
  const subjectType = opts.subjectType ?? 'pasture'
  const kinds = opts.kinds ?? BACKFILL_KINDS
  const job = await liveJob(sb, subjectType)
  if (!job) return null

  let phase = job.phase
  let cursor = job.cursor_date
  let observations = 0
  let images = 0
  let units = 0
  let stalls = job.stalls
  let gaveUp = ''
  const problems: string[] = []
  const notes: string[] = []

  // Phase 1: the observations. Statistics for the days a scene actually exists,
  // one window at a time, so neither the catalog's page limit nor the clock can
  // truncate the range without it being noticed.
  if (phase === 'observations') {
    const windows = windowsOver(job.from_date, job.to_date)
    // -1 means the cursor is past every window, which the transition below
    // normally prevents. Falling back to 0 there would silently restart the
    // whole range from the top, so it is spelt out rather than clamped.
    const at = cursor ? windows.findIndex((w) => w.to >= cursor!) : 0
    const start = at < 0 ? windows.length : at
    for (let i = start; i < windows.length; i++) {
      if (Date.now() > opts.deadline) break
      const w = windows[i]
      try {
        const r = await runSatelliteIngest(sb, {
          subjectType,
          from: w.from,
          to: w.to,
          deadline: opts.deadline,
        })
        observations += r.observations
        // The kill switch, or no geometry at all: there is nothing a further
        // run would do differently, so stop rather than chain forever.
        if (!r.ok && (r.detail.includes('SAT_INGEST_ENABLED') || r.detail.includes('no field geometries'))) {
          await finish(sb, job.id, 'failed', r.detail)
          return {
            id: job.id,
            phase,
            status: 'failed',
            observations: job.observations + observations,
            images: job.images,
            units: Number(job.units),
            cursor,
            detail: r.detail,
            more: false,
          }
        }
        // The window is only finished with if the clock did not cut it short --
        // runSatelliteIngest defers whole paddocks at its deadline.
        if (Date.now() <= opts.deadline) cursor = addDays(w.to, 1)
        notes.push(`${w.from}: ${r.observations} obs`)
      } catch (e) {
        problems.push(`${w.from}: ${(e as Error).message.slice(0, 90)}`)
      }
    }
    if (start >= windows.length || (cursor && cursor > job.to_date)) {
      phase = 'grading'
      cursor = null
    }
  }

  // Phase 2: grade, BEFORE any picture is drawn.
  //
  // This is the ordering hazard sat-run.ts spells out, and getting it wrong
  // cost a whole run. A fresh observation carries only a provisional grade,
  // because the honest valid fraction is not knowable from one look: the masked
  // pixel count includes everything outside the polygon as well as everything
  // under cloud, and only the paddock's clearest look ever separates the two.
  // sat_rescore_observations is what settles it.
  //
  // Draw first and the pictures are chosen on grades that are about to change.
  // The first 2026 run did exactly that: 912 observations landed, 158 looks
  // were `full` at that moment and got photographed, and the regrade then
  // promoted some 370 more -- which the job had already walked past and
  // declared finished. The pictures were missing from clear days in May whose
  // paddocks all read a valid fraction above 0.96.
  if (phase === 'grading' && Date.now() < opts.deadline) {
    try {
      const { data: changed, error: scoreErr } = await sb.rpc('sat_rescore_observations', {
        p_full: FULL_QUALITY,
        p_partial: PARTIAL_QUALITY,
      })
      if (scoreErr) throw new Error(scoreErr.message)
      // Landsat arrives on its own NDVI scale and the curve reads the
      // harmonized value, so this belongs with the grading rather than after.
      await runHarmonization(sb)
      notes.push(`${changed ?? 0} observations regraded`)
      phase = 'images'
    } catch (e) {
      problems.push(`grading: ${(e as Error).message.slice(0, 120)}`)
    }
  }

  // Phase 3: the pictures -- every full-quality look, not only the newest.
  if (phase === 'images' && Date.now() < opts.deadline) {
    const r = await captureHistory(sb, {
      subjectType,
      from: job.from_date,
      to: job.to_date,
      kinds,
      deadline: opts.deadline,
    })
    images += r.captured
    units += r.units
    problems.push(...r.problems)
    if (r.done) phase = 'finishing'
    notes.push(r.detail)

    // A run that drew nothing while reporting problems is a stall. Any
    // progress resets the count; MAX_STALLED_RUNS in a row and the job stops
    // waiting on looks no further attempt is going to draw.
    //
    // It routes through `finishing` rather than straight to `done`, because
    // the daily series still has to be rebuilt over everything that DID land.
    // Jumping to `done` here would leave the backfilled observations out of
    // the curve, which is the quiet half of the failure sat-run.ts warns about.
    if (phase === 'images' && r.captured === 0 && r.problems.length > 0) {
      stalls = job.stalls + 1
      if (stalls >= MAX_STALLED_RUNS) {
        phase = 'finishing'
        gaveUp =
          ` · gave up after ${stalls} runs that drew nothing: the looks named above` +
          ` were never drawn, the rest of the range is complete`
      }
    } else {
      stalls = 0
    }
  }

  // Phase 4: the daily series, last, because it reads the grades from phase 2.
  if (phase === 'finishing' && Date.now() < opts.deadline) {
    try {
      const daily = await rebuildDaily(sb, subjectType)
      notes.push(`${daily.days} ${subjectType} days rebuilt`)
      phase = 'done'
    } catch (e) {
      problems.push(`finishing: ${(e as Error).message.slice(0, 120)}`)
    }
  }

  const detail =
    `${notes.join(' · ')}${problems.length ? ` · problems: ${problems.join('; ')}` : ''}${gaveUp}`
  const { data: saved } = await sb
    .from('sat_backfill_runs')
    .update({
      phase,
      cursor_date: cursor,
      status: phase === 'done' ? 'done' : 'running',
      observations: job.observations + observations,
      images: job.images + images,
      units: Number(job.units) + units,
      runs: job.runs + 1,
      stalls,
      detail: detail.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .select('observations, images, units')
    .maybeSingle()
  const total = (saved ?? {
    observations: job.observations + observations,
    images: job.images + images,
    units: Number(job.units) + units,
  }) as { observations: number; images: number; units: number }

  await logApiCall(
    sb,
    'backfill',
    !problems.length,
    `${subjectType} ${job.from_date}..${job.to_date} ${phase}: ${detail}`.slice(0, 300),
  )

  return {
    id: job.id,
    phase,
    status: phase === 'done' ? 'done' : 'running',
    observations: total.observations,
    images: total.images,
    units: Number(total.units),
    cursor,
    detail,
    // A run that got nowhere at all must not chain, or a dead credential
    // becomes an endless queue of functions.
    more: phase !== 'done' && (observations > 0 || images > 0 || !problems.length),
  }
}

export type HistoryCapture = {
  captured: number
  skipped: number
  units: number
  done: boolean
  problems: string[]
  detail: string
}

/**
 * A picture of every full-quality look in the range, not just the newest.
 *
 * This is the one thing the backfill does that runImageryCapture does not, and
 * the reason is in that function's own comment: it takes ONE picture per
 * subject because that is what a map draws. The Satellite day picker is a
 * history, so it needs the whole series -- and the pictures are what make it
 * one, because the numbers were on file all along.
 */
export async function captureHistory(
  sb: SupabaseClient,
  opts: {
    subjectType: 'field' | 'pasture'
    from: string
    to: string
    kinds: ImageKind[]
    deadline: number
    /** Oldest first by default: the oldest gap is the one that has waited longest. */
    newestFirst?: boolean
  },
): Promise<HistoryCapture> {
  const { data: subjects, error } = await sb.rpc(
    opts.subjectType === 'pasture' ? 'sat_pasture_geometries' : 'sat_field_geometries',
    { p_limit: null },
  )
  if (error) {
    return { captured: 0, skipped: 0, units: 0, done: false, problems: [error.message], detail: error.message }
  }
  const geo = new Map<string, { field_id: string; name: string; geojson_display: unknown }>()
  for (const s of (subjects ?? []) as { field_id: string; name: string; geojson_display: unknown }[]) {
    geo.set(s.field_id, s)
  }

  // Asked for once here only to fail fast on a bad credential. The token used
  // for each raster is taken fresh inside the loop, because a CDSE access
  // token does NOT last a run: it is minted for minutes, and a run of this is
  // thirteen. One token held across the whole run meant every raster after it
  // expired came back "401 You are not authorized! AccessToken signature
  // expired" -- which is what the 2025 run's hundreds of failures were, not
  // the evalscript at all. getToken caches and re-mints a minute before
  // expiry, so calling it per raster costs nothing and is the entire point of
  // that cache.
  try {
    await getToken()
  } catch (e) {
    const msg = `token: ${(e as Error).message.slice(0, 120)}`
    return { captured: 0, skipped: 0, units: 0, done: false, problems: [msg], detail: msg }
  }

  // The farm's shared NDVI scale, read once, exactly as the nightly capture
  // does it -- so a backfilled raster is drawn on the same ramp as a fresh one.
  const { data: scaleRow } = await sb.from('sat_ndvi_scale').select('lo, hi').maybeSingle()
  const scale: NdviScale = scaleRow
    ? { lo: Number((scaleRow as { lo: number }).lo), hi: Number((scaleRow as { hi: number }).hi) }
    : DEFAULT_NDVI_SCALE

  const looks = await fullLooks(sb, opts.subjectType, opts.from, opts.to)
  if (opts.newestFirst) looks.reverse()
  const have = await imagesOnFile(sb, opts.subjectType, opts.from, opts.to)

  let captured = 0
  let skipped = 0
  let units = 0
  let remaining = 0
  let failed = 0
  let undrawable = 0
  const problems: string[] = []

  for (const look of looks) {
    const wanted = wantedKinds(look, have.get(`${look.subject_id}|${look.scene_id}`) ?? [], opts.kinds)
    if (!wanted.length) {
      skipped++
      continue
    }
    if (Date.now() > opts.deadline) {
      remaining++
      continue
    }
    // No geometry and no bounding box are permanent: a paddock that is not in
    // sat_pasture_geometries any more, or whose boundary is unusable, will be
    // no more drawable on the next run. Counted apart from `remaining` so it
    // cannot stop the job, and apart from `skipped` so it is not mistaken for
    // work that was already done.
    const s = geo.get(look.subject_id)
    if (!s) {
      undrawable++
      continue
    }
    const geom = s.geojson_display as { coordinates: number[][][][] }
    const bbox = bboxOf(geom)
    if (!bbox) {
      undrawable++
      continue
    }
    const own = fieldScale(numOrNull(look.ndvi_p10), numOrNull(look.ndvi_p90), numOrNull(look.ndvi_mean))
    for (const kind of wanted) {
      if (Date.now() > opts.deadline) {
        remaining++
        break
      }
      const bounds =
        kind === 'ndvi' ? scale : kind === 'ndre' ? DEFAULT_NDRE_SCALE : kind === 'ndvi_field' ? own : null
      try {
        const problem = await captureImage(
          sb,
          // Fresh per raster: cached until a minute before it expires, so this
          // is a map lookup almost every time and a new token exactly when one
          // is needed.
          await getToken(),
          opts.subjectType,
          s,
          { scene_id: look.scene_id, sensed_on: look.sensed_on },
          kind,
          geom,
          bbox,
          bounds,
        )
        if (problem) {
          problems.push(problem)
          failed++
        } else {
          captured++
          units += UNITS_PER_KIND[kind]
        }
      } catch (e) {
        problems.push(`${s.name} ${kind} ${look.sensed_on}: ${(e as Error).message.slice(0, 80)}`)
        failed++
      }
    }
  }

  return {
    captured,
    skipped,
    units: Number(units.toFixed(2)),
    // A raster that FAILED is not a raster that is finished with. Counting a
    // failure as done is how a job reports success over a gap: the look stays
    // unphotographed and nothing ever comes back for it. A rate limit or a
    // moment's outage is exactly the kind of thing that should be retried, and
    // workBackfill's no-progress guard is what stops a permanent failure from
    // chaining for ever.
    done: remaining === 0 && failed === 0,
    problems: problems.slice(0, 6),
    detail:
      `${captured} pictures drawn, ${skipped} looks already complete` +
      (remaining ? `, ${remaining} looks left for the next run` : '') +
      (failed ? `, ${failed} rasters failed and will be retried` : '') +
      (undrawable ? `, ${undrawable} looks have no usable boundary` : '') +
      ` (${units.toFixed(0)} units)`,
  }
}
