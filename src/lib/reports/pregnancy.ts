import { supabase } from '@/lib/supabase'
import { CALL_LABEL, mobRanch, readAnimal, stateInfo, type Call } from '@/lib/pregnancy'
import { fetchAll, longDate, pick, type Cell, type ParamValues, type ReportData, type ReportColumn, type ReportGroup } from './framework'

/**
 * Pregnancy and breeding from the eShepherd collars, by ranch and mob, read
 * exactly as the Pregnancy tab reads them (pregnancy.ts readAnimal): against
 * the ranch's bulls-in date (the heifers' own date for a heifer mob), each
 * animal is pregnant, not pregnant or unsure, with a due-date range from the
 * heat she was most likely bred on. Bull mobs and the water-trough collars
 * are left out, as on the tab.
 */

export type ReproAnimal = { animal_id: string; tag: string; mob: string; state: string; last_heat: string | null; days_since_heat: number | null; observed_on: string; heats: string[] | null }
export type BullRanch = { id: string; name: string; bulls_in_on: string | null; heifer_bulls_in_on: string | null }

type Read = ReproAnimal & { ranchId: string | null; bullsIn: string | null; call: Call; why: string; due: ReturnType<typeof readAnimal>['due']; sinceBulls: number }

export function readHerd(animals: ReproAnimal[], ranches: BullRanch[]): Read[] {
  return animals.flatMap((a) => {
    const m = mobRanch(a.mob, ranches)
    if (m.skip) return []
    const r = ranches.find((x) => x.id === m.ranchId)
    // Heifers can go in with the bulls on a different day; blank is the cows' date.
    const bullsIn = r ? (/heifer/i.test(a.mob) ? (r.heifer_bulls_in_on ?? r.bulls_in_on) : r.bulls_in_on) : null
    const heats = a.heats ?? []
    const read = readAnimal({ state: a.state, last_heat: a.last_heat, heats }, bullsIn, a.observed_on)
    return [{ ...a, ranchId: m.ranchId, bullsIn, call: read.call, why: read.why, due: read.due, sinceBulls: bullsIn ? heats.filter((h) => h >= bullsIn).length : 0 }]
  })
}

const byTag = (a: { tag: string }, b: { tag: string }) => a.tag.localeCompare(b.tag, 'en', { numeric: true })

export const MOB_COLUMNS: ReportColumn[] = [
  { label: 'Mob' },
  { label: 'Collared', decimals: 0 },
  { label: 'Pregnant', decimals: 0 },
  { label: 'Unsure', decimals: 0 },
  { label: 'Not pregnant', decimals: 0 },
  { label: 'No collar data', decimals: 0 },
  { label: 'Heat seen since bulls in', decimals: 0 },
  { label: 'Bulls in' },
  { label: 'First due' },
  { label: 'Middle due' },
  { label: 'Last due' },
]

export const ANIMAL_COLUMNS: ReportColumn[] = [
  { label: 'Tag' },
  { label: 'Call' },
  { label: 'eShepherd status' },
  { label: 'Last heat' },
  { label: 'Heats since bulls in', decimals: 0 },
  { label: 'Days since heat', decimals: 0 },
  { label: 'Due (likely)' },
  { label: 'Due from' },
  { label: 'Due to' },
  { label: 'Why' },
]

/** A mob's line: the calls counted, and the spread of due dates where one is known. */
export function mobLine(mob: string, rs: Read[]): Cell[] {
  const count = (c: Call) => rs.filter((r) => r.call === c).length
  const dues = rs.filter((r) => r.due).map((r) => r.due!)
  const likely = dues.map((d) => d.likely).sort()
  return [
    mob,
    rs.length,
    count('pregnant'),
    count('unsure'),
    count('open'),
    rs.filter((r) => r.state === 'NO_DATA').length,
    rs.filter((r) => r.sinceBulls > 0).length,
    rs[0]?.bullsIn ?? null,
    dues.length ? dues.map((d) => d.from).sort()[0] : null,
    likely.length ? likely[Math.floor((likely.length - 1) / 2)] : null,
    dues.length ? dues.map((d) => d.to).sort().pop()! : null,
  ]
}

export function pregnancyGroups(reads: Read[], ranches: BullRanch[], detail: 'mob' | 'animal', ranchId: string | null): ReportGroup[] {
  const sections = [...ranches.map((r) => ({ id: r.id as string | null, name: r.name })), { id: null, name: 'Mobs not named for a ranch' }].filter((s) => !ranchId || s.id === ranchId)
  const groups: ReportGroup[] = []
  for (const s of sections) {
    const rs = reads.filter((r) => r.ranchId === s.id)
    if (!rs.length) continue
    const mobs = [...new Set(rs.map((r) => r.mob))].sort()
    if (detail === 'mob') {
      // The ranch's spread of due dates, but no one bulls-in date or middle across mobs.
      const totals = mobLine(`${s.name} total`, rs)
      totals[7] = null
      totals[9] = null
      groups.push({ title: s.name, rows: mobs.map((m) => mobLine(m, rs.filter((r) => r.mob === m))), totals })
      continue
    }
    for (const m of mobs) {
      const list = rs.filter((r) => r.mob === m).sort((a, b) => ({ pregnant: 0, unsure: 1, open: 2 })[a.call] - ({ pregnant: 0, unsure: 1, open: 2 })[b.call] || byTag(a, b))
      const line = mobLine(m, list)
      groups.push({
        title: `${s.name} · ${m}`,
        note: `${list.length} collared: ${line[2]} pregnant, ${line[3]} unsure, ${line[4]} not pregnant${list[0]?.bullsIn ? ` · bulls in ${longDate(list[0].bullsIn)}` : ' · no bulls-in date set'}.`,
        rows: list.map((r) => [
          r.tag,
          CALL_LABEL[r.call],
          stateInfo(r.state).label,
          r.last_heat,
          r.bullsIn ? r.sinceBulls : null,
          r.last_heat ? r.days_since_heat : null,
          r.due?.likely ?? null,
          r.due?.from ?? null,
          r.due?.to ?? null,
          r.why || null,
        ]),
      })
    }
  }
  return groups
}

export async function gatherPregnancy(p: ParamValues): Promise<ReportData> {
  const ranchId = pick(p, 'ranch')
  const detail = p.detail === 'animal' ? 'animal' : 'mob'
  const [animals, ranches] = await Promise.all([
    fetchAll<ReproAnimal>((a, b) => supabase.from('eshepherd_repro').select('animal_id, tag, mob, state, last_heat, days_since_heat, observed_on, heats').order('animal_id').range(a, b)),
    fetchAll<BullRanch>((a, b) => supabase.from('ranches').select('id, name, bulls_in_on, heifer_bulls_in_on').order('sort_order').order('id').range(a, b)),
  ])
  const reads = readHerd(animals, ranches)
  const shown = ranchId ? reads.filter((r) => r.ranchId === ranchId) : reads
  const ranchName = ranchId ? (ranches.find((r) => r.id === ranchId)?.name ?? 'one ranch') : 'All ranches'
  if (!shown.length) throw new Error(`No collared cows or heifers${ranchId ? ` at ${ranchName}` : ''} — eShepherd's pregnancy data is pulled weekly (Pregnancy).`)
  const groups = pregnancyGroups(reads, ranches, detail, ranchId)
  const read = shown.map((a) => a.observed_on).sort().pop()!
  const count = (c: Call) => shown.filter((r) => r.call === c).length
  return {
    title: 'Pregnancy and breeding summary',
    subtitle: `${ranchName} · eShepherd as of ${longDate(read)}`,
    meta: [
      ['Collared', shown.length],
      ['Pregnant', count('pregnant')],
      ['Unsure', count('unsure')],
      ['Not pregnant', count('open')],
      ['Read on', read],
    ],
    summary: [
      'The collars detect heats; eShepherd’s model reports heats or their absence and never claims a cause. Pregnant means no heat for about two and a half cycles after one following the bulls going in — illness, poor condition or a collar fault look the same, so preg-check to confirm.',
      'Due dates count 283 days (276–290) from the heat she was most likely bred on. If the collar missed the heat she caught on, she calves about three weeks later.',
      'Bull mobs and the water-trough collars are left out. A mob with no bulls-in date set is read on eShepherd’s status alone.',
    ],
    columns: detail === 'mob' ? MOB_COLUMNS : ANIMAL_COLUMNS,
    groups,
    groupLabel: detail === 'mob' ? 'Ranch' : 'Mob',
    filename: `Pregnancy ${detail === 'mob' ? 'by mob' : 'by animal'} ${read}${ranchId ? ` ${ranchName}` : ''}`,
  }
}
