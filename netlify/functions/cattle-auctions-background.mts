import { admin, json, requireManager } from './_jd.mts'
import { runCattleAuctions } from '../shared/cattle-auctions.ts'
import { runMarketAlerts } from '../shared/market-alerts.ts'
import { advisorModel } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { MARKET_KEYS, type MarketKey } from '../../src/lib/auction-markets.ts'

// The four auction markets' prices: Medicine Hat, Lethbridge, Calgary
// Stockyards, Team online (netlify/shared/cattle-auctions.ts).
//
// Background, because a Medicine Hat report is a scan that Claude has to read
// — up to a minute or so each — and a two-year backfill is about a hundred of
// them. Woken daily by cattle-auctions-cron with the worker key, or by a
// manager. Works for 13 minutes, then starts itself again if Medicine Hat
// reports are still waiting.
//
// POST body, all optional:
//   { "markets": ["medicine-hat"] }   only these markets
//   { "backfill": true }              the last two years
//   { "backfill": 20 }                the newest 20 Medicine Hat reports / 20 weeks of Lethbridge
//   { "force": true }                 re-read Medicine Hat reports already stored or given up on
//
// Authorised by the worker key (refused outright when unset) or a manager's
// session — never by the absence of a credential.
let workerKey = process.env.JOB_WORKER_KEY

type Body = { markets?: string[]; backfill?: number | boolean; force?: boolean }

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)

  const body = ((await req.json().catch(() => null)) ?? {}) as Body
  const markets = (body.markets ?? []).filter((m): m is MarketKey => MARKET_KEYS.includes(m as MarketKey))
  const backfill =
    body.backfill === true
      ? true
      : typeof body.backfill === 'number' && body.backfill > 0
        ? Math.floor(body.backfill)
        : undefined

  const result = await runCattleAuctions(sb, {
    markets,
    backfill,
    force: body.force === true,
    deadline: Date.now() + 13 * 60_000,
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AUCTION_READER_MODEL ?? advisorModel(),
  })

  // Alerts after the prices land, so a watch is judged on this week's sale.
  const alerts =
    result.stored > 0 ? await runMarketAlerts(sb).catch((e) => ({ detail: (e as Error).message })) : null

  // Medicine Hat still has reports waiting: carry on in a fresh run. Only
  // when this run got somewhere, so a missing key or a dead site cannot loop.
  // Not after a forced run, which would read everything again.
  const mh = result.runs.find((r) => r.market === 'medicine-hat')
  if (mh && mh.remaining > 0 && mh.stored + mh.failed > 0 && body.force !== true && workerKey && process.env.URL) {
    await fetch(`${process.env.URL}/.netlify/functions/cattle-auctions-background`, {
      method: 'POST',
      headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
      body: JSON.stringify({ markets: ['medicine-hat'], backfill }),
    }).catch(() => {})
  }

  console.log('[cattle-auctions]', JSON.stringify({ ...result, alerts }))
  return json({ ...result, alerts })
}
