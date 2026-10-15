# Fitting the last few pieces to your farm

Most of the app is set up from **Settings → Farm setup**: your name, logo,
location, units, suppliers, which parts of the app you use, and your keys.
A few pieces were built around the original farm's own surroundings and still
need a small code change to fit yours:

1. [The River page's gauges](#1-the-river-pages-gauges)
2. [The weather stations behind irrigation scheduling](#2-weather-stations-for-irrigation-scheduling)
3. [The grain moisture meter](#3-your-grain-moisture-meter)
4. [Your irrigation district (or none)](#4-your-irrigation-district-or-none)

The same instructions, with a **Copy prompt** button, are at the bottom of
Settings → Farm setup in the app.

Each section says what to gather, then gives a prompt to paste into your AI
assistant (Claude, ChatGPT or similar) with this repository open. The prompts
are written so the assistant does the work and you only supply the facts.

> **Before you start:** this is a prototype (see [DISCLAIMER.md](../DISCLAIMER.md)).
> Check the result on screen against the source — a river gauge's own page, your
> meter's chart — before relying on it.

**Don't need one of these?** Switch it off instead: Settings → Farm setup →
*Parts of the app this farm uses* (River levels, Irrigation district
allotment, and so on). Nothing is lost; it is only hidden.

---

## 1. The River page's gauges

**What it is.** The River page shows river flow at the gauges that matter to
your water — usually one near where you pump, plus a few upstream so you see a
change coming. It can also alert you when flow upstream jumps (a dam release),
with an estimate of when it will reach you. The original farm's gauges are on
the Oldman and South Saskatchewan rivers in Alberta.

**What to gather.**

- The **Water Survey of Canada station number** (like `05AD007`) of the gauge
  nearest each place you take water. Find them on the map at
  <https://wateroffice.ec.gc.ca> → *Real-time data* → search near your farm.
  Write down the station number and name for each.
- Optionally, two to four gauges **upstream** of you (a dam outflow, the main
  tributaries), for the early-warning alert.
- If you have more than one ranch or farm site on different water, which gauge
  belongs to which site.
- Outside Canada: the equivalent gauge IDs (USGS site numbers in the US) — the
  assistant will need to switch the data source too; say so in the prompt.

**Prompt to copy:**

```text
I want the River page in this app to show my own river gauges instead of the
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
  <site name> — <station number> <station name>
- Upstream gauges for the early warning (upstream first):
  <station number> <station name>
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
wateroffice.ec.gc.ca.
```

---

## 2. Weather stations for irrigation scheduling

**What it is.** The soil-moisture model (Irrigation → Soil moisture) needs a
daily weather record near each field: temperature, humidity, wind, sun and
rain, to work out how much water the crop used. Each field is assigned the
nearest station in the `weather_stations` table, and a daily job fetches its
data. The original farm uses Alberta's agriculture network (ACIS) with
Environment Canada as a fallback.

*(The forecast places on the Weather page are separate and need no code: set
them in Farm setup → Forecast places.)*

**What to gather.**

- The weather stations nearest your fields, with their **latitude, longitude
  and elevation**. In Canada, Environment Canada stations and their **climate
  IDs** are listed at
  <https://climate.weather.gc.ca/historical_data/search_historic_data_e.html>.
  In Alberta, ACIS stations are at <https://acis.alberta.ca>.
- Which provider you want the daily data from. Environment Canada works across
  Canada; ACIS only covers Alberta. Elsewhere, Open-Meteo (free, worldwide) can
  stand in for a station at any coordinate.

**Prompt to copy:**

```text
The irrigation soil-moisture model in this app needs daily weather for my
fields. Stations are rows in the weather_stations table (name, climate_id,
eccc_climate_id, acis_file_name, lat, lon, elevation_m, active), each field
points at one through fields.assigned_station_id, and the daily fetch is in
netlify/functions/irrigation-sync.mts (ACIS files via acis_file_name,
Environment Canada via eccc_climate_id; farms.weather_source picks which).

My stations:
- <name>, lat <..>, lon <..>, elevation <..> m, Environment Canada climate ID <..>
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
field's daily weather filled in.
```

---

## 3. Your grain moisture meter

**What it is.** Harvest → Moisture turns a moisture-meter reading into grain
moisture. It is built for the **Model 919** meter, which reads a dial number
rather than a percentage; the conversion comes from the Canadian Grain
Commission's published chart for each crop and temperature (stored in
`src/data/919-charts`, extracted from the PDFs in `public/919-charts`). It
refuses to guess outside a chart, on purpose.

If your meter shows **moisture % directly** (most modern meters do), you don't
need conversion charts at all — only the safe-to-store limits, which are
already editable per crop.

**What to gather.**

- Your meter's **make and model**, and whether it shows % moisture directly or
  a reading that needs a chart.
- If it needs charts: the official conversion charts for each crop you test
  (PDF or photos), and the sample weight and calibration setting each chart
  assumes.

**Prompt to copy:**

```text
Harvest → Moisture in this app converts Model 919 meter readings using
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
check by hand against my chart: <crop>, reading <..> at <..> °C should be <..> %.
```

---

## 4. Your irrigation district (or none)

**What it is.** Many irrigated farms get water from an irrigation district that
sets an allotment each season (inches per acre). The app tracks how much of it
you have used. Set your district's name in Farm setup → Names and defaults, or
switch *Irrigation district allotment* off if you pump under your own licence
only.

Two places don't yet follow that switch, and one reads the allotment from the
original district's website:

- the **PDF report** on the soil-moisture graph still prints its canal section
  (`src/pages/irrigation/IrrigationGraph.tsx`);
- the **end-of-April reminder** to check the season's allotment still goes out
  (`netlify/shared/lease-reminders.ts`, `remindWaterAllotment`);
- the allotment itself is read automatically from the original district's
  website (`netlify/shared/smrid-allotment.ts` and the `smrid-*` scheduled
  functions). For another district it has to be entered by hand, or read from
  that district's own site.

**What to gather.**

- Whether you are in a district at all.
- If you are: your district's name, where it publishes the season's allotment
  (a web page, a letter, an email), and your contracted inches per acre.

**Prompt to copy:**

```text
This app tracks irrigation district allotments. The farm's district name is in
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

Run npx tsc -b and npx vitest run, and tell me how to check each change.
```

---

## When something else needs changing

The same approach works for anything: tell your assistant what you want in
your own words, point it at [CLAUDE.md](../CLAUDE.md) first (it explains how
the project fits together), and ask it to run the tests before it finishes.
If you build something other farms would want, share it in
[Discussions → Show and tell](../../../discussions/categories/show-and-tell).
