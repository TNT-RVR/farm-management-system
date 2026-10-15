/**
 * Plain-language info buttons for the cattle planning numbers — the ones Sam
 * asked about on 5 Oct 2026 ("Not sure what you mean by either of those",
 * "Is this if we background them?", "tell me how to calculate that").
 * Each says what the number is, and what moving it does to the answer.
 */

export type CattleHelp = { title: string; body: string[]; how?: string[] }

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
} satisfies Record<string, CattleHelp>

export type CattleHelpKey = keyof typeof CATTLE_HELP
