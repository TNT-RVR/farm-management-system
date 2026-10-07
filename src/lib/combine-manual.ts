import { CROP_BASELINES, SETTINGS, type CombineCropKey, type SettingKey } from './combine'

/**
 * What the New Holland CR operator's manual says, section 6 "Working
 * operations": the settings table for every crop it lists, the sieve
 * packages, the corn conversion list, where losses come from, and how the
 * manual reads the machine. Typed in from the printed pages in September
 * 2026; where a figure looks wrong, the book is the authority, not this file.
 *
 * Our two CR9090s run 22 in rotors, so that column is the one that applies.
 */
export const ROTOR_IN = 22

export type ManualRow = {
  /** The crop as the manual names it. */
  name: string
  /** The app crop it stands in for, if any. */
  app?: CombineCropKey
  /** Straw elevator front drum position. */
  feederDrum: number
  /** Dynamic stone protection speed, rpm, if equipped. */
  dspRpm: number
  rotor17: number
  rotor22: number
  configuration: string
  concaveMm: number
  concaveType: string
  /** Remove the intermediate wires from the concave — only half are needed. */
  halfWires?: boolean
  /** Concave extension position. */
  extension: 'In' | 'Out' | '—'
  fanRpm: number
  returnsCover: 'spike' | 'smooth'
  vanesFront?: string
  vanesRear?: string
  presieveMm: number
  /** Upper sieve extension, mm; null means the Graepel extension instead. */
  upperExtMm: number | null
  upperMm: number
  lowerMm: number
}

export const NH_MANUAL: ManualRow[] = [
  { name: 'Barley', app: 'barley', feederDrum: 2, dspRpm: 1100, rotor17: 1200, rotor22: 1100, configuration: 'Standard', concaveMm: 14, concaveType: 'Small grain', extension: 'Out', fanRpm: 800, returnsCover: 'spike', presieveMm: 11, upperExtMm: 15, upperMm: 13, lowerMm: 5 },
  { name: 'Canola', app: 'canola', feederDrum: 3, dspRpm: 1100, rotor17: 880, rotor22: 630, configuration: 'Standard', concaveMm: 23, concaveType: 'Small grain', extension: 'Out', fanRpm: 500, returnsCover: 'smooth', presieveMm: 7, upperExtMm: null, upperMm: 9, lowerMm: 4 },
  { name: 'Corn', app: 'corn', feederDrum: 5, dspRpm: 640, rotor17: 800, rotor22: 500, configuration: 'Standard', concaveMm: 23, concaveType: 'Universal or round bar', halfWires: true, extension: '—', fanRpm: 1000, returnsCover: 'smooth', vanesFront: 'Slow', vanesRear: 'Mid', presieveMm: 11, upperExtMm: null, upperMm: 13, lowerMm: 12 },
  { name: 'Flax', feederDrum: 2, dspRpm: 1100, rotor17: 1350, rotor22: 980, configuration: 'Standard', concaveMm: 8, concaveType: 'Small grain', extension: 'In', fanRpm: 525, returnsCover: 'spike', presieveMm: 4, upperExtMm: null, upperMm: 6, lowerMm: 3 },
  { name: 'Bermuda grass', feederDrum: 2, dspRpm: 1100, rotor17: 1730, rotor22: 1350, configuration: 'Standard', concaveMm: 5, concaveType: 'Small grain', extension: 'In', fanRpm: 300, returnsCover: 'spike', presieveMm: 4, upperExtMm: 5, upperMm: 5, lowerMm: 1.5 },
  { name: 'Blue grass', feederDrum: 1, dspRpm: 1100, rotor17: 1330, rotor22: 1030, configuration: 'Standard', concaveMm: 13, concaveType: 'Small grain', extension: 'Out', fanRpm: 375, returnsCover: 'spike', presieveMm: 3, upperExtMm: 10, upperMm: 6, lowerMm: 3 },
  { name: 'Milo / Sorghum', feederDrum: 1, dspRpm: 640, rotor17: 1000, rotor22: 750, configuration: 'Agitator pins', concaveMm: 21, concaveType: 'Small grain or universal', extension: 'Out', fanRpm: 775, returnsCover: 'smooth', presieveMm: 8, upperExtMm: 13, upperMm: 11, lowerMm: 5 },
  { name: 'Mustard', feederDrum: 3, dspRpm: 1100, rotor17: 880, rotor22: 680, configuration: 'Standard', concaveMm: 17, concaveType: 'Small grain', extension: 'Out', fanRpm: 475, returnsCover: 'smooth', presieveMm: 7, upperExtMm: null, upperMm: 9, lowerMm: 3 },
  { name: 'Oats', app: 'oats', feederDrum: 2, dspRpm: 1100, rotor17: 1200, rotor22: 930, configuration: 'Standard', concaveMm: 14, concaveType: 'Small grain', extension: 'Out', fanRpm: 600, returnsCover: 'spike', presieveMm: 9, upperExtMm: 13, upperMm: 11, lowerMm: 6 },
  { name: 'Peas / Edible beans', app: 'beans', feederDrum: 3, dspRpm: 640, rotor17: 800, rotor22: 700, configuration: 'Standard', concaveMm: 21, concaveType: 'Universal or round bar', halfWires: true, extension: '—', fanRpm: 900, returnsCover: 'smooth', presieveMm: 9, upperExtMm: 13, upperMm: 11, lowerMm: 9 },
  { name: 'Rice', feederDrum: 2, dspRpm: 1100, rotor17: 1300, rotor22: 1000, configuration: 'Rice', concaveMm: 21, concaveType: 'Universal', extension: 'Out', fanRpm: 700, returnsCover: 'spike', vanesFront: 'Mid', vanesRear: 'Fast', presieveMm: 9, upperExtMm: 13, upperMm: 11, lowerMm: 6 },
  { name: 'Rye', feederDrum: 2, dspRpm: 1100, rotor17: 1500, rotor22: 1180, configuration: 'Standard', concaveMm: 14, concaveType: 'Small grain', extension: 'Out', fanRpm: 750, returnsCover: 'spike', presieveMm: 9, upperExtMm: 13, upperMm: 11, lowerMm: 6 },
  { name: 'Soybeans', feederDrum: 2, dspRpm: 640, rotor17: 750, rotor22: 600, configuration: 'Standard', concaveMm: 23, concaveType: 'Universal or round bar', halfWires: true, extension: '—', fanRpm: 700, returnsCover: 'smooth', presieveMm: 9, upperExtMm: 13, upperMm: 11, lowerMm: 8 },
  { name: 'Sunflower', feederDrum: 3, dspRpm: 640, rotor17: 750, rotor22: 600, configuration: 'Standard', concaveMm: 23, concaveType: 'Universal or round bar', halfWires: true, extension: '—', fanRpm: 700, returnsCover: 'smooth', presieveMm: 9, upperExtMm: 13, upperMm: 11, lowerMm: 8 },
  { name: 'Triticale', feederDrum: 2, dspRpm: 1100, rotor17: 1450, rotor22: 1100, configuration: 'Standard', concaveMm: 14, concaveType: 'Small grain', extension: 'Out', fanRpm: 800, returnsCover: 'spike', presieveMm: 9, upperExtMm: 13, upperMm: 12, lowerMm: 6 },
  { name: 'Wheat normal', app: 'wheat', feederDrum: 2, dspRpm: 1100, rotor17: 1500, rotor22: 1150, configuration: 'Standard', concaveMm: 13, concaveType: 'Small grain', extension: 'Out', fanRpm: 850, returnsCover: 'spike', vanesFront: 'Mid', vanesRear: 'Fast', presieveMm: 10, upperExtMm: 14, upperMm: 10, lowerMm: 4 },
  { name: 'Wheat hard red', app: 'durum', feederDrum: 2, dspRpm: 1100, rotor17: 1700, rotor22: 1350, configuration: 'Standard', concaveMm: 8, concaveType: 'Small grain', extension: 'In', fanRpm: 850, returnsCover: 'spike', vanesFront: 'Mid', vanesRear: 'Fast', presieveMm: 8, upperExtMm: 12, upperMm: 13, lowerMm: 8 },
  { name: 'Wheat soft', feederDrum: 2, dspRpm: 1100, rotor17: 1250, rotor22: 980, configuration: 'Standard', concaveMm: 13, concaveType: 'Small grain', extension: 'Out', fanRpm: 850, returnsCover: 'spike', vanesFront: 'Fast', vanesRear: 'Fast', presieveMm: 10, upperExtMm: 15, upperMm: 13, lowerMm: 8 },
]

/** The manual row an app crop starts from, if the book has one. */
export function manualFor(crop: CombineCropKey): ManualRow | null {
  return NH_MANUAL.find((r) => r.app === crop) ?? null
}

/** Why a crop is on a row that is not its own name. */
export function manualCaveat(crop: CombineCropKey): string | null {
  if (crop === 'durum') return 'The book has no durum row; hard red wheat is the nearest.'
  if (crop === 'beans') return 'The book puts peas and edible beans on one row.'
  if (crop === 'wheat') return 'The book’s "Wheat normal" row. Hard red is 200 rpm faster with the concave nearly closed.'
  if (crop === 'sainfoin') return 'Sainfoin is not in the book; the starting points are ours.'
  return null
}

/** Which settings the manual table fills in, and from which of its columns. */
const MANUAL_SETTING: Partial<Record<SettingKey, (r: ManualRow) => number>> = {
  rotor_rpm: (r) => (ROTOR_IN === 22 ? r.rotor22 : r.rotor17),
  concave_mm: (r) => r.concaveMm,
  fan_rpm: (r) => r.fanRpm,
  presieve_mm: (r) => r.presieveMm,
  chaffer_mm: (r) => r.upperMm,
  sieve_mm: (r) => r.lowerMm,
}

export type StartingPoint = { value: number; source: 'manual' | 'estimate' }

/**
 * Where each setting starts for a crop, and whether that is the book talking
 * or us. The baseline's own numbers are kept in step with the manual, so the
 * value is the same either way; the source is what the page shows.
 */
export function startingPoints(crop: CombineCropKey): Record<SettingKey, StartingPoint> {
  const base = CROP_BASELINES.find((c) => c.key === crop)!
  const row = manualFor(crop)
  const out = {} as Record<SettingKey, StartingPoint>
  for (const s of SETTINGS) {
    const pick = MANUAL_SETTING[s.key]
    out[s.key] =
      row && pick
        ? { value: pick(row), source: 'manual' }
        : { value: base.start[s.key], source: 'estimate' }
  }
  return out
}

/**
 * Millimetres as the monitor shows them: inches in sixteenths, "15/16 in".
 * The manual's 23 mm concave and the screen's 15/16 in are the same setting,
 * and nobody wants to do that sum in the cab.
 */
export function inchFraction(mm: number | null | undefined): string {
  if (mm == null || !Number.isFinite(mm)) return ''
  const sixteenths = Math.round((mm / 25.4) * 16)
  const whole = Math.floor(sixteenths / 16)
  let num = sixteenths % 16
  let den = 16
  while (num > 0 && num % 2 === 0) {
    num /= 2
    den /= 2
  }
  if (num === 0) return `${whole} in`
  return whole > 0 ? `${whole} ${num}/${den} in` : `${num}/${den} in`
}

/** The sieve packages and the other footnotes under the table. */
export const MANUAL_NOTES: { title: string; body: string }[] = [
  {
    title: 'Small-grain configuration',
    body: '1‑1/8 in New Holland pre-sieve, 1‑1/8 in HC upper sieve and 1‑1/8 in New Holland lower sieve. Wheat, barley, oats, canola and the grasses.',
  },
  {
    title: 'Corn, bean, pea and sunflower configuration',
    body: 'Closz pre-sieve, 1‑5/8 in HC corn upper sieve and 1‑5/8 in Closz lower sieve. Universal or round-bar concaves with only half the intermediate wires in.',
  },
  {
    title: 'Humped grain pan insert',
    body: 'Required on 22 in rotor combines — ours — in small grains, and must come OUT for corn and beans.',
  },
  {
    title: 'Graepel extension',
    body: 'Where the table says "Graepel ext" for the upper sieve extension (canola, corn, flax, mustard) the Graepel extension goes on in place of a louvred one.',
  },
]

/** The manual's list for going from grain to corn, with its chapter references. */
export const CORN_CONVERSION: { group: string; items: { action: string; ref: string }[] }[] = [
  {
    group: 'Header',
    items: [
      { action: 'Install corn header', ref: '6-24' },
      { action: 'Install counterweights as required', ref: 'Specifications 9-65' },
      { action: 'Install additional lighting kit (fold-up headers)', ref: 'Accessories 10-16' },
    ],
  },
  {
    group: 'Straw elevator',
    items: [
      { action: 'Adjust the straw elevator front drum (position 5)', ref: '6-33' },
      { action: 'Adjust DSP speed (640 rpm)', ref: '6-39' },
    ],
  },
  {
    group: 'Threshing',
    items: [
      { action: 'Install corn concaves (universal or round bar)', ref: '6-46' },
      { action: 'Spiked twin-pitch rotors: swap the spiked elements for non-spiked', ref: 'Accessories, component identification' },
    ],
  },
  {
    group: 'Separation',
    items: [
      { action: 'Adjust the discharge beater grate', ref: '6-59' },
      { action: 'Install the beater grate cover', ref: '6-59' },
    ],
  },
  {
    group: 'Cleaning',
    items: [
      { action: 'Install fan bottom shield', ref: 'Accessories 10-6' },
      { action: 'Install smooth roto-thresh covers', ref: '6-74 and 10-2' },
      { action: 'Check the cleaning shoe is running at high rpm', ref: '6-60' },
      { action: 'Install pre-sieve for corn', ref: '6-61' },
      { action: 'Install upper sieve for corn (in upper position)', ref: '6-61' },
      { action: 'Install aggressive throwing angle kit', ref: 'Accessories 10-6' },
      { action: 'Take the humped grain pan insert out', ref: 'table footnote' },
    ],
  },
  {
    group: 'Straw chopper',
    items: [
      { action: 'Remove the counter knives', ref: '6-91' },
      { action: 'Remove the shred bar', ref: '6-90' },
      { action: 'Reduce rotor knives by half', ref: '6-85' },
      { action: 'Low speed of the chopper rotor', ref: '6-93' },
      { action: 'Configure PSD doors (if equipped) to the corn position', ref: '6-93' },
    ],
  },
  {
    group: 'Engine',
    items: [{ action: 'Install rotary dust screen brush', ref: 'Accessories 10-13' }],
  },
]

/**
 * Where grain on the ground came from, by where it lies. Numbered as the
 * manual numbers them, because its formulas use the numbers.
 */
export const LOSS_SITES: { n: number; where: string; means: string }[] = [
  { n: 1, where: 'In front of the header, in standing crop', means: 'Pre-harvest loss: weather, crop condition, maturity. Count it before the combine goes in, and subtract it from everything behind.' },
  { n: 2, where: 'Behind the header, outside the drive tires', means: 'Header loss: header adjustment or ground speed. Nothing inside the machine can touch it.' },
  { n: 3, where: 'Directly under the combine', means: 'Leakage: holes in auger bottoms, damaged seals. Often mistaken for shoe or rotor loss, and large when it happens.' },
  { n: 4, where: 'Behind the machine, across the shoe width, riding the chaff', means: 'Shoe loss: upper sieve closed or opened too far, rear of the sieve too high, fan too slow, or a slope beyond the self-levelling. Build-up on the upper sieve lets grain ride out.' },
  { n: 5, where: 'Behind the machine, blown clear', means: 'Fan loss: cleaning fan too fast.' },
  { n: 6, where: 'Behind the machine, in the straw row', means: 'Rotor loss: unthreshed heads (under-threshing) or free grain, from rotor and concave adjustment or too much ground speed.' },
]

export const LOSS_FORMULAS = {
  total: 'Total machine loss = (2 + 3) + (4 + 5) + 6 − 1',
  functional: 'Functional loss (shoe, fan, rotor) = 4 + 5 + 6',
}

/**
 * The manual's worked example, kept because the app's loss check does the
 * same arithmetic: a 17 ft header in 5000 kg/ha wheat, straw laid in a 1 m
 * swath, 23 000 grains to the kilo. One per cent is 50 kg/ha, 5 g per square
 * metre of crop, so 25.5 g behind each metre of travel — 586 grains in the
 * square metre of swath, and 18 under a spread hand (0.03 m²).
 */
export const HAND_EXAMPLE = {
  headerFt: 16.73,
  swathFt: 3.28,
  yieldKgHa: 5000,
  grainsPerKg: 23000,
  grainsPerSqM: 586,
  handSqM: 0.03,
  handSqFt: 0.32,
  grainsUnderHand: 18,
}

/** How the manual reads the machine, condensed. */
export const INDICATORS: { title: string; points: string[] }[] = [
  {
    title: 'Grain tank sample',
    points: [
      'Lots of trash: over-threshing, or the fan too slow. Open the concave and/or slow the rotor first; then more fan if the trash is heavier than the grain, or close the upper sieve if the trash is bigger than the grain.',
      'Cracked or damaged grain: concave too close. Open it, then slow the rotor. Bunch feeding, a slack straw elevator chain, heavy returns and a plugged concave all crack grain too.',
      'Unthreshed material in the tank: under-threshing, or the lower sieve open too wide. Rotor up and/or concave in; close the lower sieve a little.',
    ],
  },
  {
    title: 'Grain pan and upper sieve',
    points: [
      'Material on the grain pan should be level to slightly higher under the rotors, tapering a little to both sides.',
      'Front third of the upper sieve clean. Middle third some grain, mostly residue. Rear third residue only.',
      'Grain on the rear third means heavy returns and grain about to go out the back: open the upper sieve so more drops to the lower sieve.',
      'Material broken into small pieces on the upper sieve is over-threshing: it plugs the sieve and causes loss. Open the concave and/or slow the rotor.',
      'Unthreshed heads on the sieve: rotor up and/or concave in — or worn rasp bars and concaves.',
    ],
  },
  {
    title: 'Returns',
    points: [
      'A few unthreshed heads in the returns is normal; that is what the returns are for.',
      'A lot of unthreshed heads: concave clearance too great.',
      'A lot of clean grain: fan too fast and/or the lower sieve needs opening.',
    ],
  },
  {
    title: 'The check, in the manual’s order',
    points: [
      'Header loss: count where only the header has travelled.',
      'Look at the grain pan distribution, then what is on the sieves, then the type and amount of returns.',
      'Total loss over a 60 cm (24 in) strip across the width of the shoe; subtract pre-harvest and header loss to get the machine loss. A drop screen reads the machine loss directly.',
      'Readjust with all of that in mind — one adjustment at a time, so any change can be pinned on it.',
      'Lower the concave fully before re-engaging the threshing.',
      'Chopper and spreader drives OFF before checking behind the machine.',
    ],
  },
]
