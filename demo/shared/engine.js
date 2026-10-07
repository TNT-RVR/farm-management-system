/**
 * The demo's database: PGlite (Postgres compiled to WASM) with PostGIS and the
 * extensions Supabase turns on, wrapped in the engine shape tinbase expects.
 *
 * Shared by the snapshot build (Node) and the visitor's browser (a worker), so
 * both run the same Postgres with the same extensions — a snapshot made with
 * one set and opened with another fails to start.
 */
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { fuzzystrmatch } from '@electric-sql/pglite/contrib/fuzzystrmatch'
import { hstore } from '@electric-sql/pglite/contrib/hstore'
import { ltree } from '@electric-sql/pglite/contrib/ltree'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'

export const EXTENSIONS = { postgis, pgcrypto, uuid_ossp, pg_trgm, citext, ltree, hstore, fuzzystrmatch }

/**
 * Signs every token the demo's tinbase issues. Public on purpose: the demo
 * runs in the visitor's own browser on their own copy, so there is nothing
 * for it to protect, and a fixed value keeps a visitor's session valid across
 * the nightly reset.
 */
export const DEMO_JWT_SECRET = 'rvr-farm-demo-not-a-secret-this-runs-in-your-own-browser'

/** The demo's sign-in. Shown to visitors; the demo signs them in with it. */
export const DEMO_USER = { email: 'user-2a97@prairiecreek.example', password: 'prairie-creek-demo' }

/** Open PGlite with the demo's extensions. `options` go to PGlite as they are. */
export async function openPglite(options = {}) {
  const pg = new PGlite({ extensions: EXTENSIONS, ...options })
  await pg.waitReady
  return pg
}

/**
 * PGlite as a tinbase DbEngine (see tinbase's db/pglite-engine.js, which this mirrors).
 *
 * `alreadyBootstrapped`: the database came from a demo snapshot, which tinbase
 * built, so its start-up scripts can be skipped (see build/patch-tinbase.mjs).
 */
export function engineFor(pg, { alreadyBootstrapped = false } = {}) {
  const wrap = (q) => ({
    async query(sql, params) {
      const r = await q.query(sql, params)
      return { rows: r.rows, affectedRows: r.affectedRows }
    },
    async exec(sql) {
      await q.exec(sql)
    },
  })
  return {
    alreadyBootstrapped,
    ...wrap(pg),
    async execMany(sql) {
      return (await pg.exec(sql)).map((r) => ({ rows: r.rows, affectedRows: r.affectedRows }))
    },
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    listen: (channel, cb) => pg.listen(channel, cb),
    close: () => pg.close(),
  }
}

/**
 * tinbase options that keep the demo from reaching anything outside itself.
 *
 * tinbase really sends the HTTP requests the schema's triggers and jobs make
 * (pg_net, webhooks): saving a notification posts to "<the farm's site>/api/
 * push-send". In a visitor's browser that would call somebody's real site, so
 * every one of them is answered here, silently, and goes nowhere.
 */
const nowhere = async () => new Response(null, { status: 204 })
export const OFFLINE = { netFetch: nowhere, hookFetch: nowhere, webhookFetch: nowhere, oauthFetch: nowhere, log: () => {} }

/**
 * Stop what tinbase would otherwise run on its own. The schema's scheduled
 * jobs (weather pulls, syncs, reminders) are the real farm's; in the demo they
 * would only do work nobody asked for in the visitor's browser.
 */
export async function quieten(backend) {
  await backend.cron.stop()
}

/**
 * Settings every demo connection needs once it is open.
 *
 * row_security: PGlite's connection starts with it off, and then every table
 * with row-level security refuses queries outright ("query would be affected
 * by row-level security policy") instead of filtering them.
 */
export async function prepareConnection(pg) {
  await pg.exec('set row_security = on')
}
