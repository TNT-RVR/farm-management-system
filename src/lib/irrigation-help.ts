/**
 * Setup-tab column help (spec §6.4, §10).
 *
 * Editable copy, kept beside AIMM_CALIBRATION for the same reason: what a
 * column means and how to work it out is farm knowledge, not engine code, and
 * should be correctable without touching the balance.
 *
 * `how` is the part that matters at a kitchen table in April — where the number
 * comes from, or how to measure it — not a restatement of the definition.
 */
export type { ColumnHelp } from './column-help'
import type { ColumnHelp } from './column-help'

export const SETUP_HELP: Record<string, ColumnHelp> = {
  field: {
    title: 'Field',
    body: [
      'Every active field on the farm. A field is scheduled by the balance only once it has a planting date and a crop — until then it is listed here but carries no recommendation.',
    ],
  },

  station: {
    title: 'Station',
    body: [
      'The weather station whose readings drive this field’s reference ET (ET₀) — the evaporative demand the whole calculation starts from.',
      'Assigned automatically to the nearest station. It matters more than it looks: a station on the wrong side of a coulee can be several degrees and a good deal of wind off what the crop is actually sitting in.',
    ],
    how: {
      label: 'How it is set',
      lines: [
        'Auto-assigned by straight-line distance from the field centroid.',
        'Nothing to enter. If a field is clearly better represented by a different station, change the field’s station on the field record and it will follow.',
      ],
    },
  },

  cropPlan: {
    title: 'Crop (Plan)',
    body: [
      'What is actually seeded on the field this year, read straight from Plan → Crop Plan. It is shown here, not edited here — this column is a mirror so you can see at a glance that irrigation is scheduling the crop you think it is.',
      'This is the agronomic fact. The next column is the maths that follows from it.',
    ],
    how: {
      label: 'Where it comes from',
      lines: [
        'Plan → Crop Plan, for the crop year selected at the top of the page.',
        'Blank means no plan row exists for this field and year. The field will not be scheduled until one does.',
      ],
    },
  },

  coefficient: {
    title: 'Coefficient (Kc curve)',
    body: [
      'The crop-coefficient curve — the number the model multiplies reference ET by to get what THIS crop is using today. Grass reference ET (ET₀) says how thirsty the weather is; Kc says how much of that a given crop, at a given growth stage, actually draws. ETc = ET₀ × Kc.',
      'It is a curve, not one number. Kc starts low on bare ground after seeding (roughly 0.3 — mostly soil evaporation), climbs as the canopy closes, sits near its peak through mid-season (around 1.15 for a full canopy), then drops off as the crop matures and dries down.',
      'Leave it on Auto. Auto reads the crop from the Plan column and picks that crop’s curve, so seeding a field to barley instead of canola changes the water use without anyone remembering to come here.',
      'Override only when the generic curve is wrong for what is standing — a short-season variety that closes canopy and matures well ahead of the book curve, silage cut green rather than taken to grain, or a cover crop the standard curve does not describe.',
    ],
    how: {
      label: 'Crop (Plan) vs Coefficient',
      lines: [
        'Crop (Plan) = what is in the ground. Set in Crop Plan.',
        'Coefficient = which water-use curve the math runs. Normally derived from the crop automatically.',
        'They differ only when you deliberately override. "Auto — (crop unmapped)" means the planned crop has no curve mapped yet: pick the closest curve, or the field will not schedule.',
      ],
    },
  },

  planted: {
    title: 'Planted (planting date)',
    body: [
      'The single most load-bearing number on this tab. It is day zero of the growth-stage clock: every Kc stage boundary, and therefore the entire season’s water use, is counted forward from this date.',
      'A date a week out shifts the whole curve a week, which typically moves peak-season ETc by a few tenths of a millimetre a day — small daily, meaningful by August.',
      'Use the date the drill actually went in the ground, not the date you intended to seed and not emergence.',
    ],
    how: {
      label: 'Where it comes from',
      lines: [
        'Filled automatically from the John Deere seeding pass for that field and crop year — the earliest seeding operation Operations Center reports, converted to farm-local time.',
        'A field seeded over two days takes the first day.',
        'Type over it any time. A date you type is marked manual and the Deere sync will never overwrite it — clear the box to hand control back to Deere.',
      ],
    },
  },

  pivotCap: {
    title: 'Pivot cap (mm/day)',
    body: [
      'System capacity: the most water, in millimetres of depth, this pivot can physically put on the field in a day if it ran flat out for 24 hours. It is a ceiling, not a plan.',
      'The balance uses it to tell you when you are beaten — when the crop is using more per day than the machine can deliver, no rotation speed fixes it, and the field will draw down no matter what you do. That is the warning worth having in July, because the only real answer was to have started sooner.',
      'It is a gross figure: what leaves the pivot, before the Efficiency column takes its cut.',
    ],
    how: {
      label: 'Where it comes from',
      lines: [
        'Worked out for you. Leave the box blank and it is calculated from the pivot’s flow rate and irrigated acres in Pivot Information (General Info → Pivot Information) — the greyed number is what the balance is using.',
        'The arithmetic, if you want to check it: mm/day = US gpm × 1.347 ÷ acres, or L/s × 8.64 ÷ hectares. An 800 gpm pivot on 130 acres → 8.3 mm/day.',
        'It divides by the pivot’s irrigated acres, not the field’s total — a quarter-section pivot covers about 130 of its 160 acres.',
        '"no pivot data" means the flow rate or irrigated acres is missing from the pivot record; fill that in and this fills itself. Until then the balance falls back to 8 mm/day.',
        'Type a number only to override — to knock it back about 10% for the hours a pivot is not turning, say. Clear the box to hand it back to the pivot record.',
      ],
    },
  },

  efficiency: {
    title: 'Application efficiency (Ea)',
    body: [
      'The share of water leaving the pivot that actually ends up stored in the root zone where the crop can use it. Everything else goes to wind drift, evaporation off the droplets and the canopy, runoff down the wheel tracks, and percolation below the roots.',
      'The balance uses it to turn gross applied into net applied:   net mm = gross mm × Ea.',
      'Enter it as a decimal fraction, not a percent — 0.85, not 85.',
    ],
    how: {
      label: 'Typical values by system',
      lines: [
        'LEPA / LESA, drops near the ground:   0.90 – 0.95',
        'Pivot with drop tubes and low-pressure sprinklers:   0.85   (the default)',
        'Pivot with impact sprinklers on top of the pipe:   0.75 – 0.80',
        'Wheel line / side roll:   0.65 – 0.75',
        'Gravity / flood:   0.40 – 0.60',
        'To measure it rather than look it up: set catch cans in a line out along the span, run a pass, and compare the average depth caught against the depth the panel says it applied. Do it once on a calm day and once on a windy one — the gap between those two is most of what this number is.',
      ],
    },
  },

  kcMode: {
    title: 'Water-use method (Kc mode: single vs dual)',
    body: [
      'How the model splits crop water use. Single uses one blended coefficient per growth stage that already has an average amount of soil evaporation baked into it. Dual separates the plant’s own transpiration from a soil-evaporation term that spikes for a few days whenever rain or irrigation wets bare ground, then dries back down.',
      'Single is the method AIMM itself uses, and it is the right default for pivot-irrigated broadacre crops.',
      'Dual is sharper early in the season, under frequent light applications, and on drip or partial-wetting systems — but it needs a wetting fraction and a surface-moisture layer set up before it means anything.',
    ],
    how: {
      label: 'What to pick',
      lines: [
        'Leave every field on "farm default", and leave the farm on Single.',
        'Set a field to Dual only when you specifically want tighter early-season numbers on ground that gets wetted often while the canopy is still open.',
      ],
    },
  },

  soil: {
    title: 'Soil texture',
    body: [
      'The texture class of the field’s root zone. It is how the model knows how much water this particular ground can hold — sand holds little and gives it up easily, clay holds a great deal and clings to it.',
      'Texture sets the FC and WP figures in the next column whenever no lab numbers have been entered, so for most fields this dropdown IS the water-holding capacity.',
      'Defaults to loam. Loam is a fair guess for much of the irrigated ground here, but a field that is genuinely sandy will be over-watered on a loam assumption, and a heavy clay field under-watered.',
    ],
    how: {
      label: 'How to tell which you have',
      lines: [
        'Use the ribbon test in the texture guide — the two-minute field method, done with a handful of moist soil and no equipment.',
        'Colour will not tell you texture. Dark and light soil can be the same class; colour mostly reflects organic matter and how wet it is.',
        'If you have a lab soil test, it states the texture class outright — use that and skip the guessing.',
      ],
    },
  },

  fcwp: {
    title: 'Lab water holding (field capacity / wilting point, FC / WP)',
    body: [
      'The two ends of the tank. Both are volumetric water contents — cubic metres of water per cubic metre of soil — entered as decimal fractions.',
      'Field Capacity (FC) is what the soil still holds two or three days after a heavy rain, once gravity has pulled out what it can. It is the full mark; water above it drains past the roots and is gone.',
      'Wilting Point (WP) is water held so tightly to the soil particles that the crop cannot pull it out. It is the empty mark — there is still water down there, but none the plant can have.',
      'What the crop can actually use is the gap between them. FC − WP, times the rooting depth, is Total Available Water; the allowable-depletion fraction of that is the Readily Available Water the scheduler tries to stay above.',
      'Worked example on loam: FC 0.29 − WP 0.13 = 0.16. Over a 1.0 m root zone that is 160 mm of available water, and at 50% allowable depletion about 80 mm of working room before the crop is under stress.',
    ],
    how: {
      label: 'What to enter',
      lines: [
        'Leave both blank for nearly every field. Blank means "derive it from the soil texture", and the greyed-out number shown is the value being used.',
        'Fill them in only from a lab soil test. Tests report these as field capacity and permanent wilting point, sometimes as "available water holding capacity" — which is FC − WP already subtracted, so do not enter that in either box.',
        'Enter fractions, not percentages: a test reporting 29% by volume goes in as 0.29.',
        'Entering one overrides the texture for that field, so enter both or neither.',
      ],
    },
  },

  done: {
    title: 'Done watering for the year',
    body: [
      'Tells the scheduler the season is over on this field. The moisture balance keeps running — it still shows what the soil is doing — but no irrigation to-do is raised and any standing one is retired the moment you tick it.',
      'It exists because the model cannot know the pivot has been shut off and drained. Left to itself it goes on crossing the trigger and asking for water on a field that finished a fortnight ago, and by late August most of the farm is in that state at once.',
      'That is the real cost: alerts that are always wrong get read with the same eye as the ones that are not, and the field that genuinely does need water in September is the one that gets missed.',
    ],
    how: {
      label: 'When to tick it',
      lines: [
        'When the last pass is off and you do not intend to water this field again this year.',
        'Untick it if you change your mind — nothing is lost, and the next sync raises a to-do again if the balance calls for one.',
        'It clears itself for next season: this is recorded against this field for this crop year, and next year starts a new row.',
      ],
    },
  },
}

/**
 * Soil-profile (sample site) table. Separate from SETUP_HELP because these are
 * per-LAYER figures in millimetres, where the columns above are whole-field
 * fractions — the same two words, FC and WP, meaning different things a few
 * inches apart on the page. That is worth spelling out rather than leaving to
 * be discovered.
 */
export const SOIL_PROFILE_HELP: Record<string, ColumnHelp> = {
  layerDepth: {
    title: 'Layer depth (cm)',
    body: [
      'The bottom of this layer, measured down from the surface. A row at 30 describes the soil from the layer above it down to 30 cm.',
      'Layers exist because ground is not uniform — a sandy topsoil over a clay B horizon holds water very differently from either one alone, and the roots meet both.',
    ],
    how: {
      label: 'How to set them',
      lines: [
        'Follow the depths on the soil test or the AIMM sample-site sheet for that field, so the layers line up with where the samples were actually taken.',
        'With no test, 0–30, 30–60, 60–90 and 90–120 cm is the conventional split and matches how most labs report.',
        'Go at least as deep as the crop roots — the Max root zone setting above should not reach past your deepest layer.',
      ],
    },
  },

  layerSoil: {
    title: 'Soil type (this layer)',
    body: [
      'The texture of this layer specifically, which is often not the texture of the topsoil. Dig or auger down and test each layer separately — the change with depth is the whole reason for having layers.',
    ],
    how: {
      label: 'How to tell which you have',
      lines: [
        'Same ribbon test as the field soil column — run it on a sample from that depth, not from the surface.',
        'Texture here is a label for your reference. The numbers the balance actually uses are the two millimetre figures beside it, so change those if you change this.',
      ],
    },
  },

  layerFc: {
    title: 'Available water at FC (mm)',
    body: [
      'How many millimetres of water THIS layer holds when it is at field capacity — full, after gravity has drained it.',
      'Note the units: millimetres of water in this layer, not the volumetric fraction used in the Lab water holding (FC / WP) column of the field table above, under Advanced overrides. A 30 cm layer of loam at 0.29 volumetric holds about 87 mm.',
    ],
    how: {
      label: 'Where it comes from',
      lines: [
        'Straight off the AIMM sample-site sheet or a lab test that reports by layer.',
        'To convert a volumetric fraction: mm = fraction × layer thickness in mm. Loam at 0.29 over a 300 mm layer = 0.29 × 300 = 87 mm.',
        'The layers are summed to set the Field Capacity line on the Graph, so an error here moves that line directly.',
      ],
    },
  },

  layerWp: {
    title: 'Water at WP (mm)',
    body: [
      'Millimetres of water this layer still holds at wilting point — present, but held too tightly for the crop to take.',
      'The gap between this and the FC figure beside it is what the crop can actually draw from this layer.',
    ],
    how: {
      label: 'Where it comes from',
      lines: [
        'The same sample-site sheet or lab test as the FC figure.',
        'To convert: mm = volumetric fraction × layer thickness in mm. Loam at 0.13 over a 300 mm layer = 39 mm.',
        'Must be lower than the FC figure for the same layer. If it is not, the two have been swapped.',
      ],
    },
  },

  maxRootZone: {
    title: 'Max root zone (m)',
    body: [
      'How deep the crop’s roots reach at full development — the depth of soil the balance is allowed to count as storage.',
      'Set it too deep and the model credits the crop with water it cannot reach, so it will tell you to hold off when the field actually needs a pass.',
    ],
    how: {
      label: 'Typical depths',
      lines: [
        'Cereals (wheat, barley):  1.0 – 1.5 m',
        'Canola:  1.0 – 1.5 m',
        'Potatoes:  0.6 – 1.0 m — shallow, and the usual reason a field dries down faster than expected',
        'Alfalfa:  1.5 – 2.0 m or more',
        'Cap it at the real limit of the soil, not the crop: a gravel layer or a hardpan at 0.8 m ends the root zone there no matter what the crop would do.',
      ],
    },
  },

  allowableDepletion: {
    title: 'Allowable depletion (%)',
    body: [
      'How much of the available water you are willing to let the crop use up before you water. It is what turns the storage figures into an actual trigger — the Irrigation Threshold line on the Graph is drawn at this fraction.',
      'Enter it as a percent here (50), unlike the Efficiency column which takes a fraction.',
      'Set it low and you water little and often, which costs pumping and risks runoff. Set it high and you save passes but let the crop run closer to stress.',
    ],
    how: {
      label: 'What to pick',
      lines: [
        '50% is the standard default and right for most crops on a pivot.',
        'Drop to 35 – 40% through flowering and grain fill, when moisture stress costs the most yield, and on shallow-rooted crops like potatoes.',
        'Up to 60 – 65% is defensible late in the season once the crop is filling out and you are drying down for harvest.',
        'If the pivot cannot keep up at peak demand, lowering this will not help — it just asks for water the machine cannot deliver. That is a capacity problem, not a threshold one.',
      ],
    },
  },
}
