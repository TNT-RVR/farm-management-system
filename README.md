# Farm Management System

> [!WARNING]
> **This is a prototype, shared as-is, with no warranty.** Formulas, figures
> and advice in it may be wrong, and features may fail. It is not
> professional agronomic, veterinary, financial or legal advice. Check
> anything that matters with a qualified person and the product label. The
> authors take no responsibility for losses from using it, or from it failing.
> Read [DISCLAIMER.md](DISCLAIMER.md) before using it.

A farm and ranch management app built by a working mixed farm in southern
Alberta: irrigated crops, dryland and a cow-calf herd. It runs the
day-to-day on that farm, and this is a copy of its code with the farm's own
records, names and places taken out, so that other farms can use it and build
on it.

It's built to be **handed to an AI**. Point Claude, ChatGPT or any coding
assistant at this repository, tell it about your farm, and have it change the
app to fit. [`CLAUDE.md`](CLAUDE.md) is written for that assistant to read
first.

> **Free for farms, not for resale.** You may run it on your own farm, change it
> however you like and share your changes with other farmers. You may not sell
> it or charge others to use it. See [LICENSE.md](LICENSE.md). It's a
> prototype: see [DISCLAIMER.md](DISCLAIMER.md).

## Try it first

**[Open the demo →](https://rvr-farm-demo.netlify.app)** A made-up farm,
Prairie Creek Farm, already filled in. It runs entirely in your own browser:
change anything you like, nobody else sees it, and it resets overnight. No
account needed. The first visit downloads about 50 MB, so Wi-Fi is best; a
computer or a recent phone works best. AI features show labelled examples.

## What's in it

| Area | What it does |
| --- | --- |
| **Fields & map** | Field boundaries, a satellite map with your own layers and pins, profit and loss per field, seeding and harvest progress, a field-by-field history |
| **Crop planning** | Crop plans and financials, a rotation planner with label re-cropping rules, contracts, crop prices, hail reports |
| **Fertilizer** | Soil tests, nutrient history, requirement calculations using Alberta tables, a blend calculator, fertilizer prices, a set of money-saving tools |
| **Chemicals** | Inventory, product labels (PMRA), spray records, spray and bee weather windows |
| **Irrigation** | Pivots, pumps, soil moisture with an irrigation scheduling graph, river levels, water licences and allocations |
| **Cattle** | Herd records, grazing and pasture maps, water points and reach, a winter feed budget, daily feeding, pregnancy, cattle prices |
| **Harvest & storage** | Scale tickets, yields from loads, grain bins and inventory, grain moisture and bin temperature monitoring |
| **Running the farm** | To-do list, checklists, a Monday meeting page, calendar, monthly plan, day book, alerts and phone push notifications, search |
| **Integrations** | John Deere Operations Center, Lindsay FieldNET pivots, QuickBooks Online ([setup checklist](docs/QUICKBOOKS.md)), weather, market prices, email invoice import, and Claude for writing up advice and reports |

Each integration is off until you give it your own account or key. Nothing
here connects to anyone else's farm.

## Getting started

1. **Try it or build it.** You need free accounts on
   [GitHub](https://github.com), [Supabase](https://supabase.com) (the
   database) and [Netlify](https://netlify.com) (the website).
2. **Follow [SETUP.md](SETUP.md).** It walks through creating the database,
   loading the schema and putting the site online, in about an hour.
3. **Make it yours.** Sign in and open **Settings → Farm setup**: your name,
   logo, location, units, suppliers, which parts of the app you use, and your
   keys. A few pieces built around the original farm's rivers, weather stations
   and moisture meter need a small code change — [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md)
   has copy-and-paste prompts for your AI assistant.

**What it costs to run:** nothing to try it; about $55–85 (US) a month for a
farm relying on it, mostly hosting and the database. AI and higher-resolution
satellite imagery are optional extras.
[docs/RUNNING-COSTS.md](docs/RUNNING-COSTS.md) compares the free and paid plan
of every service and says which to pick.

## Staying up to date

The app this comes from is still being worked on every week. Every week there
are changes, and they are published here as a
[release](../../releases): a plain-English summary of what changed and a
`.patch` file containing just that week's code.

To bring a week's changes into your own copy, download the patch and give it
to your AI assistant:

> Here is this week's patch from the Farm Management System. Apply it to
> my app. Where it touches something I have changed, keep my version's
> behaviour and tell me what you did.

Each release is also posted in
[Discussions → Announcements](../../discussions/categories/announcements).

## Community

Questions, ideas, and what you've built:
**[Discussions](../../discussions)**.

- **Ideas**: features you'd like, or ones you've added and want to share
- **Q&A**: stuck on setup or on a change
- **Show and tell**: screenshots of your version running on your farm

Please don't post your own farm's private details (names, land locations,
account numbers) in public threads.

## Built with

React, TypeScript and Vite · Supabase (Postgres, PostGIS, auth, storage) ·
Netlify (hosting and serverless functions) · MapLibre · Recharts · Tailwind.
