# Notes for the AI assistant working on this project

You are helping a farmer adapt the Farm Management System to their own
operation. They may not be a programmer. Explain what you change in plain
words, make the change yourself rather than handing them commands, and when
you do give a command, say which folder and which terminal it runs in.

This is a **prototype with no warranty** (see DISCLAIMER.md). Keep
DISCLAIMER.md and the warning at the top of README.md in any copy you help
make. When the farmer relies on a formula or a recommendation from the app,
remind them to check it against the label or a qualified professional.

## What this is

A farm and ranch management web app, installable on a phone.

- **Front end:** React 19 + TypeScript + Vite, Tailwind for styling, MapLibre
  for maps, Recharts for charts, TanStack Query for data fetching and offline
  caching. Pages are in `src/pages/`, shared logic in `src/lib/`, pieces of
  UI in `src/components/`.
- **Database:** Supabase (Postgres with PostGIS). The whole schema is in
  `supabase/migrations/`. Row-level security is on for every table: signed-in
  users read, and managers write most things. `src/lib/database.types.ts` is
  written by hand to mirror the schema and must be kept in sync.
- **Server:** Netlify Functions in `netlify/functions/` (one file per
  endpoint or scheduled job) with shared code in `netlify/shared/`. A file
  exporting `config.schedule` is a scheduled job. Scheduled jobs can't be
  called over HTTP and time out at about 30 seconds, so long work goes in a
  `-background` function.
- **Branding:** `src/config/brand.ts`. The name, logo, colours and default
  map centre come from there.

## How to work in it

- Run it locally with `npm install` then `npm run dev`. That needs a `.env`
  file (copy `.env.example`) pointing at the farmer's Supabase project.
- `npm test` runs the unit tests (Vitest); `npm run build` type-checks and
  builds. Run both before calling a change done.
- **Database changes** go in a new file in `supabase/migrations/` named
  `YYYYMMDDHHMMSS_what_it_does.sql`. Never edit an old migration. Tell the
  farmer to apply it (`npx supabase db push`, or paste it into the SQL
  Editor) **before** the app code that needs it goes live.
- Any table that is audited (it has the `fn_audit` trigger) must have an
  `id uuid` primary key, or every write to it fails.
- **Authenticator sign-in is enforced in the database**, by a policy on every
  table. A migration that creates a table with row-level security must end
  with `select public.apply_mfa_policies();`, or that table is readable
  without the second step. A new server function that checks who is signed
  in must use `getUserMfa` (`netlify/shared/auth-mfa.ts`), not
  `sb.auth.getUser`.
- **Every new page** needs a lazy-loaded route in `src/App.tsx`, a tile in
  `TILES` in `src/lib/tiles.ts`, and a view in the season menu,
  `src/lib/nav-tree.ts` (`VIEW_LIST`, then list its key in its home section).
  Tests check that every view points at a real route and sits in its home
  section, and that nothing is unreachable from the home screen. Search
  (`src/lib/search/`) indexes pages and tabs; add new tabs to `tabs.ts`.
- **The menu is section › view › tabs.** Sections are grouped by season
  (Planting, Growing, Harvest, Winter) among year-round ones (Fields,
  Financials, Cattle, Equipment, Tasks & calendar, Tools, Settings). A view
  may be listed in more than one section; outside its home it shows a ↗.
  Each view has a single row of tabs (`src/components/PillTabs.tsx`, state
  in `?tab=` via `src/lib/useTab.ts`); keep it to six or fewer, the rest fold
  behind "+N ▾", and never add a second row of tabs inside a tab. A view
  key is saved in people's menu choices (`users.menu_prefs`), so never
  rename or reuse one.
- **Keep old addresses working.** When a page is split or a tab is renamed,
  add a redirect that maps the old path and `?tab=` to the new place
  (examples: `src/lib/settings-routes.ts`, the redirects in `src/App.tsx`).
  Bookmarks, notification links and alert rows in the database carry them.
- Read comments before changing the code around them. Many explain a
  real-world reason (a supplier's quirk, a unit trap such as US vs imperial
  gallons, a sensor that lies) that isn't obvious from the code.

## Adapting it to a new farm

Good first steps, in roughly this order:

1. **Settings → Farm setup in the app**, not code: name, logo, location,
   units, suppliers, which parts of the app the farm uses (*Parts of the
   app*: switching one off removes its views from everyone's menu), and a
   description of the farm. Keys go in **Settings → Connections**. Every AI feature reads that description, so a
   good one (crops, soils, water, livestock, what the farm does NOT do) is
   worth more than any prompt change. `src/config/brand.ts` is only the
   fallback before setup is saved.
2. Fields: drawn, imported, or brought across from John Deere.
3. Region: the app assumes Alberta in places, including fertilizer tables
   (`src/lib/fert-savings/alberta.ts`), the Alberta Township System
   (`src/lib/geo/`), weather sites (`src/lib/weatherSites.ts`), river and
   water stations (`src/lib/river.ts`, `src/lib/water-stations.ts`), and
   irrigation-district allotments. River levels and the irrigation district
   start switched off on a new install for this reason. Swap these for the
   farmer's own region, or leave them off.
4. Integrations: see SETUP.md and docs/RUNNING-COSTS.md. Each is off until
   its keys are set.

For the river gauges, irrigation weather stations, moisture meter and
irrigation district, docs/CUSTOMIZING.md has the specifics: which files, which
tables, and what to ask the farmer for.

## Staying up to date

The original app changes every week, and each week's changes are published
as a release with a `.patch` file. When the farmer gives you one, apply it,
keep their own changes where the two conflict, and point out any new
migration they need to run.
