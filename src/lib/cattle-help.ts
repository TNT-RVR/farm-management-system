/**
 * Plain-language info buttons for the cattle planning numbers — the ones Sam
 * asked about on 5 Oct 2026 ("Not sure what you mean by either of those",
 * "Is this if we background them?", "tell me how to calculate that").
 * Each says what the number is, and what moving it does to the answer.
 */

export type CattleHelp = {
  title: string
  body: string[]
  how?: string[]
  /** Heading over `how`. The default suits a number you work out yourself. */
  howLabel?: string
}

export const CATTLE_HELP = {
  costOfGain: {
    title: 'Cost of gain',
    body: [
      'What it costs to put one more pound on a calf after weaning. Add up everything the calf costs from the day it is weaned to the day it is sold, and divide by the pounds it put on:',
      'cost of gain = (feed + yardage + vet + interest + death loss) ÷ pounds gained',
      'Feed: each feed’s pounds a day (as fed, with what is wasted) × its price a pound × the days. Yardage: everything else a day in the pen costs — labour, fuel, the tractor, bedding, power, water. Vet: shots, implants and treatments. Interest: the money tied up in the calf (its value × the rate × days ÷ 365). Death loss: the share that die × what a calf is worth.',
      'Example: a 500 lb calf fed 150 days at 1.5 lb a day puts on 225 lb. If its feed costs $205, yardage $75, vet $25, interest $37 and death loss $30, that is $372 ÷ 225 lb = $1.65 a pound.',
      'It is compared with what the extra pounds sell for. Heavier calves bring less a pound, so the value of gain is usually well under today’s price: backgrounding pays while the cost of gain is below the value of gain.',
    ],
    how: [
      'Open “Work out the cost of gain” below: it takes the calves’ ration from the Feed tab and asks only for the prices.',
      'Feed prices: the invoices for bought feed; for your own hay and silage, what you could sell it for.',
      'Yardage: a year’s labour, fuel, machinery and bedding for the feeding yard ÷ head ÷ days. Alberta custom feedlots charge roughly 50¢–$1 a head a day.',
    ],
  },
  winterTo: {
    title: 'Winter them to',
    body: [
      'Yes — this is for heifers you background: weaned in the fall, fed over the winter, and sold in March–April at this weight instead of at weaning.',
      'It sets the “Wintered” sale option only. The heifers you keep and the ones sold at weaning do not use it.',
      'Heavier makes the wintered option pay more pounds but costs more feed (pounds put on × cost of gain), and heavier calves bring less a pound.',
    ],
  },
  yearlingTo: {
    title: 'Yearlings off grass at',
    body: [
      'Yes — this is for heifers you background over winter and then run on grass for the summer, selling them as yearlings in August–September at this weight.',
      'It sets the “Yearlings off grass” option, and what the open heifers (the ones that did not get bred) are sold for. Nothing else uses it.',
    ],
  },
  grassPerYearling: {
    title: 'Summer grass per yearling',
    body: [
      'What a summer on grass costs for one yearling: the pasture it eats (what you could rent it out for, or what you would pay to rent grass), fencing and water, salt and mineral, and checking them.',
      'Only the “Yearlings off grass” option uses it. Raise it and selling as yearlings pays less; set it to what renting summer grass costs around here if you are not sure.',
    ],
  },
  cullRate: {
    title: 'Culled a year',
    body: [
      'The share of the cow herd you sell each year as culls — open cows, old cows, bad feet or udders. At 12%, a 277-cow herd culls about 33 cows a year.',
      'It is what decides how many heifers you must keep just to stand still: culls plus deaths have to be replaced. Raise it and the app recommends keeping more heifers.',
    ],
  },
  heifersBreed: {
    title: 'Heifers that breed',
    body: [
      'Of the heifers you keep, the share that are bred and calve. The rest come up open at preg-check and are sold as yearlings.',
      'At 88%, keep 100 heifers and 88 join the herd. Lower it and you have to keep more heifers to get the same number of cows, and each one kept is worth less.',
    ],
  },
  productiveYears: {
    title: 'Cow’s working years',
    body: [
      'How many calves a cow raises before she is culled — her working life in the herd. A cow that calves first at two and is culled at twelve works ten years.',
      'A heifer kept is worth this many years of a cow’s margin, plus her cull cheque at the end. More years makes each heifer kept worth more, so the app leans toward keeping. With 12% culled a year a cow lasts about eight years on average, so the two numbers should roughly agree.',
    ],
  },
  discountRate: {
    title: 'Discount rate',
    body: [
      'What money a year from now is worth today: the interest rate you pay on an operating loan, or could earn on the money instead. A calf cheque ten years away is worth less than one this fall.',
      'The heifer’s future calves are added up at this rate. A higher rate makes the far-off years count for less, so keeping heifers looks less attractive than selling them now. 5–7% is about what farm credit costs.',
    ],
  },
  cullCow: {
    title: 'Cull cow cheque',
    body: [
      'What a cow brings when she leaves the herd: the cull cow price ($ a hundredweight) × her weight ÷ 100.',
      'The price is the latest D1-D2 cows at Lethbridge and slaughter cows in her weight class at Medicine Hat — the nearest markets, averaged — and Calgary Stockyards or Team when neither sold cows in the last two weeks. With nothing from the markets, the price typed in Cattle settings is used.',
      'It is the last cheque in a kept heifer’s working life, so a higher one makes keeping pay more.',
    ],
  },
  cowForAYear: {
    title: 'A cow for a year',
    body: [
      'Everything it costs to keep one cow for a year: her feed and grass, vet and breeding, the share of machinery, fuel, buildings and labour she uses, and what she loses in value. It is the figure a kept heifer’s whole working life is measured against, so it moves this page’s answer more than any other number on it.',
      'Your own figure is used whenever Cattle settings look filled in. When they do not, the default is the Alberta cow-calf benchmark: “$1,738 a cow” across 19 Alberta farms for the 2024 production year — $1,059 cash, $257 depreciation and $422 opportunity cost — from the Canadian Cow-Calf Cost of Production Network (Canfax Research Services, October 2025), carried forward at the rise that Network itself measures, about $110 a cow a year.',
      'There is no southern Alberta figure published. The Network says plainly that it has no farms in the south of the province, and Alberta’s own AgriProfit$ has not broken the regions out since 2002. The south pulls two ways against the provincial average anyway — a shorter winter costs less feed, land worth more costs more to tie up — so nothing is adjusted for it.',
      'It counts depreciation and opportunity cost, not just money out the door. That is the right basis for a keep-or-sell decision, because keeping her ties up grass, money and your time. If you would rather count only cash, the same benchmark’s cash-only figure is roughly $1,200 a cow.',
    ],
    howLabel: 'Your own number',
    how: [
      'Cattle settings — cow, feed, pasture, vet and other, per head. Fill those in and this page uses your total instead.',
      'Or type straight over the figure here: it is kept in this browser for this ranch and changes nothing else.',
    ],
  },

  // ── The keep-this-many table, column by column (Sam, 29 Oct 2026:
  //    "for the grass column have a little info symbol ... do the same for
  //    each column"). Each says where its figure comes from and what moves it.

  keepColumn: {
    title: 'Keep',
    body: [
      'One row for every number of this fall’s heifer calves you could keep back as replacements. The rest are sold.',
      'The rows step in fives when there are more than 60 calves, twos over 20, otherwise one at a time — and whatever the step, four rows are always there: none kept, the number that holds the herd where it is, the number recommended, and keeping them all.',
      '“recommended” is the app’s answer, from the reason given at the top of the page. “holds herd” is just enough to replace the cows leaving: cows × (culled % + death loss %), divided by the share of heifers that breed.',
    ],
  },
  cowsNextYearColumn: {
    title: 'Cows next year',
    body: [
      'The cow herd a year from now if you keep this many: the cows you have now, less the ones culled and lost, plus the kept heifers that end up bred.',
      'cows next year = cows − cows × (culled % + death loss %) + heifers kept × heifers that breed %',
      'Cows, culled a year, death loss and heifers that breed are all in “Assumptions” below the table. Cows comes from Herd counts and death loss from Cattle settings; the other two are typed here.',
    ],
  },
  grassColumn: {
    title: 'Grass',
    body: [
      'Whether the herd in the column beside it is within what the ranch’s own grass carries. “fits” means it is; otherwise it counts the cows over: cows next year − cows the grass carries.',
      'The carrying number is worked out the way the Grazing tab works it out: every pasture’s supply in animal-unit days for the season, at the forecast rain and this ranch’s utilization rate, less what the other classes with grazing dates eat, divided by what one cow needs over her grazing days (her animal-unit equivalent × days).',
      'It counts the ranch’s own pastures only. If the cows also graze rented land, crop aftermath or a neighbour’s quarter, raise “Cows the grass carries” in Assumptions below — nothing else on the page changes it. A dash means no pastures are set up yet.',
    ],
    howLabel: 'Where to change it',
    how: [
      'Change it for this screen: “Cows the grass carries” in Assumptions, below the table.',
      'Change it properly: the Grazing tab — the pastures, their acres and the grazing dates on each class.',
    ],
  },
  heiferSalesColumn: {
    title: 'Heifer sales now',
    body: [
      'The cheque for the heifer calves you do not keep, this year: (heifer calves − kept) × what one nets at the best time to sell her.',
      'The best time is whichever of weaning, wintered or yearlings off grass nets the most a head — the three priced at the top of the page off this week’s Alberta auction quotes for that weight, less what the gain costs and the death loss while they are held.',
      'It is cash in hand this year only. It says nothing about what the kept heifers go on to be worth, which is the next column’s job.',
    ],
  },
  gainVsSellingAllColumn: {
    title: 'Gain / loss vs selling all',
    body: [
      'The whole answer in one number: keeping this many against selling every heifer calf. Above zero, keeping this many beats selling the lot.',
      'gain or loss = heifers kept × what one more kept heifer is worth, less cows over the grass × what a cow over the grass costs',
      'What one kept heifer is worth is the “Each extra heifer kept” box at the top: a bred cow’s working life in today’s money (her yearly margin discounted over her working years, plus her cull cheque at the end), weighted by the share that breed, with the open ones sold as yearlings, less what it costs to develop her — and then less what she would have fetched sold now.',
      'The sale cheque in the column beside it is NOT subtracted again. It is already in there: a kept heifer is counted against the sale she gave up.',
    ],
    howLabel: 'The blank rows',
    how: [
      'Blank rows read “over the grass — set its cost”: that herd is bigger than the grass carries, and until you say what a cow over the grass costs there is no honest total. Click those words, or set “A cow over the grass” in Assumptions — rented pasture, extra hay, whatever carrying her takes.',
    ],
  },
} satisfies Record<string, CattleHelp>

export type CattleHelpKey = keyof typeof CATTLE_HELP
