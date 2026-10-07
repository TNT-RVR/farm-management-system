# Setting it up

> **Before you start:** this is a prototype with no warranty. Read
> [DISCLAIMER.md](DISCLAIMER.md). Check every figure and recommendation it
> gives you before you act on it.

About an hour, most of it waiting for things to create themselves. You need
free accounts on [GitHub](https://github.com), [Supabase](https://supabase.com)
and [Netlify](https://netlify.com), and [Node.js](https://nodejs.org) 22 or
newer if you want to run it on your own computer.

**What it costs:** $0 to try. About $55–85 a month once a farm relies on it.
[docs/RUNNING-COSTS.md](docs/RUNNING-COSTS.md) lists every service, its free
and paid plans, which to pick, and step-by-step setup for each connection.

If you're working with an AI assistant, you can hand it this file and do
each step together.

## 1. Your own copy of the code

On this repository's GitHub page, click **Use this template → Create a new
repository** and make it **private**. (A *fork* of a public repository can't
be made private, and your copy will soon hold things about your farm.) If the
template button isn't there, use GitHub's **Import repository** instead.

## 2. The database (Supabase)

1. Create a new Supabase project. Pick the region closest to you and save
   the database password somewhere safe.
2. Load the schema. Either:
   - **By hand (easiest):** open **SQL Editor**, paste the whole of
     `supabase/migrations/00000000000000_schema.sql` and run it.
   - **With the Supabase CLI:** `npx supabase login`, then
     `npx supabase link --project-ref <your ref>`, then `npx supabase db push`.

   Then run `supabase/seed/reference_data.sql` the same way (paste it into the
   SQL Editor). It is starter data the app needs before you have entered any:
   a crop list, crop water-use curves, rotation rules and the like. Edit or
   delete anything that doesn't fit your farm afterwards.
3. **Make your own account — after the schema, not before.** Go to
   **Authentication → Users → Add user → Create new user**, enter your email
   and a password, and tick **Auto Confirm User**. The first account becomes
   the farm's admin and owner. (An account made before the schema is loaded
   doesn't get that, and the next person to sign up would.)
4. **Turn off public sign-up:** **Authentication → Sign In / Providers →
   Email**, untick **Allow new users to sign up**. The app is invite-only;
   with sign-up left on, anyone who finds your site address could make an
   account. Inviting people from the app still works with it off.
5. **Email that reaches your staff:** Supabase's built-in email only delivers
   to your Supabase team, a couple an hour. To invite anyone else, set up
   your own sender under **Authentication → Emails → SMTP Settings** (Resend,
   Postmark, or a Gmail app password all work).
6. From **Project Settings → API**, copy the **Project URL**, the **anon**
   key and the **service_role** key. The service_role key can read and write
   everything: it only ever goes into Netlify's environment variables, never
   into the code.

## 3. The website (Netlify)

1. **Add new site → Import an existing project**, and pick your GitHub copy.
   The build settings come from `netlify.toml`; leave them. Netlify builds
   once straight away, before it has your settings; that first build won't
   work, which is expected.
2. Under **Site configuration → Environment variables**, add:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | the Project URL |
   | `VITE_SUPABASE_ANON_KEY` | the anon key |
   | `SUPABASE_URL` | the Project URL again (for the server functions) |
   | `SUPABASE_ANON_KEY` | the anon key again (for the news feed) |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |

3. **Deploys → Trigger deploy → Deploy site.** Settings whose names start
   with `VITE_` are built into the app, so any change to one needs this step
   again.
4. Back in Supabase, **Authentication → URL Configuration**: set the **Site
   URL** to your Netlify address (e.g. `https://your-farm.netlify.app`) so
   invitation and password emails link to your site.
5. Open your site and sign in with the account from step 2.3.

## 4. Make it yours — in the app

Open **Settings → Farm setup**. The checklist at the top takes you through it:

- your farm's name, logo, location, province, time zone and units;
- **Site address** and **Notification secret** (press *Generate*) under
  *Connections and keys* — sign-in links, John Deere and phone notifications
  use them;
- your retailer, irrigation district, combine, main ranch and calf sale;
- which parts of the app your farm uses — parts built for the original farm's
  equipment (its pump-station controller, collars, contract canola report,
  staff calendar, irrigation district, retailer invoices) start switched off;
- the keys for anything you connect (below).

Then the **Getting started** card on the home screen walks through crops,
fields (draw them, import a shapefile or KML, or connect John Deere), this
year's plan and, if you run cattle, your first ranch.

For anything else, ask your AI assistant. [CLAUDE.md](CLAUDE.md) tells it how
the project fits together.

## Connections (all optional)

Step-by-step instructions and costs for each are in
[docs/RUNNING-COSTS.md](docs/RUNNING-COSTS.md).

Each stays off until its keys are set. Paste them in **Settings → Farm setup →
Connections and keys**, where they are stored so only the server can read
them. A Netlify environment variable with the same name also works, and wins
if both are set.

| Feature | Keys | Where to get them |
| --- | --- | --- |
| AI write-ups, label reading, advice, voice capture | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Background jobs (the heavier AI and data pulls) | `JOB_WORKER_KEY` | press *Generate* in Farm setup |
| John Deere Operations Center | `JD_CLIENT_ID`, `JD_CLIENT_SECRET` in Farm setup, **plus** `TOKEN_ENC_KEY` as a Netlify variable (see below) | [developer.deere.com](https://developer.deere.com); redirect URI `<your site>/api/jd-callback` |
| Lindsay FieldNET pivots | `FIELDNET_CLIENT_ID`, `FIELDNET_CLIENT_SECRET`, plus `TOKEN_ENC_KEY` | Lindsay's developer program; callback `<your site>/api/fieldnet/callback` |
| QuickBooks Online (read-only) | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` (production keys), plus `TOKEN_ENC_KEY`; `QUICKBOOKS_ENVIRONMENT=sandbox` in Netlify only to test against Intuit's sample company | [developer.intuit.com](https://developer.intuit.com); redirect `<your site>/api/quickbooks/callback`. Step-by-step, including every answer to Intuit's production questionnaire: [docs/QUICKBOOKS.md](docs/QUICKBOOKS.md) |
| Phone push notifications | `VITE_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as Netlify variables (then redeploy), and the Notification secret in Farm setup | `npx web-push generate-vapid-keys` |
| Satellite crop imagery | `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `SAT_INGEST_ENABLED=true` | [Copernicus Data Space](https://dataspace.copernicus.eu) |
| Hail reports by email | `INBOUND_EMAIL_SECRET` (Netlify), `INBOUND_EMAIL_SENDERS` | your email forwarding service |
| eShepherd collars | `ESHEPHERD_REPRO_TOKEN` | eShepherd |
| Staff time-off calendar | `TIMEOFF_ICS_URL` | the calendar subscription link on your HR or payroll system's time-off page |
| Feed sheet (Google Sheets) | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `FEED_SHEET_ID`, and the service account's key in the `app_secrets` table as `google_service_account_key` | Google Cloud |

**`TOKEN_ENC_KEY`** encrypts the stored John Deere and FieldNET sign-ins, so it
lives in Netlify, not beside them. It must be exactly 32 random bytes — a
made-up string won't work. Make one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Scheduled jobs and your Netlify plan

About forty jobs run on a schedule — weather, prices, river levels, Deere
syncs, reminders. Jobs for things you haven't connected or have switched off
skip themselves, but they still start. On Netlify's free plan, watch
**Usage** for the first week; if you're close to the limit, switch off parts
of the app you don't use in Farm setup. Each deploy costs credits too, which
matters more than the jobs while you're customizing. See
[docs/RUNNING-COSTS.md](docs/RUNNING-COSTS.md#1-website-netlify).

## Fitting the rest to your farm

Rivers, the weather stations behind irrigation scheduling, the grain moisture
meter and irrigation districts were built around the original farm. The
bottom of **Settings → Farm setup** — and [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md)
— says what to gather for each and gives a prompt to paste into your AI
assistant.

## Where it came from, and what that means for you

It was built for one farm in southern Alberta, and some parts still show it:
Alberta fertilizer tables, the Alberta Township System for land
descriptions, provincial weather and river stations, Alberta grants. Outside
Alberta those screens will be empty or need changing — a good first job for
your AI assistant.

The sample names in comments and tests (Prairie Creek Farm, Creek Flat, the
Hansens) are made up.
