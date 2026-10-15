import { admin, json } from './_jd.mts'
import { judge, reportable, type FilerReport } from '../../src/lib/iciFilerReport.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * Where the Gmail invoice filer reports in.
 *
 * The filer runs in Sam's Google account, hourly, and nothing here can see
 * it. That was fine until it stopped working: it searched an email domain ICI
 * had abandoned, matched nothing new for a year, and reported success the whole
 * time. Every chemical price in the app stayed frozen at its September 2025
 * value and the integrations page showed nothing wrong, because the invoice
 * chain was the one feed with no row on it.
 *
 * So the filer now says what it saw, and this decides whether that is healthy.
 * See src/lib/iciFilerReport.ts for why the signal is a COMPARISON of invoice
 * numbers rather than a recency threshold — the short version is that invoices
 * genuinely stop over winter, so "nothing lately" is normal in January and
 * catastrophic in July, and a number that is simply behind is neither.
 *
 * SECURITY. Unauthenticated by necessity — Apps Script cannot hold a Supabase
 * session — so, exactly as inbound-email does: a shared secret, checked before
 * anything else, and a missing secret means the endpoint refuses rather than
 * falls open. It writes one row of health status and nothing else, so the worst
 * a leaked secret buys is a false green tick, but a false green tick on this
 * particular alarm is the whole failure it exists to prevent.
 */

const SECRET = process.env.ICI_FILER_SECRET

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SECRET) return json({ error: 'The invoice filer report is not configured' }, 503)

  const given = new URL(req.url).searchParams.get('key') ?? req.headers.get('x-filer-secret') ?? ''
  if (given !== SECRET) return json({ error: 'Not authorised' }, 401)

  let body: Partial<FilerReport>
  try {
    body = (await req.json()) as Partial<FilerReport>
  } catch {
    return json({ error: 'Expected JSON' }, 400)
  }

  const report: FilerReport = {
    matched: Number(body.matched ?? 0),
    filed: Number(body.filed ?? 0),
    newestSeen: typeof body.newestSeen === 'string' ? body.newestSeen : null,
  }

  const sb = admin()

  // The newest ICI invoice the price book actually holds. Ordered as TEXT,
  // which is safe only because every reference is INV plus five digits — the
  // numeric comparison that matters happens in judge().
  const { data: newest } = await sb
    .from('product_purchases')
    .select('invoice_no')
    .eq('supplier', 'your retailer')
    .order('invoice_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const verdict = judge(report, (newest?.invoice_no as string | null) ?? null)
  const now = new Date().toISOString()

  // This row is check_kind 'reported': the verdict written here stands, and the
  // hourly watchdog only overrides it if these reports stop arriving.
  //
  // It has to be that way round. Under the ordinary heartbeat rule a row that
  // has never once been healthy reads as "no first run yet" and stays silent —
  // which is precisely the state the invoice chain was in when this was built,
  // a gap a year old. The alarm would have been quiet about the only thing it
  // was added to notice.
  // A day's grace before anybody is told.
  //
  // An invoice landing in the mailbox is not a problem, it is Tuesday: the
  // filer runs hourly and the import follows, so for a few hours "behind"
  // only means "not filed yet". Raising on that sent a notification about
  // every invoice ICI ever sent. Still behind tomorrow is the real signal.
  //
  // The clock is last_success_at, which is left alone while waiting — writing
  // it every hour would reset the day and the alarm would never come.
  const { data: row } = await sb
    .from('integration_health')
    .select('last_success_at')
    .eq('source_key', 'ici_invoices')
    .maybeSingle()
  const behindFor =
    row?.last_success_at == null
      ? null
      : (Date.now() - new Date(row.last_success_at as string).getTime()) / 60_000
  const state = reportable(verdict, behindFor)

  const patch: Record<string, unknown> = {
    status: state.status,
    last_checked_at: now,
    detail: `${state.detail} (filer saw ${report.matched} thread${
      report.matched === 1 ? '' : 's'
    }, filed ${report.filed} this run)`,
    updated_at: now,
  }
  if (verdict.ok) {
    patch.last_success_at = now
    patch.data_at = now
    patch.consecutive_fail = 0
  }

  const { error } = await sb
    .from('integration_health')
    .update(patch)
    .eq('source_key', 'ici_invoices')
  if (error) return json({ error: error.message }, 500)

  return json({ ok: verdict.ok, raised: state.status !== 'ok', behind: verdict.behind, detail: state.detail })
}
