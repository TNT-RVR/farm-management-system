#!/usr/bin/env node
/**
 * Two fixes to tinbase that the demo needs.
 *
 * 1. Read the schema's structure from the system catalogue. tinbase (the
 *    in-browser Supabase stand-in the demo runs on) learns tables, keys and
 *    foreign keys from information_schema. Those views join very slowly on a
 *    schema the size of this app's — 300 tables and hundreds of foreign keys —
 *    and in PGlite, single-threaded WASM, the first REST request blocked for
 *    more than ten minutes. The same facts from pg_catalog take a tenth of a
 *    second.
 *
 * 2. Skip tinbase's start-up scripts on a database that already has them.
 *    Every demo snapshot was built by tinbase, so its auth, storage, queue,
 *    cron and vault objects are there already; re-running the scripts cost
 *    every visitor a second or more at each start, on a phone more. The demo's
 *    worker marks its engine alreadyBootstrapped to take that path.
 *
 * Runs at the start of every demo build rather than on install, because npm
 * now holds back install scripts until each is approved. Idempotent: each fix
 * is applied once, and a tinbase version whose code no longer matches fails
 * the build rather than shipping a demo that hangs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let file
try {
  // Through the package's main entry (dist/index.js): its exports map does not expose package.json.
  file = path.join(path.dirname(fileURLToPath(import.meta.resolve('tinbase'))), 'db', 'database.js')
} catch {
  console.error('tinbase is not installed; run npm ci first.')
  process.exit(1)
}
if (!existsSync(file)) {
  console.error(`tinbase's layout changed: ${file} is missing.`)
  process.exit(1)
}

let s = readFileSync(file, 'utf8')
const before = s
const INTROSPECTION_MARK = '/* rvr-demo: pg_catalog introspection */'
const BOOTSTRAP_MARK = '/* rvr-demo: skip bootstrap */'

/** Replace from `start` through the first `end` after it; fail loudly if absent. */
function swap(start, end, replacement) {
  const i = s.indexOf(start)
  const j = i < 0 ? -1 : s.indexOf(end, i)
  if (i < 0 || j < 0) {
    console.error(`tinbase changed: could not find "${start.slice(0, 50)}". Update demo/build/patch-tinbase.mjs.`)
    process.exit(1)
  }
  s = s.slice(0, i) + replacement + s.slice(j + end.length)
}

// ------------------------------------------------------------- fix 1
if (!s.includes(INTROSPECTION_MARK)) {
  swap(
    'const cols = await this.engine.query(`select table_name, column_name',
    '[schema]);',
    `${INTROSPECTION_MARK}
        const cols = await this.engine.query(\`select c.relname as table_name, a.attname as column_name, t.typname as udt_name,
              case when a.attnotnull then 'NO' else 'YES' end as is_nullable, a.atthasdef as has_default
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       join pg_type t on t.oid = a.atttypid
       where n.nspname = $1 and c.relkind in ('r','v','m','p','f') and a.attnum > 0 and not a.attisdropped
       order by a.attnum\`, [schema]);`,
  )
  swap(
    'const pks = await this.engine.query(`select kcu.table_name, kcu.column_name',
    '[schema]);',
    `const pks = await this.engine.query(\`select c.relname as table_name, a.attname as column_name
       from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
       where k.contype = 'p' and n.nspname = $1\`, [schema]);`,
  )
  swap(
    'const uniq = await this.engine.query(`select kcu.table_name, kcu.constraint_name',
    '[schema]);',
    `const uniq = await this.engine.query(\`select c.relname as table_name, k.conname as constraint_name, a.attname as column_name, u.ord as ordinal
       from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       cross join lateral unnest(k.conkey) with ordinality as u(attnum, ord)
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum
       where k.contype in ('p','u') and n.nspname = $1
       order by k.conname, u.ord\`, [schema]);`,
  )
  swap(
    'const fks = await this.engine.query(`select',
    '[schema]);',
    `const fks = await this.engine.query(\`select k.conname as constraint_name,
         sn.nspname as src_schema, sc.relname as src_table, sa.attname as src_column,
         tn.nspname as tgt_schema, tc.relname as tgt_table, ta.attname as tgt_column,
         u.ord as ordinal
       from pg_constraint k
       join pg_class sc on sc.oid = k.conrelid join pg_namespace sn on sn.oid = sc.relnamespace
       join pg_class tc on tc.oid = k.confrelid join pg_namespace tn on tn.oid = tc.relnamespace
       cross join lateral unnest(k.conkey, k.confkey) with ordinality as u(src_att, tgt_att, ord)
       join pg_attribute sa on sa.attrelid = k.conrelid and sa.attnum = u.src_att
       join pg_attribute ta on ta.attrelid = k.confrelid and ta.attnum = u.tgt_att
       where k.contype = 'f' and (sn.nspname = $1 or tn.nspname = $1)
       order by k.conname, u.ord\`, [schema]);`,
  )
  if (s.includes('information_schema')) {
    console.error('tinbase still reads information_schema somewhere in database.js; check before shipping.')
    process.exit(1)
  }
}

// ------------------------------------------------------------- fix 2
if (!s.includes(BOOTSTRAP_MARK)) {
  const start = '        else {\n            await engine.exec(BOOTSTRAP_SQL);'
  if (!s.includes(start)) {
    console.error("tinbase changed: its start-up block moved. Update demo/build/patch-tinbase.mjs.")
    process.exit(1)
  }
  const vault = "await engine.query(`select set_config('app.settings.vault_key', $1, false)`, [opts.vaultKey]);"
  s = s.replace(
    start,
    [
      `        else if (engine.alreadyBootstrapped) { ${BOOTSTRAP_MARK}`,
      '            if (opts?.vaultKey) {',
      `                ${vault}`,
      '            }',
      '        }',
      start,
    ].join('\n'),
  )
}

if (s === before) console.log('tinbase already patched.')
else {
  writeFileSync(file, s)
  console.log('tinbase patched: catalogue introspection; start-up scripts skipped on a built database.')
}
