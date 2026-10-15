import { admin, json, requireManager } from './_jd.mts'
import { runFullIngest } from '../shared/sat-run.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered satellite pull, as a BACKGROUND function.
//
// The synchronous version returned 504 the moment the ingest went from three
// fields to twenty-nine. Netlify gives a normal function ten seconds; a full
// run over every field touches four providers and several hundred HTTP calls
// and takes minutes. A background function returns 202 straight away and gets
// fifteen.
//
// Nothing about the run itself changed — the same runFullIngest, the same
// order, the same per-scene skip. What changed is that nobody is holding a
// connection open waiting for it, which was never a sensible thing to do with
// work of this shape.
//
// The trade is that the caller gets no result. It cannot: the response is sent
// before the work starts. Progress is read from the tables afterwards —
// sat_api_usage for what was called, sat_season_coverage for what landed.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can run the satellite ingest' }, 403)
  }
  const url = new URL(req.url)
  const days = Number(url.searchParams.get('days') ?? 14)
  const fieldsParam = url.searchParams.get('fields')
  const limitFields = fieldsParam ? Number(fieldsParam) : undefined
  const reprocess = url.searchParams.get('reprocess') === '1'

  const result = await runFullIngest(sb, { days, limitFields, reprocess })
  // Logged rather than returned: by now the 202 is long since sent, and the
  // function log is the only place this can still be read.
  console.log('Satellite ingest:', JSON.stringify(result))
  return json(result, result.ok ? 200 : 502)
}
