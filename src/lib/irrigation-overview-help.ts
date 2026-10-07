import type { ColumnHelp } from './column-help'

/**
 * The "what is this column?" text for the AIMM Overview and the week's plan.
 * Written for whoever reads the table on a phone in the yard, not for the
 * person who built the model.
 */
export const OVERVIEW_HELP: Record<string, ColumnHelp> = {
  status: {
    title: 'Status',
    body: [
      'Where the field’s soil water stands today, from the irrigation model (the same balance AIMM keeps).',
      'OK — plenty of water in the root zone. Irrigate soon — it will reach the point the crop starts to need water within a few days. Irrigate now — it is there. Water stress — it is past it and the crop is using less water than it would like, which costs yield.',
      'The date under it is the day the balance was last worked out (every morning, or when someone presses Sync).',
    ],
  },
  total: {
    title: 'Total water',
    body: ['Rain plus irrigation on this field so far this year — every drop that landed on it, before any was lost.'],
    how: {
      label: 'Worth knowing',
      lines: [
        'Irrigation here is the gross depth pumped; some of it never reaches the roots (wind, evaporation, run-off). The crop keeps roughly the pivot’s efficiency share of it — 85% unless set otherwise.',
        'Compare it with Crop used: total water well above crop use late in the season means water was lost below the roots or ran off.',
      ],
    },
  },
  rain: {
    title: 'Rain',
    body: [
      'Rain the model counted on this field this year: the field’s own gauge when it has one, else the nearest station gauge within 10 km, else Environment Canada’s radar estimate for that spot.',
      'Rain over about 25 mm in a day partly runs off; this column is what fell, not what soaked in.',
    ],
  },
  irrigation: {
    title: 'Irrigation',
    body: [
      'Water the pivot put down this year, as FieldNET logged it, averaged over the whole field (a pass over half the circle counts as half a pass).',
      'Includes any corrections made with “Adjust irrigation amounts” on the Detailed View, and water logged by hand.',
      'The badge under it is the water allowance: how much this field may take this year, and how much of that has been used. For SMRID fields that is the district’s allotment in inches, read from smrid.com. For river pivots on a licence it is the field’s share of the licence, in acre-feet, spread over the pivot’s acres.',
      'Amber means over 85% or on pace to run out before the season ends; red means over. The field’s Water allowance card in its Detailed View has the pace and the licence.',
    ],
  },
  cropUsed: {
    title: 'Crop used',
    body: [
      'How much water the crop has actually used this season (crop evapotranspiration, ETc): the weather’s drying power that day times how big the crop was, less any day the soil was too dry to supply it.',
      'This is the number irrigation and rain have to keep up with. A field ahead of it is in good shape; one behind it has been drawing the soil down.',
    ],
  },
  lastOn: {
    title: 'Pivot last on',
    body: ['The last day FieldNET recorded this pivot putting water down. “Running now” means it is watering at this moment.'],
  },
  needs: {
    title: 'Needs water',
    body: [
      'The first day the forecast says the field reaches the point the crop starts to need water, if nothing is put on. “Now” means it already has.',
      '“Not this week” means the 7-day forecast keeps it above that point. The week’s plan below has the exact hour to start the pivot.',
    ],
  },
}

export const PLAN_HELP: Record<string, ColumnHelp> = {
  status: OVERVIEW_HELP.status,
  waterTrigger: {
    title: 'Water / trigger',
    body: [
      'The first number is the water the crop can still use in its root zone now. The second is the trigger: the level where the crop starts to struggle to pull water out and it is time to irrigate.',
      'Example: 2.1 / 1.4 in — 2.1 inches left, and the crop wants water once it is down to 1.4. The line under it divides the water above the trigger by what the crop has been using a day: “3 days of water left”.',
    ],
    how: {
      label: 'Where the trigger comes from',
      lines: [
        'Everything the soil can hold for the crop over its root depth (field capacity less wilting point), less the share the crop can take before it is stressed — about half for most crops. AIMM calls the two the total and readily available water.',
        'Sandy ground holds less, so its trigger comes sooner and passes need to be lighter and more often.',
      ],
    },
  },
  crosses: {
    title: 'Crosses',
    body: [
      'The day (and roughly the hour) the forecast says the water will fall to the trigger if no irrigation goes on.',
      '“Already” means it is below the trigger now. Past the 7-day forecast it carries on at the last week’s water use and says “extrapolated” — a rough guide, not a forecast.',
    ],
  },
  startBy: {
    title: 'Start by',
    body: [
      'When the pivot has to start so a full lap is finished before the field crosses the trigger: the crossing time less one lap.',
      'The line under it is the lap: how long one circle takes at the speed that puts on the depth needed, and that depth. A part circle takes its share of a lap.',
    ],
  },
  advice: {
    title: 'Advice',
    body: [
      'Irrigate — start by the time shown. Hold — enough rain is likely in the next two days to cover most of the pass, so waiting saves water. Watch the forecast — a fair chance of a useful rain before the start time. No water needed this week.',
      '“Shares a pump” means two fields on one pump both need to start within a day of each other — stagger them, or neither runs at full flow.',
    ],
  },
}
