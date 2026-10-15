import { createClient } from '@supabase/supabase-js'
import {
  ensureTabs,
  feedRecordsToRows,
  googleAccessToken,
  groupByYear,
  replaceSheet,
  type SheetRecord,
} from '../shared/feed-sheet.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Mirrors the cattle feed records into a Google Sheet.
//
// Two reasons, and the second is the one that makes it worth a cron rather than
// a button. A copy outside Supabase survives this project being deleted or the
// account lapsing, the same argument as the nightly database backup. And the
// cattle manager works in paper and Sheets — this puts the records where he can
// read them without an account on anything.
//
// Nightly at 09:40 UTC, twenty minutes after the database backup, so the two
// never argue over the same rate limit.
export const config = { schedule: '40 9 * * *' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
let spreadsheetId = process.env.FEED_SHEET_ID

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  spreadsheetId = process.env.FEED_SHEET_ID
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })

  // Named individually. "Not configured" tells whoever reads the failure
  // nothing, and this job is meant to be set up by somebody who has not seen
  // this file.
  const sbEarly = createClient(url, serviceKey)

  // The private key is NOT an environment variable. With it set, Netlify's
  // builders fail `npm run build` with exit 2 on a commit that builds green
  // without it — proven by removing it and rebuilding the same commit, and not
  // fixed by marking it secret or by SECRETS_SCAN_OMIT_KEYS. Netlify does not
  // expose the build log for this project through its CLI or API, so the
  // reason is not visible from here. It lives in app_secrets instead, which is
  // the better home anyway: a build has no business holding a signing key.
  const { data: secret } = await sbEarly
    .from('app_secrets')
    .select('value')
    .eq('key', 'google_service_account_key')
    .maybeSingle()
  const privateKey = (secret?.value as string | undefined) ?? undefined

  const missing = [
    !clientEmail && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !privateKey && 'the google_service_account_key row in app_secrets',
    !spreadsheetId && 'FEED_SHEET_ID',
  ].filter(Boolean)
  if (missing.length) {
    const detail = `Not set up: ${missing.join(', ')} missing`
    console.warn(`[feed-sheet] ${detail}`)
    // Reported, not thrown. A backup that is not configured yet is a fact to
    // show on the integrations page, not a nightly alarm about a broken job.
    await sbEarly.rpc('record_integration_heartbeat', {
      p_key: 'feed_sheet',
      p_detail: detail,
      p_data_at: null,
    })
    return new Response(detail, { status: 200 })
  }

  const sb = createClient(url, serviceKey)
  const { data, error } = await sb
    .from('feed_records')
    .select(
      'herd_group, period_start, period_end, head_count, notes, ' +
        'ranches(name), ' +
        'feed_record_lines(feed_type_name, quantity, unit, lb_per_bale, purpose, sort_order)',
    )
    .order('period_start', { ascending: true })
  if (error) return new Response(error.message, { status: 500 })

  const records: SheetRecord[] = (data ?? []).map((r) => {
    const row = r as unknown as {
      herd_group: string
      period_start: string
      period_end: string
      head_count: number | null
      notes: string | null
      ranches: { name: string } | null
      feed_record_lines: {
        feed_type_name: string
        quantity: number
        unit: 'lb' | 'big_square' | 'round'
        lb_per_bale: number | null
        purpose: 'feed' | 'bedding' | 'self_feeder'
        sort_order: number
      }[]
    }
    return {
      ranch: row.ranches?.name ?? '',
      herdGroup: row.herd_group,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      headCount: row.head_count,
      notes: row.notes,
      lines: [...row.feed_record_lines]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({
          feedTypeName: l.feed_type_name,
          quantity: Number(l.quantity),
          unit: l.unit,
          lbPerBale: l.lb_per_bale == null ? null : Number(l.lb_per_bale),
          purpose: l.purpose,
        })),
    }
  })

  // An empty export would clear the sheet and call it a success — the same
  // green tick over nothing the database backup refuses to give.
  if (records.length === 0) {
    const detail = 'No feed records to export — leaving the sheet alone'
    console.warn(`[feed-sheet] ${detail}`)
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'feed_sheet',
      p_detail: detail,
      p_data_at: null,
    })
    return new Response(detail, { status: 200 })
  }

  // One tab per year, which is how the farm wants to read it back. A year that
  // has no tab yet gets one — nobody should have to remember in January.
  const byYear = groupByYear(records)
  let written = 0
  try {
    const token = await googleAccessToken(clientEmail!, privateKey!)
    const added = await ensureTabs(token, spreadsheetId!, [...byYear.keys()])
    if (added.length) console.log(`[feed-sheet] added tab(s): ${added.join(', ')}`)
    for (const [year, forYear] of byYear) {
      const rows = feedRecordsToRows(forYear)
      await replaceSheet(token, spreadsheetId!, year, rows)
      written += rows.length - 1
    }
  } catch (e) {
    const detail = (e as Error).message.slice(0, 300)
    console.error(`[feed-sheet] ${detail}`)
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'feed_sheet',
      p_detail: `Failed: ${detail}`,
      p_data_at: null,
    })
    return new Response(detail, { status: 500 })
  }

  const detail =
    `${records.length} record(s), ${written} line(s) across ` +
    `${byYear.size} tab(s): ${[...byYear.keys()].join(', ')}`
  console.log(`[feed-sheet] ${detail}`)
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'feed_sheet',
    p_detail: detail,
    p_data_at: new Date().toISOString(),
  })
  return new Response(detail, { status: 200 })
}
