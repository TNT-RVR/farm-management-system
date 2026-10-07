# What it costs to run, and how to set up each service

Every outside service the app uses, what you get free, what the paid plan
adds, which one to pick, and how to set it up.

Prices are in **US dollars** (multiply by about 1.4 for Canadian), as listed
by each company in **October 2026**. They change; check the linked pricing
page before you sign up for anything.

## The short answer

| | Free setup | Recommended setup |
| --- | --- | --- |
| Website (Netlify) | $0, works if you rarely change the code | $20/month Pro |
| Database (Supabase) | $0 for the first months | $25/month Pro |
| AI (Anthropic) | $0 with AI features off | about $10–40/month, pay as you go |
| Satellite imagery | $0 (Copernicus, 10 m) | $0, unless you want 3 m daily (see below) |
| Everything else | $0 | $0 |
| **Total** | **$0/month** | **about $55–85/month, $660–1,020/year** |

The farm this was built on (about 2,200 acres of crop, plus cattle) runs the
recommended setup. In a month with heavy code changes it pays about $95,
because every update to the site uses Netlify credits (see Netlify below).

---

## The three that can cost money

### 1. Website: Netlify

Hosts the app and runs its server functions and about forty scheduled jobs.

| Plan | Price | Credits a month | Extra credits |
| --- | --- | --- | --- |
| Free | $0 | 300 | none: the site stops until next month |
| Personal | $9/month | 1,000 | $5 per 500 |
| **Pro** | **$20/month** | **3,000** | **$10 per 1,500** |

What uses credits: **each deploy (each update to the site) is 15 credits**,
plus 10 per GB-hour of function running time, 20 per GB of traffic and 2 per
10,000 requests.

**Which to pick.** Start on **Free** while you set up. The scheduled jobs and
a few dozen deploys while you customize will likely use up 300 credits. Move
to **Personal** once you're past setup and updating rarely, or to **Pro** if
you or your AI assistant change the code often. A month of daily changes can
mean 300–400 deploys, which is 4,500–6,000 credits on deploys alone. The
cheapest saving is fewer, bigger updates: batch changes instead of deploying
each one.

**Set it up:** [SETUP.md, step 3](../SETUP.md#3-the-website-netlify). To
watch usage: Netlify → your team → **Usage & billing**. Set a credit alert
there, and turn auto top-up on or off to choose between paying for overage
and the site pausing.

[Netlify pricing](https://www.netlify.com/pricing/)

### 2. Database: Supabase

Holds everything: fields, records, maps, readings, sign-ins.

| | Free | **Pro ($25/month)** |
| --- | --- | --- |
| Database size | 500 MB | 8 GB included |
| Server | shared | Micro, covered by the $10/month compute credit |
| Pauses when idle | after 1 week without activity | never |
| Backups | none | daily, kept 7 days |
| Point-in-time restore | not available | $100/month extra per 7 days (optional) |
| Data transfer | 5 GB | 250 GB |

**Which to pick.** **Free** is fine for trying it out. Move to **Pro**
before you rely on it: a farm's first year of satellite readings, machine
passes and records lands close to 500 MB (the original farm was at 485 MB
after about a year), and Free has no backups. Point-in-time restore is not
needed by most farms; daily backups are enough.

**Set it up:** [SETUP.md, step 2](../SETUP.md#2-the-database-supabase). To
upgrade: Supabase → your organization → **Billing → Change plan**. Leave the
compute size at **Micro**; it's free on Pro and has been enough.

[Supabase pricing](https://supabase.com/pricing)

### 3. AI: Anthropic (Claude)

Reads chemical labels, scale tickets, meter and bin-cable photos and voice
notes. Writes rotation and soil advice, finds grants and events, and
fills in grazing rules from labels.

There is no free plan and no subscription: you buy credit and each request
uses some. What the app uses:

| Model | Used for | Price per million tokens, in / out |
| --- | --- | --- |
| Claude Sonnet | most features | $2–3 in / $10–15 out |
| Claude Opus | rotation advice and soil write-ups | $4 in / $20 out |
| Claude Haiku | small summaries | $1 in / $5 out |

(The prices are per million *tokens*; a token is about three quarters of a
word.)

**What it costs.** About **$10–40 a month** for one farm. The big users are
the weekly label refresh (reading new chemical labels) and anything you ask
for advice on. A photo read or a voice note costs a cent or two.

**Which to pick.** Put **$20** of credit on and watch it for a month. With
no key, the AI features simply don't appear and everything else works.

**Set it up:**

1. Sign up at [console.anthropic.com](https://console.anthropic.com).
2. **Billing → Add credit.** Turn on auto-reload with a monthly limit so a
   runaway job can't surprise you.
3. **API keys → Create key**, and copy it.
4. In the app: **Settings → Farm setup → Connections and keys → AI key**,
   paste it, save. Press **Generate** next to **Background jobs key** too.
5. Check spending any time under **Usage** in the console.

[Anthropic pricing](https://www.anthropic.com/pricing#api)

---

## Satellite imagery: free 10 m or paid 3 m

The app tracks crop health (NDVI and related indices), crop water use and
field photos from satellites.

| | **Copernicus (free, the default)** | Planet (paid) |
| --- | --- | --- |
| Satellite | Sentinel-2 | PlanetScope |
| Detail | 10 m pixels (a pivot circle is about 5,000 pixels) | 3 m pixels, about 11 times as many |
| How often | every 5 days or so, if it's clear | daily, if it's clear |
| Moisture index (NDMI) | yes | **no**: PlanetScope has no short-wave infrared |
| History | back to 2017 | 2 years with the agriculture plan |
| Free allowance | 10,000 processing units a month; past that it slows, it doesn't bill | none |
| Cost | $0 | per hectare per year, plus a platform plan |

**What Planet would add to the bill.** Planet sells its agriculture plan in
500-hectare (about 1,235-acre) blocks, priced by region. Its regions run
from $0.35 to $1.80 per hectare per year, and Planet decides which one
applies to you. You also need a platform plan to process the images; the
smallest listed is about $28/month.

| Your crop area | Blocks | Imagery per year | + platform | **Added per month** |
| --- | --- | --- | --- | --- |
| up to 1,235 ac (500 ha) | 1 | $175–900 | $336 | **about $40–105** |
| up to 2,470 ac (1,000 ha) | 2 | $350–1,800 | $336 | **about $55–180** |
| up to 4,940 ac (2,000 ha) | 4 | $700–3,600 | $336 | **about $85–330** |

So the recommended setup's $55–85/month would become about **$110–265/month**
for a 2,000-acre farm with Planet.

**Which to pick.** **Copernicus.** It's free, and 10 m is enough to see a
pivot's dry wedge, a plugged nozzle strip or a drowned-out low spot. Planet
earns its price only if you need to act within a day, such as daily
irrigation checks in a cloudy week or spotting a pest early, or you farm many
small fields where 10 m pixels blur the edges. Ask Planet for a quote: farm
volume pricing isn't listed.

**Set up Copernicus (free):**

1. Register at [dataspace.copernicus.eu](https://dataspace.copernicus.eu).
2. Open the [Sentinel Hub dashboard](https://shapps.dataspace.copernicus.eu/dashboard/)
   → **User settings → OAuth clients → Create**. Copy the client ID and the
   secret; the secret is shown only once.
3. In the app: **Settings → Farm setup → Connections and keys → Satellite
   imagery**: paste both, and type `true` in *Fetch imagery automatically*.
4. New images arrive overnight. Usage shows on the same dashboard.

**Set up Planet (paid, optional):** after you have a subscription, Planet
gives you an OAuth client (ID and secret) and a collection ID for your area.
Add `PLANET_SH_CLIENT_ID`, `PLANET_SH_CLIENT_SECRET` and
`PLANET_SH_COLLECTION_ID` as Netlify environment variables, then redeploy.
Copernicus stays the nightly default; Planet is used only where asked for, so
a trial can't quietly use up the season's allowance. Have your AI assistant
read `src/lib/sat-provider.ts` first.

[Planet agriculture pricing](https://www.planet.com/pricing/agriculture/) ·
[Copernicus quotas](https://documentation.dataspace.copernicus.eu/FAQ.html)

---

## Free, and nothing to set up

These work as soon as the app is running. No account, no key.

| Service | What it gives the app | Limits |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com) | forecasts, past weather, frost and heat watch, seasonal outlook | free for non-commercial use, 10,000 calls a day (the app uses a few hundred). A business using it commercially needs a paid plan from $29/month. |
| Environment Canada (MSC GeoMet, Water Office) | weather stations, radar rain per field, river levels | free |
| Alberta Rivers, Alberta Open Data, AGRASID | river and reservoir levels, input prices, soil maps | free; Alberta only |
| USDA NRCS (SNOTEL) | snowpack for the irrigation outlook | free |
| Health Canada pesticide labels (PMRA) | the chemical registry and label PDFs | free |
| Statistics Canada, Bank of Canada, DTN, NRCan | crop, fertilizer and fuel prices, exchange rate | free |
| Microsoft Planetary Computer | Landsat imagery, older than Sentinel | free |
| Esri World Imagery | the satellite base map | free with attribution |
| OSRM | road distances | free public server |
| Auction markets, farm news sites | cattle prices, news | free |
| Web push notifications | phone alerts | free (see SETUP.md for the keys) |

## Free, but you need an account or the equipment

| Service | What it gives the app | Cost | Set it up |
| --- | --- | --- | --- |
| **GitHub** | your copy of the code; the nightly backup and update jobs | free; private repositories get 2,000 job minutes a month, far more than this uses | [SETUP.md step 1](../SETUP.md#1-your-own-copy-of-the-code) |
| **John Deere Operations Center** | fields, boundaries, every pass, yield, work orders | API free; needs your Operations Center org | developer.deere.com → create an application → **Redirect URI** `<your site>/api/jd-callback` → paste the ID and secret in Farm setup → **Connect John Deere** in the app. Deere approves new applications, which can take a few days. Also needs `TOKEN_ENC_KEY` (SETUP.md). |
| **Lindsay FieldNET** | live pivot position, water applied, faults | API free; needs FieldNET on your pivots (Lindsay's subscription) | Ask Lindsay for developer access → callback `<your site>/api/fieldnet/callback` → paste the ID and secret in Farm setup → **Connect FieldNET**. |
| **Email for invites** | sign-up and password emails to your staff | Supabase's built-in sender only reaches your own team, a couple an hour. [Resend](https://resend.com) is free for 3,000 a month (100 a day) | Resend → add your domain → **API keys** → in Supabase, **Authentication → Emails → SMTP Settings**: host `smtp.resend.com`, port 465, user `resend`, password = the key. A Gmail app password also works for a small crew. |
| **Gmail + Apps Script** | forwards emailed reports (hail inspections) into the app | free | a new plain Gmail address → set `INBOUND_EMAIL_SECRET` (Netlify, a long random string) and `INBOUND_EMAIL_SENDERS` (Farm setup) → paste `docs/inbound-email.gs` into [script.google.com](https://script.google.com) under that account, fill in your site address and the same secret → **Triggers → Add trigger**, `forwardDocuments`, time-driven, every 15 minutes |
| **Google Sheets** | reads a daily feeding sheet | free | Google Cloud → a service account → share the sheet with its email → Farm setup → *Feed sheet* |
| **eShepherd** | heat and pregnancy from collars | needs eShepherd collars (their pricing) | ask eShepherd for your herd's public dashboard link; the long code in it is the token. Farm setup → *eShepherd collars*. |
| **QuickBooks Online** | reads your books (bills, expenses, invoices and their PDFs) for finance users; never writes | API free; needs a QuickBooks Online subscription (Intuit's pricing) | create an app at [developer.intuit.com](https://developer.intuit.com) → redirect URI `<your site>/api/quickbooks/callback` → paste the ID and secret in Farm setup → *QuickBooks Online* → **Connect**. Start with the sandbox keys. Intuit's production questionnaire, with the answers about what the app does: [docs/QUICKBOOKS.md](QUICKBOOKS.md). Also needs `TOKEN_ENC_KEY` (SETUP.md). |
| **SolisCloud** | what your solar panels made, hourly | free; needs Solis inverters on SolisCloud | email Solis support to ask for API access → on a computer, soliscloud.com → **Service → API Management → Activate** → **View Key** gives the KeyID, KeySecret and API URL → Farm setup → *SolisCloud solar* → switch **Solar** on |
| **Authenticator sign-in** | an optional second step at sign-in (a 6-digit code), per person | free; any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and the like) | each person turns it on under **Settings → My account → Sign-in security**. An admin can reset a lost one under **Users**. Supabase has it switched on by default; check **Authentication → Multi-Factor** shows TOTP enabled |
| **Staff time-off calendar** | who is away, on the calendar and the Monday meeting | free; uses the calendar link most HR, payroll and shared calendars (Google, Outlook) can give you | on your HR system's time-off page, find **Subscribe** or **Calendar feed** and copy the link (it starts `webcal://` or `https://`) → Farm setup → *Staff time off* → paste it → switch **Staff time off** on → press **refresh** on the Calendar page |

## Keeping the bill down

- **Batch your changes.** On Netlify every deploy is 15 credits, and that's
  where most overage comes from.
- **Switch off what you don't use** in Settings → Farm setup. Its pages
  disappear and its AI calls stop.
- **Set limits** on everything that has them: a Netlify credit alert, an
  Anthropic monthly limit, a Supabase spend cap (on by default on Pro).
- **Skip point-in-time restore** unless losing a day of entries would really
  hurt; the daily backups cover most mistakes.
