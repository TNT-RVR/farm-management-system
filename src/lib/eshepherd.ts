import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { parseCsv } from './csv'
import { pastureLabel } from './pastureLabel'

/**
 * Where each mob is, from the eShepherd collars.
 *
 * Gallagher has no API. The eShepherd web app's Status page downloads the
 * activation history as a CSV — which mob, which virtual paddock, from when,
 * until when — and that file is imported here. From it: where every mob is
 * now, how long it has been there, where it was before, and the head count if
 * the file carries one.
 *
 * THE COLUMNS ARE GUESSED BY NAME, because the exact export was not in hand
 * when this was written. The reader says which columns it took for which
 * meaning before anything is saved, and every row's full contents are kept.
 */
export type ActivationRow = {
  id: string
  mob: string
  paddock_name: string
  pasture_id: string | null
  status: string | null
  started_at: string
  ended_at: string | null
  head_count: number | null
  imported_at: string
}

export type ParsedActivation = {
  mob: string
  paddock_name: string
  status: string | null
  started_at: string
  ended_at: string | null
  head_count: number | null
  raw: Record<string, string>
}

export type ColumnGuess = {
  mob: string | null
  paddock: string | null
  status: string | null
  start: string | null
  end: string | null
  head: string | null
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which header means what. First match wins, in the order given. */
export function guessColumns(headers: string[]): ColumnGuess {
  const find = (...needles: RegExp[]) => {
    for (const re of needles) {
      const hit = headers.find((h) => re.test(norm(h)))
      if (hit) return hit
    }
    return null
  }
  // A lone "Date" column is a start: an export with one date per row is
  // saying when each activation began.
  const start = find(/^(activated|activation|start|from|turnedin|turnin|entered)/, /activat.*(at|on|time|date)/, /start/, /^(date|time|datetime|when)$/)
  const end = find(/^(deactivated|deactivation|end|to|until|movedout|moveout|exited|left)/, /deactivat.*(at|on|time|date)/, /end/)
  return {
    mob: find(/^mob/, /herd/, /group/, /animals?name/),
    paddock: find(/virtualpaddock/, /^vp/, /paddock/, /fence/, /pasture/),
    status: find(/^status/, /state/),
    start,
    // Never the same column twice: an export with a single "Date" column is a
    // start, not both ends.
    end: end === start ? null : end,
    head: find(/^(animals|head|headcount|count|numberofanimals|noofanimals)/, /animals/, /head/),
  }
}

/**
 * Anything a spreadsheet might have done to a timestamp, as ISO — or null.
 *
 * A bare timestamp has no zone. The eShepherd export writes UTC (its moves
 * land at 14:30, which is 8:30 in the morning here, when moves happen), so
 * the importer passes `utc`; anything typed by a person is local.
 */
export function toIso(v: string | undefined | null, utc = false): string | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const make = (y: number, mo: number, d: number, h: number, mi: number, sec: number) =>
    (utc ? new Date(Date.UTC(y, mo, d, h, mi, sec)) : new Date(y, mo, d, h, mi, sec)).toISOString()
  // d/m/Y and Y-m-d come through Date.parse unpredictably; try the obvious
  // shapes by hand first.
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) return make(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?/i.exec(s)
  if (m) {
    // Day first: eShepherd is a New Zealand product and this is Canada — both
    // write the day before the month.
    let h = +(m[4] ?? 0)
    const ap = (m[7] ?? '').toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return make(+m[3], +m[2] - 1, +m[1], h, +(m[5] ?? 0), +(m[6] ?? 0))
  }
  // Anything with its own zone ("…Z", "…+00:00") says what it means.
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * "(VP Disabled)": the fence is off. The collars are still on the animals and
 * the mob is still somewhere, but the app is not saying where.
 */
export const isNoFence = (paddockName: string) => /disabled|no\s*fence|none/i.test(paddockName)

/** An ended activation beats an open one for the same start; later end beats earlier. */
const laterEnd = (a: string | null, b: string | null) => (a != null && (b == null || a > b))

/**
 * Rows out of the export, with the reader's column choices.
 *
 * Rows without a mob are skipped: the real file carries one per collar for
 * animals not in any mob (a bull pulled, a heifer sold), which say nothing
 * about where a herd is. Two rows with the same mob, paddock and start (the
 * fence toggled off and on within the minute) collapse to one, or the upsert
 * would refuse the batch for touching a row twice.
 */
export function parseActivations(text: string): { rows: ParsedActivation[]; guess: ColumnGuess; skipped: number } {
  const records = parseCsv(text)
  const headers = records.length ? Object.keys(records[0]) : []
  const guess = guessColumns(headers)
  const byKey = new Map<string, ParsedActivation>()
  let skipped = 0
  for (const r of records) {
    const mob = guess.mob ? r[guess.mob]?.trim() : ''
    const paddock = guess.paddock ? r[guess.paddock]?.trim() : ''
    const started = guess.start ? toIso(r[guess.start], true) : null
    if (!mob || !paddock || !started) {
      skipped++
      continue
    }
    const headText = guess.head ? String(r[guess.head]).replace(/[^\d.]/g, '') : ''
    const head = headText ? Number(headText) : NaN
    const row: ParsedActivation = {
      mob,
      paddock_name: paddock,
      status: guess.status ? r[guess.status]?.trim() || null : null,
      started_at: started,
      ended_at: guess.end ? toIso(r[guess.end], true) : null,
      // Zero is kept as zero: a mob of nobody is a fact about the mob, and
      // the card list hides it on that. Blank is unknown.
      head_count: Number.isFinite(head) && head >= 0 ? Math.round(head) : null,
      raw: r,
    }
    const key = `${mob} | ${paddock} | ${started}`
    const prior = byKey.get(key)
    // The later end wins: an open row and a closed one for the same start are
    // the same activation seen before and after it ended.
    if (!prior || laterEnd(row.ended_at, prior.ended_at)) byKey.set(key, row)
  }
  return { rows: [...byKey.values()], guess, skipped }
}

/**
 * The paddock on our map an eShepherd paddock name refers to.
 *
 * By the letter when there is one ("Pasture E" and "E West VP" are the same
 * ground), else by the name appearing in the other. Null rather than a guess:
 * a collar paddock drawn across two of ours belongs to neither.
 */
export function matchPasture(
  paddockName: string,
  pastures: { id: string; name: string }[],
): string | null {
  if (isNoFence(paddockName)) return null
  // "E West VP", "Virtual Paddock K": the collar app's furniture, not the name.
  const bare = paddockName.replace(/\b(virtual\s+paddock|paddock|vp)\b/gi, ' ').replace(/\s+/g, ' ').trim()

  // A strip of one of ours. The collar paddocks are drawn as numbered slices
  // of the lettered pastures — "N-2", "C-3 (South West)", "F-9" — so the letter
  // is the paddock and the number is the week. Where the letter is split on
  // our map (E, J) a compass word in the rest of the name picks the half.
  const strip = /^([A-Za-z])\s*[-–]\s*\d+\s*(.*)$/.exec(bare)
  if (strip) {
    const letter = strip[1].toUpperCase()
    const hits = pastures.filter((p) => pastureLabel(p.name)?.letter === letter)
    if (hits.length === 1) return hits[0].id
    const compass = /(north|south|east|west)/i.exec(strip[2])
    if (hits.length > 1 && compass) {
      const part = compass[1][0].toUpperCase() + compass[1].slice(1).toLowerCase()
      const half = hits.filter((p) => pastureLabel(p.name)?.part === part)
      if (half.length === 1) return half[0].id
    }
    return null
  }

  const wanted = pastureLabel(bare)
  if (wanted) {
    const hits = pastures.filter((p) => {
      const l = pastureLabel(p.name)
      return l && l.letter === wanted.letter && (l.part ?? null) === (wanted.part ?? null)
    })
    if (hits.length === 1) return hits[0].id
    // "E" alone against "E West" and "E East": both, so neither.
    if (hits.length === 0) {
      const loose = pastures.filter((p) => pastureLabel(p.name)?.letter === wanted.letter)
      if (loose.length === 1) return loose[0].id
    }
    return null
  }
  const a = paddockName.toLowerCase().trim()
  const hits = pastures.filter((p) => {
    const b = p.name.toLowerCase().trim()
    return a === b || a.includes(b) || b.includes(a)
  })
  return hits.length === 1 ? hits[0].id : null
}

export type MobNow = {
  mob: string
  paddock_name: string
  pasture_id: string | null
  /** The fence is off: the collars are on but no paddock is active. */
  no_fence: boolean
  since: string
  days: number
  head_count: number | null
  /** The paddock before this one, if the history shows one. */
  previous: string | null
}

/**
 * Where each mob is, from the newest activation per mob.
 *
 * "Since" is the start of the run, not of the newest row: the fence is
 * toggled off and on several times a move, and each toggle is a fresh row in
 * the same paddock. Days in a paddock counts from the first of them.
 */
export function mobsNow(rows: ActivationRow[], now = Date.now()): MobNow[] {
  const byMob = new Map<string, ActivationRow[]>()
  for (const r of rows) {
    const list = byMob.get(r.mob) ?? []
    list.push(r)
    byMob.set(r.mob, list)
  }
  const out: MobNow[] = []
  for (const [mob, list] of byMob) {
    list.sort((a, b) => b.started_at.localeCompare(a.started_at))
    const cur = list[0]
    // Walk back through rows in the same paddock to the start of the run,
    // stepping over an off-and-on of the fence in between.
    let since = cur.started_at
    for (const r of list.slice(1)) {
      if (r.paddock_name === cur.paddock_name || isNoFence(r.paddock_name)) {
        if (r.paddock_name === cur.paddock_name) since = r.started_at
        continue
      }
      break
    }
    const noFence = isNoFence(cur.paddock_name)
    // The paddock before this one: the newest row in a different, real paddock.
    const prev = list.find((r) => r.paddock_name !== cur.paddock_name && !isNoFence(r.paddock_name))
    // A mob whose newest activation has ended is not anywhere we know of;
    // still shown, so the gap is visible rather than the mob vanishing.
    const left = !noFence && !!cur.ended_at
    const anchor = left ? (cur.ended_at as string) : since
    out.push({
      mob,
      paddock_name: noFence ? 'No fence active' : left ? `${cur.paddock_name} (left)` : cur.paddock_name,
      pasture_id: noFence || left ? null : cur.pasture_id,
      no_fence: noFence,
      since: anchor,
      days: Math.max(0, Math.floor((now - Date.parse(anchor)) / 86_400_000)),
      head_count: cur.head_count,
      previous: prev?.paddock_name ?? null,
    })
  }
  return out.sort((a, b) => a.mob.localeCompare(b.mob))
}

/**
 * The mobs are named for their ranch ("East Ranch Herd"), so a ranch-scoped
 * page shows its own plus any mob that names no ranch (a custom-grazing
 * customer's cattle). Under "All ranches" every mob shows.
 */
export function mobsForRanch<T extends { mob: string }>(
  mobs: T[],
  ranch: string | null,
  ranches: string[],
): T[] {
  if (!ranch) return mobs
  const names = ranches.map((r) => r.toLowerCase())
  return mobs.filter((m) => {
    const name = m.mob.toLowerCase()
    if (name.includes(ranch.toLowerCase())) return true
    return !names.some((r) => name.includes(r))
  })
}

export function useActivations() {
  return useQuery({
    queryKey: ['eshepherd_activations'],
    queryFn: async (): Promise<ActivationRow[]> => {
      const { data, error } = await supabase
        .from('eshepherd_activations')
        .select('id, mob, paddock_name, pasture_id, status, started_at, ended_at, head_count, imported_at')
        .order('started_at', { ascending: false })
        .limit(2000)
      if (error) throw error
      return (data ?? []) as unknown as ActivationRow[]
    },
  })
}

/**
 * Import an export.
 *
 * Upserted on (mob, paddock, start) so the same file twice changes nothing,
 * and a newer file that closes an activation updates the end. Activations that
 * resolve to one of our paddocks are also written as grazing_events, which is
 * what the rotation planner's "cattle on now" and "days rested" read.
 */
export function useImportActivations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { rows: ParsedActivation[]; pastures: { id: string; name: string }[] }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const payload = v.rows.map((r) => ({
        mob: r.mob,
        paddock_name: r.paddock_name,
        pasture_id: matchPasture(r.paddock_name, v.pastures),
        status: r.status,
        started_at: r.started_at,
        ended_at: r.ended_at,
        head_count: r.head_count,
        raw: r.raw,
        imported_by: user?.id ?? null,
      }))
      const { data, error } = await supabase
        .from('eshepherd_activations')
        .upsert(payload, { onConflict: 'mob,paddock_name,started_at' })
        .select('id, pasture_id, head_count, started_at, ended_at, mob')
      if (error) throw error

      const events = (data ?? [])
        .filter((a) => a.pasture_id)
        .map((a) => ({
          eshepherd_activation_id: a.id,
          pasture_id: a.pasture_id as string,
          head_count: a.head_count,
          turned_in_on: (a.started_at as string).slice(0, 10),
          moved_out_on: a.ended_at ? (a.ended_at as string).slice(0, 10) : null,
          notes: `eShepherd · ${a.mob}`,
        }))
      if (events.length) {
        const { error: e2 } = await supabase
          .from('grazing_events')
          .upsert(events, { onConflict: 'eshepherd_activation_id' })
        if (e2) throw e2
      }
      return { imported: payload.length, placed: events.length, unmatched: payload.length - events.length }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['eshepherd_activations'] })
      void qc.invalidateQueries({ queryKey: ['pasture_rotation_order'] })
      void qc.invalidateQueries({ queryKey: ['grazing_events'] })
    },
  })
}
