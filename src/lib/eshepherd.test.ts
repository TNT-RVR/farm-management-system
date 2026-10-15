import { describe, expect, it } from 'vitest'
import {
  guessColumns,
  isNoFence,
  matchPasture,
  mobsForRanch,
  mobsNow,
  parseActivations,
  toIso,
  type ActivationRow,
} from './eshepherd'

const pastures = [
  { id: 'a', name: 'Pasture A' },
  { id: 'c', name: 'Pasture C' },
  { id: 'ew', name: 'Pasture E- West' },
  { id: 'ee', name: 'Pasture E- East' },
  { id: 'f', name: 'Pasture F' },
  { id: 'k', name: 'Pasture K' },
  { id: 'n', name: 'Pasture N' },
  { id: 'outer', name: 'Farm Outer Boundary (Rough)' },
]

/** The real export's header, September 2026. */
const REAL_HEADER = 'VP Name,Start Time,End Time,VP Area,Head Count,Mob Name,Animals'

describe('guessColumns', () => {
  it('finds the obvious names', () => {
    const g = guessColumns(['Mob', 'Virtual Paddock', 'Status', 'Activated At', 'Deactivated At', 'Animals'])
    expect(g).toEqual({
      mob: 'Mob',
      paddock: 'Virtual Paddock',
      status: 'Status',
      start: 'Activated At',
      end: 'Deactivated At',
      head: 'Animals',
    })
  })

  it('reads the real export, taking Head Count over the Animals blob', () => {
    expect(guessColumns(REAL_HEADER.split(','))).toEqual({
      mob: 'Mob Name',
      paddock: 'VP Name',
      status: null,
      start: 'Start Time',
      end: 'End Time',
      head: 'Head Count',
    })
  })

  it('does not take one date column for both ends', () => {
    const g = guessColumns(['Mob Name', 'VP Name', 'Date'])
    expect(g.start).toBe('Date')
    expect(g.end).toBeNull()
  })
})

describe('toIso', () => {
  it('reads a day-first date, because both NZ and Canada write it that way', () => {
    expect(toIso('03/09/2026 14:05')).toBe(new Date(2026, 8, 3, 14, 5).toISOString())
  })

  it('reads an ISO date and an empty cell', () => {
    expect(toIso('2026-09-03 08:00')).toBe(new Date(2026, 8, 3, 8, 0).toISOString())
    expect(toIso('')).toBeNull()
  })

  it('reads the export as UTC when told to', () => {
    expect(toIso('2026-09-07 14:30', true)).toBe('2026-09-07T14:30:00.000Z')
  })
})

describe('parseActivations', () => {
  it('keeps every column of every row', () => {
    const { rows, skipped } = parseActivations(
      'Mob,Virtual Paddock,Status,Activated At,Deactivated At,Animals\nCows,E West,Active,2026-09-01 07:00,,142\nBulls,K,Ended,2026-08-20 07:00,2026-09-01 06:00,6\n',
    )
    expect(skipped).toBe(0)
    expect(rows[0].raw['Animals']).toBe('142')
    expect(rows[0].head_count).toBe(142)
    expect(rows[1].ended_at).not.toBeNull()
  })

  it('reads the real export shape: a JSON blob in the last column, UTC times, zero head kept', () => {
    const { rows, skipped } = parseActivations(
      REAL_HEADER +
        '\nN-2,2026-09-07 14:30,2026-09-12 14:30,108.09 ha,290,Home Ranch Herd,"{""38"":""overridden"",""52"":""cancelled""}"' +
        '\n(VP Disabled),2026-06-19 17:50,,,0,Replacement Heifer,"{}"' +
        '\n(VP Disabled),2026-06-24 16:58,,,1,,"{""4"":""overridden""}"\n',
    )
    expect(skipped).toBe(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      mob: 'Home Ranch Herd',
      paddock_name: 'N-2',
      started_at: '2026-09-07T14:30:00.000Z',
      ended_at: '2026-09-12T14:30:00.000Z',
      head_count: 290,
    })
    expect(rows[0].raw['Animals']).toContain('"52":"cancelled"')
    expect(rows[1].head_count).toBe(0)
  })

  it('collapses two rows for the same activation, keeping the ended one', () => {
    const { rows } = parseActivations(
      REAL_HEADER +
        '\nH-2,2026-08-25 14:30,,,290,Home Ranch Herd,"{}"' +
        '\nH-2,2026-08-25 14:30,2026-08-26 14:30,,290,Home Ranch Herd,"{}"\n',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].ended_at).toBe('2026-08-26T14:30:00.000Z')
  })

  it('skips a row it cannot place, and counts it', () => {
    const { rows, skipped } = parseActivations('Mob,Virtual Paddock,Activated At\nCows,,2026-09-01\n')
    expect(rows).toEqual([])
    expect(skipped).toBe(1)
  })
})

describe('matchPasture', () => {
  it('matches by the letter everybody calls the paddock by', () => {
    expect(matchPasture('K', pastures)).toBe('k')
    expect(matchPasture('E West VP', pastures)).toBe('ew')
  })

  it('reads a numbered strip as the lettered pasture it is cut from', () => {
    expect(matchPasture('N-2', pastures)).toBe('n')
    expect(matchPasture('F-9', pastures)).toBe('f')
    expect(matchPasture('C-3 (South West)', pastures)).toBe('c')
    expect(matchPasture('C-7 (East) (All)', pastures)).toBe('c')
  })

  it('uses the compass word to pick the half of a split pasture', () => {
    expect(matchPasture('E-2 (West)', pastures)).toBe('ew')
    expect(matchPasture('E-2', pastures)).toBeNull()
  })

  it('refuses a letter that is split in two', () => {
    // "E" alone is both halves of E, so it is neither: a collar paddock across
    // two of ours belongs to no single one.
    expect(matchPasture('E', pastures)).toBeNull()
  })

  it('leaves temporary, training and off-map paddocks unplaced', () => {
    expect(matchPasture('H-K- Temp', pastures)).toBeNull()
    expect(matchPasture('Training 9', pastures)).toBeNull()
    expect(matchPasture('Bull Pasture- 5', pastures)).toBeNull()
    expect(matchPasture('(VP Disabled)', pastures)).toBeNull()
  })

  it('never lands on the outer boundary', () => {
    expect(matchPasture('Farm', pastures)).toBe('outer')
    expect(matchPasture('Somewhere else', pastures)).toBeNull()
  })
})

describe('isNoFence', () => {
  it('knows the fence-off row', () => {
    expect(isNoFence('(VP Disabled)')).toBe(true)
    expect(isNoFence('N-4')).toBe(false)
  })
})

describe('mobsNow', () => {
  const row = (p: Partial<ActivationRow>): ActivationRow => ({
    id: Math.random().toString(),
    mob: 'Cows',
    paddock_name: 'K',
    pasture_id: 'k',
    status: null,
    started_at: '2026-09-01T13:00:00.000Z',
    ended_at: null,
    head_count: null,
    imported_at: '2026-09-18T00:00:00.000Z',
    ...p,
  })

  it('reads the newest activation as where the mob is, with days there', () => {
    const now = Date.parse('2026-09-18T13:00:00.000Z')
    const [m] = mobsNow(
      [row({ started_at: '2026-08-10T13:00:00.000Z', ended_at: '2026-09-01T12:00:00.000Z', paddock_name: 'A', pasture_id: 'a' }), row({})],
      now,
    )
    expect(m.paddock_name).toBe('K')
    expect(m.days).toBe(17)
    expect(m.previous).toBe('A')
    expect(m.no_fence).toBe(false)
  })

  it('counts from the start of the run, across a fence toggled off and on', () => {
    const now = Date.parse('2026-09-18T13:00:00.000Z')
    const [m] = mobsNow(
      [
        row({ started_at: '2026-08-25T14:00:00.000Z', ended_at: '2026-09-01T12:00:00.000Z', paddock_name: 'A', pasture_id: 'a' }),
        row({ started_at: '2026-09-01T12:00:00.000Z', ended_at: '2026-09-01T12:05:00.000Z' }),
        row({ started_at: '2026-09-01T12:05:00.000Z', ended_at: '2026-09-01T12:30:00.000Z', paddock_name: '(VP Disabled)', pasture_id: null }),
        row({ started_at: '2026-09-01T12:30:00.000Z' }),
      ],
      now,
    )
    expect(m.paddock_name).toBe('K')
    expect(m.since).toBe('2026-09-01T12:00:00.000Z')
    expect(m.days).toBe(17)
    expect(m.previous).toBe('A')
  })

  it('says when the fence is off, and where the mob was last fenced', () => {
    const [m] = mobsNow(
      [
        row({ started_at: '2026-09-01T13:00:00.000Z', ended_at: '2026-09-18T05:00:00.000Z', paddock_name: 'Whitfield 2', pasture_id: null }),
        row({ started_at: '2026-09-18T05:00:00.000Z', paddock_name: '(VP Disabled)', pasture_id: null, head_count: 15 }),
      ],
      Date.parse('2026-09-19T13:00:00.000Z'),
    )
    expect(m.no_fence).toBe(true)
    expect(m.paddock_name).toBe('No fence active')
    expect(m.pasture_id).toBeNull()
    expect(m.days).toBe(1)
    expect(m.previous).toBe('Whitfield 2')
  })

  it('shows a mob whose last activation ended rather than losing it', () => {
    const [m] = mobsNow([row({ ended_at: '2026-09-10T12:00:00.000Z' })], Date.parse('2026-09-18T13:00:00.000Z'))
    expect(m.paddock_name).toBe('K (left)')
    expect(m.pasture_id).toBeNull()
    expect(m.days).toBe(8)
  })
})

describe('mobsForRanch', () => {
  const mobs = ['Home Ranch Herd', 'East Ranch Bulls', 'Whitfields', 'Johns Cattle'].map((mob) => ({ mob }))
  const ranches = ['Home Ranch', 'East Ranch']

  it('shows a ranch its own mobs plus the ones that name no ranch', () => {
    expect(mobsForRanch(mobs, 'Home Ranch', ranches).map((m) => m.mob)).toEqual([
      'Home Ranch Herd',
      'Whitfields',
      'Johns Cattle',
    ])
  })

  it('shows everything under all ranches', () => {
    expect(mobsForRanch(mobs, null, ranches)).toHaveLength(4)
  })
})
