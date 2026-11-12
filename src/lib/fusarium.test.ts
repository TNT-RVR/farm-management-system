import { describe, expect, it } from 'vitest'
import {
  HUMID_RH,
  INFECTION_WINDOW_DAYS,
  SPELL_HOURS,
  SPRAY_WINDOW_DAYS,
  SUSCEPTIBILITY,
  WARM_HI_C,
  WARM_LO_C,
  cerealClass,
  fhbSpells,
  floweringClashes,
  group11InWindow,
  infectionWindow,
  irrigationInWindow,
  isResidueHost,
  levelFor,
  residueRisk,
  sortFields,
  spellsFromDays,
  spellsFromHours,
  windowState,
  type Day,
  type FhbField,
  type Hour,
} from './fusarium'

// Alberta's sheet gives words, not thresholds: "around 25 degrees C ...
// associated with precipitation, or very high humidity, for 36 hours". These
// tests pin the app's reading of those words, so a later tidy-up cannot widen
// the band or drop the 36-hour span without a test saying so.

const hoursFrom = (startISO: string, n: number, f: (i: number) => Partial<Hour>): Hour[] =>
  Array.from({ length: n }, (_, i) => {
    const ts = new Date(Date.parse(`${startISO}T00:00:00Z`) + i * 3_600_000).toISOString()
    return { ts, temp_c: 25, rh: 70, precip_mm: 0, ...f(i) }
  })

describe('the 36-hour weather rule, hour by hour', () => {
  it('calls a warm wet spell conducive', () => {
    const hours = hoursFrom('2026-07-10', 48, (i) => ({ temp_c: 24, precip_mm: i === 5 ? 3 : 0 }))
    const spells = spellsFromHours(hours, '2026-07-01', '2026-07-31')
    expect(spells).toHaveLength(1)
    expect(spells[0].wet).toBe('rain')
    expect(spells[0].rainMm).toBeCloseTo(3, 5)
  })

  it('calls a warm humid spell conducive with no rain at all', () => {
    const hours = hoursFrom('2026-07-10', 40, () => ({ temp_c: 24, rh: 92, precip_mm: 0 }))
    const spells = spellsFromHours(hours, '2026-07-01', '2026-07-31')
    expect(spells).toHaveLength(1)
    expect(spells[0].wet).toBe('humidity')
    expect(spells[0].meanRh).toBeCloseTo(92, 5)
  })

  it('needs the full 36 hours', () => {
    // 35 warm wet hours is not the sheet's rule, and must not be rounded up to it.
    const hours = hoursFrom('2026-07-10', SPELL_HOURS - 1, (i) => ({ temp_c: 24, precip_mm: i === 2 ? 5 : 0 }))
    expect(spellsFromHours(hours, '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('wants warmth and wet together, not one or the other', () => {
    const warmDry = hoursFrom('2026-07-10', 48, () => ({ temp_c: 25, rh: 40, precip_mm: 0 }))
    expect(spellsFromHours(warmDry, '2026-07-01', '2026-07-31')).toHaveLength(0)
    const coolWet = hoursFrom('2026-07-10', 48, () => ({ temp_c: 12, rh: 95, precip_mm: 2 }))
    expect(spellsFromHours(coolWet, '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('reads the band as a mean over the spell, so a hot afternoon alone is not a spell', () => {
    // Mean 32 °C is outside the band even though every hour is "warm".
    const tooHot = hoursFrom('2026-07-10', 48, () => ({ temp_c: 32, rh: 95 }))
    expect(spellsFromHours(tooHot, '2026-07-01', '2026-07-31')).toHaveLength(0)
    const justIn = hoursFrom('2026-07-10', 48, () => ({ temp_c: WARM_HI_C, rh: HUMID_RH }))
    expect(spellsFromHours(justIn, '2026-07-01', '2026-07-31')).toHaveLength(1)
    const justOut = hoursFrom('2026-07-10', 48, () => ({ temp_c: WARM_LO_C - 0.1, rh: 95 }))
    expect(spellsFromHours(justOut, '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('merges a long spell into one, not one per hour', () => {
    const hours = hoursFrom('2026-07-10', 24 * 5, () => ({ temp_c: 24, rh: 95 }))
    const spells = spellsFromHours(hours, '2026-07-01', '2026-07-31')
    expect(spells).toHaveLength(1)
    expect(spells[0].hours).toBe(24 * 5)
  })

  it('will not stitch a spell across a gap in the record', () => {
    // A station offline for a week would otherwise hand back 36 "consecutive"
    // readings spanning a fortnight and read as conducive weather.
    const before = hoursFrom('2026-07-01', 18, () => ({ temp_c: 24, rh: 95 }))
    const after = hoursFrom('2026-07-20', 18, () => ({ temp_c: 24, rh: 95 }))
    expect(spellsFromHours([...before, ...after], '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('marks a spell that is still a forecast', () => {
    const hours = hoursFrom('2026-07-10', 48, (i) => ({ temp_c: 24, rh: 95, forecast: i > 30 }))
    expect(spellsFromHours(hours, '2026-07-01', '2026-07-31')[0].forecast).toBe(true)
  })

  it('ignores hours outside the flowering window', () => {
    const hours = hoursFrom('2026-08-10', 48, () => ({ temp_c: 24, rh: 95 }))
    expect(spellsFromHours(hours, '2026-07-01', '2026-07-31')).toHaveLength(0)
  })
})

describe('the same rule read off daily records', () => {
  const day = (date: string, o: Partial<Day> = {}): Day => ({
    date,
    tmax_c: 26,
    tmin_c: 14,
    rh_mean: 70,
    rh_max: null,
    rh_min: null,
    precip_mm: 0,
    ...o,
  })

  it('takes two consecutive warm days with rain', () => {
    const days = [day('2026-07-10', { precip_mm: 4 }), day('2026-07-11')]
    const spells = spellsFromDays(days, '2026-07-01', '2026-07-31')
    expect(spells).toHaveLength(1)
    expect(spells[0].hours).toBe(48)
  })

  it('will not take a single day, however wet', () => {
    expect(spellsFromDays([day('2026-07-10', { precip_mm: 40 })], '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('breaks the run on a cool day', () => {
    const days = [
      day('2026-07-10', { precip_mm: 4 }),
      day('2026-07-11', { tmax_c: 11 }),
      day('2026-07-12', { precip_mm: 4 }),
    ]
    expect(spellsFromDays(days, '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('breaks the run on a missing day', () => {
    const days = [day('2026-07-10', { precip_mm: 4 }), day('2026-07-12', { precip_mm: 4 })]
    expect(spellsFromDays(days, '2026-07-01', '2026-07-31')).toHaveLength(0)
  })

  it('falls back to the high and low when there is no mean humidity', () => {
    const days = [
      day('2026-07-10', { rh_mean: null, rh_max: 98, rh_min: 80 }),
      day('2026-07-11', { rh_mean: null, rh_max: 98, rh_min: 80 }),
    ]
    expect(spellsFromDays(days, '2026-07-01', '2026-07-31')).toHaveLength(1)
  })

  it('never calls a daily spell a forecast', () => {
    const days = [day('2026-07-10', { precip_mm: 4 }), day('2026-07-11')]
    expect(spellsFromDays(days, '2026-07-01', '2026-07-31')[0].forecast).toBe(false)
  })
})

describe('choosing which record to read', () => {
  const warmWetHours = hoursFrom('2026-07-05', 24 * 10, () => ({ temp_c: 24, rh: 95 }))
  const days: Day[] = Array.from({ length: 20 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    tmax_c: 26,
    tmin_c: 14,
    rh_mean: 95,
    rh_max: null,
    rh_min: null,
    precip_mm: 0,
  }))

  it('uses hourly when it reaches the start of the window', () => {
    expect(fhbSpells({ from: '2026-07-06', to: '2026-07-14', hours: warmWetHours, days }).basis).toBe('hourly')
  })

  it('falls back to daily when hourly starts after the window does', () => {
    // The hourly record is a rolling few months, so any earlier season has only
    // daily rows. Half-covered must not read as hourly, or the uncovered half
    // would silently report no weather.
    const r = fhbSpells({ from: '2026-07-01', to: '2026-07-14', hours: warmWetHours, days })
    expect(r.basis).toBe('daily')
    expect(r.spells.length).toBeGreaterThan(0)
  })

  it('says so when neither record covers the window', () => {
    const r = fhbSpells({ from: '2020-07-01', to: '2020-07-14', hours: warmWetHours, days })
    expect(r.basis).toBe('none')
    expect(r.spells).toEqual([])
  })
})

describe('which crops are in this', () => {
  it('knows the cereals this farm grows', () => {
    expect(cerealClass('Durum Wheat')).toBe('durum')
    expect(cerealClass('Wheat')).toBe('spring wheat')
    expect(cerealClass('Barley')).toBe('barley')
    expect(cerealClass('Oats')).toBe('oat')
    expect(cerealClass('Triticale')).toBe('triticale')
    // Green feed is barley cut green here, and shares barley's susceptibility.
    expect(cerealClass('Green Feed')).toBe('barley')
  })

  it('does not call a non-cereal a cereal', () => {
    for (const c of ['Canola', 'Potato', 'Silage Corn', 'Peas', 'Alfalfa', null, '']) {
      expect(cerealClass(c), String(c)).toBeNull()
    }
  })

  it('reads durum before wheat, so durum is never filed as spring wheat', () => {
    expect(cerealClass('Durum Wheat')).not.toBe('spring wheat')
  })

  it('counts corn as residue that carries the fungus, though not as a cereal', () => {
    for (const c of ['Grain Corn', 'Silage Corn', 'High-Moisture Corn', 'Sorghum']) {
      expect(isResidueHost(c), c).toBe(true)
      expect(cerealClass(c), c).toBeNull()
    }
    expect(isResidueHost('Canola')).toBe(false)
    expect(isResidueHost('Barley')).toBe(true)
  })

  it('keeps the susceptibility order the sheet prints, and leaves the unranked unranked', () => {
    expect(SUSCEPTIBILITY.durum.rank!).toBeLessThan(SUSCEPTIBILITY['spring wheat'].rank!)
    expect(SUSCEPTIBILITY['spring wheat'].rank!).toBeLessThan(SUSCEPTIBILITY.barley.rank!)
    expect(SUSCEPTIBILITY.barley.rank!).toBeLessThan(SUSCEPTIBILITY.oat.rank!)
    expect(SUSCEPTIBILITY['winter wheat'].rank).toBeNull()
    expect(SUSCEPTIBILITY.triticale.rank).toBeNull()
  })
})

describe('the infection window', () => {
  const barley = { l_ini: 15, l_dev: 25, l_mid: 50, l_late: 30 }

  it('starts heading where the crop’s own water-use curve starts its mid stage', () => {
    const w = infectionWindow('2026-05-01', barley)!
    // 15 + 25 = 40 days after planting.
    expect(w.headingOn).toBe('2026-06-10')
    expect(w.sprayTo).toBe('2026-06-17')
    expect(w.to).toBe('2026-06-24')
  })

  it('runs the spray window for the sheet’s seven days and the weather window past it', () => {
    const w = infectionWindow('2026-05-01', barley)!
    expect(Math.round((Date.parse(w.sprayTo) - Date.parse(w.sprayFrom)) / 86_400_000)).toBe(SPRAY_WINDOW_DAYS)
    expect(Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86_400_000)).toBe(INFECTION_WINDOW_DAYS)
  })

  it('has no window without a planting date or stage lengths', () => {
    expect(infectionWindow(null, barley)).toBeNull()
    expect(infectionWindow('2026-05-01', null)).toBeNull()
    expect(infectionWindow('2026-05-01', { l_ini: 0, l_dev: 0, l_mid: 0, l_late: 0 })).toBeNull()
  })

  it('says where today sits', () => {
    const w = infectionWindow('2026-05-01', barley)!
    expect(windowState(w, '2026-06-01')).toBe('before')
    expect(windowState(w, '2026-06-12')).toBe('spray window')
    expect(windowState(w, '2026-06-20')).toBe('open')
    expect(windowState(w, '2026-07-01')).toBe('past')
  })
})

describe('residue from the last two years', () => {
  const hist = [
    { crop_year: 2025, cropName: 'Grain Corn' },
    { crop_year: 2024, cropName: 'Canola' },
    { crop_year: 2023, cropName: 'Barley' },
  ]

  it('looks at two years and no further, because two is what the sheet asks for', () => {
    const r = residueRisk(hist, 2026)
    expect(r.hosts.map((h) => h.crop_year)).toEqual([2025])
    expect(r.clear).toBe(false)
    // 2023's barley is outside the two years and must not count against it.
    expect(r.hosts.some((h) => h.crop_year === 2023)).toBe(false)
  })

  it('marks corn, which the sheet singles out for the volume of its stubble', () => {
    expect(residueRisk(hist, 2026).hosts[0].corn).toBe(true)
    expect(residueRisk([{ crop_year: 2025, cropName: 'Barley' }], 2026).hosts[0].corn).toBe(false)
  })

  it('is clear after two non-host years', () => {
    const r = residueRisk(
      [
        { crop_year: 2025, cropName: 'Canola' },
        { crop_year: 2024, cropName: 'Peas' },
      ],
      2026,
    )
    expect(r.clear).toBe(true)
    expect(r.unknown).toBe(false)
  })

  it('says when a year is simply not on record, rather than calling it clear', () => {
    const r = residueRisk([{ crop_year: 2025, cropName: 'Canola' }], 2026)
    expect(r.clear).toBe(true)
    expect(r.unknown).toBe(true)
  })
})

describe('the fungicide and the pivot', () => {
  const w = infectionWindow('2026-05-01', { l_ini: 15, l_dev: 25, l_mid: 50, l_late: 30 })!

  it('flags a Group 11 fungicide inside the window', () => {
    const found = group11InWindow(
      [
        { applied_on: '2026-06-12', name: 'Headline', scheme: 'fungicide', group_code: '11' },
        { applied_on: '2026-06-12', name: 'Prosaro', scheme: 'fungicide', group_code: '3' },
        { applied_on: '2026-05-20', name: 'Headline', scheme: 'fungicide', group_code: '11' },
        { applied_on: '2026-06-12', name: 'Matador', scheme: 'insecticide', group_code: '11' },
      ],
      w,
    )
    // Only the Group 11 fungicide, and only the one inside the window. An
    // insecticide that happens to be group 11 on its own scheme is a different
    // numbering entirely.
    expect(found).toHaveLength(1)
    expect(found[0].applied_on).toBe('2026-06-12')
    expect(found[0].name).toBe('Headline')
  })

  it('counts irrigation during flowering apart from irrigation before it', () => {
    const got = irrigationInWindow(
      [
        { date: '2026-06-05', gross_mm: 25 },
        { date: '2026-06-12', gross_mm: 25 },
        { date: '2026-05-01', gross_mm: 25 },
        { date: '2026-07-15', gross_mm: 25 },
      ],
      w,
    )
    expect(got.map((e) => e.date)).toEqual(['2026-06-05', '2026-06-12'])
    expect(got[0].before).toBe(true)
    expect(got[1].before).toBe(false)
  })
})

describe('the level, and why', () => {
  const base = {
    spells: [],
    residue: { hosts: [], clear: true, unknown: false },
    irrigation: [],
    cereal: 'barley' as const,
    irrigated: false,
    state: 'open' as const,
  }
  const spell = {
    from: '2026-06-12',
    to: '2026-06-14',
    hours: 48,
    meanTempC: 24,
    meanRh: 95,
    rainMm: 0,
    wet: 'humidity' as const,
    forecast: false,
  }
  const cornLastYear = {
    hosts: [{ crop_year: 2025, cropName: 'Grain Corn', corn: true }],
    clear: false,
    unknown: false,
  }

  it('is low with nothing against the field', () => {
    expect(levelFor(base).level).toBe('low')
  })

  it('is watch on residue alone, because residue is next spring’s decision', () => {
    expect(levelFor({ ...base, residue: cornLastYear }).level).toBe('watch')
  })

  it('is watch on conducive weather alone', () => {
    expect(levelFor({ ...base, spells: [spell] }).level).toBe('watch')
  })

  it('is high only when the weather lands on a field that has the inoculum', () => {
    expect(levelFor({ ...base, spells: [spell], residue: cornLastYear }).level).toBe('high')
  })

  it('is high when the weather lands on a field irrigated through flowering', () => {
    expect(
      levelFor({ ...base, spells: [spell], irrigation: [{ date: '2026-06-12', gross_mm: 25, before: false }] }).level,
    ).toBe('high')
  })

  it('does not lift winter wheat to high, which usually flowers before the spores are about', () => {
    const r = levelFor({ ...base, cereal: 'winter wheat', spells: [spell], residue: cornLastYear })
    expect(r.level).toBe('watch')
    expect(r.reasons.join(' ')).toMatch(/flowers before the spores/)
  })

  it('does not put the rule’s own 36 hours where the spell’s length belongs', () => {
    // The spell listed under the reason was 48 hours. Splicing the rule's "36
    // hours" into the sentence made the two contradict each other on screen.
    const r = levelFor({ ...base, spells: [spell] })
    const line = r.reasons.find((x) => /spell/.test(x))!
    expect(line).not.toMatch(/36 hours/)
    expect(line).toMatch(/warm, wet weather Alberta describes/)
  })

  it('gives a reason for everything it counted', () => {
    const r = levelFor({
      ...base,
      cereal: 'durum',
      irrigated: true,
      spells: [spell],
      residue: cornLastYear,
      irrigation: [{ date: '2026-06-05', gross_mm: 25, before: true }],
    })
    expect(r.reasons.join(' | ')).toMatch(/spell/)
    expect(r.reasons.join(' | ')).toMatch(/corn stubble/)
    expect(r.reasons.join(' | ')).toMatch(/week before flowering/)
    expect(r.reasons.join(' | ')).toMatch(/most susceptible/)
    expect(r.reasons.join(' | ')).toMatch(/irrigated southern fields/)
  })

  it('says when a year of the rotation is missing instead of passing it over', () => {
    const r = levelFor({ ...base, residue: { hosts: [], clear: true, unknown: true } })
    expect(r.reasons.join(' ')).toMatch(/no crop on record/)
  })
})

describe('the farm-wide view', () => {
  const field = (name: string, level: 'low' | 'watch' | 'high', from: string): FhbField =>
    ({
      fieldId: name,
      fieldName: name,
      cropName: 'Barley',
      cereal: 'barley',
      variety: null,
      irrigated: false,
      plantingDate: '2026-05-01',
      window: { headingOn: from, sprayFrom: from, sprayTo: from, from, to: from },
      phase: 'mid',
      state: 'open',
      spells: [],
      basis: 'hourly',
      residue: { hosts: [], clear: true, unknown: false },
      irrigation: [],
      group11: [],
      level,
      reasons: [],
    }) as FhbField

  it('puts the field needing a decision at the top', () => {
    const rows = sortFields([
      field('A', 'low', '2026-06-01'),
      field('B', 'high', '2026-06-20'),
      field('C', 'watch', '2026-06-10'),
    ])
    expect(rows.map((r) => r.fieldName)).toEqual(['B', 'C', 'A'])
  })

  it('names the fields whose spray windows land on the same days', () => {
    const rows = [field('A', 'low', '2026-06-10'), field('B', 'low', '2026-06-10'), field('C', 'low', '2026-08-01')]
    // A and B flower together; C does not, and must not be dragged in.
    const clashes = floweringClashes(rows)
    expect(clashes).toHaveLength(1)
    expect(clashes[0].fields).toEqual(['A', 'B'])
  })

  it('says nothing when the seeding dates are already staggered', () => {
    expect(floweringClashes([field('A', 'low', '2026-06-10'), field('B', 'low', '2026-07-20')])).toEqual([])
  })
})
