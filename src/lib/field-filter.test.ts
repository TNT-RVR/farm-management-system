import { describe, expect, it } from 'vitest'
import {
  cropOptions,
  EMPTY_FIELD_FILTER,
  FIELD_STATE_KEYS,
  filterFieldRows,
  isFieldFiltered,
  readFieldFilter,
  writeFieldFilter,
  type FieldFilter,
} from '@/lib/field-filter'
import { FIELD_STATE_LABEL, fieldState, type FieldStateKey } from '@/lib/field-state'

const row = (id: string, crop_name: string | null) => ({ id, crop_name })

const rows = [
  row('a', 'Canola'),
  row('b', 'Canola'),
  row('c', 'Durum'),
  row('d', null),
]

const states: Record<string, FieldStateKey> = {
  a: 'growing',
  b: 'off',
  c: 'growing',
  d: 'no-crop',
}
const stateOf = (id: string) => states[id] ?? 'no-crop'

describe('readFieldFilter', () => {
  it('defaults to the active tab with nothing narrowed', () => {
    expect(readFieldFilter(new URLSearchParams())).toEqual(EMPTY_FIELD_FILTER)
    expect(isFieldFiltered(EMPTY_FIELD_FILTER)).toBe(false)
  })

  it('reads the tab, crop and state', () => {
    const f = readFieldFilter(new URLSearchParams('tab=archive&crop=Canola&state=off'))
    expect(f).toEqual({ tab: 'archive', crop: 'Canola', state: 'off' })
    expect(isFieldFiltered(f)).toBe(true)
  })

  it('ignores a state it does not know rather than showing nothing', () => {
    expect(readFieldFilter(new URLSearchParams('state=combined')).state).toBe('')
  })

  it('reads an unknown tab as active, not as a third tab', () => {
    expect(readFieldFilter(new URLSearchParams('tab=everything')).tab).toBe('active')
  })
})

describe('writeFieldFilter', () => {
  it('round-trips a filter through the URL', () => {
    const f: FieldFilter = { tab: 'archive', crop: 'Durum', state: 'harvesting' }
    expect(readFieldFilter(writeFieldFilter(new URLSearchParams(), f))).toEqual(f)
  })

  // Saved views compare query strings as text, so a filter that is off has to
  // be absent, never `crop=`.
  it('leaves out what is switched off', () => {
    const p = writeFieldFilter(new URLSearchParams('tab=archive&crop=Canola&state=off'), EMPTY_FIELD_FILTER)
    expect(p.toString()).toBe('')
  })

  it('keeps params that are not the filter', () => {
    const p = writeFieldFilter(new URLSearchParams('year=2026'), { tab: 'active', crop: 'Canola', state: '' })
    expect(p.get('year')).toBe('2026')
    expect(p.get('crop')).toBe('Canola')
  })
})

describe('filterFieldRows', () => {
  it('shows every row when nothing is narrowed', () => {
    expect(filterFieldRows(rows, EMPTY_FIELD_FILTER, stateOf)).toHaveLength(4)
  })

  it('narrows to a crop', () => {
    const got = filterFieldRows(rows, { tab: 'active', crop: 'Canola', state: '' }, stateOf)
    expect(got.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('narrows to a season state', () => {
    const got = filterFieldRows(rows, { tab: 'active', crop: '', state: 'growing' }, stateOf)
    expect(got.map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('applies both at once', () => {
    const got = filterFieldRows(rows, { tab: 'active', crop: 'Canola', state: 'growing' }, stateOf)
    expect(got.map((r) => r.id)).toEqual(['a'])
  })

  // The controls say what was asked for, so nothing matching is an answer.
  it('shows nothing for a crop the list has none of', () => {
    expect(filterFieldRows(rows, { tab: 'active', crop: 'Barley', state: '' }, stateOf)).toEqual([])
  })
})

describe('cropOptions', () => {
  it('lists each crop the rows hold once, sorted, without the blanks', () => {
    expect(cropOptions(rows)).toEqual(['Canola', 'Durum'])
  })

  // Otherwise a saved view naming a crop this tab has none of leaves the
  // dropdown reading "Any crop" above an empty list.
  it('keeps the crop being filtered to even when no row has it', () => {
    expect(cropOptions(rows, 'Barley')).toEqual(['Barley', 'Canola', 'Durum'])
  })

  it('does not duplicate a crop the rows already hold', () => {
    expect(cropOptions(rows, 'Canola')).toEqual(['Canola', 'Durum'])
  })
})

describe('FIELD_STATE_KEYS', () => {
  // The dropdown offers these; a state the chip can show but the dropdown
  // cannot would be a filter you can reach by URL and not by clicking.
  it('covers every state fieldState can return', () => {
    const fromState = [
      fieldState({ cropName: null }),
      fieldState({ cropName: 'Canola' }),
      fieldState({ cropName: 'Canola', wateringDoneAt: '2026-08-31' }),
      fieldState({ cropName: 'Canola', harvestStarted: true }),
      fieldState({ cropName: 'Canola', harvestFinished: true }),
    ]
    for (const s of fromState) {
      expect(FIELD_STATE_KEYS).toContain(s.key)
      // …and the dropdown's word is the chip's word.
      expect(FIELD_STATE_LABEL[s.key]).toBe(s.label)
    }
    expect(new Set(fromState.map((s) => s.key)).size).toBe(FIELD_STATE_KEYS.length)
  })
})
