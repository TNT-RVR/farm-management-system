/**
 * Alberta's own fertilizer rate tables, transcribed from the factsheets.
 *
 * The lab writes a programme for each field and the app orders against it. This
 * file is the second opinion: what Alberta Agriculture's published rate table
 * says for the same crop at the same soil test level. Having the two side by
 * side is the point — a recommendation you can argue with beats one you can
 * only accept.
 *
 * Every table here was read out of the PDF the research library holds and
 * carries that paper's id, so a screen can link to the sheet it came from.
 * Nothing is interpolated and nothing is extended past where the sheet stops:
 * `bands` ends where the printed table ends, and a soil test past the end
 * returns no number rather than a guessed one.
 *
 * Two cautions that belong with the numbers rather than in a comment nobody
 * reads:
 *
 *  - The sheets' P tables are Kelowna or modified Kelowna; our lab reports
 *    sodium-bicarbonate P. Different extractants, so nutrient-guide.ts puts the
 *    soil test through `olsenToMkLbAc` in fert-savings/alberta.ts rather than
 *    comparing the two as though they were one measurement. `method` carries
 *    what each table assumed, and the screen shows it.
 *  - Soil test ppm converts to lb/ac at 2 lb per ppm per 6 inch layer, the
 *    convention these sheets were written against.
 *
 * HOW THIS RELATES TO fert-savings/alberta.ts, which also holds Alberta tables:
 * that module produces the rate the app itself applies, mostly off the newer
 * irrigation-wide sheet (Agdex 100/541-1), with its steps simplified for use —
 * its bean P table collapses the printed 35 and 25 steps, and its alfalfa K
 * table takes the midpoint of each printed range. This file is the printed
 * table instead: every band the sheet shows, both of its columns where it has
 * two, and the paper id to link to. The two are not interchangeable and should
 * not be made so silently; reconciling them properly is its own job, because
 * alberta.ts feeds the soil-test write-up and its tests pin those outputs.
 */

export type GuideBand = {
  /** Lower edge of the band, inclusive. */
  from: number
  /** Upper edge, exclusive; null for the sheet's open-ended top row. */
  to: number | null
  /** lb/ac of the nutrient, or null where the sheet left the cell unreadable. */
  rate: number | null
  /** Set where the sheet printed a range rather than a single rate. */
  rateTo?: number
}

/** What soil number a table is read against. */
export type GuideBasis =
  | 'n-lb-0-12'
  | 'n-lb-0-24'
  | 'p-lb-0-6'
  | 'k-lb-0-6'
  | 's-lb-0-12'
  | 'zn-ppm-0-6'

export type GuideCrop =
  | 'dry beans'
  | 'barley'
  | 'winter wheat'
  | 'soft white spring wheat'
  | 'alfalfa'

export type GuideTable = {
  crop: GuideCrop
  nutrient: 'N' | 'P2O5' | 'K2O' | 'S' | 'Zn'
  basis: GuideBasis
  /**
   * Which column of the sheet's table this is. Irrigated southern Alberta is
   * the farm, so where a sheet gives a soil-zone or moisture column for it,
   * that column is `main` and the dryland Brown column is kept beside it.
   */
  variant: string
  main?: boolean
  bands: GuideBand[]
  paperId: string
  paper: string
  agdex: string
  table: string
  method: string
  note?: string
}

/**
 * Which crop label gets which table.
 *
 * An explicit list, the way cropLabelMatch.ts is an explicit list: a wrong
 * match here puts one crop's rate table against another crop's soil test,
 * which reads as authority it has not got. Soft white spring wheat is its own
 * entry on purpose — its sheet is not a hard red spring wheat sheet, and
 * nothing matches a bare "wheat".
 */
export const GUIDE_CROP_LABELS: Record<string, GuideCrop> = {
  'dry beans': 'dry beans',
  'dry bean': 'dry beans',
  beans: 'dry beans',
  bean: 'dry beans',
  'beans pinto': 'dry beans',
  'beans yellow': 'dry beans',
  'beans black': 'dry beans',
  'beans great northern': 'dry beans',
  'pinto beans': 'dry beans',
  'yellow beans': 'dry beans',
  'black beans': 'dry beans',
  'great northern beans': 'dry beans',
  'edible beans': 'dry beans',
  barley: 'barley',
  'malt barley': 'barley',
  'malting barley': 'barley',
  'feed barley': 'barley',
  'barley silage': 'barley',
  'winter wheat': 'winter wheat',
  'soft white spring wheat': 'soft white spring wheat',
  'soft white wheat': 'soft white spring wheat',
  'soft wheat': 'soft white spring wheat',
  alfalfa: 'alfalfa',
  'alfalfa hay': 'alfalfa',
  'alfalfa seed': 'alfalfa',
}

const DRY_BEAN = {
  paperId: '3b173780-527a-4410-b2ec-4e45e00e18fc',
  paper: 'Irrigated Dry Bean Nutrient Requirements for Southern Alberta',
  agdex: '142/532-1',
}
const BARLEY = {
  paperId: 'dbac6ae4-99cf-412a-aedd-e9bdb97da32f',
  paper: 'Agronomic and fertilizer management of barley in Alberta',
  agdex: '114/541-1',
}
const WINTER_WHEAT = {
  paperId: 'ad085394-900e-46fb-916c-5c076c54e7ef',
  paper: 'Fertilizing winter wheat in southern Alberta',
  agdex: '112/541-2',
}
const SOFT_WHEAT = {
  paperId: 'ccfa3659-de93-4c0e-99d4-94282859ecec',
  paper: 'Fertilizing irrigated soft white spring wheat',
  agdex: '112/541-1',
}
const ALFALFA = {
  paperId: 'a27f4d20-2854-4ed8-a674-bd8fb82e9d5c',
  paper: 'Fertilizer requirements of irrigated alfalfa',
  agdex: '561-18',
}

/** `from`/`to` pairs from a sheet's evenly stepped first column. */
const steps = (
  start: number,
  step: number,
  rates: (number | null)[],
  openTop = true,
): GuideBand[] =>
  rates.map((rate, i) => ({
    from: start + i * step,
    to: openTop && i === rates.length - 1 ? null : start + (i + 1) * step,
    rate,
  }))

export const GUIDE_TABLES: GuideTable[] = [
  // Table 1, row cropped and solid seeded. The sheet's last row is ">120 0 0",
  // so both variants end open-topped at nil.
  {
    ...DRY_BEAN,
    crop: 'dry beans',
    nutrient: 'N',
    basis: 'n-lb-0-12',
    variant: 'Row cropped',
    main: true,
    table: 'Table 1',
    method: 'soil nitrate-N, 0 to 12 inches',
    bands: steps(0, 10, [90, 80, 70, 60, 50, 40, 30, 20, 10, 10, 0, 0, 0]),
    note: 'Optimum yield comes when soil N plus fertilizer N totals 80 to 100 lb/ac as a row crop.',
  },
  {
    ...DRY_BEAN,
    crop: 'dry beans',
    nutrient: 'N',
    basis: 'n-lb-0-12',
    variant: 'Solid seeded',
    table: 'Table 1',
    method: 'soil nitrate-N, 0 to 12 inches',
    bands: steps(0, 10, [110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 10, 0]),
    note: 'Solid-seeded rates are preliminary in the sheet itself: 100 to 120 lb/ac of soil N plus fertilizer N.',
  },
  {
    ...DRY_BEAN,
    crop: 'dry beans',
    nutrient: 'P2O5',
    basis: 'p-lb-0-6',
    variant: 'Banded',
    main: true,
    table: 'Table 2',
    method: 'modified Kelowna P, 0 to 6 inches',
    bands: steps(0, 10, [60, 50, 40, 35, 30, 25, 20, 15, 0]),
    note: 'Banded rates. Broadcast and incorporated needs 1.5 to 2 times as much to match it on low-P soil.',
  },
  {
    ...DRY_BEAN,
    crop: 'dry beans',
    nutrient: 'K2O',
    basis: 'k-lb-0-6',
    variant: 'General',
    main: true,
    table: 'Table 3',
    method: 'exchangeable K, 0 to 6 inches',
    bands: steps(0, 50, [140, 120, 100, 80, 60, 40, 20, 0]),
    note: 'Above about 300 lb K/ac the sheet says potassium fertilizer is not required.',
  },
  {
    ...DRY_BEAN,
    crop: 'dry beans',
    nutrient: 'S',
    basis: 's-lb-0-12',
    variant: 'General',
    main: true,
    table: 'Table 4',
    method: 'sulphate-S, 0 to 12 inches',
    bands: steps(0, 5, [25, 20, 15, 10, 0]),
    note: 'Sulphur is rarely short on irrigated land — the water carries about 30 lb/ac of sulphate-S per 12 inches applied.',
  },

  // Table 2, soil nitrogen 0 to 24 inches at medium soil moisture. The sheet
  // labels each row with a single level (10, 20, …); read here as the band
  // ending at that level. Its table stops at 150, so nothing is answered above.
  {
    ...BARLEY,
    crop: 'barley',
    nutrient: 'N',
    basis: 'n-lb-0-24',
    variant: 'Irrigation',
    main: true,
    table: 'Table 2',
    method: 'soil nitrate-N, 0 to 24 inches, medium soil moisture',
    bands: steps(
      0,
      10,
      [170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30],
      false,
    ),
    note: 'The sheet’s irrigation column. Its table ends at 150 lb/ac of soil N.',
  },
  {
    ...BARLEY,
    crop: 'barley',
    nutrient: 'N',
    basis: 'n-lb-0-24',
    variant: 'Brown soil zone, dryland',
    table: 'Table 2',
    method: 'soil nitrate-N, 0 to 24 inches, medium soil moisture',
    bands: steps(0, 10, [60, 50, 40, 30, 20, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0], false),
  },
  {
    ...BARLEY,
    crop: 'barley',
    nutrient: 'P2O5',
    basis: 'p-lb-0-6',
    variant: 'Irrigation',
    main: true,
    table: 'Table 5',
    method: 'Kelowna or modified Kelowna P, 0 to 6 inches',
    bands: steps(0, 10, [50, 45, 40, 35, 35, 30, 25, 20, 15, 0]),
    note: 'Seed-placed phosphate is the most efficient placement for barley.',
  },
  {
    ...BARLEY,
    crop: 'barley',
    nutrient: 'P2O5',
    basis: 'p-lb-0-6',
    variant: 'Brown soil zone, dryland',
    table: 'Table 5',
    method: 'Kelowna or modified Kelowna P, 0 to 6 inches',
    bands: steps(0, 10, [35, 30, 20, 15, 15, 15, 15, 0, 0, 0]),
  },
  {
    ...BARLEY,
    crop: 'barley',
    nutrient: 'K2O',
    basis: 'k-lb-0-6',
    variant: 'Irrigation',
    main: true,
    table: 'Table 6',
    method: '0.1N ammonium acetate K, 0 to 6 inches',
    bands: steps(0, 25, [120, 110, 105, 95, 85, 80, 70, 60, 50, 40, 30, 20, 0]),
    note: 'Response has been limited above 250 lb K/ac. Seed-placed potassium can hurt barley emergence, so banding is the safer placement.',
  },
  {
    ...BARLEY,
    crop: 'barley',
    nutrient: 'K2O',
    basis: 'k-lb-0-6',
    variant: 'Brown soil zone, dryland',
    table: 'Table 6',
    method: '0.1N ammonium acetate K, 0 to 6 inches',
    bands: steps(0, 25, [100, 95, 85, 75, 70, 60, 55, 45, 35, 30, 20, 20, 0]),
  },

  // Winter wheat. This PDF's tables extract right-to-left, so they were read
  // reversed; the Brown and Dark Brown column is the farm's, at the high soil
  // moisture level irrigation puts it in.
  {
    ...WINTER_WHEAT,
    crop: 'winter wheat',
    nutrient: 'N',
    basis: 'n-lb-0-24',
    variant: 'Brown and Dark Brown, high soil moisture',
    main: true,
    table: 'Table 2',
    method: 'soil nitrate-N, 0 to 24 inches',
    bands: steps(0, 10, [90, 80, 70, 60, 50, 40, 30, 20, 10, 0, 0]),
    note: 'Fall banding at seeding was as effective as spring broadcast, and often better, across all 13 research sites.',
  },
  {
    ...WINTER_WHEAT,
    crop: 'winter wheat',
    nutrient: 'N',
    basis: 'n-lb-0-24',
    variant: 'Brown and Dark Brown, medium soil moisture',
    table: 'Table 2',
    method: 'soil nitrate-N, 0 to 24 inches',
    bands: steps(0, 10, [60, 50, 40, 30, 20, 10, 0, 0, 0, 0, 0]),
  },
  {
    ...WINTER_WHEAT,
    crop: 'winter wheat',
    nutrient: 'P2O5',
    basis: 'p-lb-0-6',
    variant: 'Brown',
    main: true,
    table: 'Table 3',
    method: 'Kelowna or modified Kelowna P, 0 to 6 inches',
    bands: steps(0, 10, [30, 25, 20, 15, 15, 15, 15, 0, 0, 0]),
    note: 'Phosphate response was limited in the trials, so the sheet gives general requirements rather than a response table.',
  },

  {
    ...SOFT_WHEAT,
    crop: 'soft white spring wheat',
    nutrient: 'P2O5',
    basis: 'p-lb-0-6',
    variant: 'General',
    main: true,
    table: 'Table 2',
    method: 'Kelowna P, 0 to 6 inches',
    bands: steps(0, 10, [45, 40, 35, 30, 25, 20, 15, 15, 0]),
  },
  {
    ...SOFT_WHEAT,
    crop: 'soft white spring wheat',
    nutrient: 'K2O',
    basis: 'k-lb-0-6',
    variant: 'General',
    main: true,
    table: 'Table 3',
    method: 'exchangeable K, 0 to 6 inches',
    bands: steps(0, 50, [120, 100, 60, 45, 15, 0]),
  },

  {
    ...ALFALFA,
    crop: 'alfalfa',
    nutrient: 'P2O5',
    basis: 'p-lb-0-6',
    variant: 'Annual, established stand',
    main: true,
    table: 'Table 2',
    method: 'soil test P, 0 to 15 cm',
    bands: steps(0, 10, [60, 50, 45, 40, 35, 30, 20, 10, 0]),
    note: 'A 5 ton/ac crop removes about 50 lb/ac of P2O5. One 150 to 200 lb/ac application before seeding covers four to five years.',
  },
  {
    ...ALFALFA,
    crop: 'alfalfa',
    nutrient: 'K2O',
    basis: 'k-lb-0-6',
    variant: 'Annual, established stand',
    main: true,
    table: 'Table 3',
    method: 'ammonium acetate K, 0 to 15 cm',
    bands: [
      { from: 0, to: 50, rate: 240, rateTo: 260 },
      { from: 50, to: 100, rate: 165, rateTo: 180 },
      { from: 100, to: 150, rate: 115, rateTo: 125 },
      { from: 150, to: 175, rate: 75 },
      { from: 175, to: 200, rate: 50 },
      { from: 200, to: 225, rate: 25 },
      { from: 225, to: null, rate: 0 },
    ],
    note: 'Alfalfa removes 50 to 65 lb of K2O per ton of dry matter, so a hay crop draws K down faster than anything else grown here.',
  },
]

/**
 * Nitrogen for soft white spring wheat, which its sheet gives the other way
 * round: soil N plus fertilizer N needed to reach a yield goal, rather than a
 * rate at a soil test level. Fertilizer N is that total less what the soil
 * holds, which is how the sheet's own worked example reads.
 *
 * One cell of the intermediate column is unreadable in the scan (the 70 lb/ac
 * row) and is null rather than transcribed as the 52 the extraction gives,
 * which would be lower than the row above it.
 */
export const SOFT_WHEAT_N = {
  ...SOFT_WHEAT,
  table: 'Table 1',
  method: 'soil nitrate-N, 0 to 24 inches, plus fertilizer N',
  /** Total N (lb/ac) against the yield (bu/ac) it buys at each irrigation level. */
  rows: [
    { totalN: 50, intermediate: 52, optimum: 56 },
    { totalN: 60, intermediate: 57, optimum: 62 },
    { totalN: 70, intermediate: null, optimum: 68 },
    { totalN: 80, intermediate: 66, optimum: 73 },
    { totalN: 90, intermediate: 70, optimum: 77 },
    { totalN: 100, intermediate: 73, optimum: 81 },
    { totalN: 110, intermediate: 76, optimum: 85 },
    { totalN: 120, intermediate: 78, optimum: 88 },
    { totalN: 130, intermediate: 81, optimum: 91 },
    { totalN: 140, intermediate: 83, optimum: 94 },
    { totalN: 150, intermediate: 85, optimum: 96 },
    { totalN: 160, intermediate: 87, optimum: 98 },
    { totalN: 170, intermediate: 88, optimum: 100 },
    { totalN: 180, intermediate: 89, optimum: 102 },
    { totalN: 190, intermediate: 90, optimum: 104 },
    { totalN: 200, intermediate: 91, optimum: 106 },
  ] as { totalN: number; intermediate: number | null; optimum: number }[],
  /** Above these totals the sheet warns grain protein can pass 10.5 per cent. */
  proteinCeiling: { intermediate: 150, optimum: 180 },
  note: 'Optimum irrigation is 450 to 500 mm of crop water use with soil moisture never below 50 per cent available; intermediate is 350 to 425 mm with several stress periods.',
}

/**
 * Zinc for dry beans, the one micronutrient the bean sheet found responses to.
 * Keyed by texture because the critical level differs: 1.5 ppm on medium to
 * fine soil, 2.0 ppm on coarse.
 */
export const DRY_BEAN_ZINC = {
  ...DRY_BEAN,
  table: 'Table 5',
  method: 'DTPA extractable Zn, 0 to 6 inches',
  textures: [
    {
      texture: 'Medium to fine (loam to clay loam)',
      critical: 1.5,
      bands: [
        { from: 0, to: 1.0, rate: 5 },
        { from: 1.0, to: 1.5, rate: 3 },
        { from: 1.5, to: null, rate: 0 },
      ] as GuideBand[],
    },
    {
      texture: 'Coarse (sandy loam to loamy sand)',
      critical: 2.0,
      bands: [
        { from: 0, to: 1.0, rate: 5 },
        { from: 1.0, to: 2.0, rate: 3 },
        { from: 2.0, to: null, rate: 0 },
      ] as GuideBand[],
    },
  ],
  note: 'Based on a very limited amount of field data. Foliar zinc may still be wanted above the critical level when the soil is cold and wet.',
}

/**
 * Russet Burbank petiole targets, which is what the potato sheet gives instead
 * of a soil-test rate table: the optimal petiole nutrient range by days after
 * planting, from three years of southern Alberta trials (2004, 2005 and 2007).
 *
 * The lower edge is the concentration at 90 per cent of relative yield and the
 * upper edge at 100 per cent, so inside the range is where the crop should sit.
 * The sheet's own 85 DAP row steps back up because the curves were re-fitted
 * there; it is transcribed as printed.
 */
export const POTATO_PETIOLE = {
  paperId: 'b93e01f2-3e1a-49a3-be95-9a1f9b285d61',
  paper: 'Nutrient recommendations for Russet Burbank potatoes in southern Alberta',
  agdex: '258/541-1',
  table: 'Table 1',
  rows: [
    { dap: 60, no3n: [13000, 21400], p: [0.15, 0.43], k: [7.3, 12.4] },
    { dap: 65, no3n: [11550, 19950], p: [0.15, 0.41], k: [6.6, 11.6] },
    { dap: 70, no3n: [10100, 18500], p: [0.14, 0.4], k: [5.9, 10.7] },
    { dap: 75, no3n: [8650, 17050], p: [0.14, 0.38], k: [5.2, 9.9] },
    { dap: 80, no3n: [7200, 15600], p: [0.13, 0.37], k: [4.5, 9.0] },
    { dap: 85, no3n: [12978, 20378], p: [0.13, 0.35], k: [8.8, 14.1] },
    { dap: 90, no3n: [11756, 19156], p: [0.13, 0.34], k: [7.9, 13.2] },
    { dap: 95, no3n: [10533, 17933], p: [0.12, 0.32], k: [7.1, 12.4] },
    { dap: 100, no3n: [9311, 16711], p: [0.12, 0.31], k: [6.2, 11.5] },
    { dap: 105, no3n: [8089, 15489], p: [0.12, 0.29], k: [5.4, 10.6] },
    { dap: 110, no3n: [6867, 14267], p: [0.11, 0.28], k: [4.5, 9.7] },
    { dap: 115, no3n: [5644, 13044], p: [0.11, 0.26], k: [3.7, 8.9] },
    { dap: 120, no3n: [4422, 11822], p: [0.1, 0.25], k: [2.8, 8.0] },
    { dap: 125, no3n: [3200, 10600], p: [0.1, 0.23], k: [2.0, 7.1] },
  ] as { dap: number; no3n: [number, number]; p: [number, number]; k: [number, number] }[],
  note: 'Petiole NO3-N in ppm, P and K as a per cent of dry matter. Guidelines only — climate, soil, sampling technique and the lab all move them.',
}
