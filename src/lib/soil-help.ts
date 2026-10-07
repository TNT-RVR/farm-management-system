import { bandFor, type ColumnHelp, type HelpBand } from './column-help'

/**
 * What each soil-test column means, and what counts as high or low.
 *
 * Bands are structured rather than prose for two reasons: the popover can
 * highlight the one a field's own result falls into, and the table's colour
 * coding is read from this same list, so the colours and the stated ranges
 * cannot drift apart.
 *
 * Ranges are those commonly used for prairie / southern-Alberta soils. Two
 * caveats are stated in the copy where they matter: critical levels are
 * crop-specific, and a lab's own interpretation depends on its extraction
 * method.
 */

const b = (max: number, label: string, note: string, rating: HelpBand['rating']): HelpBand => ({
  max,
  label,
  note,
  rating,
})
const TOP = Infinity

export const SOIL_HELP: Record<string, ColumnHelp> = {
  sample: {
    title: 'Sample',
    body: [
      'Which sampling site on the field, and which depth from it. The number is the site; the letter is the depth — A is the topsoil core, B the subsoil core taken at the same spot.',
      'Several sites per field is the point: one core tells you about one square foot of ground. Comparing sites shows whether the field is uniform or whether one corner is doing something different.',
    ],
  },

  depth: {
    title: 'Sample depth (inches)',
    body: [
      '0–6 inches is the topsoil, where phosphorus, potassium, organic matter and the micronutrients are measured. Those nutrients barely move, so the surface is where they accumulate and where the roots first meet them.',
      '6–24 inches is the subsoil, sampled mainly for nitrate and sulphate. Both are mobile — they follow water down — so a field can look empty at the surface while holding a useful amount deeper.',
    ],
    how: {
      label: 'Reading the two together',
      lines: [
        'Nitrogen and sulphur: add the two depths. The crop will reach both.',
        'Phosphorus, potassium, micronutrients: read the topsoil. The subsoil figures are near zero because those tests are not run at depth.',
      ],
    },
  },

  om_pct: {
    title: 'Organic matter (%)',
    body: [
      'The share of the soil that is decomposed plant and animal residue. It holds water, holds nutrients, feeds soil biology, and mineralises nitrogen through the season.',
      'It moves very slowly. A number that shifts by more than a few tenths between years is more likely a different sampling spot than a real change in the soil.',
    ],
    ranges: {
      label: 'Organic matter',
      bands: [
        b(2, 'Under 2%', 'little nitrogen release, poor water holding', 'low'),
        b(4, '2 – 4%', 'moderate, and typical of irrigated ground here', 'ok'),
        b(6, '4 – 6%', 'good', 'ok'),
        b(TOP, 'Over 6%', 'high, usually old grassland or heavily manured', 'high'),
      ],
      footnote:
        'Southern Alberta irrigated soils commonly sit at 1.5 – 3%, so 2% here is normal rather than poor.',
    },
  },

  no3n_ppm: {
    title: 'Nitrate nitrogen (ppm)',
    body: [
      'Plant-available nitrogen as a concentration. Nitrate is what the crop takes up, and it is mobile — it moves with water, which is why it is measured at both depths and does not carry over reliably between years.',
      'This is the raw measurement. For setting a rate, use the lb/ac column beside it, which converts concentration into an amount over the sampled depth.',
    ],
    how: {
      label: 'Why ppm alone misleads',
      lines: [
        'The same ppm means far more nitrogen over an 18-inch subsoil layer than over a 6-inch topsoil layer.',
        'A high topsoil ppm with an empty subsoil is a small amount of nitrogen; a moderate reading through both is a large one.',
      ],
    },
  },

  no3n_lb_ac: {
    title: 'Nitrate nitrogen (lb/ac)',
    body: [
      'The number a nitrogen decision is made from. It converts the nitrate concentration into pounds per acre over the depth sampled, so topsoil and subsoil can simply be added.',
      'Add both depths for the field total, then subtract that from the crop requirement to get what needs applying.',
    ],
    ranges: {
      label: 'Total across 0–24 inches',
      bands: [
        b(20, 'Under 20 lb/ac', 'extremely deficient', 'low'),
        b(40, '20 – 40', 'very deficient', 'low'),
        b(70, '40 – 70', 'deficient — a strong response to N', 'low'),
        b(100, '70 – 100', 'marginal', 'marginal'),
        b(150, '100 – 150', 'adequate — trim the rate', 'ok'),
        b(TOP, 'Over 150', 'high, often after a poor year that left nitrogen behind', 'high'),
      ],
      footnote:
        "Alberta's irrigated scale (Agdex 100/541-1). Dryland crops need far less — 40 – 60 lb/ac is often enough on Brown soil. Requirements are crop-specific: corn or potatoes ask far more than a pulse, which fixes its own.",
    },
  },

  p_bicarb_ppm: {
    title: 'Phosphorus — Bicarbonate (Olsen), ppm',
    body: [
      'The phosphorus test that is right for these soils. Sodium-bicarbonate extraction is the standard above about pH 7.2, and every field here is alkaline.',
      'Phosphorus barely moves. It is measured in the topsoil, responds slowly to fertiliser, and a low reading is a multi-year problem rather than something one pass fixes.',
    ],
    ranges: {
      label: 'Olsen phosphorus',
      bands: [
        b(5, 'Under 5 ppm', 'very low — a strong response to applied P is likely', 'low'),
        b(10, '5 – 10', 'low', 'low'),
        b(20, '10 – 20', 'medium', 'marginal'),
        b(41, '20 – 41', 'adequate — irrigated crops still take 20 – 45 lb P₂O₅', 'ok'),
        b(85, '41 – 85', 'very high — starter only', 'high'),
        b(TOP, 'Over 85', 'excessive — no P, no manure', 'high'),
      ],
      footnote:
        "Alberta's P tables are written in Modified Kelowna lb/ac; Olsen ppm converts at about (Olsen + 3.3) ÷ 0.886 × 2, so Olsen 41 ≈ 100 lb/ac (very high under irrigation) and Olsen 85 ≈ 200 lb/ac, where Alberta stops all P. Seed-placed starter often pays even above that on cold spring soils.",
    },
  },

  p_melich3_ppm: {
    title: 'Phosphorus — Mehlich-III, ppm',
    body: [
      'A second phosphorus extraction reported alongside the bicarbonate one. Mehlich-III is an acid extractant designed for acidic soils; on calcareous ground it dissolves phosphorus the crop cannot reach, so it reads higher than Olsen.',
      'Useful for comparing against labs that report Mehlich-III, and for trend. For a fertiliser decision here, the bicarbonate column is the one to trust.',
    ],
    ranges: {
      label: 'Mehlich-III phosphorus',
      bands: [
        b(15, 'Under 15 ppm', 'low', 'low'),
        b(30, '15 – 30', 'medium', 'marginal'),
        b(50, '30 – 50', 'high', 'ok'),
        b(TOP, 'Over 50', 'very high', 'high'),
      ],
      footnote:
        'On these alkaline soils Mehlich-III runs roughly 1.5 – 2× the Olsen figure. Where the two disagree, believe Olsen.',
    },
  },

  k_ppm: {
    title: 'Potassium (ppm)',
    body: [
      'Exchangeable potassium — the pool the crop draws from. It drives water regulation, stalk and straw strength, and disease tolerance.',
      'Prairie soils are usually well supplied, so a low reading here is worth a second look before acting on it.',
    ],
    ranges: {
      label: 'Exchangeable potassium',
      bands: [
        b(100, 'Under 100 ppm', 'low — a response is likely', 'low'),
        b(150, '100 – 150', 'marginal', 'marginal'),
        b(250, '150 – 250', 'adequate', 'ok'),
        b(TOP, 'Over 250', 'high', 'high'),
      ],
      footnote:
        'Alfalfa, silage and potatoes draw potassium down fastest — the whole plant leaves the field rather than just the grain.',
    },
  },

  so4s_ppm: {
    title: 'Sulphur as sulphate (ppm)',
    body: [
      'Plant-available sulphur. Like nitrate it is mobile and measured at both depths, and it can sit in the subsoil while the surface reads empty.',
      'It is also patchy — sulphur varies sharply across one field, so a single low site among several is worth checking rather than acting on.',
    ],
    ranges: {
      label: 'Sulphate sulphur',
      bands: [
        b(10, 'Under 10 ppm', 'low', 'low'),
        b(20, '10 – 20', 'marginal', 'marginal'),
        b(TOP, 'Over 20', 'adequate', 'ok'),
      ],
      footnote:
        'A concentration, so it reads the same way at either depth and is NOT added between them — unlike nitrate, which the lab also reports in lb/ac. Canola needs far more sulphur than cereals and shows deficiency first. Irrigation water carries sulphate too: SMRID canal water about 2 lb S an inch applied, Oldman River water about 3.6 — so a foot of water brings 24 – 43 lb S, and a low test on irrigated ground is less urgent than on dryland.',
    },
  },

  ph: {
    title: 'pH',
    body: [
      'Acidity or alkalinity, and the master variable behind nutrient availability. It decides which phosphorus test is valid, whether micronutrients are locked up, and whether aluminium is a concern.',
      'These fields are alkaline, which is normal here. The consequence is that phosphorus, zinc, iron and manganese become less available as pH climbs, even when the total amount in the soil is fine.',
    ],
    ranges: {
      label: 'Soil reaction',
      bands: [
        b(5.5, 'Under 5.5', 'acidic — aluminium toxicity becomes a real risk', 'low'),
        b(6.5, '5.5 – 6.5', 'slightly acidic, ideal for most crops', 'ok'),
        b(7.5, '6.5 – 7.5', 'near neutral', 'ok'),
        b(8.0, '7.5 – 8.0', 'slightly alkaline, typical here', 'ok'),
        b(8.5, '8.0 – 8.5', 'alkaline — expect tie-up of P, Zn, Fe and Mn', 'marginal'),
        b(TOP, 'Over 8.5', 'strongly alkaline — check sodium for a sodic problem', 'high'),
      ],
      footnote: 'pH is context rather than good or bad; it decides which other numbers can be trusted.',
    },
  },

  cec_meq: {
    title: 'Cation exchange capacity (meq/100 g)',
    body: [
      'How much nutrient the soil can hold, not how much it currently has. It is the size of the tank, set mostly by clay and organic matter, and it barely changes.',
      'A low CEC soil cannot hold much and leaks readily, so it wants smaller, more frequent applications. A high CEC soil buffers change — slower to correct, slower to lose.',
    ],
    ranges: {
      label: 'Holding capacity',
      bands: [
        b(10, 'Under 10', 'sandy, low holding capacity', 'low'),
        b(20, '10 – 20', 'medium, typical loam', 'ok'),
        b(TOP, 'Over 20', 'high, clay-dominated', 'ok'),
      ],
      footnote:
        'A capacity, not a fertility rating. High CEC with low base saturations is a big tank that happens to be empty.',
    },
  },

  base_k_pct: {
    title: 'Base saturation — %K',
    body: [
      'The share of the soil exchange sites holding potassium. It puts the K reading in context: 150 ppm means something different on a light soil than on a heavy one.',
    ],
    ranges: {
      label: 'Share of exchange sites',
      bands: [
        b(2, 'Under 2%', 'low', 'low'),
        b(5, '2 – 5%', 'the usual target', 'ok'),
        b(TOP, 'Over 5%', 'high, and unusual', 'high'),
      ],
      footnote: 'Read alongside %Mg — potassium and magnesium compete for uptake.',
    },
  },

  base_mg_pct: {
    title: 'Base saturation — %Mg',
    body: [
      'The share of exchange sites holding magnesium — a nutrient in its own right and the centre of the chlorophyll molecule.',
      'Very high magnesium relative to calcium can tighten soil structure, though that matters far less on these soils than sodium does.',
    ],
    ranges: {
      label: 'Share of exchange sites',
      bands: [
        b(10, 'Under 10%', 'low', 'low'),
        b(20, '10 – 20%', 'the usual target', 'ok'),
        b(TOP, 'Over 20%', 'high — check against %K, excess Mg can restrict potassium uptake', 'high'),
      ],
    },
  },

  base_ca_pct: {
    title: 'Base saturation — %Ca',
    body: [
      'The share of exchange sites holding calcium, normally the dominant cation. Beyond nutrition it supports structure — calcium flocculates clay, keeping soil open and friable.',
      'On calcareous ground it is high by default because of free lime, so a high figure is expected rather than notable.',
    ],
    ranges: {
      label: 'Share of exchange sites',
      bands: [
        b(40, 'Under 40%', 'low, and unusual here', 'low'),
        b(60, '40 – 60%', 'moderate', 'marginal'),
        b(80, '60 – 80%', 'the usual target', 'ok'),
        b(TOP, 'Over 80%', 'high, and normal on limey prairie soils', 'ok'),
      ],
    },
  },

  base_h_pct: {
    title: 'Base saturation — %H',
    body: [
      'Exchangeable acidity: the share of exchange sites holding hydrogen. It is what makes a soil acidic.',
      'Above pH 7 there is effectively none, which is why this column is blank or zero on every field here. A non-zero figure would mean a soil that had turned acidic.',
    ],
    ranges: {
      label: 'Exchangeable acidity',
      bands: [
        b(0.001, '0%', 'expected on any soil above pH 7 — the normal case here', 'ok'),
        b(10, 'Under 10%', 'slight acidity', 'marginal'),
        b(TOP, 'Over 10%', 'meaningful acidity; check pH and consider lime', 'low'),
      ],
      footnote: 'A blank cell on an alkaline soil means zero, not unknown.',
    },
  },

  base_na_pct: {
    title: 'Base saturation — %Na',
    body: [
      'The share of exchange sites holding sodium, and the one to watch on irrigated ground. Sodium does the opposite of calcium: it disperses clay, collapsing structure so water stops infiltrating and the surface seals and crusts.',
      'This is a structure problem, not a fertility one. Fertiliser does not fix it — it takes calcium (usually gypsum) to displace the sodium and enough water to carry it below the root zone.',
    ],
    ranges: {
      label: 'Sodium on the exchange',
      bands: [
        b(1, 'Under 1%', 'no concern', 'ok'),
        b(5, '1 – 5%', 'worth watching, especially with sodium in the irrigation water', 'marginal'),
        b(TOP, 'Over 5%', 'sodic — expect infiltration and crusting problems', 'high'),
      ],
      footnote:
        'High sodium with high pH and low salts is the classic sodic signature. Here a HIGH number is the bad news.',
    },
  },

  ca_ppm: {
    title: 'Calcium (ppm)',
    body: [
      'Total exchangeable calcium, the amount behind the %Ca figure. High on these limey soils and almost never limiting as a nutrient.',
      'Its value here is as a counterweight to sodium — the ratio between them tells you more than either alone.',
    ],
    ranges: {
      label: 'Exchangeable calcium',
      bands: [
        b(500, 'Under 500 ppm', 'low, and unusual above pH 6', 'low'),
        b(5000, '500 – 5,000', 'the usual range on soils like these', 'ok'),
        b(TOP, 'Over 5,000', 'high, typical of strongly calcareous ground', 'ok'),
      ],
    },
  },

  mg_ppm: {
    title: 'Magnesium (ppm)',
    body: ['Total exchangeable magnesium, the amount behind the %Mg figure.'],
    ranges: {
      label: 'Exchangeable magnesium',
      bands: [
        b(50, 'Under 50 ppm', 'low', 'low'),
        b(150, '50 – 150', 'adequate', 'ok'),
        b(TOP, 'Over 150', 'high, typical of heavier soils', 'high'),
      ],
    },
  },

  na_ppm: {
    title: 'Sodium (ppm)',
    body: [
      'Total exchangeable sodium, the amount behind the %Na figure. On irrigated ground it accumulates over years from the water, so the trend across seasons matters more than any single reading.',
    ],
    how: {
      label: 'How to read it',
      lines: [
        'Read %Na rather than this raw number — the same ppm is far more serious on a low-CEC soil.',
        'A figure climbing year on year while %Na stays flat still deserves attention: it means sodium is accumulating.',
      ],
    },
  },

  zn_ppm: {
    title: 'Zinc (ppm)',
    body: [
      'The micronutrient most likely to be short on high-pH prairie soils, and the one corn, beans and potatoes are most sensitive to.',
      'Availability falls as pH rises, so a marginal figure on an alkaline field is more serious than the same number on a neutral one.',
    ],
    ranges: {
      label: 'DTPA zinc',
      bands: [
        b(0.5, 'Under 0.5 ppm', 'low — a response is likely on a sensitive crop', 'low'),
        b(1, '0.5 – 1.0', 'low for corn and potatoes', 'low'),
        b(1.5, '1.0 – 1.5', 'marginal — dry beans still respond', 'marginal'),
        b(2, '1.5 – 2.0', 'adequate, except beans on sandy ground', 'ok'),
        b(TOP, 'Over 2.0', 'adequate', 'ok'),
      ],
      footnote:
        'Critical levels are crop-specific: corn and potatoes about 1.0 ppm, dry beans 1.5 (2.0 on sandy soil, Agdex 142/532-1). Cereals rarely respond.',
    },
  },

  mn_ppm: {
    title: 'Manganese (ppm)',
    body: [
      'A micronutrient involved in photosynthesis and disease resistance. Like zinc it is tied up by high pH, and deficiency shows first on the highest, most limey knolls.',
    ],
    ranges: {
      label: 'DTPA manganese',
      bands: [
        b(5, 'Under 5 ppm', 'low', 'low'),
        b(TOP, 'Over 5', 'generally adequate', 'ok'),
      ],
      footnote: 'Deficiency is patchy — it follows eroded high spots rather than the whole field.',
    },
  },

  fe_ppm: {
    title: 'Iron (ppm)',
    body: [
      'Iron is abundant in almost all soils; the issue is availability. On high-pH ground it converts to forms the plant cannot take up, showing as chlorosis — yellow leaves with green veins — on the youngest growth.',
      'Soil-applied iron rarely fixes this on calcareous soil, because the applied iron ties up as fast as the native supply. A chelated foliar feed is the usual answer.',
    ],
    ranges: {
      label: 'DTPA iron',
      bands: [
        b(2.5, 'Under 2.5 ppm', 'low', 'low'),
        b(4.5, '2.5 – 4.5', 'marginal', 'marginal'),
        b(TOP, 'Over 4.5', 'adequate', 'ok'),
      ],
      footnote: 'Soybeans and edible beans show iron chlorosis; cereals almost never do.',
    },
  },

  cu_ppm: {
    title: 'Copper (ppm)',
    body: [
      'Needed in very small amounts, with cereals — wheat especially — the most sensitive. Deficiency causes limp, twisted flag leaves and poor grain fill, most often on high-organic-matter or sandy soils.',
    ],
    ranges: {
      label: 'DTPA copper',
      bands: [
        b(0.4, 'Under 0.4 ppm', 'low', 'low'),
        b(0.8, '0.4 – 0.8', 'marginal', 'marginal'),
        b(TOP, 'Over 0.8', 'adequate', 'ok'),
      ],
      footnote: 'Copper stays put once applied — a correcting application lasts several seasons.',
    },
  },

  b_ppm: {
    title: 'Boron (ppm)',
    body: [
      'Needed for flowering, seed set and cell-wall formation. Canola and alfalfa are the heavy users; cereals need very little.',
      'The one micronutrient where the gap between deficient and toxic is narrow, so it should never be applied blind or broadcast at a guessed rate.',
    ],
    ranges: {
      label: 'Hot-water boron',
      bands: [
        b(0.5, 'Under 0.5 ppm', 'low', 'low'),
        b(1, '0.5 – 1.0', 'marginal', 'marginal'),
        b(2, '1.0 – 2.0', 'adequate', 'ok'),
        b(TOP, 'Over 2.0', 'approaching toxicity for sensitive crops', 'high'),
      ],
      footnote: 'Boron leaches readily, so it does not carry over the way copper does.',
    },
  },

  soluble_salts: {
    title: 'Soluble salts (mS/cm)',
    body: [
      'Total dissolved salts. High salinity makes it harder for a crop to draw water even from wet soil, so the symptoms look like drought in a field that is not short of water.',
      'On irrigated ground salts arrive with the water and concentrate where it evaporates, building at the surface and in low spots that do not drain.',
    ],
    ranges: {
      label: 'Salinity',
      bands: [
        b(1, 'Under 1', 'no effect on any crop', 'ok'),
        b(2, '1 – 2', 'slight — very sensitive crops affected', 'marginal'),
        b(4, '2 – 4', 'moderate — many crops restricted', 'high'),
        b(8, '4 – 8', 'severe — only tolerant crops', 'high'),
        b(TOP, 'Over 8', 'very severe', 'high'),
      ],
      footnote:
        'Beans and carrots are among the most sensitive; barley and beets among the most tolerant. A HIGH number is the bad news.',
    },
  },

  ec_ms_cm: {
    title: 'Electrical conductivity (mS/cm)',
    body: [
      'The measurement behind the soluble-salts figure — salinity read as how well the soil solution conducts electricity. The two columns are two views of the same thing and should tell the same story.',
    ],
    ranges: {
      label: 'Salinity',
      bands: [
        b(1, 'Under 1', 'unrestricted', 'ok'),
        b(2, '1 – 2', 'slight', 'marginal'),
        b(4, '2 – 4', 'moderate', 'high'),
        b(TOP, 'Over 4', 'severe', 'high'),
      ],
      footnote:
        'Climbing year on year on irrigated ground means drainage is not keeping up with what the water brings in.',
    },
  },

  cl_ppm: {
    title: 'Chloride (ppm)',
    body: [
      'A micronutrient with a modest but real effect in cereals, linked to suppression of some leaf diseases and more consistent yields, particularly in wheat.',
      'It is also a salt, so a very high reading contributes to the salinity picture rather than being purely a nutrient.',
    ],
    ranges: {
      label: 'Chloride',
      bands: [
        b(20, 'Under 20 ppm', 'a cereal response is possible', 'low'),
        b(40, '20 – 40', 'marginal', 'marginal'),
        b(TOP, 'Over 40', 'adequate', 'ok'),
      ],
      footnote: 'Supplied incidentally by potash (0-0-60), which is about half chloride by weight.',
    },
  },

  p_sat_pct: {
    title: 'Phosphorus saturation (%)',
    body: [
      'How full the soil phosphorus-holding capacity is. It is an environmental measure more than an agronomic one: a near-saturated soil releases phosphorus to runoff.',
      'A field can be adequate for the crop and still climb here after years of manure or high phosphorus rates.',
    ],
    ranges: {
      label: 'Phosphorus saturation',
      bands: [
        b(10, 'Under 10%', 'low risk of loss', 'ok'),
        b(25, '10 – 25%', 'moderate', 'marginal'),
        b(TOP, 'Over 25%', 'elevated — review rates and placement near water', 'high'),
      ],
    },
  },

  al_ppm: {
    title: 'Aluminium (ppm)',
    body: [
      'Aluminium becomes soluble and toxic to roots only in acid soils, below about pH 5.5. Above pH 7 it stays locked in mineral form and is not plant-available at all.',
      'Every field here is alkaline, so this column is background information rather than something to act on.',
    ],
    how: {
      label: 'How to read it',
      lines: [
        'On alkaline soil: not a concern at any figure shown here.',
        'It matters only if a field pH were to fall below about 5.5, at which point the saturation column beside it is the one to read.',
      ],
    },
  },

  al_sat_pct: {
    title: 'Aluminium saturation (%)',
    body: [
      'The share of exchange sites held by aluminium — the measure that actually predicts root damage on acid soils.',
      'Zero on these fields, and expected to be, because the soil is alkaline.',
    ],
    ranges: {
      label: 'Aluminium saturation',
      bands: [
        b(5, 'Under 5%', 'no effect', 'ok'),
        b(20, '5 – 20%', 'root growth restricted on sensitive crops', 'marginal'),
        b(TOP, 'Over 20%', 'severe — but only reachable on strongly acid soil', 'low'),
      ],
    },
  },

  k_mg_ratio: {
    title: 'K:Mg ratio',
    body: [
      'Potassium measured against magnesium. The two compete for uptake, so a soil can hold adequate potassium and still deliver it poorly if magnesium dominates the exchange sites.',
      'A guide rather than a rule — the individual levels matter more, and the ratio is most useful when one of them is already marginal.',
    ],
    ranges: {
      label: 'Potassium against magnesium',
      bands: [
        b(0.1, 'Under 0.1', 'magnesium-dominated; potassium uptake may be restricted', 'low'),
        b(0.5, '0.1 – 0.5', 'the usual range, with 0.2 – 0.3 a common target', 'ok'),
        b(TOP, 'Over 0.5', 'potassium-dominated, and unusual', 'high'),
      ],
    },
  },

  enr: {
    title: 'Estimated nitrogen release (lb/ac)',
    body: [
      'The lab estimate of how much nitrogen the organic matter will mineralise over a season — nitrogen the crop gets from the soil itself.',
      'It assumes a normal season. A cold spring or a dry summer slows mineralisation and delivers less than the figure suggests.',
    ],
    how: {
      label: 'How to read it',
      lines: [
        'It scales with organic matter: more organic matter, more release.',
        'Treat it as context for the nitrate figures rather than a credit to subtract pound for pound — the timing is not guaranteed to match when the crop needs it.',
      ],
    },
  },

  gfi: {
    title: 'GFI',
    body: [
      'A lab-specific index reported on these sheets. It reads zero on every sample we hold, so nothing can be inferred from it here.',
      'Recorded for completeness rather than interpreted. If the lab starts returning values, ask what it represents before reading anything into it.',
    ],
  },
}

/** The columns shown in the samples table, in order. */
export const SOIL_COLUMNS: { key: string; label: string; unit?: string }[] = [
  { key: 'sample', label: 'Sample' },
  { key: 'depth', label: 'Depth', unit: 'in' },
  { key: 'om_pct', label: 'OM', unit: '%' },
  { key: 'no3n_ppm', label: 'NO₃-N', unit: 'ppm' },
  { key: 'no3n_lb_ac', label: 'NO₃-N', unit: 'lb/ac' },
  { key: 'p_bicarb_ppm', label: 'P Bicarb', unit: 'ppm' },
  { key: 'p_melich3_ppm', label: 'P Mel-III', unit: 'ppm' },
  { key: 'k_ppm', label: 'K', unit: 'ppm' },
  { key: 'so4s_ppm', label: 'SO₄-S', unit: 'ppm' },
  { key: 'ph', label: 'pH' },
  { key: 'cec_meq', label: 'CEC', unit: 'meq/100g' },
  { key: 'base_k_pct', label: '%K' },
  { key: 'base_mg_pct', label: '%Mg' },
  { key: 'base_ca_pct', label: '%Ca' },
  { key: 'base_h_pct', label: '%H' },
  { key: 'base_na_pct', label: '%Na' },
]

/** The second panel — topsoil only, and only where the lab reported it. */
export const SOIL_MICRO_COLUMNS: { key: string; label: string; unit?: string }[] = [
  { key: 'ca_ppm', label: 'Ca', unit: 'ppm' },
  { key: 'mg_ppm', label: 'Mg', unit: 'ppm' },
  { key: 'na_ppm', label: 'Na', unit: 'ppm' },
  { key: 'zn_ppm', label: 'Zn', unit: 'ppm' },
  { key: 'mn_ppm', label: 'Mn', unit: 'ppm' },
  { key: 'fe_ppm', label: 'Fe', unit: 'ppm' },
  { key: 'cu_ppm', label: 'Cu', unit: 'ppm' },
  { key: 'b_ppm', label: 'B', unit: 'ppm' },
  { key: 'soluble_salts', label: 'Sol. salts', unit: 'mS/cm' },
  { key: 'ec_ms_cm', label: 'EC', unit: 'mS/cm' },
  { key: 'cl_ppm', label: 'Cl', unit: 'ppm' },
  { key: 'p_sat_pct', label: 'P sat', unit: '%' },
  { key: 'al_ppm', label: 'Al', unit: 'ppm' },
  { key: 'al_sat_pct', label: 'Al sat', unit: '%' },
  { key: 'k_mg_ratio', label: 'K:Mg' },
  { key: 'enr', label: 'ENR', unit: 'lb/ac' },
  { key: 'gfi', label: 'GFI' },
]

/**
 * Which columns the table colours. Deliberately narrower than the set that has
 * bands: pH, CEC, %Ca and the aluminium columns have bands worth reading in the
 * popover but are context rather than good or bad, and colouring them would
 * flag a normal alkaline soil as a problem on every row.
 */
const COLOURED = new Set([
  'om_pct', 'p_bicarb_ppm', 'p_melich3_ppm', 'k_ppm', 'so4s_ppm', 'base_na_pct',
  'zn_ppm', 'mn_ppm', 'fe_ppm', 'cu_ppm', 'b_ppm', 'soluble_salts', 'ec_ms_cm',
])

/**
 * Columns whose bands describe the 0-24 inch PROFILE, not a single core.
 *
 * Nitrate and sulphate move with water, so their thresholds are written against
 * the total down the profile. Colouring a per-core cell against them says a
 * topsoil core holding 9 lb/ac is "very low" when the field total may be a
 * perfectly adequate 40 — the number is right and the verdict is wrong. These
 * are rated on the summary line at the top of each report instead, where the
 * figure being judged is the one the band was written for.
 */
export const PROFILE_RATED = new Set(['no3n_lb_ac'])

/** Rating for a whole-profile figure, used by the report summary. */
export function rateProfileValue(key: string, value: number | null | undefined) {
  if (!PROFILE_RATED.has(key)) return null
  return bandFor(SOIL_HELP[key], value)?.rating ?? null
}

/**
 * Rating for one core of a nutrient whose bands describe the whole profile.
 *
 * The bands are written for 0–24 inches, so a single layer is judged against
 * its share of that depth: a 6-inch layer carries a quarter of the profile, so
 * a quarter of each threshold. It answers "is this layer pulling its weight",
 * which is the only question a single core can answer against a profile scale.
 *
 * Only lb/ac works this way. A concentration in ppm does not scale with depth
 * and must not be summed or prorated across layers — the same ppm means far
 * more nitrogen over 18 inches than over 6.
 */
export function rateDepthScaled(
  key: string,
  value: number | null | undefined,
  depthTopIn: number | null,
  depthBottomIn: number | null,
) {
  if (!PROFILE_RATED.has(key)) return null
  const help = SOIL_HELP[key]
  if (!help?.ranges || value == null || depthTopIn == null || depthBottomIn == null) return null
  const share = (depthBottomIn - depthTopIn) / 24
  if (!(share > 0)) return null
  return help.ranges.bands.find((band) => value <= band.max * share)?.rating ?? null
}

/**
 * Rating for the table's colour coding, read from the same bands the popover
 * shows — so a cell's colour and the highlighted range always agree.
 */
export function rateValue(key: string, value: number | null | undefined) {
  if (!COLOURED.has(key)) return null
  return bandFor(SOIL_HELP[key], value)?.rating ?? null
}

export { bandFor }
