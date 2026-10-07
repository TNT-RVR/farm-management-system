/**
 * What the survey's shorthand means, in a farmer's terms.
 *
 * AGRASID speaks the Canadian System of Soil Classification: a horizon is "Ap"
 * or "Ck", a subgroup is "O.BC", and the columns are CEC and EC and CaCO3. All
 * of it is standard and none of it is guessable, so the screen carries the
 * translation rather than assuming the reader did soil science.
 *
 * Horizon codes are composed rather than listed: a capital for the master
 * horizon, then lower-case suffixes for what happened to it. "Ap" is the A
 * horizon, ploughed. "Ck" is the C horizon with visible carbonate. Listing
 * every combination would be a hundred entries and would still miss the next
 * one, so they are taken apart instead.
 */

export const HORIZON_MASTER: Record<string, { name: string; text: string }> = {
  O: {
    name: 'Organic',
    text: 'Formed from plant material rather than mineral soil — peat and muck. Rare on cultivated land here.',
  },
  A: {
    name: 'Topsoil',
    text: 'The surface mineral layer. Where organic matter collects, where roots are thickest, and where a soil test is taken.',
  },
  B: {
    name: 'Subsoil',
    text: 'Altered by weathering below the topsoil — colour or structure changed, or clay washed down into it. Roots reach it but it holds less organic matter.',
  },
  C: {
    name: 'Parent material',
    text: 'The material the soil formed from, largely unchanged. Often where carbonate and salts have accumulated.',
  },
  R: { name: 'Bedrock', text: 'Consolidated rock.' },
}

export const HORIZON_SUFFIX: Record<string, { name: string; text: string }> = {
  p: {
    name: 'ploughed',
    text: 'Disturbed by cultivation. "Ap" is the plough layer — the depth the implement mixes, and what a 0–6″ sample is.',
  },
  h: { name: 'humus-rich', text: 'Enriched with organic matter. The dark layer under a native sod.' },
  e: {
    name: 'leached',
    text: 'Clay, iron and organic matter have been washed out of it, leaving it paler and lighter-textured.',
  },
  m: {
    name: 'weathered',
    text: 'Slightly altered in colour or structure by weathering, without clay having moved in. A mild subsoil.',
  },
  t: {
    name: 'clay accumulation',
    text: 'Clay washed down from above has built up here. Holds water and nutrients well, but restricts roots and drainage when heavy.',
  },
  k: {
    name: 'carbonate present',
    text: 'Free lime — it fizzes with acid. Carbonate ties up phosphorus and zinc, so a soil test reads them lower than the same number means on non-calcareous ground.',
  },
  ca: {
    name: 'carbonate accumulation',
    text: 'A distinct layer where lime has built up, usually a whitish band. The same phosphorus and zinc problem, more strongly.',
  },
  sa: {
    name: 'salt accumulation',
    text: 'Soluble salts have concentrated here. Where this sits near the surface, crops thin out and bare patches show in a dry year.',
  },
  s: { name: 'salts', text: 'Soluble salts present, including gypsum.' },
  g: {
    name: 'gleyed',
    text: 'Grey colours and mottles from sitting wet. Ground that stays saturated long enough to lose its oxygen — the low, late-drying part of a field.',
  },
  n: {
    name: 'sodic (solonetzic)',
    text: 'High sodium relative to calcium, giving a hard columnar layer. Water moves through it poorly and roots struggle — the classic "burnout" knoll of southern Alberta.',
  },
  j: { name: 'weakly expressed', text: 'The feature marked by the letter before it, present but too weak to qualify fully.' },
  c: { name: 'cemented', text: 'Hardened into a pan that roots and water cannot easily pass.' },
  f: { name: 'iron-enriched', text: 'Iron and aluminium have accumulated — a podzolic subsoil.' },
  y: { name: 'frost-churned', text: 'Mixed by freeze-thaw.' },
  z: { name: 'frozen', text: 'A perennially frozen layer.' },
}

export type HorizonParts = {
  code: string
  master: { letter: string; name: string; text: string } | null
  /** "BC" and the like: a layer transitional between two masters. */
  transitionTo: { letter: string; name: string } | null
  suffixes: { letter: string; name: string; text: string }[]
}

/**
 * A horizon code taken apart.
 *
 * Two-letter suffixes are matched before one-letter ones, because "ca" is
 * carbonate accumulation and reading it as c-then-a would make it a cemented
 * layer — the opposite kind of problem.
 */
export function parseHorizon(code: string | null | undefined): HorizonParts | null {
  if (!code) return null
  const raw = code.trim()
  if (!raw) return null

  const masters = raw.match(/^[A-Z]+/)?.[0] ?? ''
  const first = masters[0]
  const master = first && HORIZON_MASTER[first] ? { letter: first, ...HORIZON_MASTER[first] } : null
  const second = masters[1]
  const transitionTo =
    second && HORIZON_MASTER[second]
      ? { letter: second, name: HORIZON_MASTER[second].name }
      : null

  const suffixes: HorizonParts['suffixes'] = []
  let rest = raw.slice(masters.length)
  while (rest.length) {
    const two = rest.slice(0, 2).toLowerCase()
    if (HORIZON_SUFFIX[two]) {
      suffixes.push({ letter: two, ...HORIZON_SUFFIX[two] })
      rest = rest.slice(2)
      continue
    }
    const one = rest[0].toLowerCase()
    if (HORIZON_SUFFIX[one]) suffixes.push({ letter: one, ...HORIZON_SUFFIX[one] })
    rest = rest.slice(1)
  }

  return { code: raw, master, transitionTo, suffixes }
}

/** One line for a horizon: "Topsoil, ploughed". */
export function describeHorizon(code: string | null | undefined): string | null {
  const p = parseHorizon(code)
  if (!p?.master) return null
  const head = p.transitionTo
    ? `${p.master.name} grading into ${p.transitionTo.name.toLowerCase()}`
    : p.master.name
  const tail = p.suffixes.map((s) => s.name).join(', ')
  return tail ? `${head}, ${tail}` : head
}

/** The measured columns, and what a number in them is telling you. */
export const SOIL_COLUMN_HELP: Record<string, { title: string; text: string }> = {
  horizon: {
    title: 'Horizon',
    text: 'A layer of the soil profile. The capital is the layer — A topsoil, B subsoil, C parent material — and the small letters say what happened to it. Tap a code for its own explanation.',
  },
  depth: {
    title: 'Depth',
    text: 'How far below the surface this layer sits, in centimetres. A shallow topsoil over sand behaves very differently from the same topsoil over clay.',
  },
  texture: {
    title: 'Texture',
    text: 'The mix of sand, silt and clay, as an abbreviation: S sand, LS loamy sand, SL sandy loam, L loam, SIL silt loam, CL clay loam, SCL sandy clay loam, SIC silty clay, C clay. Texture drives how much water the layer holds and how fast it drains — the single most useful thing on this table.',
  },
  clay: {
    title: 'Clay %',
    text: 'Proportion of clay-sized particles. More clay means more water and nutrient holding, slower drainage, and more trouble getting on the field after rain. Under about 10% is sand-like; over about 35% is heavy.',
  },
  organicCarbon: {
    title: 'Organic carbon %',
    text: 'Carbon in the soil organic matter. Multiply by about 1.7 to compare with the organic matter percentage a soil lab reports — so 2% organic carbon is roughly 3.4% organic matter.',
  },
  ph: {
    title: 'pH',
    text: 'Acidity or alkalinity. Most of this district runs 7 to 8.5 — alkaline, which is why phosphorus, zinc, iron and manganese are less available here than the raw test numbers suggest. Below 6 is acidic and rare on this land.',
  },
  ec: {
    title: 'EC — electrical conductivity',
    text: 'How salty the layer is, in dS/m. Under 2 affects almost nothing. From 4 the sensitive crops — beans, onions — start losing yield; over 8 only the tolerant ones do well. Salinity usually shows up as bare patches where water sits and evaporates.',
  },
  cec: {
    title: 'CEC — cation exchange capacity',
    text: 'How much of the positively charged nutrients — calcium, magnesium, potassium, ammonium — the soil can hold against leaching, in meq/100 g. Sands run under 10 and cannot hold much, so nitrogen and potassium are better split than applied all at once. Clays run over 25.',
  },
  caco3: {
    title: 'CaCO₃ — free lime',
    text: 'Calcium carbonate, the material that fizzes with acid. It buffers pH high and ties up phosphorus and zinc, so a phosphorus reading on a calcareous layer means less available phosphorus than the same reading elsewhere.',
  },
  fc: {
    title: 'Field capacity',
    text: 'The water a soil holds after it has drained, as a percentage of its volume. The full mark of the reservoir a crop draws on.',
  },
  wp: {
    title: 'Wilting point',
    text: 'The water still held in the soil but bound too tightly for a crop to pull out. The empty mark. What lies between this and field capacity is all the crop actually gets.',
  },
  availableWater: {
    title: 'Available water',
    text: 'Field capacity minus wilting point, given here as inches of water per metre of soil. It is the number that decides how long a field goes between sets: under 1.5″ empties in a few hot days, over 3.5″ carries a crop through a week.',
  },
  drainage: {
    title: 'Drainage',
    text: 'How readily water leaves the profile. Rapid and well-drained soils dry out fast and let nitrate leach past the roots. Imperfect and poor drainage means ground that stays wet, works late, and denitrifies.',
  },
  salinity: {
    title: 'Salinity rating',
    text: 'The survey’s own classing of salt content, from non-saline to very strongly saline. A rating above non-saline is worth reading beside the EC figures in the horizon table.',
  },
  subgroup: {
    title: 'Classification',
    text: 'The Canadian soil classification, abbreviated — "O.BC" is an Orthic Brown Chernozem, the typical grassland soil of dry southern Alberta. "SZ" prefixes mean solonetzic, the sodium-affected soils. It is a summary of how the profile formed rather than something to act on directly.',
  },
  munit: {
    title: 'Map unit',
    text: 'The survey’s own code for this piece of ground, naming the soils in it and the landform they sit on. Useful for looking the polygon up in AGRASID; not something to act on.',
  },
}
