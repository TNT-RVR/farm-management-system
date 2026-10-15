/**
 * One thing worth knowing, for the top of the Monday meeting.
 *
 * THIS LIST IS THE REVIEWED ONE. Fixed text, read in a diff, every one of them
 * saying what to DO about it — because a fact nobody acts on is a quiz
 * question, and a fact read out as farm policy has to be right.
 *
 * It is no longer the whole library. Nothing is ever read out twice, so the
 * library is consumed, and a year of Mondays is all this list holds; the rest
 * are written as they are needed and kept in `meeting_facts`
 * (netlify/shared/meeting-facts-core.ts), grounded in a source, droppable in
 * one press. This list is what survives all of that: it needs no network and no
 * API key, and it is what the meeting falls back on when there is neither.
 *
 * CHOSEN BY THE WEEK, NOT AT RANDOM. Everybody in the meeting sees the same one,
 * it does not change while the page is open, and it does not repeat until the
 * list is exhausted. `seasonal` facts are pulled forward to the months they
 * matter in — telling somebody about swathing canola in February is a fact, but
 * it is not a useful one in February.
 */

export type FactTopic = 'canola' | 'cereals' | 'beans' | 'pulses' | 'corn' | 'forage' | 'cattle' | 'weather' | 'spraying' | 'storage'

export type FarmFact = {
  /** Stable id. Never reuse one for different text — it is how a skip is remembered. */
  id: string
  topic: FactTopic
  title: string
  /** The fact. Two or three sentences; this gets read aloud. */
  body: string
  /** What to do differently. The reason the fact is on the agenda at all. */
  soWhat: string
  /**
   * Months (1-12) this is worth hearing in. Empty means any time.
   *
   * A fact about swathing timing is true in February and useless in February.
   */
  months?: number[]
  /**
   * Where it was checked, for the facts that were written later rather than
   * reviewed in a diff (see netlify/shared/meeting-facts-core.ts). Shown as a
   * link on the card, so anybody hearing one can go and look at it.
   */
  sourceUrl?: string
  /** True for a fact the top-up job wrote. The reviewed library does not set it. */
  written?: boolean
}

/**
 * How many unused facts a month should always have in hand.
 *
 * The number the whole top-up exists to hold. A month has four or five Mondays,
 * so eight is a month or two of headroom — enough that a failed run never
 * reaches the meeting. Kept here beside the library because it is a fact about
 * the library, and read by both the app and the job that refills it.
 */
export const STOCK_PER_MONTH = 8

/** The facts for a month that have not been read out yet. */
export function unusedForMonth(library: FarmFact[], used: Set<string>, month: number): FarmFact[] {
  return library.filter((f) => f.months?.includes(month) && !used.has(f.id))
}

export const FARM_FACTS: FarmFact[] = [
  // ---- spraying -----------------------------------------------------------
  {
    id: 'inversion',
    topic: 'spraying',
    title: 'The stillest evening is the worst time to spray',
    body: 'On a clear, calm evening the ground cools faster than the air above it and the air stops mixing — a temperature inversion. Fine droplets that would normally dilute upward instead hang in a layer a few feet off the ground and drift together, intact, for kilometres. The tell-tales are smoke or dust hanging flat rather than rising, dew forming early, and wind under 3 km/h.',
    soWhat: 'Dead calm is a reason to stop, not to start. A light steady breeze of 6–15 km/h is the safest spraying wind there is.',
  },
  {
    id: 'hard-water-glyphosate',
    topic: 'spraying',
    title: 'Hard water quietly steals glyphosate',
    body: 'Calcium and magnesium in hard water bind to glyphosate in the tank and form a salt the plant cannot take up. The product is still in there; it just will not work. Southern Alberta groundwater is often hard enough to matter, and the effect is worst at low water volumes where the concentration of both is highest.',
    soWhat: 'Ammonium sulphate in the tank FIRST, before the glyphosate, ties up the calcium and magnesium so the herbicide stays available. Get the water tested once and you will know whether it matters here.',
  },
  {
    id: 'tank-mix-order',
    topic: 'spraying',
    title: 'Mixing order is not a preference',
    body: 'Products go in by formulation type, not by what is nearest the door: water conditioners and ammonium sulphate, then dry flowables and granules, then wettable powders, then suspension concentrates, then emulsifiable concentrates, and adjuvants last. Out of order, dry products that have not fully dispersed get coated by oil-based ones and come back out as sludge in the screens.',
    soWhat: 'Half-fill with water and keep agitation running the whole time. If a mix has gone wrong, it will show as gel in the sight glass long before it shows as a plugged boom.',
  },
  {
    id: 'droplet-size',
    topic: 'spraying',
    title: 'Droplets under 150 microns are the ones that leave',
    body: 'Drift is not really about wind, it is about how many fine droplets a nozzle makes. Anything below about 150 microns stays airborne long enough for wind to carry it off target. Raising pressure makes droplets smaller; a coarser nozzle at the same rate keeps the product on the field.',
    soWhat: 'Coarse or very coarse droplets for systemic products like glyphosate — they move inside the plant so coverage matters less. Save the finer sprays for contact products that have to hit what they kill.',
  },
  {
    id: 'kochia-resistance',
    topic: 'spraying',
    title: 'Kochia around here is glyphosate-resistant, and it tumbles',
    body: 'Glyphosate-resistant kochia is established across southern Alberta, and a large share also carries Group 2 resistance. What makes it spread faster than other weeds is the tumbleweed habit — one mature plant breaks off and scatters seed across every field it rolls through, so resistance travels along field edges and ditches rather than staying where it started.',
    soWhat: 'Kill kochia patches before they set seed even if it means a separate pass, and never rely on glyphosate alone. A patch left to tumble is next year\'s problem in three fields.',
  },
  {
    id: 'rainfast',
    topic: 'spraying',
    title: 'Rainfast is about uptake, not about drying',
    body: 'A spray is rainfast when enough of it has moved into the leaf, which is not the same as the leaf looking dry. Glyphosate needs somewhere around 4–6 hours on most weeds; some contact and hormone products are far quicker. Hot dry conditions make it slower, not faster — a drought-stressed plant closes down and stops taking anything up.',
    soWhat: 'Check the label for the actual number rather than guessing off the forecast, and do not spray weeds that are wilting. Waiting a day after a rain usually beats spraying ahead of one.',
  },

  // ---- canola -------------------------------------------------------------
  {
    id: 'canola-60pct',
    topic: 'canola',
    title: 'Swath canola at 60% seed colour change — on the main stem',
    body: 'Seed colour change is counted on the main stem only, and 60% means 60% of those seeds show any colour at all, not that they are fully brown. Swathing earlier costs yield outright — seed is still filling — and swathing later costs shelling and green seed risk. The window moves fast: colour change runs about 10% a day in warm weather.',
    soWhat: 'Pull pods from the main stem in several spots, roll the seed in your palm, and count. A field checked once at the right hour beats one checked from the truck window three days running.',
    months: [8, 9],
  },
  {
    id: 'canola-green-seed',
    topic: 'canola',
    title: 'Frost locks green into canola seed',
    body: 'Canola seed clears its chlorophyll as it dries down, and that process needs the seed to still be alive. A hard frost on immature seed kills it before it has cleared, and the green is locked in permanently — no amount of time in the bin will take it out. Frost on canola that has already turned is far less damaging.',
    soWhat: 'If a frost is coming and the crop is not far enough along, there is nothing to gain by swathing in a panic — a standing crop is slightly more protected. After a frost, wait several days before judging the damage; it does not show immediately.',
    months: [8, 9],
  },
  {
    id: 'canola-storage',
    topic: 'canola',
    title: 'Canola goes in dry and heats anyway',
    body: 'Canola is graded dry at 10% moisture but does not store safely there for long — 8% is the number for long-term storage. It also sweats: freshly binned canola releases moisture and heat for several weeks as the seed finishes respiring, and because the seed is small and the bin packs tight, that heat does not escape on its own.',
    soWhat: 'Put air on every bin of canola for the first few weeks whether the moisture test says tough or not. Most canola that spoils was binned dry.',
    months: [9, 10, 11],
  },
  {
    id: 'canola-seeding-depth',
    topic: 'canola',
    title: 'Canola cannot climb out of a deep hole',
    body: 'Canola seed is tiny and carries almost no reserve, so it has one short push to reach daylight. Half an inch to an inch is the target; at two inches a large share of the seeds simply run out of energy underground. Seeding into soil below about 5 °C does not kill it, but it stretches emergence out for weeks and spreads the stand across stages, which makes every later spray a compromise.',
    soWhat: 'Depth control on the drill is worth more on canola than on anything else we seed. Check actual seed depth in several spots rather than trusting the gauge.',
    months: [4, 5],
  },

  // ---- cereals ------------------------------------------------------------
  {
    id: 'wheat-protein-n',
    topic: 'cereals',
    title: 'Late nitrogen buys protein, not yield',
    body: 'Nitrogen applied at seeding mostly becomes yield. Nitrogen applied after heading mostly becomes protein, because by then the number of kernels is already set and the plant puts the extra into filling them richer. On a protein-premium contract that late pass can be worth more than the same nitrogen applied in the spring.',
    soWhat: 'Decide whether a field is being grown for yield or for grade before the season starts — the two want the nitrogen at different times, and splitting the difference gets neither.',
    months: [5, 6, 7],
  },
  {
    id: 'fusarium-flowering',
    topic: 'cereals',
    title: 'Fusarium infects during flowering and nowhere else',
    body: 'Fusarium head blight gets into wheat through the open flower, which means the entire window of vulnerability is a few days wide. A fungicide applied at early flowering — when anthers first show on the middle of the head — is protecting the crop; the same product a week later is protecting nothing, because infection has already happened.',
    soWhat: 'Watch the heads, not the calendar. Warm and humid during flowering is the risk combination, and irrigated wheat makes its own humidity.',
    months: [6, 7],
  },
  {
    id: 'falling-number',
    topic: 'cereals',
    title: 'Sprouting damage is invisible before it is visible',
    body: 'Rain on ripe wheat starts the enzymes that break down starch, and grade is docked on the falling number test long before any sprout can be seen on a kernel. A crop that looks perfectly sound can already have lost its milling grade. Durum is more vulnerable than spring wheat, and dormancy varies by variety.',
    soWhat: 'After a wet spell on ripe wheat, the standing crop is losing grade every day. Combining slightly tough and conditioning it is usually cheaper than waiting out another shower.',
    months: [8, 9],
  },
  {
    id: 'barley-malt-chit',
    topic: 'cereals',
    title: 'One chitted kernel rejects a malt load',
    body: 'Malting barley is bought on its ability to germinate evenly on demand. A kernel that has already started to sprout in the field — chitted — has spent that ability, and even a small percentage rejects the load to feed. Chitting happens when ripe barley sits through rain, and it is not reversible.',
    soWhat: 'If a barley field is targeted for malt, it is the first one off when the weather turns. Feed barley can wait; malt cannot.',
    months: [8, 9],
  },

  // ---- beans --------------------------------------------------------------
  {
    id: 'beans-seed-coat',
    topic: 'beans',
    title: 'Dry beans crack when they are dry, not when they are wet',
    body: 'Bean seed coats become brittle below about 16% moisture, and every drop and auger flight after that puts splits and cracks into the sample. The grade is paid on appearance, so mechanical damage costs real money on a crop that came off perfectly good. Beans are harvested wetter than cereals on purpose and conditioned down afterwards.',
    soWhat: 'Combine beans in the cool of the morning or evening while they have picked up a little moisture, slow the augers down, and keep drops short. A dry afternoon is the most expensive time to move beans.',
    months: [9, 10],
  },
  {
    id: 'beans-white-mould',
    topic: 'beans',
    title: 'Irrigation makes its own white mould weather',
    body: 'White mould needs a closed canopy that stays wet, and a pivot supplies exactly that no matter what the sky is doing. The infection starts on dying blossoms that fall into the canopy, so the risk window opens at flowering and the fungicide has to be in there before the canopy closes over — after that, nothing reaches the bottom of the plant.',
    soWhat: 'Time the fungicide to early flowering and get water volume up so it penetrates. Stretching the irrigation interval slightly during flowering costs less than losing the bottom pods.',
    months: [7, 8],
  },
  {
    id: 'beans-cold-soil',
    topic: 'beans',
    title: 'Beans are the most cold-sensitive thing we seed',
    body: 'Dry beans want soil at 12 °C and rising before they go in — well above canola or cereals. Seeded into cold ground they sit, take up water without growing, and become an easy target for seedling disease; emergence gets ragged and the stand never recovers. They are also killed outright by a light frost at either end of the season, unlike cereals which take a few degrees below.',
    soWhat: 'Beans are worth waiting for. The yield lost to a late seeding date is smaller than the yield lost to a poor stand.',
    months: [5, 6],
  },

  // ---- pulses -------------------------------------------------------------
  {
    id: 'peas-bleaching',
    topic: 'pulses',
    title: 'Rain on ripe peas costs grade, not yield',
    body: 'Green peas are graded heavily on colour, and rain on a ripe crop bleaches them toward yellow. The yield is untouched and the sample looks fine in every other respect, but the grade — and the price — drops. The longer the crop lies in the field after it is ready, the more exposure it gets.',
    soWhat: 'Ripe peas are a harvest priority ahead of crops that can sit. Peas combine at 16% and can be conditioned down; waiting for 14% in the field is a gamble against the forecast.',
    months: [8, 9],
  },
  {
    id: 'pea-roots-n',
    topic: 'pulses',
    title: 'Peas do not leave as much nitrogen as people think',
    body: 'A pea crop fixes most of the nitrogen it needs, but it also takes most of that nitrogen away in the seed. What is left for the following crop is the root and residue portion — real, and worth something, but nothing like the whole amount fixed. The bigger benefit to the next crop is often the break in the disease cycle and the improved soil structure.',
    soWhat: 'Credit a pulse in the rotation for a modest nitrogen contribution and a large rotational one. Budgeting the full fixation as free nitrogen leaves the following wheat short.',
  },

  // ---- corn ---------------------------------------------------------------
  {
    id: 'corn-black-layer',
    topic: 'corn',
    title: 'Black layer is the end of yield, not the end of drying',
    body: 'When a dark layer forms at the tip of the kernel, the corn plant has finished moving anything into the seed — that is physiological maturity, and the yield is now fixed. But the grain is still around 30–35% moisture at that point. Everything after black layer is drying, and whether it happens in the field or in a dryer is purely a cost decision.',
    soWhat: 'Once black layer is reached, frost no longer costs yield. From there it is field drying versus fuel, and a dry warm October is worth a great deal of propane.',
    months: [9, 10],
  },
  {
    id: 'corn-heat-units',
    topic: 'corn',
    title: 'Corn runs on heat, and it does not count cold nights',
    body: 'Corn development is driven by accumulated heat rather than by days. Corn heat units only accrue above about 10 °C — a cool night contributes nothing at all, and a cold week can put a crop behind by more than the calendar suggests. Hybrid ratings are a heat-unit requirement, which is why the same hybrid matures at different dates in different years.',
    soWhat: 'Judge how a corn crop is doing against accumulated heat, not against the date. A late but hot season can still finish a hybrid that looks hopelessly behind in July.',
    months: [6, 7, 8],
  },

  // ---- forage -------------------------------------------------------------
  {
    id: 'alfalfa-fall-window',
    topic: 'forage',
    title: 'The last alfalfa cut has a window it should not be inside',
    body: 'Alfalfa rebuilds its root reserves in the six weeks or so before a killing frost, and that stored energy is what carries the stand through winter and pushes the first growth next spring. A cut taken inside that window takes the top off exactly while it is refilling, and the stand goes into winter on an empty tank. Either cut early enough that it regrows, or late enough that it was not going to regrow anyway.',
    soWhat: 'Take the last cut with six weeks to spare, or wait until after a hard frost. The cut in between is the expensive one, and the cost shows up as winterkill next spring.',
    months: [8, 9],
  },
  {
    id: 'alfalfa-autotoxicity',
    topic: 'forage',
    title: 'Alfalfa poisons its own seedlings',
    body: 'An established alfalfa stand releases compounds that stunt or kill new alfalfa seedlings — autotoxicity. Thickening a thin old stand by seeding more alfalfa into it does not work, and reseeding straight back into a terminated stand usually fails as well. The effect fades over roughly a year.',
    soWhat: 'A thin alfalfa stand gets a grass, or it gets a year of something else first. Seeding alfalfa into alfalfa is money spent on a stand that will not establish.',
  },
  {
    id: 'forage-bloom-tradeoff',
    topic: 'forage',
    title: 'Every day you wait to cut, you trade protein for tonnes',
    body: 'Alfalfa quality falls steadily as the plant moves toward bloom while tonnage keeps climbing, and the two curves cross around early bloom. Cut before that and you have excellent feed and less of it; cut well after and you have plenty of a feed that needs grain alongside it to do the same job.',
    soWhat: 'Decide what the cut is FOR before deciding when to take it. Feed for young stock or milking-type demands wants early; bulk winter feed for dry cows can stand later.',
    months: [6, 7],
  },

  // ---- cattle -------------------------------------------------------------
  {
    id: 'red-hide-heat',
    topic: 'cattle',
    title: 'A red hide is a real advantage in July',
    body: 'Coat colour changes how much solar radiation an animal absorbs, and a black hide takes on noticeably more heat load than a red one in direct sun. Under the same conditions, red cattle typically show lower body temperature and keep eating when black cattle have backed off. In a heat event, feed intake is the first thing to go, and intake is gain.',
    soWhat: 'It is an advantage worth protecting, not relying on. Shade and water access still do more than hide colour, and Red Angus cattle in a heat event still need both.',
    months: [6, 7, 8],
  },
  {
    id: 'bcs-calving',
    topic: 'cattle',
    title: 'Body condition at calving decides next year\'s calf crop',
    body: 'A cow calving in moderate condition comes back into heat sooner than a thin one, and the interval from calving to first heat is what decides whether she breeds back inside a tight window. A thin cow will put what she has into milk before she puts anything into cycling. Condition added before calving is far cheaper than condition added after, because a lactating cow is fighting to hold what she has.',
    soWhat: 'Sort and feed thin cows separately in the second trimester, not in the spring. By calving, the decision has already been made for you.',
    months: [11, 12, 1, 2],
  },
  {
    id: 'gestation-283',
    topic: 'cattle',
    title: 'Gestation is 283 days, and the bull turnout date sets everything',
    body: 'Beef cattle gestation runs about 283 days, so the day bulls go out determines the day calving starts nine and a half months later — and the length of time bulls are left in determines how long calving drags on. A 63-day breeding season gives a 63-day calving season; leaving bulls out year round gives calves in every month and no way to manage any of them as a group.',
    soWhat: 'Count back 283 days from when you want to be calving and that is the turnout date. Pulling bulls on a set date is the single cheapest way to tighten a calving season.',
  },
  {
    id: 'trace-minerals',
    topic: 'cattle',
    title: 'Copper and selenium are short in this country by default',
    body: 'Much of western Canada is naturally low in selenium, and forage copper is often either low or tied up by high molybdenum and sulphate — the animal cannot use it even when the feed test shows it is there. The symptoms are not dramatic: poor conception, retained placentas, calves that lack vigour, faded coats. It reads as bad luck rather than as a deficiency.',
    soWhat: 'A mineral programme is insurance, not a feed cost, and it has to be available year round rather than when somebody remembers. Test the water too — high sulphate water ties up copper on its own.',
  },
  {
    id: 'water-intake',
    topic: 'cattle',
    title: 'Water is the feed nobody budgets',
    body: 'A lactating cow in summer heat can drink well over 100 litres a day, and intake of feed falls off almost immediately when water is short or unpalatable. High-sulphate water — common in this country — reduces how much they will drink before it does anything else, so the first sign of a water problem is usually cattle that are not gaining.',
    soWhat: 'Trough capacity and recharge rate matter as much as total supply: cattle drink as a mob after grazing, not evenly through the day. Get water tested for sulphates before blaming the pasture.',
    months: [6, 7, 8],
  },
  {
    id: 'bull-battery',
    topic: 'cattle',
    title: 'A bull is a one-season investment that fails quietly',
    body: 'Roughly one bull in five turns out to be a subfertile breeder in any given year, and nothing about how he looks or behaves gives it away — he will still chase and still mount. The cost does not show up until preg-checking, by which point an entire breeding season on that group is gone. A breeding soundness exam costs a fraction of one open cow.',
    soWhat: 'Test every bull every year, not once when he is bought. And watch them work in the first cycle — a bull that is sore-footed in June is an open cow in March.',
    months: [4, 5, 6],
  },

  // ---- weather ------------------------------------------------------------
  {
    id: 'frost-clear-calm',
    topic: 'weather',
    title: 'Frost is made by clear calm nights, not by cold air',
    body: 'On a clear still night the ground radiates its heat straight to the sky and the air right at crop height can drop several degrees below what the forecast says for the area. Cloud cover puts a lid on that, and wind mixes warmer air down — either one can be the difference between frost and no frost at the same forecast temperature. Low spots collect the cold air that drains off higher ground.',
    soWhat: 'Read the sky and the wind, not just the number. A forecast low of 2 °C on a clear calm night is a frost in the hollows, and our own topography map shows exactly which hollows.',
    months: [5, 6, 8, 9],
  },
  {
    id: 'chinook-stress',
    topic: 'weather',
    title: 'A chinook is harder on cattle than the cold it replaces',
    body: 'Cattle handle steady cold well once their winter coat and their intake have adjusted. What costs them is the swing: a chinook melts snow, wets the hair coat, and then the temperature drops back — and a wet coat has a fraction of the insulating value of a dry one. The effective cold after a chinook can be worse than anything in the week before it.',
    soWhat: 'Feed for the days after a chinook, not during it. Dry bedding and a windbreak are worth more than extra feed when the coat is wet.',
    months: [11, 12, 1, 2, 3],
  },
  {
    id: 'evaporative-demand',
    topic: 'weather',
    title: 'Wind dries a crop faster than heat does',
    body: 'Evaporative demand is driven by the combination of temperature, humidity and wind, and wind is the term people underestimate. A 25 °C day with a stiff dry wind pulls more water out of a crop than a still 32 °C day. That is why a hot calm week and a warm windy week leave the soil in very different places.',
    soWhat: 'Check the irrigation model rather than the thermometer when deciding whether to start. A windy week can empty the profile while the temperature looks unremarkable.',
    months: [6, 7, 8],
  },

  // ---- storage ------------------------------------------------------------
  {
    id: 'moisture-migration',
    topic: 'storage',
    title: 'Winter moves moisture to the top centre of the bin',
    body: 'Through winter the outside of a bin cools while the core stays warm, and that difference sets up a slow convection current — air sinks down the cold wall, crosses the floor, rises through the warm middle, and gives up its moisture when it hits the cold grain at the top. The result is a wet crusted spot in the top centre of a bin that went in perfectly dry, and it is where nearly every winter spoilage starts.',
    soWhat: 'Cool the whole bin down to near outside temperature in the fall and the current never gets going. Check the top centre first when checking bins — it is where it will show.',
    months: [10, 11, 12, 1, 2],
  },
  {
    id: 'emc',
    topic: 'storage',
    title: 'A fan can add moisture as easily as remove it',
    body: 'Grain comes to equilibrium with the air around it, and which direction it moves depends on the air, not on the fan. Running a fan on a warm humid night can put moisture INTO a bin of dry grain. The number that matters is the equilibrium moisture content of the air being pushed in, which comes from its temperature and relative humidity together.',
    soWhat: 'Aeration is worth running when the air is cool and dry, not simply when somebody is at the yard. A fan run at the wrong time is not neutral — it is worse than leaving it off.',
    months: [9, 10, 11],
  },
  {
    id: 'grain-temp-not-moisture',
    topic: 'storage',
    title: 'Temperature tells you about spoilage before moisture does',
    body: 'Grain that is starting to go does not get wetter first — it gets warmer. Mould and insect activity generate heat, and a rising temperature in one part of a bin is the earliest signal there is, often weeks before anything shows in a moisture reading or a smell. A bin that is slowly warming while the weather is cooling is a bin with something happening in it.',
    soWhat: 'It is the CHANGE that matters, not the number. One reading tells you nothing; the same spot read again a fortnight later tells you everything.',
    months: [10, 11, 12, 1, 2, 3],
  },
  {
    id: 'tough-clock',
    topic: 'storage',
    title: 'Tough grain has a clock on it, and the clock runs on temperature',
    body: 'How long grain keeps safely is a function of moisture AND temperature together. Tough wheat at 25 °C may only have days before it is at risk; the same wheat cooled to 5 °C can sit for months. Cooling does not dry the grain, but it very nearly stops the biology that spoils it.',
    soWhat: 'If it went in tough and cannot be dried right away, cooling it buys the time to deal with it properly. Getting air on it the same week is worth more than getting it perfect next month.',
    months: [9, 10, 11],
  },

  // ---- winter: cattle ------------------------------------------------------
  {
    id: 'lower-critical-temp',
    topic: 'cattle',
    title: 'Below about freezing, every degree costs feed',
    body: 'A dry cow in full winter coat sits comfortably down to around freezing — that is her lower critical temperature. Below it she burns extra energy simply holding her body temperature, on the order of 2% more for every degree colder. A wet or muddy coat raises that threshold sharply, because the insulation is gone.',
    soWhat: 'A cold snap is a feed event, not just a weather event. Raise the energy in the ration for the duration rather than after the condition has already come off.',
    months: [11, 12, 1, 2],
  },
  {
    id: 'feed-test-first',
    topic: 'cattle',
    title: 'Two loads of hay off the same field are not the same feed',
    body: 'Protein and energy in hay vary enormously with cutting date, weather during curing and how long it has sat. Guessing from appearance is unreliable — a green-looking bale cut late can test well below a weathered one cut early. A feed test costs a few dollars and is the only thing that turns a pile of bales into a ration.',
    soWhat: 'Test each distinct lot before building the winter ration, not after the cows start losing condition. Our own feed records now show what was actually fed — pair that with a test and the numbers mean something.',
    months: [10, 11, 12],
  },
  {
    id: 'winter-water',
    topic: 'cattle',
    title: 'Cattle eating snow are cattle not eating feed',
    body: 'Water intake and feed intake move together: when water is hard to get at, dry matter intake drops within a day. A frozen or slow-recharging trough in January costs condition even with plenty of feed in front of them, and cattle will not stand and wait their turn in a wind.',
    soWhat: 'Check troughs and heaters on the coldest mornings, not the mild ones. Recharge rate matters as much as capacity, because they drink as a mob after feeding.',
    months: [12, 1, 2],
  },
  {
    id: 'vitamin-a-winter',
    topic: 'cattle',
    title: 'Stored forage loses its vitamin A over the winter',
    body: 'Green growing forage is full of carotene, which cattle convert to vitamin A. Cured hay loses it steadily in storage, and by late winter a ration built entirely on last summer’s bales can be genuinely short. The signs show up at calving — weak calves, retained placentas, poor immunity — and read as bad luck.',
    soWhat: 'Make sure the winter mineral carries vitamins A, D and E, and that it is still going out in February and March rather than having quietly run out in December.',
    months: [1, 2, 3],
  },
  {
    id: 'bull-frostbite',
    topic: 'cattle',
    title: 'A bull can be ruined by one cold night',
    body: 'Scrotal frostbite damages sperm production, and the damage is not visible from the outside — a bull can look completely sound in April and be sterile or subfertile through the breeding season. It happens on cold still nights with inadequate bedding, and the effect on semen quality can take two months or more to recover from, if it recovers.',
    soWhat: 'Bulls get dry bedding and a windbreak all winter, not just the cows. And it is another reason to test every bull in the spring rather than assuming last year’s result still holds.',
    months: [12, 1, 2],
  },
  {
    id: 'colostrum-six-hours',
    topic: 'cattle',
    title: 'Colostrum is a six-hour window, not a first-day one',
    body: 'A newborn calf absorbs whole antibodies through its gut wall, and that ability closes down fast — most of the absorption happens in the first six hours and very little after twenty-four. A calf that gets plenty of colostrum late is still a calf with poor immunity, and it shows up weeks later as scours or pneumonia.',
    soWhat: 'A calf that has not clearly sucked within a few hours is a job now, not a job to watch. Keep a bag of replacement colostrum where the calving supplies are.',
    months: [2, 3, 4],
  },
  {
    id: 'dystocia-clock',
    topic: 'cattle',
    title: 'Active straining with no progress is a clock, not a wait',
    body: 'Once a cow or heifer is in hard labour, progress should be visible within about an hour. Beyond that the odds for the calf fall away quickly, and a calf pulled late is a calf that is slow to get up and slow to suck even when it survives. Heifers need watching closer than cows, and a quiet check beats a late intervention.',
    soWhat: 'Note the time when active straining starts rather than guessing afterwards how long it has been. An hour of no progress is the point to look, not the point to worry.',
    months: [2, 3, 4],
  },
  {
    id: 'weaning-stress',
    topic: 'cattle',
    title: 'Weaning stacks every stress into one week',
    body: 'Separation, a new diet, a new pen and often transport and processing all land within days of each other, and that is exactly when calves get sick. Spreading the events out — vaccinating ahead of weaning, introducing the new feed before the separation, fenceline weaning rather than complete removal — pulls the stresses apart without changing any of them.',
    soWhat: 'Decide the order of operations before weaning week rather than doing everything on the day the trucks are available. Preconditioning also sells: buyers pay for calves that have already been through it.',
    months: [9, 10],
  },

  // ---- winter and early spring: planning -----------------------------------
  {
    id: 'group-rotation',
    topic: 'spraying',
    title: 'Resistance is bought in the winter, not sprayed in the summer',
    body: 'Herbicide resistance is driven by using the same mode of action repeatedly on the same acres, and that decision is made when the chemical is ordered rather than when it goes in the tank. A plan built around groups — not around product names — is what keeps a group working, and two products with different labels are often the same group.',
    soWhat: 'Write next season’s plan out by GROUP NUMBER per field before ordering, and look for a group each field has not seen in two years. Our chemical list shows the registration for each product, which is how to check what a group actually is.',
    months: [1, 2, 3],
  },
  {
    id: 'recrop-restrictions',
    topic: 'spraying',
    title: 'Some of what was sprayed last year decides what can be seeded this year',
    body: 'Residual herbicides carry re-cropping restrictions measured in months, and the interval often depends on soil pH, organic matter and how much rain fell after application — a dry year lengthens it. The damage from ignoring one does not look like herbicide injury; it looks like a poor stand, and it is diagnosed after seeding when nothing can be done.',
    soWhat: 'Check re-cropping intervals against the rotation plan before the seed is bought, not before the drill goes in the ground. The app holds each label, and a dry season is the one to be careful in.',
    months: [2, 3],
  },
  {
    id: 'seed-test-vigour',
    topic: 'cereals',
    title: 'Germination and vigour are two different numbers',
    body: 'A seed test’s germination figure says what will sprout under ideal laboratory conditions. Vigour says what will sprout in cold wet ground in April — and a lot can germinate at 95% and still emerge poorly in a real seedbed. Seed held over from a tough harvest is where the two numbers diverge most.',
    soWhat: 'Ask for vigour as well as germination on anything being kept for seed, and test early enough that a poor lot can still be replaced. Adjust seeding rate off the real number rather than the optimistic one.',
    months: [3, 4],
  },
  {
    id: 'seeds-per-square-foot',
    topic: 'cereals',
    title: 'Seeding rate in pounds per acre is a guess about plant stand',
    body: 'Thousand-kernel weight varies by a third or more between lots of the same crop, so the same pounds per acre can put down noticeably different numbers of seeds. The stand is what matters, and it is set by seeds per square foot, adjusted for the germination and the expected survival — not by weight.',
    soWhat: 'Weigh a thousand kernels of each seed lot and work the rate back from the target stand. It is fifteen minutes that changes the rate on every field that lot goes into.',
    months: [3, 4, 5],
  },
  {
    id: 'nozzle-wear',
    topic: 'spraying',
    title: 'A worn nozzle over-applies, and it looks perfectly normal',
    body: 'Spray tips wear from the inside out, and the hole gets larger rather than blocked — so a worn set puts out MORE than the rate, not less, and the pattern goes coarse and streaky at the same time. Ten per cent over is invisible to the eye and is both money and a residue risk.',
    soWhat: 'Catch and time the output from several tips at the start of the season and replace the whole set when the average is 10% over nominal. Do it before the first pass, not after a complaint.',
    months: [4, 5],
  },
  {
    id: 'soil-temp-seeding',
    topic: 'cereals',
    title: 'Seeding decisions run on soil temperature at depth, not the air',
    body: 'What the seed experiences is the soil at seeding depth first thing in the morning, which can be several degrees off both the afternoon air and the surface. Cereals will go at 4–5 °C; canola wants the same but establishes far better warmer; dry beans want 12 °C and rising. A crop seeded into ground below its threshold does not die, it just emerges slowly and unevenly, and every later spray becomes a compromise between stages.',
    soWhat: 'Take the temperature at seeding depth, in the morning, in the field being seeded — not once for the whole farm. A thermometer in the drill box settles more arguments than the forecast does.',
    months: [4, 5],
  },
  {
    id: 'seed-placed-fertilizer',
    topic: 'cereals',
    title: 'Fertiliser in the seed row can cost you the stand',
    body: 'Nitrogen and sulphur placed with the seed draw water away from it and can burn the germinating seedling outright. How much is safe depends on how spread out the seed row is — a wide opener on narrow spacing dilutes the salt over more soil than a narrow knife on wide spacing, and the same rate can be safe in one drill and damaging in another.',
    soWhat: 'Know the seedbed utilisation of our own drill before deciding what can ride with the seed. Canola is the least tolerant of anything we grow.',
    months: [4, 5],
  },
  {
    id: 'urea-volatilisation',
    topic: 'cereals',
    title: 'Broadcast urea can go up in the air rather than into the crop',
    body: 'Urea on the soil surface converts to ammonia and a large share can be lost to the atmosphere before it reaches the root — worst on warm moist days, on high-pH calcareous soils, and with no rain to wash it in. Southern Alberta soils are often exactly that. The loss leaves no trace; the crop simply behaves as though less nitrogen was applied.',
    soWhat: 'Incorporate it, band it, or apply ahead of rain rather than ahead of a hot dry week. A treated urea is worth the premium where surface application cannot be avoided.',
    months: [4, 5],
  },
  {
    id: 'critical-weed-free',
    topic: 'spraying',
    title: 'Early weed competition is the yield you never get back',
    body: 'Yield loss from weeds is set very early — competition in the first few leaf stages costs yield that a later clean-up cannot recover, because the crop’s tillering and branching is already decided. A field sprayed late can look immaculate at harvest and still have lost yield in the first three weeks.',
    soWhat: 'Spray on the crop’s stage rather than on how bad the field looks. A weedy-looking field at the right stage is a better outcome than a clean one sprayed a fortnight late.',
    months: [5, 6],
  },
  {
    id: 'grasshopper-edges',
    topic: 'spraying',
    title: 'Grasshoppers hatch on the edges, and that is where to stop them',
    body: 'Eggs are laid in undisturbed ground — ditches, field margins, road allowances — so the hatch appears around the outside of a field and works inward. Small nymphs are far easier to kill than adults, and they are still concentrated in a strip when they are small. A hot dry spring brings a bigger hatch.',
    soWhat: 'Scout the margins in late spring rather than waiting for damage in the field, and treat the strip rather than the whole field if the hatch is still on the edge.',
    months: [5, 6],
  },
  {
    id: 'sclerotinia-bloom',
    topic: 'canola',
    title: 'Sclerotinia is decided at bloom, in the humidity under the canopy',
    body: 'Sclerotinia infects canola through dying petals that stick in the canopy, so the risk is set during flowering and depends on how wet it stays down in the crop rather than on the rain gauge. A thick irrigated canopy makes its own humidity and holds it, which is why the same year can be severe under a pivot and mild on dryland next door.',
    soWhat: 'The decision window is 20–50% bloom and it is short. Judge it on canopy density and how long the crop stays wet in the morning, not on the forecast.',
    months: [7],
  },
  {
    id: 'preharvest-staging',
    topic: 'cereals',
    title: 'Pre-harvest glyphosate has a moisture number, and it is a residue rule',
    body: 'Pre-harvest glyphosate goes on when the grain is at or below 30% moisture — that is the hard dough stage, where a kernel can be dented with a thumbnail but not squeezed into a paste. Applied earlier the product moves into the developing seed, which is both a residue violation and a problem for anything kept as seed.',
    soWhat: 'Check the grain, not the calendar or the colour of the field, and check the wettest part of the field rather than the ripest. Anything intended for seed should not get it at all.',
    months: [8, 9],
  },
  {
    id: 'combine-loss-pan',
    topic: 'cereals',
    title: 'Harvest loss is invisible at the speed you are travelling',
    body: 'Grain going over the back of a combine does not look like anything from the cab, and the amount that matters financially is far smaller than the amount that is visible on the ground. The only way to know is to catch what comes out behind the machine and measure it against the width of the cut.',
    soWhat: 'Run a drop-pan check on each crop at the start and after any big settings change — the app’s combine loss calculator turns the pan into bushels per acre. One check a day is the cheapest yield gain available at harvest.',
    months: [8, 9, 10],
  },
  {
    id: 'post-harvest-weeds',
    topic: 'spraying',
    title: 'Autumn is when the perennials are easiest to kill',
    body: 'After harvest, perennial weeds like thistle and quackgrass move sugars down into their roots for the winter, and anything systemic goes down with them. The same product on the same weed in June mostly reaches the top growth. Winter annuals germinating in the stubble are also small and unprotected in the fall and large and awkward next May.',
    soWhat: 'A post-harvest pass is worth more per litre against perennials than any in-crop timing. The window closes with the first hard frosts, so it competes with harvest for time — plan it rather than fit it in.',
    months: [9, 10],
  },
  {
    id: 'fall-soil-test',
    topic: 'cereals',
    title: 'A fall soil test measures something slightly different than a spring one',
    body: 'Soil nitrogen keeps changing after harvest: organic matter mineralises while the soil is still warm, and nitrate can move with autumn moisture. A test pulled early in the fall on warm soil can read differently from the same field in April. Later is better, once the soil has cooled.',
    soWhat: 'Pull fall samples as late as the ground allows, and be consistent about timing year to year — the trend between years is worth more than any single absolute number.',
    months: [10, 11],
  },
  {
    id: 'stubble-snow',
    topic: 'weather',
    title: 'Tall stubble is a water decision',
    body: 'Standing stubble traps blowing snow, and the snow it holds is moisture in the seedbed next spring rather than moisture in the next coulee. Taller stubble catches more, keeps the soil surface from drying and blowing, and shades the ground early in the season. What it costs is slower spring warm-up and a bit more residue to seed through.',
    soWhat: 'Cut height at harvest is a choice about next year’s moisture, not only about combine throughput. On our driest fields it is worth leaving more behind.',
    months: [10, 11],
  },
  {
    id: 'basis-and-carry',
    topic: 'storage',
    title: 'Storing grain has a price, and it is not just the bin',
    body: 'Holding grain costs interest on the money it represents, the risk of it going out of condition, and the chance that basis widens rather than narrows. Sometimes the market pays for that carry and sometimes it does not — the futures spread and the basis together say which. Storing because the bin is there is not the same as storing because it pays.',
    soWhat: 'Compare the deferred bid with today’s plus the real cost of carry before deciding to hold. A flat market with a widening basis is the market telling you to move it.',
    months: [11, 12, 1, 2],
  },
]

/** ISO-ish week index, counted from a fixed Monday so it never resets in January. */
export function weekIndex(date: Date): number {
  // 5 Jan 1970 was a Monday. Counting whole weeks from there gives a number
  // that increases by exactly one each Monday, forever, with no year boundary
  // to get wrong — unlike a week-of-year, which repeats and has 52 or 53.
  const epochMonday = Date.UTC(1970, 0, 5)
  const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((d - epochMonday) / (7 * 86_400_000))
}

/**
 * Every fact that suits a given week, best first.
 *
 * THIS IS A PREFERENCE ORDER, NOT A PICK. Which one actually gets read out is
 * decided in the database, because "never repeat" is a fact about the whole
 * crew over years and cannot be computed from a date — see assign_meeting_fact.
 * This says what would be suitable and in what order; the log says what is
 * left.
 *
 * SEASONAL FIRST, AND OUT-OF-SEASON NEVER. Facts whose months include this one
 * come ahead of the evergreen ones, and facts belonging to another season are
 * left out entirely rather than ranked last — swathing advice in February is
 * the one thing the seasons exist to prevent, and every month now carries at
 * least nine of its own.
 *
 * The seasonal block is rotated by the week so that two consecutive weeks in
 * the same month do not walk the same order; without it a week that has to fall
 * through to the second candidate always falls through to the same one.
 */
export function candidatesForWeek(date: Date, facts: FarmFact[] = FARM_FACTS): FarmFact[] {
  const month = date.getMonth() + 1
  const inSeason = facts.filter((f) => f.months?.includes(month))
  const anytime = facts.filter((f) => !f.months?.length)
  if (!inSeason.length) return anytime
  const offset = (((weekIndex(date) % inSeason.length) + inSeason.length) % inSeason.length)
  return [...inSeason.slice(offset), ...inSeason.slice(0, offset), ...anytime]
}

/**
 * What would be picked for a week if nothing had ever been used.
 *
 * The pure form of the choice, kept because it is what the tests can pin down
 * and because it is the answer the screen falls back on when the log cannot be
 * read — a meeting with no network still gets a fact that suits the month.
 */
export function factForWeek(date: Date, skip = 0, facts: FarmFact[] = FARM_FACTS): FarmFact | null {
  const pool = candidatesForWeek(date, facts)
  if (!pool.length) return null
  const i = ((skip % pool.length) + pool.length) % pool.length
  return pool[i]
}

export const TOPIC_LABEL: Record<FactTopic, string> = {
  canola: 'Canola',
  cereals: 'Cereals',
  beans: 'Dry beans',
  pulses: 'Peas',
  corn: 'Corn',
  forage: 'Forage',
  cattle: 'Red Angus',
  weather: 'Weather',
  spraying: 'Spraying',
  storage: 'Storage',
}

export const TOPIC_STYLE: Record<FactTopic, string> = {
  canola: 'bg-yellow-100 text-yellow-900',
  cereals: 'bg-amber-100 text-amber-900',
  beans: 'bg-orange-100 text-orange-900',
  pulses: 'bg-lime-100 text-lime-900',
  corn: 'bg-yellow-200 text-yellow-950',
  forage: 'bg-green-100 text-green-900',
  cattle: 'bg-red-100 text-red-900',
  weather: 'bg-sky-100 text-sky-900',
  spraying: 'bg-violet-100 text-violet-900',
  storage: 'bg-stone-200 text-stone-800',
}
