import { describe, expect, it } from 'vitest'
import { reportCsv, reportTable } from './framework'
import { longDay, parentPaddock, pastureUse, pastureUseReport, type UseActivation } from './pasture-use'

const C = { id: 'c', name: 'Pasture C', area_acres: 1270 }
const F = { id: 'f', name: 'Pasture F', area_acres: 645 }
const GL = { id: 'gl', name: 'Home Ranch' }
const BI = { id: 'bi', name: 'East Ranch' }
const dayOf = (iso: string) => iso.slice(0, 10)
let n = 0
const act = (mob: string, paddock: string, pasture: string | null, start: string, end: string | null, head: number | null = 100): UseActivation => ({
  id: `a${n++}`,
  mob,
  paddock_name: paddock,
  pasture_id: pasture,
  started_at: `${start}T12:00:00Z`,
  ended_at: end ? `${end}T12:00:00Z` : null,
  head_count: head,
})
const run = (activations: UseActivation[], o: { today?: string; ranchId?: string | null; year?: number } = {}) =>
  pastureUse({
    year: o.year ?? 2026,
    today: o.today ?? '2026-11-23',
    nowIso: `${o.today ?? '2026-11-23'}T18:00:00Z`,
    activations,
    events: [],
    pastures: [C, F],
    pastureRanch: new Map([
      ['c', 'gl'],
      ['f', 'gl'],
    ]),
    ranches: [GL, BI],
    ranchId: o.ranchId ?? null,
    lld: new Map([['c', '11-11-14; 12-40-26 W4']]),
    dayOf,
  })

describe('parentPaddock', () => {
  it('takes the strip number off a paddock not on the map', () => {
    expect(parentPaddock('Bull Pasture- 3')).toBe('Bull Pasture')
    expect(parentPaddock('Training 11')).toBe('Training')
    expect(parentPaddock('Training Paddock-VP001')).toBe('Training')
    expect(parentPaddock('Whitfield3')).toBe('Whitfield')
    expect(parentPaddock('H-K- Temp')).toBe('H-K- Temp')
    expect(parentPaddock('2026-10-16 10:46:41')).toBe('Paddock drawn 2026-10-16')
  })
})

describe('longDay', () => {
  it('writes a day as May 04, 2026', () => {
    expect(longDay('2026-05-04')).toBe('May 04, 2026')
    expect(longDay(null)).toBe('still in')
  })
})

describe('pastureUse', () => {
  it('rolls the strips of one pasture into one stay, counted in nights', () => {
    const r = run([
      act('Home Ranch Herd', 'C-1 (South East)', 'c', '2026-06-05', '2026-06-10'),
      act('Home Ranch Herd', 'C-2 (South)', 'c', '2026-06-10', '2026-06-15'),
      act('Home Ranch Herd', 'C-3 (South West)', 'c', '2026-06-15', '2026-06-20'),
    ])
    expect(r.herds[0].stays).toEqual([expect.objectContaining({ pasture: 'Pasture C', in: '2026-06-05', out: '2026-06-20', days: 15 })])
    expect(r.pastures[0]).toMatchObject({ pasture: 'Pasture C', acres: 1270, daysWithCattle: 15 })
  })

  it('merges the hour-apart duplicate of each move and keeps the larger head count', () => {
    const r = run([
      act('Home Ranch Herd', 'C-1', 'c', '2026-06-05', '2026-06-10', 274),
      act('Home Ranch Herd', 'C-1', 'c', '2026-06-05', '2026-06-10', 290),
    ])
    expect(r.herds[0].stays).toHaveLength(1)
    expect(r.herds[0].stays[0]).toMatchObject({ days: 5, head: 290 })
  })

  it('bridges a short fence-off gap inside one pasture, but not one with another pasture in it', () => {
    const bridged = run([
      act('Herd', 'F-1', 'f', '2026-07-19', '2026-07-21'),
      act('Herd', '(VP Disabled)', null, '2026-07-21', '2026-07-24'),
      act('Herd', 'F-1', 'f', '2026-07-24', '2026-08-20'),
    ])
    expect(bridged.herds[0].stays).toEqual([expect.objectContaining({ in: '2026-07-19', out: '2026-08-20', days: 32 })])
    expect(bridged.herds[0].fenceOffDays).toBe(0)

    const away = run([
      act('Herd', 'F-1', 'f', '2026-07-01', '2026-07-05'),
      act('Herd', 'C-1', 'c', '2026-07-05', '2026-07-08'),
      act('Herd', 'F-2', 'f', '2026-07-08', '2026-07-12'),
    ])
    expect(away.herds[0].stays.map((s) => s.pasture)).toEqual(['Pasture F', 'Pasture C', 'Pasture F'])
    expect(away.pastures.find((p) => p.pasture === 'Pasture F')!.herds[0]).toMatchObject({ stays: 2, days: 8 })
  })

  it('adds up each herd’s head for the pasture', () => {
    const r = run([act('Herd', 'F-1', 'f', '2026-07-19', '2026-08-20', 290), act('Bulls', 'F-9', 'f', '2026-08-17', '2026-08-24', 9)])
    expect(r.pastures[0]).toMatchObject({ pasture: 'Pasture F', head: 299 })
    const rep = pastureUseReport(r, { view: 'pasture', year: 2026, ranchName: 'All ranches' })
    expect(rep.groups[0].totals).toEqual(['2 herds', null, null, null, null, null, null, 299])
    // The pasture's LLD and acres are on each herd's row, in the CSV and the PDF alike.
    expect(reportCsv(rep).replace(String.fromCharCode(0xfeff), '').split('\r\n').slice(0, 2)).toEqual(['Pasture,Herd,LLD,Acres,First in,Last out,Stays,Days,Head', 'Pasture F,Herd,,645,"Jul 19, 2026","Aug 20, 2026",1,32,290'])
    const pdf = reportTable(rep).sections[0]
    expect(pdf.head).toEqual(['Herd', 'LLD', 'Acres', 'First in', 'Last out', 'Stays', 'Days', 'Head'])
    expect(pdf.rows[0].slice(0, 3)).toEqual(['Herd', null, '645'])
    expect(pdf.foot).toEqual(['2 herds', null, null, null, null, null, null, '299'])
    expect(rep.groups[0].note).toBe('cattle in 36 days')
    const one = pastureUseReport(run([act('Herd', 'C-1', 'c', '2026-08-25', '2026-08-26')]), { view: 'pasture', year: 2026, ranchName: 'All ranches' })
    expect(one.groups[0].note).toBe('cattle in 1 day')
  })

  it('counts a long fence-off spell as fence off, not as the pasture', () => {
    const r = run([
      act('Herd', 'C-7', 'c', '2026-07-01', '2026-07-05'),
      act('Herd', '(VP Disabled)', null, '2026-07-05', '2026-07-19'),
      act('Herd', 'F-1', 'f', '2026-07-19', '2026-07-20'),
    ])
    expect(r.herds[0]).toMatchObject({ placedDays: 5, fenceOffDays: 14 })
  })

  it('ends an open row at the mob’s next row, and runs the last one to today', () => {
    const r = run(
      [
        act('Herd', 'N-4', 'c', '2026-09-17', null),
        act('Herd', '(VP Disabled)', null, '2026-09-22', '2026-09-28'),
        act('Herd', 'K7', 'f', '2026-10-21', null),
      ],
      { today: '2026-11-23' },
    )
    expect(r.herds[0].stays).toEqual([
      expect.objectContaining({ pasture: 'Pasture C', out: '2026-09-22', days: 5 }),
      expect.objectContaining({ pasture: 'Pasture F', out: null, days: 33 }),
    ])
  })

  it('leaves out a stay of under a night and a mob of nobody', () => {
    const r = run([act('Herd', 'K7', 'c', '2026-10-21', '2026-10-21'), act('Empty', 'C-1', 'c', '2026-06-01', '2026-06-10', 0)])
    expect(r.herds).toEqual([])
  })

  it('counts only the chosen year', () => {
    const r = run([act('Herd', 'C-1', 'c', '2025-12-20', '2026-01-10')])
    expect(r.herds[0].stays[0]).toMatchObject({ in: '2025-12-20', out: '2026-01-10', days: 9 })
  })

  it('keeps a ranch to its own pastures, and its own mobs off the map', () => {
    const acts = [act('East Ranch Herd', 'Training 4', null, '2026-06-01', '2026-06-10'), act('Home Ranch Herd', 'C-1', 'c', '2026-06-01', '2026-06-10')]
    expect(run(acts, { ranchId: 'gl' }).herds.map((h) => h.mob)).toEqual(['Home Ranch Herd'])
    expect(run(acts, { ranchId: 'bi' }).herds.map((h) => h.mob)).toEqual(['East Ranch Herd'])
  })

  it('makes a report a group per herd or per pasture', () => {
    const r = run([act('Herd', 'C-1', 'c', '2026-06-05', '2026-06-10'), act('Herd', 'Bull Pasture- 1', null, '2026-06-10', '2026-06-12')])
    const byHerd = pastureUseReport(r, { view: 'herd', year: 2026, ranchName: 'All ranches' })
    expect(byHerd.groups[0].rows).toEqual([
      ['Pasture C', '11-11-14; 12-40-26 W4', 1270, 'Jun 05, 2026', 'Jun 10, 2026', 5, 100],
      ['Bull Pasture (eShepherd only)', null, null, 'Jun 10, 2026', 'Jun 12, 2026', 2, 100],
    ])
    const byPasture = pastureUseReport(r, { view: 'pasture', year: 2026, ranchName: 'All ranches' })
    expect(byPasture.groups.map((g) => g.title)).toEqual(['Pasture C', 'Bull Pasture (eShepherd only)'])
    expect(byPasture.groups[0].rows[0].slice(0, 3)).toEqual(["Herd", "11-11-14; 12-40-26 W4", 1270])
  })
})
