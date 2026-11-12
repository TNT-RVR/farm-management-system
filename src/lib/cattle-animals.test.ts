import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildAnimalWorkbook, ranchForMob, toExportAnimal } from './cattle-animals'
import { parseSheet, toAnimal, SHEET_HEADERS } from './eshepherd-animals'

/**
 * The export has to come back in. A file eShepherd rejects, or one that
 * loses a column on the way out, is worse than no export at all — so this
 * writes a real workbook, reads it back with the same reader an upload uses,
 * and checks the animals survived.
 */
describe('the exported workbook', () => {
  const animals = [
    {
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
      eshepherd_note: 'quiet, good feet',
    },
    {
      eshepherd_animal_id: '63384',
      eid: null,
      vid: 'L2',
      neckband: '1073857263',
      breed: 'Red Angus',
      stock_class: 'Heifers',
      birth_date: null,
      brand: 'Y',
      weight_kg: null,
      weighed_on: null,
      expected_gain_kg: -12.5,
      pregnancy_status: null,
      eshepherd_note: null,
    },
  ]

  const readBack = async (blob: Blob) => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.worksheets[0]
    const grid: unknown[][] = []
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const line: unknown[] = []
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        line[c - 1] = cell.value
      })
      grid[r - 1] = line
    })
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = []
    return grid
  }

  it('reads back as the same animals', async () => {
    const grid = await readBack(await buildAnimalWorkbook(animals))
    const parsed = parseSheet(grid)
    expect(parsed.headerRow).toBeGreaterThanOrEqual(0)
    expect(parsed.missingHeaders).toEqual([])
    const back = parsed.rows.map(toAnimal)
    expect(back).toHaveLength(2)
    expect(back[0]).toMatchObject({
      eid: '124000192476682',
      vid: '5',
      birth_date: '2021-05-01',
      weighed_on: '2026-10-02',
      weight_kg: 520,
      pregnancy_status: 'In Calf',
      stock_class: 'Bulls',
      brand: 'A7',
      eshepherd_note: 'quiet, good feet',
    })
    expect(back[1]).toMatchObject({ vid: 'L2', neckband: '1073857263', expected_gain_kg: -12.5 })
    // Nothing the sheet would argue with came out of our own export.
    expect(back.flatMap((b) => b.problems)).toEqual([])
  })

  it('keeps eShepherd’s banner and column order', async () => {
    const grid = await readBack(await buildAnimalWorkbook(animals))
    expect(String(grid[0][0])).toContain('Spreadsheet Instructions')
    expect(grid[1].map(String)).toEqual([...SHEET_HEADERS])
  })

  // A file that said EDIT on every row would rewrite the herd on upload.
  it('says NO ACTION on every row unless asked otherwise', async () => {
    const grid = await readBack(await buildAnimalWorkbook(animals))
    expect(grid.slice(2).map((r) => String(r[0]))).toEqual(['NO ACTION', 'NO ACTION'])
    const edit = await readBack(await buildAnimalWorkbook(animals, 'EDIT'))
    expect(edit.slice(2).map((r) => String(r[0]))).toEqual(['EDIT', 'EDIT'])
  })

  it('writes an empty register without falling over', async () => {
    const grid = await readBack(await buildAnimalWorkbook([]))
    expect(parseSheet(grid).rows).toEqual([])
  })
})

describe('toExportAnimal', () => {
  it('takes the columns off a row and leaves the rest', () => {
    const out = toExportAnimal({ eid: '1', vid: 'A', weight_kg: '520', notes_md: 'ours', mob: 'Home Ranch Herd' })
    expect(out).toMatchObject({ eid: '1', vid: 'A', weight_kg: 520 })
    expect('notes_md' in out).toBe(false)
    // Mob is ours; eShepherd's sheet has no column for it.
    expect('mob' in out).toBe(false)
  })
})

describe('ranchForMob', () => {
  const ranches = [
    { id: 'gl', name: 'Home Ranch' },
    { id: 'bi', name: 'East Ranch' },
  ]

  it('reads the ranch off the mob name the collars use', () => {
    expect(ranchForMob('Home Ranch Herd', ranches)).toBe('gl')
    expect(ranchForMob('East Ranch Replacement Heifer', ranches)).toBe('bi')
    expect(ranchForMob('East Ranch Bulls', ranches)).toBe('bi')
  })

  // Somebody else's cattle run here but are not ours to file under a ranch.
  it('leaves another outfit’s mob unplaced', () => {
    expect(ranchForMob('Whitfields', ranches)).toBeNull()
    expect(ranchForMob('Johns Cattle', ranches)).toBeNull()
    expect(ranchForMob('Replacement Heifer', ranches)).toBeNull()
    expect(ranchForMob(null, ranches)).toBeNull()
  })
})
