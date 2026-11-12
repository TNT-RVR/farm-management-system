import { describe, expect, it } from 'vitest'
import {
  BEE_FACTS,
  HAIL_NOTICE_HOURS,
  LEAFCUTTER_HATCH_HOURS,
  beekeeperNote,
  hailWarnings,
  inFieldOn,
  mergePasses,
  pivotWarnings,
  sortWarnings,
  sprayWarnings,
  stockingAdvice,
  type Placement,
} from './pollinators'

// The two 2019 Alberta guides give exact figures: leafcutters at 5 per cent
// bloom, honey bees at 10, 800 m and 100 m of foraging, flight from 13 °C and
// 20 °C, 36 hours before the pivot may run, 24 hours to tell the beekeeper
// about hail. These tests pin those numbers and the one flat prohibition —
// never an insecticide on blooming canola.

const place = (o: Partial<Placement> = {}): Placement => ({
  id: 'p1',
  field_id: 'f1',
  kind: 'leafcutter',
  placed_on: '2026-07-05',
  removed_on: null,
  units: 4,
  contact_id: null,
  contactName: 'Hiebert Honey',
  note: null,
  ...o,
})

describe('the guides’ own figures', () => {
  it('stocks leafcutters at five per cent bloom and honey bees at ten', () => {
    expect(BEE_FACTS.leafcutter.stockAtPct).toBe(5)
    expect(BEE_FACTS.honey.stockAtPct).toBe(10)
  })

  it('keeps the two foraging distances and flight temperatures apart', () => {
    // 800 m against 100 m is why a spray next door is the honey bees' business
    // and not the leafcutters'.
    expect(BEE_FACTS.honey.forageM).toBe(800)
    expect(BEE_FACTS.leafcutter.forageM).toBe(100)
    expect(BEE_FACTS.honey.flightC).toBe(13)
    expect(BEE_FACTS.leafcutter.flightC).toBe(20)
  })

  it('holds the pivot for 36 hours and the hail call to 24', () => {
    expect(LEAFCUTTER_HATCH_HOURS).toBe(36)
    expect(HAIL_NOTICE_HOURS).toBe(24)
  })
})

describe('whether the bees are in the field', () => {
  it('counts the day they arrive and the day they leave', () => {
    const p = place({ placed_on: '2026-07-05', removed_on: '2026-07-20' })
    expect(inFieldOn(p, '2026-07-04')).toBe(false)
    expect(inFieldOn(p, '2026-07-05')).toBe(true)
    expect(inFieldOn(p, '2026-07-20')).toBe(true)
    expect(inFieldOn(p, '2026-07-21')).toBe(false)
  })

  it('treats a placement with no removal date as still in the field', () => {
    expect(inFieldOn(place({ removed_on: null }), '2026-09-01')).toBe(true)
  })
})

describe('the stocking guide', () => {
  const today = '2026-07-10'

  it('says too early below five per cent', () => {
    const a = stockingAdvice({ yellowNow: 0.03, stage: 'starting', placements: [], today })
    expect(a.state).toBe('too early')
  })

  it('calls for leafcutters at five per cent but not yet honey bees', () => {
    const a = stockingAdvice({ yellowNow: 0.06, stage: 'starting', placements: [], today })
    expect(a.state).toBe('stock leafcutters')
  })

  it('calls for both once bloom passes ten per cent and neither is in', () => {
    const a = stockingAdvice({ yellowNow: 0.12, stage: 'window', placements: [], today })
    expect(a.state).toBe('both due')
  })

  it('asks only for the kind that is missing', () => {
    const withLeafcutters = stockingAdvice({
      yellowNow: 0.12,
      stage: 'window',
      placements: [place({ kind: 'leafcutter' })],
      today,
    })
    expect(withLeafcutters.state).toBe('stock honey bees')
    const withHoney = stockingAdvice({ yellowNow: 0.12, stage: 'window', placements: [place({ kind: 'honey' })], today })
    expect(withHoney.state).toBe('stock leafcutters')
  })

  it('is settled once both kinds are in', () => {
    const a = stockingAdvice({
      yellowNow: 0.4,
      stage: 'full',
      placements: [place({ kind: 'leafcutter' }), place({ id: 'p2', kind: 'honey' })],
      today,
    })
    expect(a.state).toBe('in')
  })

  it('does not ask for bees on a crop that is going over', () => {
    // A falling crop at 12 per cent is on its way out, not on its way in, and
    // bringing hives to it is the opposite of the guides' advice.
    expect(stockingAdvice({ yellowNow: 0.12, stage: 'falling', placements: [], today }).state).toBe('waning')
  })

  it('tells a finished crop apart from a falling one', () => {
    // "Start taking the hives out in stages" is the right line in August and a
    // silly one in November, when the record just says the bloom is over.
    expect(stockingAdvice({ yellowNow: 0.9, stage: 'over', placements: [], today }).state).toBe('over')
  })

  it('says nothing at all when the satellite has no share to give', () => {
    expect(stockingAdvice({ yellowNow: null, stage: 'window', placements: [], today }).state).toBe('unknown')
  })

  it('ignores a placement that has already been removed', () => {
    const gone = place({ kind: 'leafcutter', placed_on: '2026-06-01', removed_on: '2026-07-01' })
    expect(stockingAdvice({ yellowNow: 0.07, stage: 'window', placements: [gone], today }).state).toBe('stock leafcutters')
  })
})

describe('sprays while the bees are in', () => {
  const bees = [place({ kind: 'honey', placed_on: '2026-07-05', removed_on: '2026-07-25' })]

  it('calls an insecticide on a bee-stocked field what the guides call it', () => {
    const w = sprayWarnings([{ applied_on: '2026-07-10', product_name: 'Matador', scheme: 'insecticide' }], bees)
    expect(w).toHaveLength(1)
    expect(w[0].severity).toBe('never')
    expect(w[0].why).toMatch(/never be sprayed with insecticides/)
    expect(w[0].text).toMatch(/honey bees/)
  })

  it('treats a fungicide as caution, not as a prohibition', () => {
    const w = sprayWarnings([{ applied_on: '2026-07-10', product_name: 'Proline', scheme: 'fungicide' }], bees)
    expect(w[0].severity).toBe('caution')
  })

  it('says so when the product’s chemistry is not on record', () => {
    // An unplaced product is not a cleared one, and passing over it would make
    // the list read as a clean bill of health.
    const w = sprayWarnings([{ applied_on: '2026-07-10', product_name: 'Unknown jug', scheme: null }], bees)
    expect(w).toHaveLength(1)
    expect(w[0].severity).toBe('caution')
    expect(w[0].text).toMatch(/not on record/)
  })

  it('leaves a herbicide alone', () => {
    expect(sprayWarnings([{ applied_on: '2026-07-10', product_name: 'Liberty', scheme: 'herbicide' }], bees)).toEqual([])
  })

  it('ignores a spray from before the bees arrived or after they left', () => {
    const passes = [
      { applied_on: '2026-07-01', product_name: 'Matador', scheme: 'insecticide' },
      { applied_on: '2026-08-01', product_name: 'Matador', scheme: 'insecticide' },
    ]
    expect(sprayWarnings(passes, bees)).toEqual([])
  })

  it('names both kinds when both were in the field', () => {
    const both = [place({ kind: 'honey' }), place({ id: 'p2', kind: 'leafcutter' })]
    const w = sprayWarnings([{ applied_on: '2026-07-10', product_name: 'Matador', scheme: 'insecticide' }], both)
    expect(w[0].text).toMatch(/honey bees and leafcutter bees|leafcutter bees and honey bees/)
  })
})

describe('the pivot and the leafcutters', () => {
  it('flags a pass inside the hatching window', () => {
    const w = pivotWarnings([{ date: '2026-07-06', gross_mm: 20 }], [place({ kind: 'leafcutter', placed_on: '2026-07-05' })])
    expect(w).toHaveLength(1)
    expect(w[0].severity).toBe('never')
    expect(w[0].why).toMatch(/36 hours as the minimum/)
  })

  it('leaves a pass after the window alone', () => {
    const w = pivotWarnings([{ date: '2026-07-09', gross_mm: 20 }], [place({ kind: 'leafcutter', placed_on: '2026-07-05' })])
    expect(w).toEqual([])
  })

  it('does not apply the rule to honey bees, which it is not about', () => {
    const w = pivotWarnings([{ date: '2026-07-06', gross_mm: 20 }], [place({ kind: 'honey', placed_on: '2026-07-05' })])
    expect(w).toEqual([])
  })

  it('says the minimum is a floor, not the answer', () => {
    const w = pivotWarnings([{ date: '2026-07-05', gross_mm: 20 }], [place({ kind: 'leafcutter', placed_on: '2026-07-05' })])
    expect(w[0].why).toMatch(/depends on the weather/)
  })
})

describe('hail with bees in the field', () => {
  it('names who has to hear, and by when', () => {
    const w = hailWarnings(
      [{ event_date: '2026-07-12', loss_pct: 70 }],
      [place({ placed_on: '2026-07-05', contactName: 'Hiebert Honey' })],
    )
    expect(w).toHaveLength(1)
    expect(w[0].severity).toBe('tell them')
    expect(w[0].text).toMatch(/Hiebert Honey/)
    expect(w[0].text).toMatch(/24 hours/)
  })

  it('still warns when no beekeeper is on the placement', () => {
    const w = hailWarnings([{ event_date: '2026-07-12', loss_pct: null }], [place({ contactName: null })])
    expect(w).toHaveLength(1)
    expect(w[0].text).not.toMatch(/undefined|null/)
  })

  it('says nothing about hail on a field with no bees in it', () => {
    const w = hailWarnings([{ event_date: '2026-06-01', loss_pct: 70 }], [place({ placed_on: '2026-07-05' })])
    expect(w).toEqual([])
  })
})

describe('ordering the warnings', () => {
  it('puts the prohibition above the courtesy call and the caution', () => {
    const ws = sortWarnings([
      { severity: 'caution', text: 'c', why: '', on: '2026-07-20' },
      { severity: 'never', text: 'n', why: '', on: '2026-07-01' },
      { severity: 'tell them', text: 't', why: '', on: '2026-07-10' },
    ])
    expect(ws.map((w) => w.severity)).toEqual(['never', 'tell them', 'caution'])
  })

  it('puts the most recent first within a severity', () => {
    const ws = sortWarnings([
      { severity: 'never', text: 'old', why: '', on: '2026-07-01' },
      { severity: 'never', text: 'new', why: '', on: '2026-07-20' },
    ])
    expect(ws.map((w) => w.text)).toEqual(['new', 'old'])
  })
})

describe('the note for the beekeeper', () => {
  const today = '2026-07-15'

  it('lists only the fields that have bees in them today', () => {
    const note = beekeeperNote(
      [
        { fieldName: 'Home Quarter', pct: 42, stage: 'full', placements: [place({ kind: 'honey', units: 24 })], upcoming: [] },
        { fieldName: 'East Half', pct: 5, stage: 'starting', placements: [], upcoming: [] },
      ],
      today,
    )
    expect(note).toMatch(/Home Quarter/)
    expect(note).not.toMatch(/East Half/)
    expect(note).toMatch(/24 hives of honey bees since 2026-07-05/)
    expect(note).toMatch(/42% bloom/)
  })

  it('names what is going on the crop, and when', () => {
    const note = beekeeperNote(
      [
        {
          fieldName: 'Home Quarter',
          pct: 42,
          stage: 'full',
          placements: [place({ kind: 'honey' })],
          upcoming: [{ applied_on: '2026-07-18', product_name: 'Proline', scheme: 'fungicide' }],
        },
      ],
      today,
    )
    expect(note).toMatch(/Proline \(fungicide\) on 2026-07-18/)
    expect(note).toMatch(/evening, after flight has ceased/)
  })

  it('says plainly when nothing is booked', () => {
    const note = beekeeperNote([{ fieldName: 'Home Quarter', pct: 42, stage: 'full', placements: [place()], upcoming: [] }], today)
    expect(note).toMatch(/Nothing booked to go on/)
  })

  it('is empty when there are no bees anywhere, rather than a note saying nothing', () => {
    expect(beekeeperNote([{ fieldName: 'Home Quarter', pct: 42, stage: 'full', placements: [], upcoming: [] }], today)).toBe('')
  })

  it('does not print a bloom share the satellite never read', () => {
    const note = beekeeperNote([{ fieldName: 'Home Quarter', pct: null, stage: null, placements: [place()], upcoming: [] }], today)
    expect(note).toMatch(/bloom share not read yet/)
    expect(note).not.toMatch(/null|NaN/)
  })
})

describe('merging the two spray sources', () => {
  const raw = (o: Partial<Parameters<typeof mergePasses>[0][number]>) => ({
    field_id: 'f1',
    operation_id: 'op1',
    product_id: 'prod1',
    name: 'Cotegra',
    applied_on: '2026-07-08',
    scheme: 'fungicide' as string | null,
    ...o,
  })

  it('keeps one pass when the two sources name the same jug differently', () => {
    // This is the live bug: field_moa_history_v says "Cotegra", the
    // application record says "Cotegra Fungicide", same operation and product.
    // Keyed on the name it warned twice -- once as a fungicide, once as a
    // product of unknown chemistry.
    const out = mergePasses(
      [raw({ name: 'Cotegra', scheme: 'fungicide' })],
      [raw({ name: 'Cotegra Fungicide', scheme: null })],
    )
    expect(out.get('f1')).toHaveLength(1)
    expect(out.get('f1')![0].scheme).toBe('fungicide')
  })

  it('lets the placed row win, so the chemistry is not lost', () => {
    const out = mergePasses([raw({ scheme: 'insecticide' })], [raw({ scheme: null })])
    expect(out.get('f1')![0].scheme).toBe('insecticide')
  })

  it('collapses the view’s one row per active ingredient', () => {
    const out = mergePasses([raw({ name: 'Cotegra' }), raw({ name: 'Cotegra' })], [])
    expect(out.get('f1')).toHaveLength(1)
  })

  it('still carries a pass the view could not place', () => {
    const out = mergePasses([], [raw({ operation_id: 'op2', product_id: null, name: 'Unknown jug', scheme: null })])
    expect(out.get('f1')).toHaveLength(1)
    expect(out.get('f1')![0].scheme).toBeNull()
  })

  it('keeps two different operations apart, same product and day', () => {
    const out = mergePasses([raw({ operation_id: 'op1' }), raw({ operation_id: 'op2' })], [])
    expect(out.get('f1')).toHaveLength(2)
  })

  it('keeps each field’s passes to itself, in date order', () => {
    const out = mergePasses(
      [
        raw({ field_id: 'f1', operation_id: 'b', applied_on: '2026-07-20' }),
        raw({ field_id: 'f1', operation_id: 'a', applied_on: '2026-07-05' }),
        raw({ field_id: 'f2', operation_id: 'c' }),
      ],
      [],
    )
    expect(out.get('f1')!.map((p) => p.applied_on)).toEqual(['2026-07-05', '2026-07-20'])
    expect(out.get('f2')).toHaveLength(1)
  })
})
