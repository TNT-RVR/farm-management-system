import { describe, expect, it } from 'vitest'
import {
  checkFigure, cropNeedles, cropsNamedIn, flatten, MEASURES, numberInPassage,
  namesWhatItMeasures, quotesSomeoneElse, saysNotSignificant, UNITS_SQL,
} from './research-numbers'
import { sayFigure } from './research'

const chunk = { id: 42, paper_id: 'p-1', page_from: 7 }
const crops = ['canola', 'spring wheat']
const actives = ['glyphosate']

/** The real shape of the text these are read out of, line breaks and all. */
const text = `Economic thresholds for flea beetle in canola are based on leaf
area loss. Spray when defoliation reaches 25 per cent and beetles are still
feeding. Seed treatments protect the crop to the two-leaf stage. Recommended
rates are 15 to 20 kg/ha of actual nitrogen on stubble.`
const hay = flatten(text)

const figure = (over: Record<string, unknown> = {}) => ({
  measure: 'economic threshold',
  subject: 'flea beetle',
  crop: 'canola',
  active: null,
  low: 25,
  high: 25,
  unit: '%',
  qualifier: 'leaf area loss',
  passage: 'Spray when defoliation reaches 25 per cent and beetles are still feeding.',
  confidence: 3,
  ...over,
})

describe('flatten', () => {
  it('levels the line breaks the typesetting left behind', () => {
    expect(flatten('one\ntwo   three')).toBe('one two three')
  })

  it('levels dashes and quote marks, so an honest quote still matches', () => {
    expect(flatten('15–20 kg')).toBe(flatten('15-20 kg'))
    expect(flatten('“spray”')).toBe('"spray"')
  })

  it('leaves digits alone, so a changed number cannot sneak through', () => {
    expect(flatten('25 per cent')).not.toBe(flatten('35 per cent'))
  })
})

describe('checkFigure', () => {
  it('keeps a figure whose sentence really is in the text', () => {
    const out = checkFigure(figure(), chunk, crops, actives, hay, 'test-model')
    expect(out.bad).toBeUndefined()
    expect(out.row).toMatchObject({
      paper_id: 'p-1',
      chunk_id: 42,
      page: 7,
      measure: 'economic threshold',
      subject: 'flea beetle',
      crop_name: 'canola',
      value_low: 25,
      unit: '%',
      confidence: 3,
    })
  })

  it('matches a quote across a line break in the original', () => {
    // This sentence is broken over two lines in the paper; the model quotes it
    // as one. That is the common case, not an edge case.
    const out = checkFigure(
      figure({
        measure: 'fertilizer rate',
        subject: 'nitrogen',
        low: 15,
        high: 20,
        unit: 'kg/ha',
        passage: 'Recommended rates are 15 to 20 kg/ha of actual nitrogen on stubble.',
      }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.bad).toBeUndefined()
    expect(out.row?.value_low).toBe(15)
    expect(out.row?.value_high).toBe(20)
  })

  // The refusals are the reason this function exists.
  it('throws away a sentence that is not in the text', () => {
    const out = checkFigure(
      figure({ passage: 'Spray when defoliation reaches 10 per cent and beetles are still feeding.' }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.bad).toBe('passage not in the text')
    expect(out.row).toBeUndefined()
  })

  it('throws away a figure whose number was changed but whose words were not', () => {
    const out = checkFigure(
      figure({ low: 50, passage: 'Spray when defoliation reaches 50 per cent and beetles are still feeding.' }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.bad).toBe('passage not in the text')
  })

  it('refuses a measure nobody asked for', () => {
    const out = checkFigure(figure({ measure: 'vibes' }), chunk, crops, actives, hay, 'test-model')
    expect(out.bad).toBe('unknown measure')
  })

  it('refuses a figure with no subject', () => {
    const out = checkFigure(figure({ subject: '  ' }), chunk, crops, actives, hay, 'test-model')
    expect(out.bad).toBe('no subject')
  })

  it('refuses a quote too short to prove anything', () => {
    const out = checkFigure(figure({ passage: '25 per cent' }), chunk, crops, actives, hay, 'test-model')
    expect(out.bad).toBe('passage too short')
  })

  it('refuses the table row a real reading quoted', () => {
    // Straight from a real reading: a fertilizer table whose zero the PDF read
    // as a letter O, from which the model inferred 110 lb/acre. The number may
    // even be right; the "sentence" shows nothing, so it cannot be checked.
    // This one is short enough that the length guard gets it first — either
    // refusal is the correct answer, so the test asserts that it is refused.
    const table = 'Nitrogen by soil test: 50 lb/acre 11 O lb / acre'
    const out = checkFigure(
      figure({ measure: 'fertilizer rate', subject: 'nitrogen', low: 110, unit: 'lb/acre', passage: '50 lb/acre 11 O lb / acre' }),
      chunk, crops, actives, flatten(table), 'test-model',
    )
    expect(out.bad).toBeDefined()
    expect(out.row).toBeUndefined()
  })

  it('refuses a long row of table cells that clears the length guard', () => {
    const table = 'Rates by soil test 20 30 40 50 lb/acre 11 O lb / acre 120 140 160 180'
    const out = checkFigure(
      figure({
        measure: 'fertilizer rate',
        subject: 'nitrogen',
        low: 110,
        unit: 'lb/acre',
        passage: '20 30 40 50 lb/acre 11 O lb / acre 120 140 160 180',
      }),
      chunk, crops, actives, flatten(table), 'test-model',
    )
    expect(out.bad).toBe('passage is not prose')
  })

  it('still keeps a short line from a list of seeding rates', () => {
    const list = 'The mix for a grassed waterway is fall rye - 1 kg/ha (0.9 lbs/ac), plus brome.'
    const out = checkFigure(
      figure({ measure: 'seeding rate', subject: 'fall rye', low: 1, high: 1, unit: 'kg/ha', passage: 'fall rye - 1 kg/ha (0.9 lbs/ac)' }),
      chunk, crops, actives, flatten(list), 'test-model',
    )
    expect(out.bad).toBeUndefined()
    expect(out.row?.value_low).toBe(1)
  })

  it('refuses a rate with no number', () => {
    const out = checkFigure(
      figure({ measure: 'application rate', low: null, high: null }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.bad).toBe('no number')
  })

  it('allows a stage to be words rather than a number', () => {
    const out = checkFigure(
      figure({
        measure: 'growth stage',
        subject: 'canola',
        low: null,
        high: null,
        unit: null,
        passage: 'Seed treatments protect the crop to the two-leaf stage.',
      }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.bad).toBeUndefined()
    expect(out.row?.value_low).toBeNull()
  })

  it('drops a crop or active this paper never named, rather than believing it', () => {
    const out = checkFigure(
      figure({ crop: 'durum', active: 'clopyralid' }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.bad).toBeUndefined()
    expect(out.row?.crop_name).toBeNull()
    expect(out.row?.active).toBeNull()
  })

  it('does not let a range run backwards', () => {
    const out = checkFigure(
      figure({
        measure: 'fertilizer rate',
        subject: 'nitrogen',
        low: 20,
        high: 15,
        unit: 'kg/ha',
        passage: 'Recommended rates are 15 to 20 kg/ha of actual nitrogen on stubble.',
      }),
      chunk, crops, actives, hay, 'test-model',
    )
    expect(out.row?.value_high).toBe(20)
  })

  it('falls back to the middle confidence when the model gives nonsense', () => {
    const out = checkFigure(figure({ confidence: 9 }), chunk, crops, actives, hay, 'test-model')
    expect(out.row?.confidence).toBe(2)
  })

  it('refuses something that is not an object at all', () => {
    expect(checkFigure('25 kg/ha', chunk, crops, actives, hay, 'm').bad).toBe('not an object')
    expect(checkFigure(null, chunk, crops, actives, hay, 'm').bad).toBe('not an object')
  })
})

describe('quotesSomeoneElse and saysNotSignificant', () => {
  it('spots a number quoted from another paper', () => {
    expect(quotesSomeoneElse(
      'The increases in barley yields from KCl fertilization in the studies of Bauer and Vasey (1964) were modest',
    )).toBe(true)
    expect(quotesSomeoneElse('In soybean, yield losses of 18-32% have been recorded [16]')).toBe(true)
    expect(quotesSomeoneElse(
      'Maximum yields of lentil were observed between 150 and 250 mm (Bowness et al. 2019), ' +
      'and these conditions were present in both years',
    )).toBe(true)
  })

  it('spots one where the sentence carries on after the citation', () => {
    expect(quotesSomeoneElse('Wen et al. (2023) found that yield increased by 41% at 200 kg/ha'))
      .toBe(true)
    expect(quotesSomeoneElse('Dosdall et al.22 report that increasing seeding rates to 12.5 kg/ha helped'))
      .toBe(true)
  })

  it('leaves a paper citing a source for its own advice alone', () => {
    // A recommendation the paper makes and backs up is still its own, and
    // this one is a real figure worth keeping.
    expect(quotesSomeoneElse(
      'The optimal seeding time is from early May to early June (Baron et al., 2000).',
    )).toBe(false)
    expect(quotesSomeoneElse(
      'Fall broadcast-incorporated urea is not recommended in southern Alberta (Smith 1980).',
    )).toBe(false)
    expect(quotesSomeoneElse('Apply 30 lb of P2O5 per acre at seeding.')).toBe(false)
  })

  it('spots a figure the paper itself calls meaningless', () => {
    expect(saysNotSignificant(
      'ammonium availability was higher (10, 42 and 155 %) although the difference was not significant',
    )).toBe(true)
    expect(saysNotSignificant('There was no significant difference between the 40 and 60 kg/ha rates.')).toBe(true)
    expect(saysNotSignificant('Grain yield responded significantly to 20 kg N/ha.')).toBe(false)
  })

  it('refuses both when a figure is checked', () => {
    const text = 'The increases in barley yields from KCl in the studies of Bauer and Vasey were 100 to 150 kg/ha.'
    const out = checkFigure(
      figure({
        measure: 'yield response', subject: 'barley', low: 100, high: 150, unit: 'kg/ha',
        passage: text,
      }),
      chunk, crops, actives, flatten(text), 'test-model',
    )
    expect(out.bad).toBe('the figure is quoted from another paper')
  })
})

describe('namesWhatItMeasures', () => {
  // Every string here is a real passage out of a real paper, stored as a
  // yield response by a full pass over the library.
  it('refuses a yield response whose sentence never mentions a yield', () => {
    expect(namesWhatItMeasures('yield response', 'medium plant density plots had 1535.5 ± 86.9 kg/ha'))
      .toBe(false)
    expect(namesWhatItMeasures('yield response', 'CPY by 61.5% (832.8 vs. 320.5 kg/ha)')).toBe(false)
    // Residue left on the ground is the opposite of a yield.
    expect(namesWhatItMeasures(
      'yield response',
      'a minimum residue of 126 and 104 kg/ha, and maximum residue of 894 and 5,611, on winter wheat and corn, respectively.',
    )).toBe(false)
    expect(namesWhatItMeasures(
      'yield response',
      'the ammonium availability was higher in Humalite-treated plants (10, 42 and 155 % higher 400, 800 and 1600 kg/ha of Humalite, respectively)',
    )).toBe(false)
  })

  it('keeps the ones that say what the number is a yield of', () => {
    expect(namesWhatItMeasures(
      'yield response',
      'indicate 88 lb / acre of applied nitrogen raised yield s from 49 bu / acre to 77 bu/acre',
    )).toBe(true)
    expect(namesWhatItMeasures(
      'yield response',
      'On healthy range sites, forage production is about 1,680 kg/ha (1,500 lb/ac.) of grasses,',
    )).toBe(true)
    expect(namesWhatItMeasures(
      'yield response',
      'The corn silage operation has been projected to produce 10,000 pounds of silage per acre on a dry matter basis.',
    )).toBe(true)
    // A yield loss is a yield response.
    expect(namesWhatItMeasures(
      'yield response',
      'Individual field losses associated with the pathogen can be up to 60% based on disease severity',
    )).toBe(true)
  })

  it('leaves the measures nothing has gone wrong with alone', () => {
    expect(namesWhatItMeasures('fertilizer rate', 'Apply 30 lb of P2O5 per acre at seeding.')).toBe(true)
    expect(namesWhatItMeasures('economic threshold', 'Spray at 2 to 3 lygus per sweep.')).toBe(true)
  })

  it('says so when a figure is checked', () => {
    const text = 'medium plant density plots had 1535.5 ± 86.9 kg/ha'
    const out = checkFigure(
      figure({
        measure: 'yield response', subject: 'plant density',
        low: 1535.5, high: 1535.5, unit: 'kg/ha', passage: text,
      }),
      chunk, crops, actives, flatten(text), 'test-model',
    )
    expect(out.bad).toBe('the quote does not mention a yield response')
  })
})

describe('numberInPassage', () => {
  it('finds the number where it is written', () => {
    expect(numberInPassage(15, 'less than 15 kg/ha of available NO3-N')).toBe(true)
    expect(numberInPassage(10.5, 'a protein content of 10.5 per cent or lower')).toBe(true)
    expect(numberInPassage(1000, 'about 1,000 plants per acre')).toBe(true)
    expect(numberInPassage(20, 'losses are usually great (20-50%)')).toBe(true)
  })

  it('allows a small number to be spelled out, because papers do', () => {
    expect(numberInPassage(1, 'within one inch of the soil surface')).toBe(true)
    expect(numberInPassage(12, 'for every 12 inches of irrigation water')).toBe(true)
  })

  it('will not take a number out of a bigger number', () => {
    expect(numberInPassage(1, 'responded to 15 kg N/ha')).toBe(false)
    expect(numberInPassage(5, 'applied 50 lb/ac')).toBe(false)
  })

  it('refuses the two inferences the second pass actually made', () => {
    // A seeding depth of 0.25 inch out of "seeded shallow, within one inch".
    expect(numberInPassage(0.25, 'the growers seeded shallow, within one inch of the soil surface'))
      .toBe(false)
    // A threshold of 20 lb/acre out of a sentence with no number in it.
    expect(numberInPassage(20, 'The rate is decreased as nitrogen soil test results increase.'))
      .toBe(false)
    // 105, inferred from a text layer that read it as "1OS". It may well be
    // right; nobody can confirm it from the sentence, which is the point.
    expect(numberInPassage(105, 'only 1OS lb/acre of nitrogen will be removed')).toBe(false)
  })

  it('stops a figure whose number is not in its quote', () => {
    const list = 'A majority of the growers seeded shallow, within one inch of the soil surface.'
    const out = checkFigure(
      figure({
        measure: 'seeding depth',
        subject: 'canola',
        low: 0.25,
        high: 1,
        unit: 'inch',
        passage: 'A majority of the growers seeded shallow, within one inch of the soil surface.',
      }),
      chunk, crops, actives, flatten(list), 'test-model',
    )
    expect(out.bad).toBe('the number is not in the quote')
  })
})

describe('cropsNamedIn', () => {
  // The real crop list, abbreviated to the awkward parts of it.
  const ours = [
    'Wheat', 'Durum Wheat', 'Barley', 'Oats', 'Peas', 'Canola', 'Seed Canola',
    'Alfalfa', 'Alfalfa Seed', 'Grass', 'Spinach Seed', 'Green Feed',
    'Grain Corn', 'Silage Corn', 'Dry Beans', 'Beans-Pinto', 'Triticale',
    'Potato', 'Potato (kind not chosen)', 'Custom Crop bu/ac', 'Summer Fallow',
    'Not farmed by us',
  ]

  it('finds the crop a passage names, and both of ours that go by that word', () => {
    // Our crop list splits wheat into Wheat and Durum Wheat, so a passage
    // about "spring wheat" is offered both and the model picks from the
    // sentence. Narrowing it here would guess on the model's behalf.
    expect(cropsNamedIn('Spring wheat on stubble yielded 49 bu/acre.', ours))
      .toEqual(['Wheat', 'Durum Wheat'])
  })

  it('offers only durum where the paper says durum', () => {
    expect(cropsNamedIn('Durum needs 8 to 9 inches of irrigation.', ours)).toEqual(['Durum Wheat'])
  })

  it('does not take buckwheat for wheat', () => {
    // The reason the match is on whole words. Buckwheat has its own folder in
    // this library, so this is not hypothetical.
    expect(cropsNamedIn('Buckwheat is seeded shallow.', ours)).toEqual([])
  })

  it('finds peas where the paper writes "field pea"', () => {
    // The 1985 pea nitrogen sheet is filed under fertility, whose folder names
    // no crops at all, so this is the only way that figure gets a crop.
    expect(cropsNamedIn('Field pea contributes 1.0 lb of N per bushel.', ours)).toEqual(['Peas'])
  })

  it('does not offer Spinach Seed to every paper that says seed', () => {
    const out = cropsNamedIn('Place the seed in a firm, moist seedbed.', ours)
    expect(out).not.toContain('Spinach Seed')
    expect(out).not.toContain('Green Feed')
    expect(out).toEqual([])
  })

  it('offers both corn crops when a paper says corn, and lets the model choose', () => {
    expect(cropsNamedIn('Silage corn at 34,000 plants/acre.', ours))
      .toEqual(['Grain Corn', 'Silage Corn'])
  })

  it('matches a bean by its own word', () => {
    expect(cropsNamedIn('Pinto bean rows were 22 inches apart.', ours))
      .toEqual(['Dry Beans', 'Beans-Pinto'])
  })

  it('leaves the bookkeeping entries out', () => {
    expect(cropNeedles('Potato (kind not chosen)')).toEqual([])
    expect(cropNeedles('Custom Crop bu/ac')).toEqual([])
    expect(cropNeedles('Summer Fallow')).toEqual([])
    expect(cropNeedles('Not farmed by us')).toEqual([])
    expect(cropsNamedIn('Summer fallow is not farmed by us.', ours)).toEqual([])
  })

  it('does not chop the s off a word that ends in one', () => {
    expect(cropNeedles('Grass')).toEqual(['grass'])
    expect(cropNeedles('Peas')).toEqual(['peas', 'pea'])
  })
})

describe('the candidate test', () => {
  // Spot-check the pattern as a JS regex. It runs in Postgres, so this only
  // guards the shape — that it still catches a farm unit and still ignores the
  // lab prose that filled the first sample of "threshold" matches.
  const re = new RegExp(UNITS_SQL.replace(/\\\\/g, '\\'), 'i')

  it('catches the units a farm acts on', () => {
    expect(re.test('applied at 110 kg/ha')).toBe(true)
    expect(re.test('500 g ai/ha')).toBe(true)
    expect(re.test('two larvae/plant')).toBe(false) // a number is required
    expect(re.test('3 larvae/plant')).toBe(true)
    expect(re.test('the economic threshold was reached')).toBe(true)
    expect(re.test('yielded 11.2 t/ha')).toBe(true)
  })

  it('catches a figure written out the way an extension sheet writes it', () => {
    expect(re.test('30 lb of P2O5 per acre is the optimum application')).toBe(true)
    expect(re.test('apply 10 gallons of water per acre')).toBe(true)
    expect(re.test('durum needs 8 to 9 inches of water for the year')).toBe(true)
    expect(re.test('100 kg of nitrogen per hectare')).toBe(true)
  })

  it('still ignores a sentence with no number near the unit', () => {
    expect(re.test('yields are reported per acre throughout')).toBe(false)
    expect(re.test('the water table rose over the inches of rainfall recorded')).toBe(false)
  })

  it('ignores the laboratory prose this library is full of', () => {
    expect(re.test('capillary temperature (320 C), capillary voltage (35 V)')).toBe(false)
    expect(re.test('increasing to 95% solvent B over 4 min')).toBe(false)
    expect(re.test('a m/z tolerance of 5.0 ppm')).toBe(false)
  })
})

describe('sayFigure', () => {
  it('reads a single figure', () => {
    expect(sayFigure({ value_low: 25, value_high: 25, unit: '%' })).toBe('25 %')
  })

  it('reads a range as a range', () => {
    expect(sayFigure({ value_low: 15, value_high: 20, unit: 'kg/ha' })).toBe('15–20 kg/ha')
  })

  it('copes with no unit and with no number', () => {
    expect(sayFigure({ value_low: 4, value_high: 4, unit: null })).toBe('4')
    expect(sayFigure({ value_low: null, value_high: null, unit: 'two-leaf stage' })).toBe('two-leaf stage')
    expect(sayFigure({ value_low: null, value_high: null, unit: null })).toBe('—')
  })
})

describe('MEASURES', () => {
  it('has no duplicates, since the table keys off these strings', () => {
    expect(new Set(MEASURES).size).toBe(MEASURES.length)
  })
})
