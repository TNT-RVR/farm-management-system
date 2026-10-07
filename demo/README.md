# The demo

A copy of the app that anyone can try without an account: a made-up farm,
**Prairie Creek Farm**, already filled in, running entirely in the visitor's
own browser.

- **Nobody shares anything.** Each visitor gets their own copy of the farm,
  kept in their browser. Changes they make are theirs alone.
- **It resets overnight.** The next day, or when a new version of the demo is
  published, the browser throws its copy away and unpacks a fresh one. The
  badge's **Reset** button does the same on demand.
- **Nothing is sent anywhere.** There is no server and no database behind the
  demo site. The AI features show pre-written examples, clearly labelled, and
  connections to outside services (John Deere, FieldNET, QuickBooks, email,
  phone notifications) say they aren't available in the demo.

## How it works

| Piece | What it does |
| --- | --- |
| [PGlite](https://pglite.dev) with PostGIS | Real Postgres, compiled to WebAssembly, running in a worker in the page |
| [tinbase](https://github.com/tinbase/tinbase) | Answers the app's Supabase calls (data, sign-in, storage) from that Postgres, so the app's own code is unchanged |
| `client/supabase.ts` | Stands in for `src/lib/supabase.ts` in the demo build: starts the worker, signs the visitor in, shows the loading screen and the badge |
| `client/api-examples.ts` | Answers the app's `/api/...` calls: example AI results, and "not in the demo" for the rest |
| `farm/*.sql` | The made-up farm, loaded in name order. Every date is relative to the day it is built, and moves to the visitor's today when their copy is unpacked |
| `build/build-snapshot.mjs` | Loads the schema, the starter data and the farm into PGlite, signs up the demo account, and writes the database as one file the browser downloads |
| `build/patch-tinbase.mjs` | A fix to tinbase that the demo needs: it reads the schema's structure from Postgres's catalogue instead of `information_schema`, which takes minutes on a schema this size in the browser |

## Building it

```bash
npm run build:demo
```

Output goes to `demo/dist`, ready to publish as a static site (a Netlify site
with **demo** as its base directory picks up `demo/netlify.toml`).

To test a change to the farm without building the site:

```bash
npm run check:demo
```

Both read the schema from `supabase/migrations/00000000000000_schema.sql` and
the starter data from `supabase/seed/reference_data.sql`. Pass
`-- --schema <file> --seed <file>` to use others.

## What visitors need

A recent browser (from roughly the last five years) with a few hundred MB of
memory free. The first visit downloads about 50 MB (the database engine,
PostGIS and the farm), best on Wi-Fi; the browser keeps it, so later visits
open in a few seconds.
