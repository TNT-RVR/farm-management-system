#!/usr/bin/env node
/**
 * Build the demo farm's database snapshot.
 *
 *   node demo/build/build-snapshot.mjs [--schema f] [--seed f] [--out dir] [--check]
 *
 * Loads the public copy's schema and starter data into PGlite with tinbase in
 * front of it — the same stack a visitor's browser runs — signs up the demo
 * account (so it becomes the farm's owner, as a first sign-up does), loads the
 * made-up farm from demo/farm/*.sql in name order, and writes the whole data
 * directory as one gzipped file plus a manifest the browser reads.
 *
 * Defaults are the public copy's own paths. In the private repository, where
 * the schema only exists after the weekly job builds it, pass --schema and
 * --seed. --check builds everything and writes nothing: the way to test a
 * change to the farm data.
 *
 * Fails on any statement it was not told to expect, so a farm-data mistake or
 * a schema change the demo has not caught up with stops the deploy instead of
 * shipping a demo with holes in it.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const CHECK = args.includes('--check')
const schemaFile = path.resolve(ROOT, arg('schema', 'supabase/migrations/00000000000000_schema.sql'))
const seedFile = path.resolve(ROOT, arg('seed', 'supabase/seed/reference_data.sql'))
const outDir = path.resolve(ROOT, arg('out', 'demo/dist/demo-data'))
for (const f of [schemaFile, seedFile]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. In the private repository, pass --schema and --seed (the public copy's files).`)
    process.exit(1)
  }
}

execFileSync(process.execPath, [path.join(HERE, 'patch-tinbase.mjs')], { stdio: 'inherit' })
const { createBackend } = await import('tinbase')
const { createClient } = await import('@supabase/supabase-js')
const { openPglite, engineFor, prepareConnection, quieten, OFFLINE, DEMO_JWT_SECRET, DEMO_USER } = await import('../shared/engine.js')

const t0 = Date.now()
const step = (what) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s  ${what}`)

const pg = await openPglite()
const backend = await createBackend({ engine: engineFor(pg), jwtSecret: DEMO_JWT_SECRET, ...OFFLINE })
await quieten(backend)
step('tinbase up')

// ---------------------------------------------------------------- the schema
// A pg_dump file, statement by statement. Its SET lines are dropped (some are
// for psql only, and one turns row security off); function bodies are not
// checked while loading, because the dump creates functions before the tables
// they read — exactly as pg_dump's own header arranges.
const PSQL_LINE = new RegExp('^' + String.fromCharCode(92, 92) + '.*$', 'gm')
const clean = (sql) =>
  sql
    .replace(PSQL_LINE, '')
    .replace(/^(SET|SELECT pg_catalog\.set_config)\b.*$/gm, '')
    .replace(/^COMMENT ON SCHEMA "public".*$/gm, '')
    .replace(/^ALTER (SCHEMA|DEFAULT PRIVILEGES|PUBLICATION)\b.*$/gm, '')
    // tinbase provides its own stand-ins for these; PGlite cannot load them.
    .replace(/^CREATE EXTENSION IF NOT EXISTS "(pg_cron|pg_net|pg_stat_statements|supabase_vault)".*$/gm, '')

function statements(sql) {
  const out = []
  let cur = ''
  let dollar = null
  for (const line of sql.split('\n')) {
    cur += line + '\n'
    for (const tag of line.match(/\$[A-Za-z_]*\$/g) ?? []) dollar = dollar === null ? tag : dollar === tag ? null : dollar
    if (dollar === null && /;\s*$/.test(line)) {
      out.push(cur)
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur)
  return out.filter((s) => s.replace(/--.*$/gm, '').trim())
}

// PostGIS's browser build leaves out its row-locking and long-transaction
// helpers and one st_asgeojson overload; the dump grants rights on them.
const EXPECTED = /function public\.(addauth|checkauth|checkauthtrigger|lockrow|unlockrows|gettransactionid|longtransactionsenabled|enablelongtransactions|disablelongtransactions|postgis_extensions_upgrade|st_asgeojson)\(/

await pg.exec('set check_function_bodies = false')
const unexpected = []
let expected = 0
for (const s of statements(clean(readFileSync(schemaFile, 'utf8')))) {
  try {
    await pg.exec(s)
  } catch (e) {
    if (EXPECTED.test(e.message)) expected++
    else unexpected.push(`${e.message.split('\n')[0]}\n      in: ${s.trim().replace(/\s+/g, ' ').slice(0, 200)}`)
  }
}
step(`schema loaded (${expected} expected PostGIS-internal grants skipped)`)
if (unexpected.length) {
  console.error(`\n${unexpected.length} schema statement(s) failed:\n` + unexpected.slice(0, 30).map((u) => '  ' + u).join('\n'))
  process.exit(1)
}
await pg.exec(clean(readFileSync(seedFile, 'utf8')))
await pg.exec('set check_function_bodies = true')
step('starter data loaded')

// -------------------------------------------- the demo's own bookkeeping
// Kept out of public so the app never sees it. shift_dates moves every date
// in the farm forward to "today" when a visitor opens a fresh copy, so the
// demo never looks months old, and moves crop years on when the calendar year
// has turned since the build.
//
// One UPDATE per table moves all of its dates and years together, so a rule
// comparing two of them (valid_to after valid_from) holds throughout. And in
// two passes, via a parking spot twenty years ahead, so a unique (field, date)
// or (field, crop year) never collides with its neighbour mid-update. Twenty
// years, not more: one table checks its year lies within 2000-2100.
await pg.exec(`
  create schema if not exists demo;
  create table if not exists demo.meta (base_date date not null, built_at timestamptz not null default now());
  create or replace function demo.shift_dates(p_days integer, p_years integer default 0) returns integer
  language plpgsql as $$
  declare
    t record;
    there text;
    back text;
    n integer := 0;
    park_days constant integer := 7305;
    park_years constant integer := 20;
  begin
    if p_days = 0 and p_years = 0 then return 0; end if;
    set local session_replication_role = replica;
    for t in
      select cl.relname as tbl,
             array_agg(a.attname::text order by a.attnum) filter (where ty.typname in ('date', 'timestamp', 'timestamptz')) as dates,
             array_agg(a.attname::text order by a.attnum) filter (where ty.typname in ('int2', 'int4') and a.attname in ('crop_year', 'year')) as years
      from pg_attribute a
      join pg_class cl on cl.oid = a.attrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_type ty on ty.oid = a.atttypid
      where ns.nspname = 'public' and cl.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        and (ty.typname in ('date', 'timestamp', 'timestamptz') or (ty.typname in ('int2', 'int4') and a.attname in ('crop_year', 'year')))
      group by cl.relname
    loop
      if p_days = 0 then t.dates := null; end if;
      if p_years = 0 then t.years := null; end if;
      if t.dates is null and t.years is null then continue; end if;
      select string_agg(x, ', ') into there from (
        select format('%I = %I + make_interval(days => %s)', c, c, p_days + park_days) as x from unnest(coalesce(t.dates, '{}')) c
        union all
        select format('%I = %I + %s', c, c, p_years + park_years) from unnest(coalesce(t.years, '{}')) c
      ) s;
      select string_agg(x, ', ') into back from (
        select format('%I = %I - make_interval(days => %s)', c, c, park_days) as x from unnest(coalesce(t.dates, '{}')) c
        union all
        select format('%I = %I - %s', c, c, park_years) from unnest(coalesce(t.years, '{}')) c
      ) s;
      -- date + interval is a timestamp; assigning it to a date column casts it back.
      execute format('update public.%I set %s', t.tbl, there);
      execute format('update public.%I set %s', t.tbl, back);
      n := n + 1;
    end loop;
    return n;
  end $$;
`)

// ----------------------------------------------------------- the demo user
// Through tinbase's sign-up, like a real first sign-up: the trigger makes the
// first account the farm's active admin and owner.
await prepareConnection(pg)
const sb = createClient('http://demo.local', backend.anonKey, {
  global: { fetch: (input, init) => backend.fetch(new Request(input, init)) },
  auth: { persistSession: false, autoRefreshToken: false },
})
const up = await sb.auth.signUp({ email: DEMO_USER.email, password: DEMO_USER.password, options: { data: { full_name: 'Sam Demo' } } })
if (up.error) {
  console.error('Demo sign-up failed:', up.error.message)
  process.exit(1)
}
step('demo account created')

// ------------------------------------------------------------ the made-up farm
// As the database owner: these files are the farm's history, not a user's edits.
await pg.exec('reset role; set row_security = off')
const farmDir = path.join(ROOT, 'demo', 'farm')
const farmFiles = existsSync(farmDir) ? readdirSync(farmDir).filter((f) => f.endsWith('.sql')).sort() : []
for (const f of farmFiles) {
  try {
    await pg.exec(readFileSync(path.join(farmDir, f), 'utf8'))
  } catch (e) {
    console.error(`\ndemo/farm/${f} failed: ${e.message.split('\n')[0]}${e.detail ? `\n  detail: ${e.detail}` : ''}${e.hint ? `\n  hint: ${e.hint}` : ''}${e.where ? `\n  where: ${e.where.split('\n')[0]}` : ''}`)
    process.exit(1)
  }
}
await pg.exec(`delete from demo.meta; insert into demo.meta (base_date) values (current_date);`)
await prepareConnection(pg)
step(`farm loaded (${farmFiles.length} file${farmFiles.length === 1 ? '' : 's'})`)

// The demo user sees it all, through the security rules, the way the app will.
const signed = await sb.auth.signInWithPassword(DEMO_USER)
if (signed.error) {
  console.error('Demo sign-in failed:', signed.error.message)
  process.exit(1)
}
const probe = await sb.from('fields').select('id', { count: 'exact', head: true })
if (probe.error) {
  console.error('The demo user cannot read fields:', probe.error.message)
  process.exit(1)
}
step(`demo user sees ${probe.count} field(s)`)

if (CHECK) {
  step('check only: nothing written')
  process.exit(0)
}

// ------------------------------------------------------------------ write
await pg.exec('checkpoint')
const blob = await pg.dumpDataDir('gzip')
const bytes = Buffer.from(await blob.arrayBuffer())
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
mkdirSync(outDir, { recursive: true })
const file = `farm-${hash}.tar.gz`
writeFileSync(path.join(outDir, file), bytes)
writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify({ snapshot: file, bytes: bytes.length, baseDate: new Date().toISOString().slice(0, 10), builtAt: new Date().toISOString() }, null, 2),
)
step(`wrote ${path.relative(ROOT, path.join(outDir, file))} (${(bytes.length / 1048576).toFixed(1)} MB)`)
await backend.close()
process.exit(0)
