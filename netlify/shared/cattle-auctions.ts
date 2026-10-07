import type { SupabaseClient } from '@supabase/supabase-js'
import { advisorModel, alwaysThinks, replyProblem, replyText, type MessagesReply } from './anthropic-reply.ts'
import {
  MHFC_PROMPT,
  TEAM_REPORT_URL,
  combineSameDay,
  jsonFromReply,
  mhfcRows,
  parseCalgaryStockyards,
  parseMhfcListing,
  parseTeamReport,
  perlichComment,
  perlichRows,
  perlichSaleDate,
  validateMhfcReply,
  type AuctionRow,
  type ParsedReport,
  type PerlichComment,
  type PerlichEntry,
  type PerlichReport,
} from './cattle-auctions-parse.ts'
import { MARKET_KEYS, marketByKey, type MarketKey } from '../../src/lib/auction-markets.ts'

// The four auction markets' weekly prices into market_series / market_prices:
// Medicine Hat, Lethbridge, Calgary Stockyards and Team online. Run by
// cattle-auctions-background (woken daily by cattle-auctions-cron). Each
// market runs on its own; one failing does not cost the others, and each
// reports to the integration health monitor under its own key only when it
// actually read its source.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

export const HEALTH_KEYS: Record<MarketKey, string> = {
  'medicine-hat': 'auction_mhfc',
  lethbridge: 'auction_perlich',
  calgary: 'auction_calgary_stockyards',
  'team-online': 'auction_team',
}

/** A report that failed validation is retried this many times, then left for a person. */
const MAX_ATTEMPTS = 3
const DAY = 86_400_000

export type MarketRun = {
  market: MarketKey
  ok: boolean
  stored: number
  failed: number
  /** Reports still to read when the time ran out (Medicine Hat backfill). */
  remaining: number
  detail: string
}

export type RunOptions = {
  markets?: MarketKey[]
  /** true: the last two years. A number: that many of the newest reports (Medicine Hat) or weeks (Lethbridge). */
  backfill?: number | true
  /** Re-read Medicine Hat reports already stored, or given up on. */
  force?: boolean
  deadline: number
  apiKey?: string
  model?: string
  today?: string
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const daysAgo = (today: string, n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY).toISOString().slice(0, 10)

async function get(url: string, accept: string, ms = 30_000): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res
}

async function heartbeat(sb: SupabaseClient, market: MarketKey, detail: string, dataAt: string | null) {
  await sb.rpc('record_integration_heartbeat', {
    p_key: HEALTH_KEYS[market],
    p_detail: detail,
    p_data_at: dataAt ? `${dataAt}T18:00:00Z` : null,
  })
}

type ReportRecord = {
  market: MarketKey
  report_key: string
  sale_date: string | null
  url: string | null
  title: string | null
  status: 'stored' | 'failed' | 'skipped'
  attempts: number
  problem: string | null
  total_head: number | null
  comment: string | null
  parsed: unknown
  model: string | null
}

async function record(sb: SupabaseClient, r: ReportRecord) {
  const { error } = await sb
    .from('auction_reports')
    .upsert({ ...r, read_at: new Date().toISOString() }, { onConflict: 'market,report_key' })
  if (error) console.warn(`[cattle-auctions] could not record ${r.market} ${r.report_key}: ${error.message}`)
}

/**
 * Store one report's rows: its series (created if new — existing ones are
 * left alone, so the audit log does not fill with no-op updates) and one
 * price per series for the sale date, in a single upsert so a report is
 * written whole or not at all.
 */
async function writeRows(sb: SupabaseClient, market: MarketKey, saleDate: string, url: string, rows: AuctionRow[]) {
  if (rows.length === 0) return 0
  const m = marketByKey(market)!
  const codes = [...new Set(rows.map((r) => r.code))]
  const { data: have, error: readErr } = await sb.from('market_series').select('id, code').in('code', codes)
  if (readErr) throw new Error(`series read: ${readErr.message}`)
  const ids = new Map((have ?? []).map((s) => [s.code as string, s.id as string]))
  const missing = rows.filter((r, i) => !ids.has(r.code) && rows.findIndex((x) => x.code === r.code) === i)
  if (missing.length) {
    const { data: made, error } = await sb
      .from('market_series')
      .upsert(
        missing.map((r) => ({
          code: r.code,
          kind: 'cattle',
          name: r.name,
          commodity: r.commodity,
          unit: '$/cwt',
          region: m.label,
          source: m.source,
          derived: false,
          notes: `${m.full}. ${m.url}`,
        })),
        { onConflict: 'code' },
      )
      .select('id, code')
    if (error) throw new Error(`series write: ${error.message}`)
    for (const s of made ?? []) ids.set(s.code as string, s.id as string)
  }
  const { error } = await sb.from('market_prices').upsert(
    rows.map((r) => ({
      series_id: ids.get(r.code)!,
      observed_on: saleDate,
      value: r.value,
      low: r.low,
      high: r.high,
      head: r.head,
      avg_weight_lb: r.avgWeightLb,
      weight_min_lb: r.weightMinLb,
      weight_max_lb: r.weightMaxLb,
      top: r.top,
      class_label: r.classLabel,
      source_url: url,
    })),
    { onConflict: 'series_id,observed_on' },
  )
  if (error) throw new Error(`price write: ${error.message}`)
  return rows.length
}

async function storeParsed(sb: SupabaseClient, p: ParsedReport, extra: { parsed?: unknown; model?: string | null } = {}) {
  const n = await writeRows(sb, p.market, p.saleDate, p.url, p.rows)
  await record(sb, {
    market: p.market,
    report_key: p.reportKey,
    sale_date: p.saleDate,
    url: p.url,
    title: p.title,
    status: n > 0 ? 'stored' : 'skipped',
    attempts: 1,
    problem: p.skipped.length ? `not stored: ${p.skipped.join(', ')}` : null,
    total_head: p.totalHead,
    comment: p.comment,
    parsed: extra.parsed ?? { rows: p.rows },
    model: extra.model ?? null,
  })
  return n
}

// ── Medicine Hat ────────────────────────────────────────────────────────────

const MHFC_LIST = 'https://mhfc.ca/auction/report/market'

/** One scanned report through Claude. Returns the reply text, or why there is none. */
async function readScan(
  apiKey: string,
  model: string,
  data: string,
  mediaType: string,
): Promise<{ text: string } | { problem: string }> {
  const source = { type: 'base64', media_type: mediaType, data }
  const content = [
    mediaType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source },
    { type: 'text', text: MHFC_PROMPT },
  ]
  // A model that always thinks refuses `thinking: disabled`; it gets effort and
  // room for the thinking instead (see anthropic-reply.ts).
  const thinks = alwaysThinks(model)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      ...(thinks
        ? { max_tokens: 16000, output_config: { effort: 'high' } }
        : { max_tokens: 8000, thinking: { type: 'disabled' } }),
    }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) return { problem: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const reply = (await res.json()) as MessagesReply
  const text = replyText(reply)
  const problem = replyProblem(reply, text)
  return problem ? { problem } : { text }
}

async function runMedicineHat(sb: SupabaseClient, o: RunOptions & { today: string }): Promise<MarketRun> {
  const run: MarketRun = { market: 'medicine-hat', ok: false, stored: 0, failed: 0, remaining: 0, detail: '' }
  const listing = parseMhfcListing(await (await get(MHFC_LIST, 'text/html')).text())
  if (listing.length === 0) {
    run.detail = 'the report list page had no reports on it — the layout may have changed'
    return run
  }

  // Which reports are wanted: the last six weeks normally; two years, or the
  // newest N, on a backfill. Never all the way back to 2014 unless asked.
  const candidates =
    o.backfill === true
      ? listing.filter((l) => l.saleDate >= daysAgo(o.today, 730))
      : typeof o.backfill === 'number'
        ? listing.slice(0, Math.max(0, o.backfill))
        : listing.filter((l) => l.saleDate >= daysAgo(o.today, 45))

  const keys = candidates.map((c) => String(c.reportId))
  const { data: known } = keys.length
    ? await sb.from('auction_reports').select('report_key, status, attempts').eq('market', 'medicine-hat').in('report_key', keys)
    : { data: [] }
  const seen = new Map((known ?? []).map((k) => [k.report_key as string, k as { status: string; attempts: number }]))
  const todo = candidates.filter((c) => {
    const k = seen.get(String(c.reportId))
    if (!k) return true
    if (o.force) return true
    return k.status === 'failed' && k.attempts < MAX_ATTEMPTS
  })

  const newest = listing[0].saleDate
  if (todo.length > 0 && !o.apiKey) {
    run.detail = `${todo.length} report(s) waiting, but ANTHROPIC_API_KEY is not set`
    return run
  }
  const model = o.model ?? advisorModel()

  for (let i = 0; i < todo.length; i++) {
    const rep = todo[i]
    if (Date.now() > o.deadline) {
      run.remaining = todo.length - i
      break
    }
    const key = String(rep.reportId)
    const attempts = (seen.get(key)?.attempts ?? 0) + 1
    const fail = async (problem: string, parsed: unknown = null) => {
      run.failed++
      console.warn(`[cattle-auctions] Medicine Hat ${rep.saleDate} (#${key}) not stored: ${problem}`)
      await record(sb, {
        market: 'medicine-hat',
        report_key: key,
        sale_date: rep.saleDate,
        url: rep.url,
        title: rep.title,
        status: 'failed',
        attempts,
        problem: problem.slice(0, 2000),
        total_head: null,
        comment: null,
        parsed,
        model,
      })
    }
    try {
      const buf = new Uint8Array(await (await get(rep.url, '*/*', 60_000)).arrayBuffer())
      if (buf.length === 0 || buf.length > 20 * 1024 * 1024) {
        await fail(`the file is ${buf.length} bytes`)
        continue
      }
      const read = await readScan(o.apiKey!, model, Buffer.from(buf).toString('base64'), rep.mediaType)
      if ('problem' in read) {
        await fail(read.problem)
        continue
      }
      const raw = jsonFromReply(read.text)
      const v = validateMhfcReply(raw, rep.saleDate)
      if (!v.ok) {
        await fail(v.problems.slice(0, 12).join('; '), { reply: raw })
        continue
      }
      const { rows, skipped } = mhfcRows(v.reply)

      // A second report on the same day (a cow/calf sale beside the regular
      // one) is merged with the first, not written over it.
      const { data: sib } = await sb
        .from('auction_reports')
        .select('report_key, parsed')
        .eq('market', 'medicine-hat')
        .eq('sale_date', rep.saleDate)
        .eq('status', 'stored')
        .neq('report_key', key)
      const siblingRows = (sib ?? []).flatMap((s) => ((s.parsed as { rows?: AuctionRow[] } | null)?.rows ?? []))
      const toWrite = siblingRows.length ? combineSameDay([...siblingRows, ...rows]) : rows

      const n = await writeRows(sb, 'medicine-hat', rep.saleDate, rep.url, toWrite)
      await record(sb, {
        market: 'medicine-hat',
        report_key: key,
        sale_date: rep.saleDate,
        url: rep.url,
        title: rep.title,
        status: rows.length ? 'stored' : 'skipped',
        attempts,
        problem: rows.length
          ? skipped.length
            ? `not stored: ${skipped.join(', ')}`
            : null
          : `nothing priced per cwt${skipped.length ? ` (${skipped.join(', ')})` : ''}`,
        total_head: v.reply.total_head,
        comment: null,
        parsed: { reply: v.reply, rows },
        model,
      })
      if (n > 0) run.stored++
    } catch (e) {
      await fail((e as Error).message)
    }
  }

  const { count: givenUp } = await sb
    .from('auction_reports')
    .select('report_key', { count: 'exact', head: true })
    .eq('market', 'medicine-hat')
    .eq('status', 'failed')
    .gte('attempts', MAX_ATTEMPTS)
    .gte('sale_date', daysAgo(o.today, 60))
  const { data: last } = await sb
    .from('auction_reports')
    .select('sale_date')
    .eq('market', 'medicine-hat')
    .eq('status', 'stored')
    .order('sale_date', { ascending: false })
    .limit(1)
  const newestStored = (last?.[0]?.sale_date as string | undefined) ?? null

  run.ok = run.failed === 0
  run.detail =
    `newest report ${newest}, newest stored ${newestStored ?? 'none'}; ${run.stored} read this run` +
    (run.failed ? `, ${run.failed} could not be read` : '') +
    (run.remaining ? `, ${run.remaining} still to read` : '') +
    (givenUp ? `; ${givenUp} recent report(s) given up on after ${MAX_ATTEMPTS} tries — see auction_reports` : '')
  // Healthy only when the list was read and nothing failed. A report that
  // keeps failing stops the heartbeat, so the monitor goes stale and says so.
  if (run.ok) await heartbeat(sb, 'medicine-hat', run.detail, newestStored)
  return run
}

// ── Lethbridge ──────────────────────────────────────────────────────────────

const PERLICH_API = 'https://api.clix.auction/api/v1/public/website'
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

async function perlich<T>(path: string): Promise<T> {
  const res = await get(`${PERLICH_API}/${path}`, 'application/json')
  return (await res.json()) as T
}

async function runLethbridge(sb: SupabaseClient, o: RunOptions & { today: string }): Promise<MarketRun> {
  const run: MarketRun = { market: 'lethbridge', ok: false, stored: 0, failed: 0, remaining: 0, detail: '' }
  const spanDays = o.backfill === true ? 730 : typeof o.backfill === 'number' ? o.backfill * 7 : 28
  const from = daysAgo(o.today, spanDays)

  // The list returns at most twenty reports a call; twelve weeks at a time
  // stays well under that.
  const reports = new Map<number, PerlichReport>()
  for (let start = from; start <= o.today; start = daysAgo(start, -84)) {
    const end = daysAgo(start, -83)
    const q = new URLSearchParams({
      market: '1',
      start: `${start} 00:00:00`,
      end: `${end} 23:59:59`,
      published: stamp(new Date()),
    })
    const body = await perlich<{ data?: { market_reports?: PerlichReport[] } }>(`market-reports?${q}`)
    for (const r of body.data?.market_reports ?? []) reports.set(r.id, r)
  }

  // A backfill reads only weeks not stored yet; the daily run re-reads the
  // last four weeks, which is cheap and catches a report corrected after it
  // was first published.
  let todo = [...reports.values()].sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  if (o.backfill != null && !o.force) {
    const keys = todo.map((r) => String(r.id))
    const { data: known } = keys.length
      ? await sb.from('auction_reports').select('report_key').eq('market', 'lethbridge').eq('status', 'stored').in('report_key', keys)
      : { data: [] }
    const stored = new Set((known ?? []).map((k) => k.report_key as string))
    todo = todo.filter((r) => !stored.has(String(r.id)))
  }

  let newest: string | null = null
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i]
    if (Date.now() > o.deadline) {
      run.remaining = todo.length - i
      break
    }
    try {
      const saleDate = perlichSaleDate(r)
      const q = `market=1&market_report=${r.id}`
      const [entries, comments] = await Promise.all([
        perlich<{ data?: { market_report_entries?: PerlichEntry[] } }>(`market-report-entries?${q}`),
        perlich<{ data?: { market_report_comments?: PerlichComment[] } }>(`market-report-comments?${q}`),
      ])
      const { rows, skipped } = perlichRows(entries.data?.market_report_entries ?? [])
      const n = await storeParsed(sb, {
        market: 'lethbridge',
        reportKey: String(r.id),
        saleDate,
        url: marketByKey('lethbridge')!.url,
        title: r.name,
        totalHead: null,
        comment: perlichComment(comments.data?.market_report_comments ?? []),
        rows,
        skipped,
      })
      if (n > 0) {
        run.stored++
        if (!newest || saleDate > newest) newest = saleDate
      }
    } catch (e) {
      run.failed++
      console.warn(`[cattle-auctions] Lethbridge report ${r.id}: ${(e as Error).message}`)
    }
  }
  run.ok = run.failed === 0
  run.detail =
    `${reports.size} weekly report(s) listed, ${run.stored} with prices stored` +
    (newest ? `, newest ${newest}` : '') +
    (run.failed ? `, ${run.failed} failed` : '') +
    (run.remaining ? `, ${run.remaining} still to read` : '')
  if (run.ok) await heartbeat(sb, 'lethbridge', run.detail, newest)
  return run
}

// ── Calgary Stockyards and Team: one page each, replaced weekly ────────────

async function runPage(
  sb: SupabaseClient,
  market: 'calgary' | 'team-online',
  today: string,
): Promise<MarketRun> {
  const run: MarketRun = { market, ok: false, stored: 0, failed: 0, remaining: 0, detail: '' }
  const url = market === 'calgary' ? marketByKey('calgary')!.url : TEAM_REPORT_URL
  const html = await (await get(url, 'text/html')).text()
  const p = market === 'calgary' ? parseCalgaryStockyards(html, today) : parseTeamReport(html)
  if ('problem' in p) {
    run.failed = 1
    run.detail = p.problem
    return run
  }
  const n = await storeParsed(sb, p)
  run.stored = n > 0 ? 1 : 0
  run.ok = true
  run.detail = `report for ${p.saleDate}: ${n} classes priced${p.skipped.length ? `; not stored: ${p.skipped.join(', ')}` : ''}`
  await heartbeat(sb, market, run.detail, p.saleDate)
  return run
}

// ── All four ────────────────────────────────────────────────────────────────

export async function runCattleAuctions(
  sb: SupabaseClient,
  o: RunOptions,
): Promise<{ runs: MarketRun[]; stored: number }> {
  const today = o.today ?? todayIso()
  const wanted = (o.markets?.length ? o.markets : MARKET_KEYS).filter((k) => MARKET_KEYS.includes(k))
  // The quick ones first; Medicine Hat (a Claude read per report) gets the
  // rest of the time.
  const order: MarketKey[] = ['calgary', 'team-online', 'lethbridge', 'medicine-hat']
  const runs: MarketRun[] = []
  for (const market of order.filter((m) => wanted.includes(m))) {
    try {
      runs.push(
        market === 'medicine-hat'
          ? await runMedicineHat(sb, { ...o, today })
          : market === 'lethbridge'
            ? await runLethbridge(sb, { ...o, today })
            : await runPage(sb, market, today),
      )
    } catch (e) {
      // No heartbeat: the monitor should go stale and say so.
      runs.push({ market, ok: false, stored: 0, failed: 1, remaining: 0, detail: (e as Error).message })
    }
  }
  return { runs, stored: runs.reduce((s, r) => s + r.stored, 0) }
}
