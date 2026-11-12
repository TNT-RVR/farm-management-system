import { describe, it, expect } from 'vitest'
import {
  cropVerdict,
  daysBetween,
  phaseForDay,
  sheetFor,
  sortTriggerRows,
  stageTriggerPct,
  triggerRow,
  triggerSentence,
  triggerSummary,
  type CropSheet,
  type StageRow,
  type TriggerInput,
} from './crop-irrigation'

/** Barley's stage lengths as crop_coefficients holds them. */
const BARLEY_LENGTHS = { l_ini: 15, l_dev: 25, l_mid: 50, l_late: 30 }

function stage(p: StageRow['phase'], over: Partial<StageRow> = {}): StageRow {
  return {
    id: `stage-${p}`,
    sheet_id: 'sheet-1',
    phase: p,
    seq: 1,
    stage_label: `stage ${p}`,
    monitor_depth_cm: 50,
    start_pct: null,
    floor_pct: 60,
    note: null,
    ...over,
  }
}

function sheet(over: Partial<CropSheet> = {}): CropSheet {
  return {
    id: 'sheet-1',
    coef_crop: 'Barley',
    coef_variant: '',
    crop_label: 'Barley',
    paper_id: 'paper-1',
    agdex: '114/561-1',
    published: 'April 2011',
    season_mm_low: 380,
    season_mm_high: 430,
    peak_mm_day: 7,
    peak_when: 'flowering',
    root_zone_cm: 100,
    root_note: null,
    final_note: null,
    establish_note: null,
    created_at: '2026-11-04T00:00:00Z',
    stages: [
      stage('ini'),
      stage('dev', { stage_label: 'Tillering to late boot', start_pct: 65 }),
      stage('mid', { stage_label: 'Early heading to fruit formation', monitor_depth_cm: 100, start_pct: 60 }),
      stage('late', { stage_label: 'Soft dough to maturity', monitor_depth_cm: 100 }),
    ],
    refill: [],
    ...over,
  }
}

function input(over: Partial<TriggerInput> = {}): TriggerInput {
  return {
    fieldId: 'f1',
    fieldName: 'Field 1',
    cropName: 'Barley',
    coefCrop: 'Barley',
    coefVariant: '',
    lengths: BARLEY_LENGTHS,
    plantingDate: '2026-05-01',
    stageOverride: null,
    availMm: 126,
    capacityMm: 200,
    trackedDepthCm: 100,
    balanceOn: '2026-07-10',
    done: false,
    seasonId: 's1',
    ...over,
  }
}

describe('phaseForDay', () => {
  it('walks the same boundaries the water-use curve does', () => {
    expect(phaseForDay(BARLEY_LENGTHS, 0)).toBe('ini')
    expect(phaseForDay(BARLEY_LENGTHS, 15)).toBe('ini')
    expect(phaseForDay(BARLEY_LENGTHS, 16)).toBe('dev')
    expect(phaseForDay(BARLEY_LENGTHS, 40)).toBe('dev')
    expect(phaseForDay(BARLEY_LENGTHS, 41)).toBe('mid')
    expect(phaseForDay(BARLEY_LENGTHS, 90)).toBe('mid')
    expect(phaseForDay(BARLEY_LENGTHS, 91)).toBe('late')
  })

  it('keeps a crop standing past its table in the late stage, not back at the start', () => {
    expect(phaseForDay(BARLEY_LENGTHS, 400)).toBe('late')
  })
})

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-05-01', '2026-05-01')).toBe(0)
    expect(daysBetween('2026-05-01', '2026-07-10')).toBe(70)
  })

  it('is not shifted by the spring clock change', () => {
    // 8 March 2026 is the Sunday the clocks go forward here.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })
})

describe('cropVerdict', () => {
  const dev = stage('dev', { start_pct: 65, floor_pct: 60 })

  it('starts at the sheet’s start figure, not its floor', () => {
    expect(cropVerdict(63, dev)).toBe('start')
    expect(cropVerdict(65, dev)).toBe('start')
  })

  it('calls anything under the floor past it', () => {
    expect(cropVerdict(59.9, dev)).toBe('below')
  })

  it('warns inside five points of the trigger and holds above that', () => {
    expect(cropVerdict(70, dev)).toBe('watch')
    expect(cropVerdict(70.1, dev)).toBe('ok')
  })

  it('uses the floor as the trigger where the sheet gives no start figure', () => {
    const noStart = stage('late', { start_pct: null, floor_pct: 60 })
    expect(stageTriggerPct(noStart)).toBe(60)
    expect(cropVerdict(60, noStart)).toBe('start')
    expect(cropVerdict(61, noStart)).toBe('watch')
  })

  it('reads potato’s tighter tuber-initiation floor', () => {
    const tuber = stage('dev', { start_pct: 70, floor_pct: 70 })
    expect(cropVerdict(68, tuber)).toBe('below')
    expect(cropVerdict(70, tuber)).toBe('start')
  })

  it('reads winter wheat’s looser pre-heading floor', () => {
    const preHead = stage('dev', { start_pct: 60, floor_pct: 50 })
    expect(cropVerdict(55, preHead)).toBe('start')
    expect(cropVerdict(49, preHead)).toBe('below')
  })
})

describe('sheetFor', () => {
  const barley = sheet()
  const silage = sheet({ id: 's2', coef_crop: 'Corn', coef_variant: 'silage', crop_label: 'Silage corn' })
  const sheets = [barley, silage]

  it('matches a sheet whose variant is empty against any variant', () => {
    expect(sheetFor(sheets, 'Barley', '')?.id).toBe('sheet-1')
    expect(sheetFor(sheets, 'Barley', 'anything')?.id).toBe('sheet-1')
  })

  it('does not lend the silage corn sheet to grain corn', () => {
    expect(sheetFor(sheets, 'Corn', 'silage')?.id).toBe('s2')
    expect(sheetFor(sheets, 'Corn', 'grain')).toBeNull()
  })

  it('has nothing for a crop with no coefficient', () => {
    expect(sheetFor(sheets, null, null)).toBeNull()
  })
})

describe('triggerRow', () => {
  const sheets = [sheet()]

  it('times the stage off the planting date and reads the sheet', () => {
    const r = triggerRow(input(), sheets)
    // 70 days after a 1 May seeding puts barley in its mid-season stage, where
    // the sheet reads the whole 100 cm zone and says not to go below 60%.
    expect(r.stage?.phase).toBe('mid')
    expect(r.stageSource).toBe('planting_date')
    expect(r.pct).toBeCloseTo(63, 5)
    expect(r.verdict).toBe('watch')
    expect(triggerSentence(r)).toBe(
      'at 63% of available — barley at early heading to fruit formation, close to its 60% trigger',
    )
  })

  it('says start now once the reading is at the stage’s own trigger', () => {
    // The same 63% reading at tillering, where the sheet says to start at 65%.
    const r = triggerRow(input({ stageOverride: 'dev' }), sheets)
    expect(r.verdict).toBe('start')
    expect(triggerSentence(r)).toBe(
      'at 63% of available — barley at tillering to late boot, start now (65%)',
    )
  })

  it('lets a stage set by hand win over the planting date', () => {
    const r = triggerRow(input({ stageOverride: 'dev' }), sheets)
    expect(r.stage?.phase).toBe('dev')
    expect(r.stageSource).toBe('by_hand')
  })

  it('says which gap there is rather than going blank', () => {
    expect(triggerRow(input({ coefCrop: 'Corn', coefVariant: 'grain', cropName: 'Grain Corn' }), sheets).gap)
      .toMatch(/has not published a scheduling sheet for Grain Corn/)
    expect(triggerRow(input({ plantingDate: null }), sheets).gap).toMatch(/No planting date/)
    expect(triggerRow(input({ availMm: null }), sheets).gap).toBe('No water balance for this field yet')
  })

  it('gives no percentage when the field has no capacity figure', () => {
    expect(triggerRow(input({ capacityMm: 0 }), sheets).pct).toBeNull()
  })

  it('points a grain corn field at the silage sheet by name, without lending its numbers', () => {
    const withSilage = [
      sheet(),
      sheet({ id: 's2', coef_crop: 'Corn', coef_variant: 'silage', crop_label: 'Silage corn' }),
    ]
    const r = triggerRow(input({ coefCrop: 'Corn', coefVariant: 'grain', cropName: 'Grain Corn' }), withSilage)
    expect(r.sheet).toBeNull()
    expect(r.verdict).toBeNull()
    expect(r.nearSheet?.crop_label).toBe('Silage corn')
    expect(r.gap).toMatch(/the silage corn sheet is the nearest/)
  })
})

describe('sortTriggerRows and triggerSummary', () => {
  const sheets = [sheet()]
  const rows = [
    triggerRow(input({ fieldId: 'a', fieldName: 'A', availMm: 190 }), sheets), // 95% -> ok
    triggerRow(input({ fieldId: 'b', fieldName: 'B', availMm: 110 }), sheets), // 55% -> below
    triggerRow(input({ fieldId: 'c', fieldName: 'C', availMm: 128 }), sheets), // 64% -> watch
    triggerRow(input({ fieldId: 'd', fieldName: 'D', availMm: 100, done: true }), sheets),
  ]

  it('puts the driest first and the finished fields last', () => {
    expect(sortTriggerRows(rows).map((r) => r.fieldId)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('counts what needs acting on, leaving the finished fields out', () => {
    expect(triggerSummary(rows)).toBe('1 field is at or past its crop’s trigger · 1 getting close')
  })

  it('says so plainly when nothing is at its trigger', () => {
    expect(triggerSummary([rows[0]])).toBe('No field is at its crop’s trigger')
  })
})
