/**
 * What a load of cattle arriving is carrying, as far as the Canadian work goes.
 *
 * Bovine respiratory disease is the leading cause of sickness and death in
 * North American feedlots, and the risk is concentrated in the first two weeks
 * after a load lands. This module puts a note on an arrival from what the
 * manifest already knows, and it is deliberately not a score out of ten: none
 * of the Canadian papers published a scoring function, so inventing one would
 * be dressing a guess in their numbers.
 *
 * What the papers do give, and what is used here:
 *
 * - The risk factors themselves. Andres-Lasheras et al. 2021, "Prevalence and
 *   Risk Factors Associated With Antimicrobial Resistance in Bacteria Related
 *   to Bovine Respiratory Disease", swabbed 2,824 head at entry into feedlots
 *   in southern and central Alberta over 19 months. It records the facts the
 *   feedlots' own risk algorithms are built from, and names them: age class,
 *   body weight, source, commingling before arrival, weather, transport
 *   distance, and a visual health assessment. That list is the backbone of
 *   this note — it is a feedlot's own checklist, written down by researchers,
 *   not a model fitted to an outcome.
 *
 * - Source matters, and not in the obvious direction. In that study, beef-type
 *   cattle from backgrounding operations had HIGHER odds of carrying
 *   antimicrobial-resistant bacteria than auction-derived calves. More than
 *   two thirds of the beef cattle sampled (67.7 %) came through an auction
 *   market. Oxytetracycline resistance was the most common across every
 *   Pasteurellaceae species, and Mycoplasma bovis showed high macrolide
 *   minimum inhibitory concentrations in both cattle types.
 *
 * - Resistance is mostly not there on arrival; it arrives later. The same
 *   paper notes that studies sampling at arrival, before any antimicrobial,
 *   found Mannheimia haemolytica and Pasteurella multocida susceptible to the
 *   fluoroquinolones, macrolides, beta-lactams and cephalosporins — so
 *   resistance rises after placement. Abi Younes et al. 2024 watched it
 *   happen: 1,599 mixed-origin western Canadian steer calves in 16 pens,
 *   swabbed at 1 day on feed, 13 days on feed and some at 36. Susceptibility
 *   was high at the start and resistance climbed from day 1 to day 13,
 *   especially for the tetracyclines and the macrolides.
 *
 * - The window. Donbraye et al. 2026 sampled 380 western Canadian feedlot
 *   calves on arrival and again at 14 days on feed. In fall-placed calves the
 *   prevalence of bovine herpesvirus 1, parainfluenza 3, respiratory syncytial
 *   virus and influenza D were all higher at 14 days than on arrival, and
 *   Mannheimia haemolytica detection rose too. Fourteen days is the window
 *   this note counts, and the tildipirosin label says the same: the first 14
 *   days in the feedlot.
 *
 * - How many loads are high risk anyway. Abi Younes et al. 2024 cite an
 *   estimated 39 % of calves entering western Canadian feedlots as high risk
 *   for BRD despite preconditioning, vaccination at arrival and reduced
 *   stress — which is the honest frame for any note like this one.
 *
 * What is NOT here: a metaphylaxis recommendation. The southern Alberta trial
 * the library holds (Van Donkersgoed and Merrill 2013, 25,000-head commercial
 * feedlot, fall-placed steers) found tildipirosin gave significantly lower
 * first-pull BRD treatment rates than tilmicosin (P < 0.01), with no
 * difference in relapse, overall mortality, or BRD and histophilosis
 * mortality, and tilmicosin still came out $6.85/head ahead on drug price at
 * the time. That is a feedlot finishing trial and a drug-price comparison from
 * 2013; it is quoted on the screen as context, and what to give is the vet's
 * call and a prescription.
 */

/** Where the load came from, in the categories the Alberta entry study used. */
export type SourceKind = 'ranch_direct' | 'auction' | 'backgrounding' | 'own_ranch'

export const SOURCE_OPTIONS: { value: SourceKind; label: string; detail: string }[] = [
  { value: 'ranch_direct', label: 'Ranch direct', detail: 'Straight from the farm of birth, at weaning or after a feeding period.' },
  { value: 'auction', label: 'Auction market', detail: 'Through a sale ring. Two thirds of the beef cattle in the Alberta entry study came this way.' },
  { value: 'backgrounding', label: 'Backgrounding operation', detail: 'From a backgrounding feedlot, on a forage diet since weaning.' },
  { value: 'own_ranch', label: 'Our own ranch', detail: 'A move between our own places.' },
]

export const SOURCE_LABEL = Object.fromEntries(SOURCE_OPTIONS.map((s) => [s.value, s.label])) as Record<SourceKind, string>

/** The window the Canadian work measures the rise over, in days on feed. */
export const BRD_WINDOW_DAYS = 14
/** Share of calves entering western Canadian feedlots rated high risk for BRD. */
export const HIGH_RISK_SHARE_PCT = 39
/** Share of beef cattle in the Alberta entry study that came through an auction. */
export const AUCTION_SHARE_PCT = 67.7

export type ArrivalInput = {
  /** Date the load landed, ISO. */
  movedOn: string | null
  sourceKind: SourceKind | null
  commingled: boolean | null
  transportKm: number | null
  restStopH: number | null
  /** Head and average weight, summed off the manifest's lines. */
  head: number
  avgWeightLb: number | null
  /** Classes named on the lines, for the age-class factor. */
  classes: string[]
  /** The weather on the day, if a station reported it. */
  weather: { tmaxC: number | null; tminC: number | null; precipMm: number | null; windMs: number | null } | null
}

export type RiskFactor = {
  key: string
  label: string
  /** What this load's own record says. */
  value: string
  /** Present, absent, or not recorded. Never a weight. */
  state: 'raises' | 'neutral' | 'unknown'
  /** The Canadian finding behind it. */
  says: string
}

export type ArrivalRisk = {
  factors: RiskFactor[]
  /** How many of the seven the papers name were raised, and how many recorded. */
  raised: number
  recorded: number
  /** Days since the load landed, and whether the 14-day window is still open. */
  daysOn: number | null
  windowOpen: boolean
  /** One line for the top of the card. */
  headline: string
}

/** Is this class of cattle a calf, in the study's two age classes? */
export const isCalfClass = (name: string) => /calf|calves|steer calf|heifer calf|weanl/i.test(name)
const isYearlingClass = (name: string) => /yearling|backgroun/i.test(name)

const daysBetween = (iso: string, now: Date) =>
  Math.floor((now.getTime() - new Date(`${iso}T12:00:00Z`).getTime()) / 86_400_000)

/**
 * The risk note for one arrival.
 *
 * Each factor comes back as raised, neutral or not recorded, with the finding
 * that puts it there. The counts at the end are counts of factors, not a
 * score: the papers give no weights, so adding them up would be arithmetic the
 * research does not support.
 */
export function arrivalRisk(a: ArrivalInput, now = new Date()): ArrivalRisk {
  const factors: RiskFactor[] = []

  // 1. Source.
  if (a.sourceKind == null) {
    factors.push({
      key: 'source',
      label: 'Source',
      value: 'Not recorded',
      state: 'unknown',
      says: 'Source is one of the seven facts the Alberta entry study names. Without it the rest of this note is thinner.',
    })
  } else if (a.sourceKind === 'backgrounding') {
    factors.push({
      key: 'source',
      label: 'Source',
      value: SOURCE_LABEL[a.sourceKind],
      state: 'raises',
      says: 'In the Alberta entry study, beef-type cattle from backgrounding operations had higher odds of carrying antimicrobial-resistant bacteria than auction-derived calves — the opposite of what most people expect.',
    })
  } else if (a.sourceKind === 'auction') {
    factors.push({
      key: 'source',
      label: 'Source',
      value: SOURCE_LABEL[a.sourceKind],
      state: 'raises',
      says: `Through a sale ring: ${AUCTION_SHARE_PCT} per cent of the beef cattle in the Alberta entry study came this way, and their earlier history was unknown even to the researchers. Canadian work has looked at auction placement and a rest stop in transit against the respiratory bacterial microbiota; the library holds that paper as a citation only, so no effect size is quoted here.`,
    })
  } else {
    factors.push({
      key: 'source',
      label: 'Source',
      value: SOURCE_LABEL[a.sourceKind],
      state: 'neutral',
      says:
        a.sourceKind === 'own_ranch'
          ? 'A move between our own places: no new cattle, and no unknown history.'
          : 'Straight from the farm of birth. The study defined ranch-direct cattle as arriving from the birth farm immediately after weaning or after a feeding period.',
    })
  }

  // 2. Commingling.
  factors.push(
    a.commingled == null
      ? {
          key: 'commingled',
          label: 'Mixed with other cattle first',
          value: 'Not recorded',
          state: 'unknown',
          says: 'Commingling before arrival is on the study’s list of what a feedlot’s own risk call is built from.',
        }
      : a.commingled
        ? {
            key: 'commingled',
            label: 'Mixed with other cattle first',
            value: 'Yes',
            state: 'raises',
            says: 'Commingling before arrival is on the study’s list of risk factors.',
          }
        : {
            key: 'commingled',
            label: 'Mixed with other cattle first',
            value: 'No',
            state: 'neutral',
            says: 'No commingling before arrival.',
          },
  )

  // 3. Transport distance.
  factors.push(
    a.transportKm == null
      ? {
          key: 'transport',
          label: 'Distance hauled',
          value: 'Not recorded',
          state: 'unknown',
          says: 'Transport distance is on the study’s list. It published no distance threshold, so this screen reports the distance rather than grading it.',
        }
      : {
          key: 'transport',
          label: 'Distance hauled',
          value: `${Math.round(a.transportKm)} km`,
          // No threshold was published, so distance is never called "raises"
          // on its own — it is reported beside the rest.
          state: 'neutral',
          says: 'Transport distance is on the study’s list of risk factors. No threshold was published with it, so the distance is reported and not graded.',
        },
  )

  // 4. Rest stop.
  if (a.restStopH != null)
    factors.push({
      key: 'rest',
      label: 'Rested in transit',
      value: `${a.restStopH} h`,
      state: 'neutral',
      says: 'Canadian work has examined whether a rest stop during transport changes the respiratory bacterial microbiota. The library holds that paper as a citation with no extracted text, so the hours are recorded here and no effect is claimed.',
    })

  // 5. Age class.
  const calves = a.classes.filter(isCalfClass)
  const yearlings = a.classes.filter(isYearlingClass)
  factors.push(
    a.classes.length === 0
      ? { key: 'age', label: 'Age class', value: 'No lines on the manifest', state: 'unknown', says: 'Age class is on the study’s list.' }
      : calves.length > 0
        ? {
            key: 'age',
            label: 'Age class',
            value: calves.join(', '),
            state: 'raises',
            says: 'Calves, not yearlings. In the 2026 western Canadian sampling, fall-placed calves were the group whose virus prevalences climbed most between arrival and 14 days on feed — respiratory syncytial virus from 8.5 to 26 per cent, parainfluenza 3 from 4.2 to 12 per cent, influenza D from 17 to 51 per cent.',
          }
        : {
            key: 'age',
            label: 'Age class',
            value: (yearlings.length ? yearlings : a.classes).join(', '),
            state: 'neutral',
            says: 'In the 2026 sampling, yearlings arrived carrying more respiratory syncytial virus and parainfluenza 3 than fall-placed calves did, but their prevalences moved less over the first 14 days.',
          },
  )

  // 6. Weight.
  factors.push(
    a.avgWeightLb == null
      ? { key: 'weight', label: 'Average weight', value: 'Not on the lines', state: 'unknown', says: 'Body weight is on the study’s list. It published no weight threshold.' }
      : {
          key: 'weight',
          label: 'Average weight',
          value: `${Math.round(a.avgWeightLb)} lb`,
          state: 'neutral',
          says: 'Body weight is on the study’s list of what a feedlot’s risk call is built from. No threshold was published with it, so the weight is reported and not graded.',
        },
  )

  // 7. Weather on the day.
  factors.push(
    a.weather == null
      ? {
          key: 'weather',
          label: 'Weather that day',
          value: 'No station reading',
          state: 'unknown',
          says: 'The study recorded temperature, precipitation and estimated wind speed at arrival. The app reads the nearest station’s daily record; there is none for this date.',
        }
      : {
          key: 'weather',
          label: 'Weather that day',
          value: [
            a.weather.tmaxC != null && a.weather.tminC != null
              ? `${Math.round(a.weather.tminC)} to ${Math.round(a.weather.tmaxC)} °C`
              : null,
            a.weather.precipMm != null && a.weather.precipMm > 0 ? `${a.weather.precipMm.toFixed(1)} mm` : null,
            a.weather.windMs != null ? `wind ${Math.round(a.weather.windMs * 3.6)} km/h` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          state: 'neutral',
          says: 'The three weather variables the Alberta entry study recorded at arrival: temperature, precipitation and wind. It published no cut-offs for them, so they are shown rather than graded.',
        },
  )

  const daysOn = a.movedOn ? daysBetween(a.movedOn, now) : null
  const windowOpen = daysOn != null && daysOn >= 0 && daysOn <= BRD_WINDOW_DAYS
  const raised = factors.filter((f) => f.state === 'raises').length
  const recorded = factors.filter((f) => f.state !== 'unknown').length

  const headline = windowOpen
    ? `Day ${daysOn} of the ${BRD_WINDOW_DAYS}-day window the Canadian work measures the rise over.`
    : daysOn != null && daysOn > BRD_WINDOW_DAYS
      ? `${daysOn} days on feed — past the ${BRD_WINDOW_DAYS}-day window.`
      : daysOn != null && daysOn < 0
        ? 'Not arrived yet.'
        : 'No arrival date on the manifest.'

  return { factors, raised, recorded, daysOn, windowOpen, headline }
}

/**
 * What the papers support doing in the window, as distinct from what a drug
 * label says. Pen-side, and none of it a prescription.
 */
export const WINDOW_ACTIONS = [
  'Ride these pens hard for 14 days. The 2026 western Canadian sampling found virus and Mannheimia haemolytica prevalence higher at 14 days on feed than on arrival — the pathogens are mostly picked up here, not brought in.',
  'The signs the Alberta entry study had its pen riders call BRD on: gauntness, inactivity, depression, a rectal temperature typically over 40 °C, ocular or nasal discharge, cough, or a raised respiration rate.',
  'If anything is pulled and cultured, know that resistance climbs over these same two weeks. The 2024 pen-level work saw susceptibility high at 1 day on feed and resistance up by day 13, worst for the tetracyclines and the macrolides — so a susceptibility result from day 1 does not describe day 13.',
  'Oxytetracycline resistance was the most frequent finding across every Pasteurellaceae species at feedlot entry in the Alberta study, and Mycoplasma bovis showed high macrolide minimum inhibitory concentrations in both beef and dairy cattle.',
]

export const BRD_SOURCES = {
  entry: {
    paper: 'Prevalence and Risk Factors Associated With Antimicrobial Resistance in Bacteria Related to Bovine Respiratory Disease—A Broad Cross-Sectional Study of Beef Cattle at Entry Into Canadian Feedlots',
    year: 2021,
    what: 'The risk-factor list this note is built from, and the finding that backgrounding sources carried more resistance than auction calves. 2,824 head, southern and central Alberta.',
  },
  firstTwoWeeks: {
    paper: 'Prevalences of respiratory viruses and bacteria in Western Canadian commercial feedlot calves detected using a single metagenomic sequencing protocol vary during the first two weeks of arrival and by age group',
    year: 2026,
    what: 'The 14-day window and the arrival-versus-day-14 prevalences, by age group. 380 calves and yearlings.',
  },
  penLevel: {
    paper: 'Variation in Pen-Level Prevalence of BRD Bacterial Pathogens and Antimicrobial Resistance Following Feedlot Arrival in Beef Calves',
    year: 2024,
    what: 'Resistance climbing from day 1 to day 13 on feed, and the 39 per cent high-risk figure. 1,599 western Canadian steer calves.',
  },
  metaphylaxis: {
    paper: 'Efficacy of tilmicosin and tildipirosin for on-arrival treatment of bovine respiratory disease in fall-placed feedlot calves in western Canada',
    year: 2013,
    what: 'The southern Alberta on-arrival trial quoted as context. A 25,000-head commercial feedlot, fall-placed steers.',
  },
  restStop: {
    paper: 'Auction market placement and a rest stop during transportation affect the respiratory bacterial microbiota of beef cattle',
    year: 2023,
    what: 'The auction and rest-stop question. The library holds it as a citation only — no text was extracted, so no effect size is quoted anywhere here.',
  },
  economics: {
    paper: 'Economic impact of digital dermatitis, foot rot, and bovine respiratory disease in feedlot cattle',
    year: 2021,
    what: 'What the three cost a feedlot. Held as a citation only, so no dollar figure is quoted.',
  },
} as const
