/**
 * The info buttons on the winter feeding screens: what each number is, where
 * it comes from, and how to find the right one for this ranch without a scale.
 * Every figure is from reports/Red Angus winter feeding calculations.md; the
 * ones marked "our proposal" have no published source and are ours to change.
 */
export type Help = { title: string; body: string[]; how?: string[]; source?: string }

export const FEED_HELP = {
  method: {
    title: 'How the feed is worked out',
    body: [
      'Feed is budgeted by energy, not bales. Each group has a daily need for energy (TDN, pounds) and protein (CP, pounds), from the NASEM 2016 beef tables for its class and stage.',
      'That need goes up for cold, mud and putting condition back on. The group’s ration — its feeds as shares of the dry matter — is then fed in the amount that meets the energy need, never more than the animal can eat.',
      'When the ration is too poor to meet the need at what they can eat, the gap is closed with grain, and the screen says how much.',
      'Last, dry matter is turned back into pounds as fed (÷ dry matter %) and grossed up for what is wasted at feeding.',
    ],
    source: 'NASEM 2016 via Arkansas MP391; K-State MF3684; BCRC; Alberta Agdex 420/52-3.',
  },
  weight: {
    title: 'Typical weight — without a scale',
    body: [
      'Weight sets both the need and how much an animal can eat. Being 100 lb off on a 1,400 lb cow moves her need about 5%.',
      'Mature Angus-type cows today run about 1,400 lb and have been getting about 100 lb heavier each decade. Mature bulls are commonly 1,800–2,200 lb.',
    ],
    how: [
      'Cows: average the sale-slip weights of your recent culls, divide by 0.96 (gut fill lost on the truck), then add about 14% for each condition score (1–5 scale) the culls were under 3.',
      'Cross-check with weaning weights: a 1,300 lb cow weans a 7-month steer of about 550 lb at average milk, a 1,400 lb cow about 570 lb.',
      'Calves and heifers: the steer mates’ sale weights, or weaning weight plus expected gain.',
      'A heart-girth tape on a few head: weight (lb) ≈ girth² × body length ÷ 300 (inches) — a cross-check only.',
    ],
    source: 'Angus Journal 2025; Arkansas MP391; BCRC body condition.',
  },
  bcs: {
    title: 'Body condition (1–5): how to score',
    body: [
      'Feel, don’t look — a winter coat hides a whole score. Run a flat hand over three places: the short ribs (the loin, between the last rib and the hip bone — press your fingertips on the ends), the backbone along the top, and around the tailhead and pin bones.',
      '1 — Emaciated: backbone sharp; each short rib a sharp edge with no cover; no fat at the tailhead, hips and pins stick out.',
      '2 — Thin: backbone easy to feel but not sharp; short-rib ends felt with light pressure, rounded; a little cover at the tailhead.',
      '3 — Moderate (the target): backbone felt only with firm pressure; short ribs felt only with firm pressure through a spongy layer; soft fat around the tailhead you can feel easily.',
      '4 — Fleshy: backbone and short ribs can’t be felt; fat pads either side of the tailhead; pins rounded.',
      '5 — Fat: no bone felt anywhere; tailhead buried in fat; patchy, bulging fat.',
      'Half scores are fine (2.5, 3.5). One score is about 14% of a cow’s weight — about 200 lb on a 1,400 lb cow. (US 1–9 = 2 × Canadian − 1.)',
      'Why it matters: pregnancy rate was 43% at 1.5 and 94% at 3.0, and condition put back on in winter costs 20–30% more than condition kept. It is also the check the feed log can’t make — if the log says enough and cows are slipping, a bale or bucket weight is wrong.',
    ],
    how: [
      'When: at preg-check in the fall, about 100 days before calving (mid-winter), at calving, and before breeding.',
      'How many: every cow through the chute takes seconds a head; otherwise feel 20 in each group at the bunk or in the alley.',
      'Enter the group’s average here. Sort anything 2.5 or under — and first-calf heifers — into a group fed apart; boss cows eat their share otherwise.',
      'Target 3.0 at calving (3.0–3.5 for first-calvers); below 2.5 is the Code of Practice line.',
    ],
    source: 'BCRC body condition tool; Alberta Agriculture; Code of Practice for beef cattle.',
  },
  yard: {
    title: 'Rations from the yard',
    body: [
      'Shares out what is counted in the yard between the groups so it lasts to turnout: every group’s energy is met at what it can eat, no feed is used past what you have (keeping the reserve if it can), straw stays under 1.25% of body weight and 60% of the ration, grain under 0.5% of body weight (1% for calves), and protein is met where it can be.',
      'Richer feed goes where it is needed: meeting a need with straw and green feed counts as cheaper than meeting it with alfalfa, so the alfalfa ends up with the calves, heifers and cows close to calving, and the plainer feed with dry cows and bulls — the extension rule, worked out rather than guessed.',
      'Waste counts: feed put out to be trampled is feed used. If the yard can’t carry the herd it says how much energy is missing and roughly how much barley would cover it.',
      '“Use these rations” writes each group’s shares; the daily amounts then follow the weather and the calving date. Work it out again after a new count, a sale, or a feed test.',
    ],
  },
  feedsHere: {
    title: 'Feeds used at this ranch',
    body: [
      'Ranches differ: one may feed no silage while another feeds mostly silage. A feed switched off here drops out of this ranch’s “Add a feed” list and goes to the bottom of the feed sheet’s list, marked “not usually fed here”.',
      'It isn’t forbidden: switch it back on, or tick “show feeds not used at this ranch” on a group, to use it this year.',
    ],
  },
  targetBcs: {
    title: 'Target condition',
    body: [
      '3.0 at calving for cows; 3.0–3.5 for first-calf heifers, which are still growing.',
      'When the group is below target, energy goes up by 18 × (scores to gain) ÷ (days left): 20% for 90 days or 30% for 60 days for one score, which is BCRC’s figure. Days left are to calving for bred females, to turnout for the rest.',
    ],
    source: 'BCRC body condition; the 18 × ÷ days fit is ours.',
  },
  gain: {
    title: 'Target gain (growing cattle)',
    body: [
      'Backgrounded calves: Alberta’s target is 1.25–1.5 lb a day. At 1.5 lb/day they need about 62% TDN; at 2.0 about 67%.',
      'Replacement heifer calves: need about 64% TDN at 1.5 lb a day.',
    ],
    how: [
      'Heifers: the gain needed = (60% of mature cow weight − weight now) ÷ days to breeding. For 1,400 lb cows that is 840 lb at breeding.',
      'Backgrounders: whatever your marketing plan needs by sale day; check a few with the sale-barn weight when they go.',
    ],
    source: 'Arkansas MP391 Tables 8–9; Alberta Agdex 420/52-3.',
  },
  calving: {
    title: 'Calving date',
    body: [
      'Sets where each cow is in her year. A cow’s need rises about 25% from mid-pregnancy to the month before calving, and jumps again when she is nursing.',
      'Pairs are the cows after this date: the calf at side starts eating the cows’ feed at a few weeks old (about 2 lb in its second month, 4 in its third, 6 after — our ramp to Alberta’s 6 lb average).',
    ],
    how: ['The date the bulls went in plus about 283 days, or the first calf of last season.'],
  },
  coat: {
    title: 'Hair coat and the cold',
    body: [
      'Below its “lower critical temperature” a cow burns feed to stay warm: about 1.8% more energy for every °C colder with a dry coat, 3.6% with a wet one. Protein needs don’t change.',
      'Lower critical temperature: wet or matted coat 15 °C; dry fall coat 7 °C; dry winter coat 0 °C (the default); dry heavy winter coat −8 °C.',
      'Wind makes it colder for a cow: the app subtracts 3.5 °C at 8 km/h, 6.5 at 16, 8.5 at 24, 11.5 at 32, 15 at 40, 20 at 48 km/h.',
      'Chinooks are the trap here: a thaw then a hard freeze leaves coats wet or matted. At −10 °C calm a wet cow needs about 90% more energy — no ration covers that; she needs bedding and shelter.',
    ],
    how: ['Switch to wet after rain, a chinook thaw-freeze or when hides are caked. Heavy winter coat only for well-adapted cows in mid-winter.'],
    source: 'K-State MF3684; BCRC winter management; Alberta 2018 cold-stress table.',
  },
  sheltered: {
    title: 'Windbreak',
    body: ['Cattle behind a 25–33% porosity windbreak are protected 8–10 times its height downwind. The app caps the wind they feel at 8 km/h rather than inventing an energy credit.'],
    source: 'BCRC winter management.',
  },
  muddy: {
    title: 'Mud',
    body: ['Mud adds 10–15% to energy needs; the app uses 10%. Turn it on when cattle sink past the dewclaw.'],
    source: 'Merck Veterinary Manual.',
  },
  reserve: {
    title: 'Reserve',
    body: [
      'Feed to hold back beyond turnout for a late spring. No Canadian source states one; 15% is our proposal. Raise it in a drought year, or when stalk grazing is part of the plan (snow can end it any day).',
    ],
  },
  seasonCold: {
    title: 'Cold over the season',
    body: [
      'The plan uses this ranch’s own last five winters: for each month, the average of every day’s cold allowance (so a −25 °C week counts as it should, instead of disappearing into an average temperature).',
      'Today’s feeding uses today’s forecast instead.',
    ],
    source: 'Open-Meteo archive and forecast, daily mean temperature and wind.',
  },
  need: {
    title: 'Energy and protein need',
    body: [
      'TDN: total digestible nutrients, the energy in feed, in pounds a head a day. CP: crude protein, pounds a day.',
      'From the NASEM 2016 tables (as regenerated by Arkansas MP391), scaled to weight by (weight ÷ table weight)^0.75. A 1,200 lb cow in mid pregnancy needs about 10.6 lb TDN and 1.5 lb CP; in the month before calving 13.0 and 2.0; at peak milk 16.1 and 2.9.',
      'The Canadian rule of thumb (55-60-65% TDN, 7-9-11% CP for mid pregnancy, late pregnancy and nursing) runs 5–6 points higher because it quietly includes cold and waste. The app adds those separately, so it uses the NASEM figures — using both would count the cold twice.',
    ],
    source: 'Arkansas MP391; Canadian Cattlemen; BCRC.',
  },
  intake: {
    title: 'How much they can eat',
    body: [
      'Intake is limited by how good the feed is: a dry cow eats about 1.8% of her weight on feed under 52% TDN, 2.2% at 52–59%, 2.5% over 59% (2.2 / 2.5 / 2.7% nursing). Growing calves: about 2.5% at 400 lb falling to 2.1% at 800 lb.',
      'The last three weeks before calving there is about 10% less room. Straw: at most 1.25% of body weight. Grain: amber over 0.5% of body weight, red over 1% or 8 lb in one feeding.',
    ],
    source: 'NASEM via MP391; Saskatchewan straw; K-State; Saskatchewan ration design.',
  },
  share: {
    title: 'Ration: share of dry matter',
    body: [
      'Each feed’s share of what the group eats, on a dry-matter basis (water left out). Shares that don’t add to 100 are scaled to 100.',
      'Starting shares for cows and calves come from a ranch’s own January–February feed sheets; bulls and heifers are a guess until you set them.',
    ],
    how: [
      'From a week of your own feeding: pounds as fed × dry matter % for each feed, then each one’s part of the total.',
      'Or by eye: 7 buckets of silage (33% DM) and 1 bale of greenfeed (88% DM) a day is mostly greenfeed by dry matter even though it is mostly silage by weight.',
    ],
  },
  waste: {
    title: 'Waste at feeding',
    body: [
      'What gets trampled, bedded or left: cone or basket feeder 2–5%; ring feeder 6–8%; sheeted ring 12%; open-bottom ring 20%; unrolled daily 12%; bale processor 19%; bale grazing 16% (7% side-placed); bunk 3–14%; silage on snow 25%; several days put out at once 40% or more.',
      'This is the biggest source of error in a feed budget — bigger than the choice of nutrition tables.',
    ],
    source: 'Yoder et al. 2021; Buskirk; LARA bale grazing; Yaremcio (Alberta Agriculture) via BCRC; Ohio State.',
  },
  quality: {
    title: 'Feed values: book or test',
    body: [
      'DM % is as fed. TDN % and CP % are on a dry-matter basis — the “dry matter basis” column of a lab report.',
      'Until a lab test is entered each feed uses a book value. The book is a rough guide: greenfeed runs 56% TDN in Alberta tables and 60–64% in US ones, and in a 2013 Saskatchewan survey 62% of bales could not carry a mid-pregnancy cow at −25 °C.',
    ],
    how: ['Enter a feed test and it replaces the book values for that feed straight away.'],
    source: 'NDSU AS1182; KSU MF3648; Alberta.ca; Saskatchewan straw table.',
  },
  test: {
    title: 'Getting a feed test',
    body: [
      'One test per “lot”: one field, one cut, baled within 48 hours, stored the same way.',
      'Bales: cores 12–15 inches deep from 20 bales of the lot, into one bag. Bunker silage: 5–8 grab samples, no sooner than four weeks after it was put up. Grain: 10–15 samples as it unloads.',
      'Down to Earth Labs in Lethbridge: a beef forage package is about $37–79, nitrate about $29. Nutrilytical in Calgary is also certified.',
      'If the report has no TDN, the app works it out from ADF (and CP) with the class equation the lab would use — the straw equation for straw.',
      'Nitrate (% NO₃ of DM): under 0.5 safe, 0.5–1.0 caution, over 1.0 dangerous. From NO₃-N ppm: × 4.43 ÷ 10,000.',
      'Re-test silage and outside-stored bales mid-winter, and anything that heats or gets wet.',
    ],
    source: 'BCRC feed testing; UArk AGRI-437; UNL G1779; Down to Earth Labs.',
  },
  baleWeight: {
    title: 'Bale weight',
    body: [
      'A bale’s weight is its volume × how dense it is. A 5 × 6 ft round bale holds 141 ft³; at 9–12 lb DM per ft³ that is 1,270–1,700 lb of dry matter — a ±14% spread, which is why weighing beats guessing.',
      'Squeeze test for density: spongy 9 lb DM/ft³, gives a little 10, rigid 11, very rigid 12.',
      'Starting weights: straw 1,000 lb; greenfeed 1,350; grass or alfalfa-grass hay 1,450; alfalfa 1,600.',
    ],
    how: [
      'Weigh 3–5 bales from each lot once: a loaded bale deck over an elevator scale, gross minus tare, divided by the count. Five bales pins the average to about ±9%.',
    ],
    source: 'Penn State; Alberta Agri-News; BCRC; Saskatchewan Agriculture.',
  },
  silage: {
    title: 'Silage tonnes',
    body: [
      'A packed pile holds about 14.5 lb of dry matter per cubic foot (about 40 lb as fed at 35% DM).',
      'Drive-over pile with 3:1 sides: volume ≈ height × (base width − 3 × height) × (base length − 3 × height). Example: 150 × 40 ft base, 8 ft high ≈ 16,100 ft³ ≈ 102 t of dry matter.',
      'Loader bucket: loose silage is about 25 lb/ft³ as fed. Weigh 3–5 typical buckets once per pile and log buckets from then on.',
    ],
    source: 'UW-Madison (Holmes, Muck); Hubbard; eXtension.',
  },
  storageLoss: {
    title: 'Storage loss still to come',
    body: [
      'Dry matter lost before it is fed: shed or wrapped 5%; tarped on a pad 7%; elevated stack 10%; net-wrapped on the ground 23% (US trials; dry southern Alberta is probably at the low end). Silage: 10–15% well covered, 30–40% uncovered.',
      'The app takes this off what is left when working out how far feed goes. Record actual spoilage in the inventory as “Spoiled or wasted”.',
    ],
    source: 'Collins et al. via Illinois Extension; K-State; UW.',
  },
  daysOfFeed: {
    title: 'How far the feed goes',
    body: [
      'Day by day from today to turnout: each group’s ration at that day’s stage and the month’s cold, times head, plus waste. Each feed’s total is set against what is left (after storage loss).',
      'The scarcest feed in the ration decides how far the ration goes. Stalk grazing days come off the groups that graze them.',
    ],
  },
  stubble: {
    title: 'Corn stubble grazing',
    body: [
      'Corn leaves about 8 lb of grazeable dry matter per bushel of grain (half the leaf and husk; trampling and wind already allowed for). A cow on stalks eats about 2.3% of her weight. So cow-days per acre ≈ yield × 8 ÷ (0.023 × weight): about 51 days an acre at 180 bu for a 1,200 lb cow. Over 225 bu the leaf is poorer — stock 10% lighter.',
      'Southern Alberta has no published stalk data; chinook wind strips leaves, so the app takes another 15% off (our proposal — change it).',
      'Every grazing day replaces a full day of stored feed plus the waste that feed would have had.',
      'Six inches of snow or a quarter inch of ice: half graze, half feed. An ice crust: full feed.',
    ],
    how: [
      'Yield: the field’s combine or scale tickets ÷ acres, in bu/ac.',
      'Dropped grain: count 8-inch ears in three 100-ft rows (30-inch rows); ears ÷ 2 = bu/ac on the ground. Over 8–10 bu/ac, strip graze and step cattle onto it over 7–10 days — never turn out hungry.',
      'Protein: dry cows need only salt, mineral and vitamin A while corn still shows in the manure, then about 5 lb of alfalfa a day. Heifers, calves and nursing cows need protein from day one.',
    ],
    source: 'UNL CropWatch and Beef; K-State FORA02; DTN 2024; NDSU.',
  },
  daily: {
    title: 'The daily check',
    body: [
      'What went out, less waste, is turned into energy eaten and set against the group’s need for that day’s weather and stage.',
      'Within 10% either way: on target. 10–20% under: amber. More than 20% under, or under for a week: red. More than 15% over for two weeks: over-feeding. These bands are our proposal — no published source gives one.',
      'A daily log only catches trouble alongside condition scores; if the log looks right and the cows are losing condition, a bale or bucket weight is wrong.',
    ],
    source: 'Report, “A daily log flags trouble only when paired with condition scores”.',
  },
  // Plain-language meanings of the abbreviations on the cattle screens, for
  // the table headers and stat tiles that show them bare.
  dm: {
    title: 'DM — dry matter',
    body: [
      'What is left of a feed once the water is taken out. Rations, intake and energy are all worked in dry matter so that a wet silage and a dry bale can be compared; the amounts to put out are turned back into pounds as fed.',
      'DM % is the share of the feed, as fed, that is dry matter.',
    ],
  },
  tdn: {
    title: 'TDN — energy',
    body: [
      'Total digestible nutrients: the feed’s energy, as a share of its dry matter. It is the number the winter feed budget balances first — a group is fed enough to meet its TDN need.',
    ],
  },
  cp: {
    title: 'CP — protein',
    body: [
      'Crude protein, as a share of the feed’s dry matter. Met after energy: a cow short of protein digests her roughage less well, so a low-CP ration can leave her short of energy too.',
    ],
  },
  aud: {
    title: 'AUD and AUM — animal-unit days and months',
    body: [
      'One animal unit (AU) is a 1,000 lb cow, with or without a calf at side, eating 26 lb of forage a day. Heavier or lighter classes count as more or less than one (the AU/head column).',
      'An AUD is one animal unit grazing for one day — 26 lb of forage. An AUM is a month of it: 30 AUDs, 780 lb.',
      'Land capacity is the grazeable forage turned into AUDs; the herd’s need is its total animal units × days grazing. The difference is the surplus or deficit.',
    ],
    source: 'BCRC Carrying Capacity Calculator, Method 1.',
  },
  ndvi: {
    title: 'NDVI — satellite greenness',
    body: [
      'How green the satellite sees the ground, from about 0 for bare soil to near 1 for heavy, growing canopy. It ranks paddocks and shows a trend; it is not a weight of grass until it has been calibrated against clipped samples.',
    ],
  },
} satisfies Record<string, Help>

export type HelpKey = keyof typeof FEED_HELP
