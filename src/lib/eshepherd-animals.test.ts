import { describe, expect, it } from 'vitest'
import {
  existingKey,
  findHeaderRow,
  formatSheetDate,
  matchHeader,
  parseSheet,
  parseSheetDate,
  isSpareCollar,
  planImport,
  ranchForBrand,
  sexFromStockClass,
  toAnimal,
  toSheetGrid,
  toSheetRow,
  SHEET_HEADERS,
} from './eshepherd-animals'

const BANNER = 'Spreadsheet Instructions\n1. Select an "Action" …'

/** A grid shaped like eShepherd's own file: banner, headers, then rows. */
function grid(...rows: string[][]) {
  return [[BANNER], [...SHEET_HEADERS], ...rows]
}
const row = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    Action: 'NO ACTION',
    'Animal ID': '63380',
    Neckband: '',
    'EID*': '124000192476682',
    'VID*': '5',
    Breed: 'Angus Cross',
    'Stock Class': 'Bulls',
    'Date of Birth': '01-05-2021',
    'Tattoo or Brand': 'A7',
    'Weight (kg)': '',
    'Weighed date': '',
    'Expected Weight Gain (kg)': '',
    'Pregnancy Status': '',
    Note: '',
    ...over,
  }
  return SHEET_HEADERS.map((h) => base[h] ?? '')
}

describe('finding the header row', () => {
  it('skips the instruction banner on row 1', () => {
    expect(findHeaderRow(grid(row()))).toBe(1)
  })

  it('finds it even if somebody added rows above', () => {
    expect(findHeaderRow([['note to self'], [BANNER], [], [...SHEET_HEADERS], row()])).toBe(3)
  })

  it('says so when there is no header row at all', () => {
    expect(findHeaderRow([['a', 'b'], ['1', '2']])).toBe(-1)
  })
})

describe('matchHeader', () => {
  it('takes the columns as eShepherd writes them', () => {
    expect(matchHeader('EID*')).toBe('EID*')
    expect(matchHeader('Tattoo or Brand')).toBe('Tattoo or Brand')
  })

  // The stars are eShepherd's "one of these is required" mark, not the name.
  it('takes EID and VID without their stars', () => {
    expect(matchHeader('EID')).toBe('EID*')
    expect(matchHeader('vid')).toBe('VID*')
  })

  it('is not fooled by spacing or case', () => {
    expect(matchHeader('  stock class ')).toBe('Stock Class')
    expect(matchHeader('DOB')).toBe('Date of Birth')
  })

  it('returns null for a column it does not know', () => {
    expect(matchHeader('Paddock')).toBeNull()
  })
})

describe('parseSheet', () => {
  it('reads the rows under the headers', () => {
    const out = parseSheet(grid(row(), row({ 'EID*': '124000179564983', 'VID*': 'L2' })))
    expect(out.headerRow).toBe(1)
    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]['EID*']).toBe('124000192476682')
    expect(out.missingHeaders).toEqual([])
  })

  // The template ships thousands of rows pre-filled with NO ACTION and
  // nothing else; they are not animals.
  it('ignores a row whose only value is its Action', () => {
    const empty = SHEET_HEADERS.map((h) => (h === 'Action' ? 'NO ACTION' : ''))
    expect(parseSheet(grid(row(), empty, empty)).rows).toHaveLength(1)
  })

  it('keeps a column it does not recognise, and says so', () => {
    const out = parseSheet([[BANNER], [...SHEET_HEADERS, 'Mob'], [...row(), 'Home Ranch Herd']])
    expect(out.unknownHeaders).toEqual(['Mob'])
    expect(out.rows[0]['Mob']).toBe('Home Ranch Herd')
  })

  it('reports a file that is not this sheet', () => {
    const out = parseSheet([['Name', 'Weight'], ['Daisy', '500']])
    expect(out.headerRow).toBe(-1)
    expect(out.rows).toEqual([])
  })
})

describe('dates are day-first', () => {
  // The whole herd's birth dates hang on this: read month-first, all 328
  // dated animals land in January instead of a May calving.
  it('reads 01-05-2025 as 1 May', () => {
    expect(parseSheetDate('01-05-2025')).toBe('2025-05-01')
  })

  it('reads a two-digit day past the twelfth', () => {
    expect(parseSheetDate('28-02-2024')).toBe('2024-02-28')
  })

  it('takes ISO and a date cell that came back from Excel', () => {
    expect(parseSheetDate('2025-05-01')).toBe('2025-05-01')
    expect(parseSheetDate('2025-05-01T00:00:00.000Z')).toBe('2025-05-01')
  })

  it('refuses an impossible one rather than guessing', () => {
    expect(parseSheetDate('31-13-2024')).toBeNull()
    expect(parseSheetDate('rubbish')).toBeNull()
    expect(parseSheetDate('')).toBeNull()
  })

  it('writes it back the way eShepherd wants it', () => {
    expect(formatSheetDate('2025-05-01')).toBe('01-05-2025')
    expect(formatSheetDate(null)).toBe('')
  })

  it('survives a round trip', () => {
    expect(formatSheetDate(parseSheetDate('01-05-2025'))).toBe('01-05-2025')
  })
})

describe('toAnimal', () => {
  const read = (over: Partial<Record<string, string>> = {}) => toAnimal(parseSheet(grid(row(over))).rows[0])

  it('reads a clean row with no complaints', () => {
    const a = read()
    expect(a).toMatchObject({
      eshepherd_animal_id: '63380',
      eid: '124000192476682',
      vid: '5',
      breed: 'Angus Cross',
      stock_class: 'Bulls',
      birth_date: '2021-05-01',
      brand: 'A7',
    })
    expect(a.problems).toEqual([])
  })

  // eShepherd writes a bare dash for "not set".
  it('takes a dash as empty, not as a value', () => {
    expect(read({ 'Stock Class': '-', 'Tattoo or Brand': '-' })).toMatchObject({ stock_class: null, brand: null })
  })

  it('keys on the EID, which is the only unique column', () => {
    expect(read().key).toBe('124000192476682')
  })

  it('falls back to the collar when there is no EID', () => {
    expect(read({ 'EID*': '', Neckband: '1073857263' }).key).toBe('nb:1073857263')
  })

  it('falls back to Animal ID and VID when there is neither', () => {
    expect(read({ 'EID*': '', Neckband: '' }).key).toBe('id:63380|5')
  })

  it('refuses a row with nothing to identify it', () => {
    const a = read({ 'EID*': '', Neckband: '', 'Animal ID': '', 'VID*': '' })
    expect(a.key).toBeNull()
    expect(a.problems.join(' ')).toContain('nothing to match it on')
  })

  // The template's dropdown is older than the data in it: 114 of Sam's rows
  // say "In Calf", which that dropdown does not list.
  it('accepts eShepherd’s current pregnancy words', () => {
    expect(read({ 'Pregnancy Status': 'In Calf' }).problems).toEqual([])
    expect(read({ 'Pregnancy Status': 'Calf at Foot' }).problems).toEqual([])
  })

  it('still accepts the older ones the template lists', () => {
    expect(read({ 'Pregnancy Status': 'Wet/Lactating' }).problems).toEqual([])
  })

  it('flags a pregnancy word from neither list, without changing it', () => {
    const a = read({ 'Pregnancy Status': 'Maybe' })
    expect(a.pregnancy_status).toBe('Maybe')
    expect(a.problems.join(' ')).toContain('not one eShepherd offers')
  })

  it('flags a stock class eShepherd would reject', () => {
    // Sam's sheet carries "Replacement Heifer" and "Average".
    expect(read({ 'Stock Class': 'Replacement Heifer' }).problems.join(' ')).toContain('stock class')
    expect(read({ 'Stock Class': 'Average' }).problems.join(' ')).toContain('stock class')
  })

  it('flags a date it could not read instead of dropping it', () => {
    expect(read({ 'Date of Birth': 'last spring' }).problems.join(' ')).toContain('date of birth')
  })

  it('flags a weight outside what the sheet allows', () => {
    expect(read({ 'Weight (kg)': '12000' }).problems.join(' ')).toContain('0–9999')
  })
})

describe('sexFromStockClass', () => {
  it('maps the classes the two systems share', () => {
    expect(sexFromStockClass('Bulls')).toBe('bull')
    expect(sexFromStockClass('Heifers')).toBe('heifer')
    expect(sexFromStockClass('Replacement Heifer')).toBe('heifer')
  })

  it('leaves a class it cannot place alone', () => {
    expect(sexFromStockClass('-')).toBeNull()
    expect(sexFromStockClass('Average')).toBeNull()
    expect(sexFromStockClass(null)).toBeNull()
  })
})

describe('ranchForBrand', () => {
  const map = new Map([['A7', 'grassy']])

  it('places a brand somebody has confirmed', () => {
    expect(ranchForBrand('A7', map)).toBe('grassy')
    expect(ranchForBrand(' a7 ', map)).toBe('grassy')
  })

  // The whole point: an unplaced brand leaves the animal without a ranch
  // rather than on a guessed one.
  it('leaves an unknown brand unplaced', () => {
    expect(ranchForBrand('Y', map)).toBeNull()
    expect(ranchForBrand('77', map)).toBeNull()
    expect(ranchForBrand('-', map)).toBeNull()
    expect(ranchForBrand(null, map)).toBeNull()
  })
})

describe('planImport', () => {
  const read = (over: Partial<Record<string, string>> = {}) => toAnimal(parseSheet(grid(row(over))).rows[0])

  it('creates an animal that is not here yet', () => {
    const plan = planImport([read()], [])
    expect(plan.creates).toHaveLength(1)
    expect(plan.updates).toHaveLength(0)
  })

  it('updates the one that is, matched on EID', () => {
    const existing = [{ id: 'a1', eid: '124000192476682', neckband: null, eshepherd_animal_id: null, vid: null }]
    const plan = planImport([read()], existing)
    expect(plan.updates).toEqual([{ animal: expect.anything(), id: 'a1' }])
    expect(plan.creates).toHaveLength(0)
  })

  // The Animal ID repeats 99 times in Sam's own sheet, so matching on it
  // would merge animals that are not the same beast.
  it('does not match on Animal ID alone', () => {
    const existing = [{ id: 'a1', eid: null, neckband: null, eshepherd_animal_id: '63380', vid: null }]
    expect(planImport([read()], existing).creates).toHaveLength(1)
  })

  // 100 of Sam's 679 "animals" were spare neckbands: the band's serial, the
  // word Unfitted where the Animal ID goes, and nothing else on the row.
  it('leaves a spare collar out, and says it is a collar', () => {
    const collar = read({ 'Animal ID': 'Unfitted', Neckband: '0131184532', 'EID*': '', 'VID*': '', Breed: '', 'Stock Class': '' })
    const plan = planImport([collar], [])
    expect(plan.creates).toHaveLength(0)
    expect(plan.skips[0].why).toContain('no animal fitted')
  })

  it('keeps a collar that has an animal on it', () => {
    const fitted = read({ 'Animal ID': 'Unfitted', Neckband: '0131184532', 'EID*': '', 'VID*': '441' })
    expect(planImport([fitted], []).creates).toHaveLength(1)
  })

  it('knows a bare band from an animal', () => {
    const bare = { eid: null, vid: null, neckband: '0131184532', eshepherd_animal_id: 'Unfitted' }
    expect(isSpareCollar(bare)).toBe(true)
    expect(isSpareCollar({ ...bare, eshepherd_animal_id: '' })).toBe(true)
    // Any sign of an animal keeps it.
    expect(isSpareCollar({ ...bare, eid: '124000192476682' })).toBe(false)
    expect(isSpareCollar({ ...bare, vid: '441' })).toBe(false)
    expect(isSpareCollar({ ...bare, eshepherd_animal_id: '183227' })).toBe(false)
    expect(isSpareCollar({ ...bare, neckband: null })).toBe(false)
  })

  it('takes the first of two rows for the same animal and says why', () => {
    const plan = planImport([read(), read()], [])
    expect(plan.creates).toHaveLength(1)
    expect(plan.skips[0].why).toContain('appears earlier')
  })

  it('will not delete an animal on the strength of a spreadsheet', () => {
    const plan = planImport([read({ Action: 'DELETE' })], [])
    expect(plan.creates).toHaveLength(0)
    expect(plan.skips[0].why).toContain('remove it in eShepherd')
  })

  it('counts the problems it found', () => {
    expect(planImport([read({ 'Stock Class': 'Average' })], []).problemCount).toBe(1)
  })
})

describe('existingKey', () => {
  it('keys the same way an uploaded row does', () => {
    expect(existingKey({ id: 'x', eid: 'E1', neckband: 'N1', eshepherd_animal_id: '1', vid: '2' })).toBe('E1')
    expect(existingKey({ id: 'x', eid: null, neckband: 'N1', eshepherd_animal_id: '1', vid: '2' })).toBe('nb:N1')
    expect(existingKey({ id: 'x', eid: null, neckband: null, eshepherd_animal_id: '1', vid: '2' })).toBe('id:1|2')
    expect(existingKey({ id: 'x', eid: null, neckband: null, eshepherd_animal_id: null, vid: null })).toBeNull()
  })
})

describe('writing the sheet back', () => {
  const animal = {
    eshepherd_animal_id: '63380',
    eid: '124000192476682',
    vid: '5',
    neckband: null,
    breed: 'Angus Cross',
    stock_class: 'Bulls',
    birth_date: '2021-05-01',
    brand: 'A7',
    weight_kg: 520,
    weighed_on: '2026-10-02',
    expected_gain_kg: null,
    pregnancy_status: 'In Calf',
    eshepherd_note: 'quiet',
  }

  it('puts the columns in eShepherd’s order', () => {
    expect(toSheetRow(animal)).toEqual([
      'NO ACTION', '63380', '', '124000192476682', '5', 'Angus Cross', 'Bulls',
      '01-05-2021', 'A7', '520', '02-10-2026', '', 'In Calf', 'quiet',
    ])
  })

  // A file that came back saying EDIT on every row would rewrite the herd.
  it('says NO ACTION unless told otherwise', () => {
    expect(toSheetRow(animal)[0]).toBe('NO ACTION')
    expect(toSheetRow(animal, 'EDIT')[0]).toBe('EDIT')
  })

  it('writes the banner and headers above the animals', () => {
    const g = toSheetGrid([animal])
    expect(g[0][0]).toContain('Spreadsheet Instructions')
    expect(g[1]).toEqual([...SHEET_HEADERS])
    expect(g).toHaveLength(3)
  })

  // The round trip is the thing: read a file, write it, read it again.
  it('comes back the same after a round trip', () => {
    const out = toSheetGrid([animal])
    const again = parseSheet(out)
    expect(again.rows).toHaveLength(1)
    const back = toAnimal(again.rows[0])
    expect(back).toMatchObject({
      eid: animal.eid,
      vid: animal.vid,
      birth_date: animal.birth_date,
      weighed_on: animal.weighed_on,
      weight_kg: 520,
      pregnancy_status: 'In Calf',
      stock_class: 'Bulls',
      brand: 'A7',
    })
    expect(back.problems).toEqual([])
  })
})
