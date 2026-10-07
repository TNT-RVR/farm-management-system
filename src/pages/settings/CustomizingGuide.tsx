import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Fold } from '@/components/Fold'

/**
 * The pieces Farm setup cannot change yet, with what to gather and a prompt to
 * paste into an AI assistant — on the setup screen itself, so nobody has to go
 * looking through the repository's docs. docs/CUSTOMIZING.md in the public copy
 * says the same; keep the two in step.
 */

type Guide = {
  key: string
  title: string
  /** One line: what this is. */
  what: string
  gather: { text: string; href?: string }[]
  prompt: string
  /** What to do instead if the farm does not need it at all. */
  skip: string
}

const GUIDES: Guide[] = [
  {
    key: 'river',
    title: 'River gauges',
    what: 'The River page shows flow at the gauges that matter to your water, and warns when a release upstream is on its way. It is built around the original farm’s rivers.',
    gather: [
      { text: 'The station number (like 05AD007) of the gauge nearest each place you take water.', href: 'https://wateroffice.ec.gc.ca' },
      { text: 'Optionally, two to four gauges upstream of you — a dam outflow, the main tributaries — for the early warning.' },
      { text: 'If you have more than one site on different water, which gauge goes with which site.' },
      { text: 'Outside Canada: the USGS site numbers instead, and say so in the prompt.' },
    ],
    skip: 'Not on a river? Switch off “River levels” in the list above.',
    prompt: `I want the River page in this app to show my own river gauges instead of the
original farm's. The gauges are defined in src/lib/river.ts (RIVER_RANCHES,
OLDMAN_STATIONS, INFLOW_STATIONS, MAP_STATIONS) and read by
src/pages/irrigation/IrrigationRiver.tsx, src/pages/irrigation/RiverMap.tsx and
src/pages/IrrigationPage.tsx. The alert gauge is stored in the database
(farms.river_station_number, farms.river_station_name, and the river_watch
table's upstream_station / upstream_stations), used by
netlify/functions/river-watch.mts.

My setup:
- Sites and the gauge each one takes water from:
  <site name> — <station number> <station name>
- Upstream gauges for the early warning (upstream first):
  <station number> <station name>
- [Optional] The gauges are not in Canada: they are USGS sites, so the data
  source needs changing too.

Please:
1. Replace the station lists in src/lib/river.ts with mine, renaming
   OLDMAN_STATIONS to something neutral like HOME_STATIONS if you change it,
   and RIVER_RANCHES to my site names. Keep the shapes the components expect.
2. Write a new SQL migration in supabase/migrations (never edit old ones) that
   sets farms.river_station_number / river_station_name and the river_watch
   upstream stations to mine, and tell me how to run it.
3. Update any text on the River page that names the original rivers.
4. Run npx tsc -b and npx vitest run and fix anything that breaks.
Show me what you changed and how to check each gauge against its page on
wateroffice.ec.gc.ca.`,
  },
  {
    key: 'stations',
    title: 'Weather stations for irrigation scheduling',
    what: 'The soil-moisture model needs a daily weather record near each field to work out how much water the crop used. (Forecast places for the Weather page are set above — no code needed.)',
    gather: [
      { text: 'The weather stations nearest your fields, with latitude, longitude and elevation.' },
      { text: 'In Canada, each station’s Environment Canada climate ID.', href: 'https://climate.weather.gc.ca/historical_data/search_historic_data_e.html' },
      { text: 'In Alberta you can also use the agriculture network (ACIS).', href: 'https://acis.alberta.ca' },
      { text: 'No station nearby, or outside Canada: ask for Open-Meteo instead — it works for any coordinate.' },
    ],
    skip: 'Not irrigating? Switch off “Irrigation” in the list above.',
    prompt: `The irrigation soil-moisture model in this app needs daily weather for my
fields. Stations are rows in the weather_stations table (name, climate_id,
eccc_climate_id, acis_file_name, lat, lon, elevation_m, active), each field
points at one through fields.assigned_station_id, and the daily fetch is in
netlify/functions/irrigation-sync.mts (ACIS files via acis_file_name,
Environment Canada via eccc_climate_id; farms.weather_source picks which).

My stations:
- <name>, lat <..>, lon <..>, elevation <..> m, Environment Canada climate ID <..>
[Optional: I am outside Canada / have no station near me — use Open-Meteo for
my field coordinates instead.]

Please:
1. Write a new SQL migration (never edit old ones) that marks the original
   farm's stations inactive and inserts mine, and sets farms.weather_source to
   'eccc' if I gave Environment Canada IDs.
2. Make sure every one of my fields gets its nearest active station assigned
   (there is assignment logic in irrigation-sync.mts; reuse it).
3. If I asked for Open-Meteo, add it as a third weather_source in
   irrigation-sync.mts with the same daily fields the others return.
4. Run npx tsc -b and npx vitest run.
Then tell me how to run the migration and how to trigger one sync to check a
field's daily weather filled in.`,
  },
  {
    key: 'meter',
    title: 'Grain moisture meter',
    what: 'Harvest → Moisture turns a meter reading into grain moisture. It is built for the Model 919 meter, which reads a dial number converted with Canadian Grain Commission charts.',
    gather: [
      { text: 'Your meter’s make and model.' },
      { text: 'Whether it shows moisture % directly (most modern meters) or a reading that needs a chart.' },
      { text: 'If it needs charts: the official conversion chart for each crop you test, with the sample weight and calibration setting each one assumes.' },
    ],
    skip: 'Have a Model 919? Nothing to change.',
    prompt: `Harvest → Moisture in this app converts Model 919 meter readings using
Canadian Grain Commission charts (src/lib/moisture.ts, data in
src/data/919-charts, UI in src/pages/harvest/MoistureTester.tsx,
MoistureSteps.tsx and MoistureGuide.tsx). My meter is a <make and model>.

[Choose one]
A) It shows moisture % directly. Change the Moisture tab so I just enter the %
   and the crop; keep the safe-storage grading from src/lib/moisture.ts; hide
   the dial/temperature/chart steps and the 919-specific instructions. Keep the
   919 path available behind a "Model 919" choice in case someone else needs it.
B) It needs conversion charts. I have attached them. Add them alongside the 919
   charts in the same MoistureChart shape (see the type in src/lib/moisture.ts),
   with a meter choice so the tester uses the right charts. Never extrapolate
   off the end of a chart.

Update the help text in MoistureGuide.tsx to describe my meter, run
npx tsc -b and npx vitest run, and add a test that converts one reading I can
check by hand against my chart: <crop>, reading <..> at <..> °C should be <..> %.`,
  },
  {
    key: 'district',
    title: 'Irrigation district',
    what: 'Name your district in Names and defaults above, or switch “Irrigation district allotment” off. Two things don’t follow that switch yet — the canal section of the soil-moisture PDF and the end-of-April allotment reminder — and the season’s allotment is read from the original district’s website.',
    gather: [
      { text: 'Whether you are in an irrigation district at all.' },
      { text: 'If you are: where it publishes the season’s allotment (a web page, a letter, an email) and your contracted inches per acre.' },
    ],
    skip: 'Pump only under your own licence? Use option A in the prompt.',
    prompt: `This app tracks irrigation district allotments. The farm's district name is in
farm_setup.irrigation_district_name (read with useFarmSettings().districtName
in the browser and farmDistrict() from src/lib/farm-context.ts on the server),
and the feature switch is useFeature('district_allotment') /
featureOn(features, 'district_allotment') from src/lib/farm-setup.ts.

[Choose one]
A) I am NOT in a district. Make everything district-specific respect the
   switch when it is off:
   - the canal / allotment section of the PDF in
     src/pages/irrigation/IrrigationGraph.tsx should not print;
   - remindWaterAllotment in netlify/shared/lease-reminders.ts should not send
     (the server can read farm_setup.features with the service-role client it
     already has);
   - the smrid-* scheduled functions should exit early.
B) I AM in a district: <name>. It publishes the season's allotment at <URL or
   "by letter">; my contract is <..> inches per acre.
   - Do everything in A for the switch-off case anyway.
   - Make the allotment reader in netlify/shared/smrid-allotment.ts work for my
     district if it publishes on a web page, or otherwise give me a simple way
     to enter the season's allotment by hand on the Allocation screen.
   - Use <..> inches as the default contract instead of the original 18.

Run npx tsc -b and npx vitest run, and tell me how to check each change.`,
  },
]

/** A prompt in a box with a Copy button. Shared by the import hints. */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (an old browser, a blocked permission): the text is
      // selectable below, so it can still be copied by hand.
    }
  }
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">Prompt for your AI assistant</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-700">
        {text}
      </pre>
      <p className="mt-1 text-[11px] text-gray-500">
        Fill in the parts in &lt;angle brackets&gt;, then paste it into Claude, ChatGPT or another assistant with
        this app&apos;s code open.
      </p>
    </div>
  )
}

/** On Farm setup: the remaining pieces, each with what to gather and a prompt to copy. */
export function CustomizingGuide() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Fitting the rest to your farm</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        These were built around the original farm and still need a small code change. Each says what to gather
        and gives a prompt to paste into your AI assistant. Check the result against the source before relying
        on it — this is a prototype.
      </p>
      <div className="mt-3 space-y-2">
        {GUIDES.map((g) => (
          <Fold key={g.key} title={g.title} storageKey={`customize-${g.key}`}>
            <p className="text-sm text-gray-700">{g.what}</p>
            <p className="mt-2 text-xs font-medium text-gray-700">What to gather</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
              {g.gather.map((x) => (
                <li key={x.text}>
                  {x.text}{' '}
                  {x.href && (
                    <a
                      href={x.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <CopyPrompt text={g.prompt} />
            <p className="mt-2 text-xs text-gray-500">{g.skip}</p>
          </Fold>
        ))}
      </div>
    </section>
  )
}
