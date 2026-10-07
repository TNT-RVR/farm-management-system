import { admin, json, requireManager } from './_fieldnet.mts'
import { rebuildApplied } from '../shared/fieldnet-applied.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered historical fill of applied irrigation.
//
// A background function (the `-background` filename is what makes it one)
// because it probes FieldNET once per pivot per day: a season across thirteen
// pivots is well past what a normal request should hold open.
//
// Defaults to the growing season so the common case is a bare POST. `from` and
// `to` are accepted for re-running a narrower window without re-probing months
// that are already done.
const DEFAULT_FROM = '2026-04-01'

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can backfill irrigation' }, 403)
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? DEFAULT_FROM
  // Exclusive upper bound, and tomorrow by default so today is included.
  const to =
    url.searchParams.get('to') ??
    new Date(Date.now() + 864e5).toISOString().slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
    return json({ error: 'from/to must be YYYY-MM-DD with from before to' }, 400)
  }

  try {
    // The rebuild takes inclusive local days; `to` here is exclusive.
    const last = new Date(Date.parse(`${to}T12:00:00Z`) - 864e5).toISOString().slice(0, 10)
    const result = await rebuildApplied(sb, { from, to: last })
    console.log('fieldnet backfill:', JSON.stringify(result))
    return json(result, result.ok ? 200 : 502)
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
