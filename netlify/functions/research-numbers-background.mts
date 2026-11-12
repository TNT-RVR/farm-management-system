import { admin, json, requireManager } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { SONNET_5 } from '../shared/anthropic.ts'
import { runNumbersPass } from '../shared/research-numbers-core.ts'

/**
 * Reading the figures out of the papers, somewhere it has time to finish.
 *
 * A background function is documented to get fifteen minutes. What it gets
 * here is 300 seconds, so this works to 270 of them and leaves the rest.
 * Pressing the button again carries on: every passage read is written to
 * research_passages_read as the run goes, so nothing is paid for twice even
 * when the function is killed mid-pass.
 *
 * Manager-only. It spends money on the model, so it is not something an open
 * endpoint or a stray link should be able to start.
 *
 * There is deliberately no cron. The library grows when someone runs an
 * ingest, not on a clock, and the farm has been bitten before by scheduled
 * functions quietly eating the Netlify budget.
 */
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can read the papers for figures' }, 403)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'No ANTHROPIC_API_KEY is configured' }, 500)
  const model = process.env.ANTHROPIC_MODEL ?? SONNET_5

  const body = (await req.json().catch(() => ({}))) as {
    limit?: number
    redo?: boolean
    paperId?: string
  }

  try {
    const result = await runNumbersPass(sb, apiKey, model, {
      // Fifteen minutes is what a background function is documented to get.
      // What it gets here is 300 seconds: the first full pass logged
      // "Duration: 300922 ms" and stopped, and a second invocation had to
      // finish the queue. So the budget is four and a half minutes, which
      // leaves room for the passage in hand to finish and be recorded before
      // the function is killed. Progress is kept either way, because every
      // passage read is written to the ledger as it goes.
      budgetMs: 270_000,
      ...(typeof body.limit === 'number' ? { limit: Math.max(1, Math.min(2000, body.limit)) } : {}),
      ...(body.redo === true ? { redo: true } : {}),
      ...(body.paperId ? { paperId: body.paperId } : {}),
    })
    // No heartbeat: this runs when someone presses the button, not on a
    // clock, so "no run in 48 h" is normal and the health monitor alarmed on
    // it (9 Nov 2026). The person who pressed it sees the result or the error.
    console.log(`[numbers] ${result.detail}`)
    return json({ ok: true, ...result })
  } catch (err) {
    const detail = (err as Error).message.slice(0, 300)
    console.error(`[numbers] ${detail}`)
    return json({ error: detail }, 500)
  }
}
