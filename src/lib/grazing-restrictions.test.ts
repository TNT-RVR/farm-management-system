import { describe, expect, it } from 'vitest'
import {
  activeRestrictions,
  addDays,
  clashes,
  cropGrazingSummary,
  grazingKeys,
  grazingPicture,
  restrictionsFor,
  type GrazingData,
  type GrazingRule,
  type Spray,
} from './grazing-restrictions'
import { productResolver, sprayedProducts } from './spray-products'
import { cleanRules, grazingKeysIn, grazingPassages, needsGrazingRead } from '../../netlify/shared/grazing-rules-core'
import { planGrazingNotices } from '../../netlify/shared/grazing-watch'

const rule = (p: Partial<GrazingRule> & Pick<GrazingRule, 'kind'>): GrazingRule => ({
  registration_number: '1',
  crop: null,
  crop_key: null,
  days: null,
  never: false,
  condition: null,
  quote: null,
  ...p,
})
const spray = (p: Partial<Spray> = {}): Spray => ({
  sourceId: 'op1',
  product: 'Product',
  registration: '1',
  appliedOn: '2026-06-10',
  cropName: 'Silage Corn',
  cropKeys: ['corn'],
  ...p,
})
const by = (rules: GrazingRule[]) => {
  const m = new Map<string, GrazingRule[]>()
  for (const r of rules) m.set(r.registration_number, [...(m.get(r.registration_number) ?? []), r])
  return m
}

describe('grazingKeys', () => {
  it('maps our crops and Deere treated crops to label keys', () => {
    expect(grazingKeys('Silage Corn')).toEqual(['corn'])
    expect(grazingKeys('CORN_WET')).toEqual(['corn'])
    expect(grazingKeys('EDIBLE_BEANS')).toEqual(['dry_bean'])
    expect(grazingKeys('Green Feed')).toEqual(['barley', 'oats', 'triticale'])
    expect(grazingKeys('Durum Wheat')).toEqual(['durum', 'wheat'])
    expect(grazingKeys('GRASS_SEEDS')).toEqual(['grass'])
    expect(grazingKeys('Alfalfa forage')).toEqual(['alfalfa'])
    expect(grazingKeys(null)).toEqual([])
  })
})

describe('restrictionsFor', () => {
  it('turns days into a date the animals may go back on', () => {
    const rs = restrictionsFor([spray()], by([rule({ kind: 'graze', days: 60 }), rule({ kind: 'feed', days: 60 })]))
    expect(rs.map((r) => [r.kind, r.until])).toEqual([
      ['graze', '2026-08-09'],
      ['feed', '2026-08-09'],
    ])
  })

  it('a crop-specific line beats the general one (Lontrel: 40 days for corn, nothing for the rest)', () => {
    const rules = by([rule({ kind: 'graze', days: 0 }), rule({ kind: 'graze', crop: 'field corn', crop_key: 'corn', days: 40 })])
    expect(restrictionsFor([spray()], rules)[0].until).toBe('2026-07-20')
    expect(restrictionsFor([spray({ cropName: 'Canola', cropKeys: ['canola'] })], rules)).toEqual([])
  })

  it('"Except for alfalfa, do not graze" keeps alfalfa open and everything else shut', () => {
    const rules = by([rule({ kind: 'graze', never: true }), rule({ kind: 'graze', crop: 'alfalfa', crop_key: 'alfalfa', days: 0 })])
    expect(restrictionsFor([spray({ cropName: 'Alfalfa', cropKeys: ['alfalfa'] })], rules)).toEqual([])
    const beans = restrictionsFor([spray({ cropName: 'Beans', cropKeys: ['dry_bean'] })], rules)
    expect(beans[0].never).toBe(true)
    // Not at all = the treated crop, to the spring after.
    expect(beans[0].until).toBe('2027-05-01')
  })

  it('a label naming only other crops uses its strictest line, marked assumed', () => {
    const rules = by([
      rule({ kind: 'graze', crop: 'barley', crop_key: 'barley', days: 30 }),
      rule({ kind: 'graze', crop: 'peas', crop_key: 'pea', days: 70 }),
    ])
    const [r] = restrictionsFor([spray({ cropKeys: ['canola'] })], rules)
    expect(r.days).toBe(70)
    expect(r.assumed).toMatch(/does not name this crop/)
  })

  it("uses the crop's feeding line for grazing before the strictest line for another crop", () => {
    const rules = by([
      rule({ kind: 'feed', crop: 'dry bean', crop_key: 'dry_bean', days: 7 }),
      rule({ kind: 'graze', crop: 'winter wheat', crop_key: 'wheat', never: true }),
    ])
    const graze = restrictionsFor([spray({ cropKeys: ['dry_bean'] })], rules).find((r) => r.kind === 'graze')!
    expect(graze.days).toBe(7)
    expect(graze.assumed).toMatch(/about feeding/)
  })

  it('takes the strictest of several lines for the same crop', () => {
    const rules = by([
      rule({ kind: 'graze', crop: 'winter wheat (1 application)', crop_key: 'wheat', days: 30 }),
      rule({ kind: 'graze', crop: 'winter wheat (2 applications)', crop_key: 'wheat', never: true }),
    ])
    expect(restrictionsFor([spray({ cropKeys: ['wheat'] })], rules)[0].never).toBe(true)
  })

  it('slaughter has no date on the field; unread products give nothing', () => {
    const rs = restrictionsFor([spray(), spray({ registration: '2' })], by([rule({ kind: 'slaughter', days: 3 })]))
    expect(rs).toHaveLength(1)
    expect(rs[0].until).toBeNull()
  })
})

describe('activeRestrictions and clashes', () => {
  const rs = restrictionsFor([spray()], by([rule({ kind: 'graze', days: 30 }), rule({ kind: 'slaughter', days: 3 })]))
  it('drops what has run out; shows a slaughter note for a month', () => {
    expect(activeRestrictions(rs, '2026-06-20').map((r) => r.kind)).toEqual(['graze', 'slaughter'])
    expect(activeRestrictions(rs, '2026-07-10')).toEqual([])
  })
  it('a grazing stretch inside the window clashes; one ending on the spray day does not', () => {
    expect(clashes(rs, { start: '2026-07-01', end: null })).toHaveLength(1)
    expect(clashes(rs, { start: '2026-07-10', end: null })).toHaveLength(0)
    expect(clashes(rs, { start: '2026-06-01', end: '2026-06-10' })).toHaveLength(0)
    // Cattle already in when it was sprayed.
    expect(clashes(rs, { start: '2026-06-01', end: '2026-06-15' })).toHaveLength(1)
  })
})

describe('sprayedProducts', () => {
  it('reads tank-mix components through the price book and its aliases', () => {
    const resolve = productResolver(
      [{ id: 'p1', name: 'Delaro Complete', pmra_registration: '34095' }],
      [
        { deere_name: 'Delaro® Complete', product_id: 'p1', ignored: false },
        { deere_name: 'Water', product_id: 'p1', ignored: true },
      ],
    )
    const got = sprayedProducts(
      [{ name: 'Bean Fungicide mix', components: [{ name: 'Delaro® Complete', productType: 'CHEMICAL' }, { name: 'Water' }, { name: 'Mystery', productType: 'CHEMICAL' }] }],
      resolve,
    )
    expect(got.map((g) => [g.product, g.registration, g.matched])).toEqual([
      ['Delaro Complete', '34095', true],
      ['Water', null, false],
      ['Mystery', null, false],
    ])
  })
})

const base = (): GrazingData => ({
  ops: [{ id: 'op1', field_id: 'f1', started_at: '2026-06-10T18:00:00Z', ended_at: null, products: [{ name: 'Centurion' }], treated_crop: null }],
  products: [{ id: 'p1', name: 'Centurion', pmra_registration: '27598' }],
  aliases: [],
  rules: [rule({ registration_number: '27598', kind: 'graze', days: 60, quote: 'Do not cut treated crops for feed or graze until 60 days' }), rule({ registration_number: '27598', kind: 'feed', days: 60 })],
  labelStatus: { '27598': 'read' },
  crops: [
    { id: 'c1', name: 'Silage Corn', feed_dm_pct: 35 },
    { id: 'c2', name: 'Canola', feed_dm_pct: null },
  ],
  fieldCrops: [{ field_id: 'f1', crop_year: 2026, crop_id: 'c1' }],
  fields: [
    { id: 'f1', name: 'Field 1' },
    { id: 'f2', name: 'Field 2' },
  ],
  pastures: [{ id: 'pa1', name: 'Pasture B' }],
  pastureSprays: [],
  overlaps: [],
  stubble: [],
  events: [],
})

describe('grazingPicture and the alerts', () => {
  it('a spray on a feed crop tells the managers once', () => {
    const pic = grazingPicture(base(), '2026-06-12')
    const f1 = pic.places.find((p) => p.id === 'f1')!
    expect(f1.restrictions.map((r) => r.until)).toEqual(['2026-08-09', '2026-08-09'])
    expect(f1.restrictions[0].eatenBecause).toEqual(['Silage Corn is a feed crop'])
    const first = planGrazingNotices(pic, new Set(), '2026-06-12')
    expect(first.notices).toHaveLength(1)
    // Days left up front; the label's count said as days after spraying.
    expect(first.notices[0].title).toBe("Don't graze or feed Field 1 for 58 more days (until 9 Aug 2026) — Centurion")
    expect(first.notices[0].body).toMatch(/for \d+ days after spraying — Centurion, sprayed \d+ \w+ 2026, so not until 9 Aug 2026 \(58 days from now\)/)
    expect(first.notices[0].link).toBe('/fields/f1')
    const again = planGrazingNotices(pic, new Set(first.remember.map((r) => r.alert_key)), '2026-06-12')
    expect(again.notices).toHaveLength(0)
  })

  it('a spray on a crop nobody feeds says nothing until stubble grazing is planned on it', () => {
    const d = base()
    d.fieldCrops = [{ field_id: 'f1', crop_year: 2026, crop_id: 'c2' }]
    expect(planGrazingNotices(grazingPicture(d, '2026-06-12'), new Set(), '2026-06-12').notices).toHaveLength(0)
    d.stubble = [{ id: 's1', field_id: 'f1', name: 'Field 1 stubble', start_date: '2026-07-15' }]
    const out = planGrazingNotices(grazingPicture(d, '2026-06-12'), new Set(), '2026-06-12')
    expect(out.notices.map((n) => n.kind)).toEqual(['grazing_restriction', 'grazing_conflict'])
    expect(out.notices[1].title).toMatch(/Stubble grazing on Field 1 starts 15 Jul 2026/)
  })

  it('cattle in a pasture whose fence takes in a sprayed field clash; a sprayed pasture too', () => {
    const d = base()
    d.fields = d.fields.map((f) => (f.id === 'f1' ? { ...f, open_to_pasture: true } : f))
    d.overlaps = [{ field_id: 'f1', pasture_id: 'pa1', overlap_acres: 130, field_acres: 133 }]
    d.events = [{ id: 'e1', pasture_id: 'pa1', turned_in_on: '2026-06-20', moved_out_on: null, head_count: 290 }]
    d.pastureSprays = [{ id: 'ps1', pasture_id: 'pa1', applied_on: '2026-06-15', product: 'Centurion', registration_number: '27598' }]
    const pic = grazingPicture(d, '2026-06-25')
    expect(pic.clashes.map((c) => [c.place.name, c.via?.name ?? null])).toEqual([
      ['Pasture B', null],
      ['Field 1', 'Pasture B'],
    ])
    const out = planGrazingNotices(pic, new Set(), '2026-06-25')
    expect(out.notices.filter((n) => n.kind === 'grazing_conflict')).toHaveLength(2)
  })

  it('a field fenced off from the pasture around it does not clash with cattle in that pasture', () => {
    const d = base()
    d.overlaps = [{ field_id: 'f1', pasture_id: 'pa1', overlap_acres: 130, field_acres: 133 }]
    d.events = [{ id: 'e1', pasture_id: 'pa1', turned_in_on: '2026-06-20', moved_out_on: null, head_count: 290 }]
    const pic = grazingPicture(d, '2026-06-25')
    expect(pic.clashes.map((c) => c.place.name)).not.toContain('Field 1')
  })

  it('a field cattle graze after harvest makes any restricting spray on it worth telling', () => {
    const d = base()
    d.fields = d.fields.map((f) => (f.id === 'f2' ? { ...f, grazed_after_harvest: true } : f))
    d.ops.push({ id: 'op9', field_id: 'f2', started_at: '2026-06-11T18:00:00Z', ended_at: null, products: [{ name: 'Centurion', productType: 'CHEMICAL' }], treated_crop: 'CANOLA' })
    const f2 = grazingPicture(d, '2026-06-12').places.find((p) => p.id === 'f2')!
    expect(f2.sprays.some((s) => (s.eatenBecause ?? []).includes('cattle graze it after harvest'))).toBe(true)
  })

  it('a field mostly outside the pasture is not inside its fence', () => {
    const d = base()
    d.overlaps = [{ field_id: 'f1', pasture_id: 'pa1', overlap_acres: 10, field_acres: 133 }]
    expect(grazingPicture(d, '2026-06-25').places.find((p) => p.id === 'f1')!.inPastures).toEqual([])
  })

  it('lists sprayed products whose label has not been read, and names Deere sent that match nothing', () => {
    const d = base()
    d.labelStatus = {}
    d.ops.push({ id: 'op2', field_id: 'f2', started_at: '2026-06-11T18:00:00Z', ended_at: null, products: [{ name: 'Roundup', productType: 'CHEMICAL' }, { name: '28-0-0-UAN', productType: 'FERTILIZER' }], treated_crop: 'CANOLA' })
    const pic = grazingPicture(d, '2026-06-12')
    expect(pic.unread.map((u) => u.registration)).toEqual(['27598'])
    expect(pic.unmatched.map((u) => u.name)).toEqual(['Roundup'])
  })
})

describe('grazing rules extraction', () => {
  it('never reads a named crop as every crop, and splits a line naming several', () => {
    const got = cleanRules([
      { crop: 'peanuts', crop_key: null, kind: 'feed', days: 7, never: false, condition: null, quote: null },
      { crop: 'wheat, triticale and barley', crop_key: 'wheat', kind: 'graze', days: 25, never: false, condition: null, quote: null },
      { crop: 'All crops on this label', crop_key: null, kind: 'graze', days: 7, never: false, condition: null, quote: null },
      { crop: null, crop_key: null, kind: 'graze', days: null, never: false, condition: null, quote: 'says nothing usable' },
    ])
    expect(got.map((r) => [r.crop_key, r.kind, r.days])).toEqual([
      ['other', 'feed', 7],
      ['wheat', 'graze', 25],
      ['triticale', 'graze', 25],
      ['barley', 'graze', 25],
      [null, 'graze', 7],
    ])
    expect(grazingKeysIn('Spring Barley and Spring Wheat')).toEqual(['barley', 'wheat'])
  })

  it('sends only the passages about grazing and feed', () => {
    const text = `${'x'.repeat(5000)} Do not graze the treated crop. ${'y'.repeat(5000)}`
    const p = grazingPassages(text)
    expect(p).toContain('Do not graze')
    expect(p.length).toBeLessThan(2000)
    expect(grazingPassages('nothing about animals')).toBe('')
  })

  it('re-reads a label read again since, or corrected by hand since', () => {
    const l = { registration_number: '1', label_text: 't', grazing_restriction: null, extracted_at: '2026-01-01', updated_at: '2026-01-01', manual_fields: [], grazing_rules_extracted_at: '2026-02-01' }
    expect(needsGrazingRead(l)).toBe(false)
    expect(needsGrazingRead({ ...l, grazing_rules_extracted_at: null })).toBe(true)
    expect(needsGrazingRead({ ...l, extracted_at: '2026-03-01' })).toBe(true)
    expect(needsGrazingRead({ ...l, updated_at: '2026-03-01' })).toBe(false)
    expect(needsGrazingRead({ ...l, updated_at: '2026-03-01', manual_fields: ['grazing_restriction'] })).toBe(true)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('cropGrazingSummary', () => {
  const rule = (p: Partial<GrazingRule>): GrazingRule => ({ registration_number: '1', crop: null, crop_key: null, kind: 'graze', days: null, never: false, condition: null, quote: null, ...p })
  it('puts a crop own line first and shortens it', () => {
    const rules = [
      rule({ kind: 'graze', days: 60, quote: 'Do not graze within 60 days.' }),
      rule({ kind: 'feed', days: 60 }),
      rule({ kind: 'graze', crop: 'barley', crop_key: 'barley', days: 25 }),
      rule({ kind: 'slaughter', days: 3 }),
    ]
    expect(cropGrazingSummary(rules, '1', 'Canola')?.text).toBe('No grazing or feeding: 60 d · off 3 d before slaughter')
    expect(cropGrazingSummary(rules, '1', 'Barley')?.text).toMatch(/^No grazing: 25 d/)
  })
  it('says nothing when the label sets nothing', () => {
    expect(cropGrazingSummary([], '1', 'Canola')).toBeNull()
  })
})
