import { getStore } from '@netlify/blobs'

/**
 * The demo's visitor counter (Sam, 13 Oct 2026). The page sends one event
 * at a time (demo/client/count.ts); this keeps each as an empty entry in
 * Netlify Blobs (free on every plan) and shows a table of them.
 *
 *   POST /count         { event, visitor, newVisitor, device, reason? } → 204
 *   GET  /count/stats   the last 30 days, by day, as a page
 *
 * Everything the stats need is in the entry's KEY, so the stats page only
 * lists keys and never reads the entries:
 *   <day>/<event>/<device>/<new|ret>/<visitor>/<time>-<random>
 * One entry per event rather than a running total per day: two visitors
 * landing at once would each read the same total and one would be lost.
 *
 * No address, browser string or cookie is kept. `visitor` is a random id the
 * visitor's own browser made; it only tells a return visit from a new person.
 *
 * Optional: set STATS_KEY on the Netlify site and the stats page needs
 * ?key=<it>. Unset, anyone with the address can see the counts.
 */

export const config = {
  path: ['/count', '/count/stats'],
  // A visitor sends a handful of events; a loop sending thousands is spam
  // (security review, 15 Oct 2026). Netlify answers 429 beyond this.
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}

/** Days are the farm's days, not UTC's: an evening visit is still that day. */
const TIMEZONE = process.env.DEMO_TIMEZONE || 'America/Edmonton'
const EVENTS = new Set(['open', 'github', 'fail'])
const DEVICES = new Set(['phone', 'tablet', 'computer'])
const DAYS_SHOWN = 30

const store = () => getStore({ name: 'demo-visits', consistency: 'strong' })
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d)
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export default async (req: Request) => {
  const url = new URL(req.url)
  if (req.method === 'POST' && url.pathname === '/count') return record(req)
  if (req.method === 'GET' && url.pathname === '/count/stats') {
    const key = process.env.STATS_KEY
    if (key && url.searchParams.get('key') !== key) return new Response('Not found', { status: 404 })
    return stats()
  }
  return new Response('Not found', { status: 404 })
}

async function record(req: Request): Promise<Response> {
  // The page sends JSON; a form or text/plain post from another site is not a visit.
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return new Response(null, { status: 415 })
  const text = await req.text()
  if (text.length > 1000) return new Response(null, { status: 413 })
  let b: { event?: unknown; visitor?: unknown; newVisitor?: unknown; device?: unknown; reason?: unknown }
  try {
    b = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  const event = String(b.event)
  const device = String(b.device)
  const visitor = String(b.visitor ?? '')
  if (!EVENTS.has(event) || !DEVICES.has(device) || !/^[A-Za-z0-9-]{8,64}$/.test(visitor)) return new Response(null, { status: 400 })
  const now = new Date()
  const key = [dayOf(now), event, device, b.newVisitor === true ? 'new' : 'ret', visitor, `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`].join('/')
  // Only a failed start keeps anything in the entry: the first words of the error.
  const reason = event === 'fail' && typeof b.reason === 'string' ? b.reason.slice(0, 80) : ''
  await store().set(key, reason)
  return new Response(null, { status: 204 })
}

type Hit = { day: string; event: string; device: string; isNew: boolean; visitor: string; key: string }

async function stats(): Promise<Response> {
  const s = store()
  // Step back from midday so a clock change never skips or repeats a day.
  const noon = Date.parse(`${dayOf(new Date())}T18:00:00Z`)
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => dayOf(new Date(noon - i * 86_400_000)))
  const hits: Hit[] = []
  for (const day of days) {
    const { blobs } = await s.list({ prefix: `${day}/` })
    for (const { key } of blobs) {
      const [d, event, device, fresh, visitor] = key.split('/')
      hits.push({ day: d, event, device, isNew: fresh === 'new', visitor, key })
    }
  }
  const failReasons: { day: string; device: string; reason: string }[] = []
  for (const h of hits.filter((x) => x.event === 'fail').slice(-20)) {
    failReasons.push({ day: h.day, device: h.device, reason: (await s.get(h.key)) ?? '' })
  }

  const sum = (list: Hit[]) => {
    const opens = list.filter((h) => h.event === 'open')
    const visitors = new Set(opens.map((h) => h.visitor))
    const byDevice = (d: string) => new Set(opens.filter((h) => h.device === d).map((h) => h.visitor)).size
    return {
      opens: opens.length,
      visitors: visitors.size,
      newVisitors: new Set(opens.filter((h) => h.isNew).map((h) => h.visitor)).size,
      phone: byDevice('phone'),
      tablet: byDevice('tablet'),
      computer: byDevice('computer'),
      github: list.filter((h) => h.event === 'github').length,
      fails: list.filter((h) => h.event === 'fail').length,
    }
  }
  const last7 = new Set(days.slice(0, 7))
  const cells = (r: ReturnType<typeof sum>) =>
    [r.visitors, r.newVisitors, r.opens, r.phone, r.tablet, r.computer, r.github, r.fails].map((n) => `<td>${n || '·'}</td>`).join('')
  const rows = days
    .map((day) => {
      const r = sum(hits.filter((h) => h.day === day))
      return `<tr><th>${day}</th>${cells(r)}</tr>`
    })
    .join('')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Demo visitors</title>
<style>
:root{--bg:#f8faf8;--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--brand:#15803d;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111827;--fg:#f3f4f6;--muted:#9ca3af;--line:#374151;--card:#1f2937}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto}h1{font-size:20px;margin:0 0 4px;color:var(--brand)}p{color:var(--muted);margin:4px 0 14px}
.totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.tile b{display:block;font-size:22px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
thead th{font-size:12px;color:var(--muted);font-weight:600}tbody th{text-align:left;font-weight:500}
button{font:inherit;border:1px solid var(--brand);background:var(--card);color:var(--brand);border-radius:6px;padding:6px 12px;cursor:pointer}
ul{padding-left:18px;color:var(--muted)}
</style></head><body><main>
<h1>Demo visitors</h1>
<p>Counted by the demo itself: a visit counts once the demo farm has opened. No cookies, addresses or names; a visitor is a random id made in their browser. Days are ${esc(TIMEZONE)} days.</p>
<div class="totals">
${(() => {
  const w = sum(hits.filter((h) => last7.has(h.day)))
  const m = sum(hits)
  return [
    ['People, last 7 days', w.visitors],
    ['People, last 30 days', m.visitors],
    ['New people, 30 days', m.newVisitors],
    ['GitHub clicks, 30 days', m.github],
    ['Failed starts, 30 days', m.fails],
  ]
    .map(([k, v]) => `<div class="tile">${k}<b>${v}</b></div>`)
    .join('')
})()}
</div>
<div class="scroll"><table><thead><tr><th style="text-align:left">Day</th><th>People</th><th>New</th><th>Opens</th><th>Phone</th><th>Tablet</th><th>Computer</th><th>GitHub clicks</th><th>Failed starts</th></tr></thead>
<tbody>${rows}</tbody></table></div>
${failReasons.length ? `<h2 style="font-size:15px;margin:18px 0 4px">Why it failed to start (latest)</h2><ul>${failReasons.map((f) => `<li>${esc(f.day)} · ${esc(f.device)} · ${esc(f.reason) || 'no reason given'}</li>`).join('')}</ul>` : ''}
<p style="margin-top:18px"><button id="me"></button> <span id="state"></span></p>
<script>
(function(){var K='rvr-demo-nocount',b=document.getElementById('me'),s=document.getElementById('state');
function show(){var off=false;try{off=!!localStorage.getItem(K)}catch(e){}
b.textContent=off?'Count this browser again':'Don\\'t count this browser';s.textContent=off?'This browser\\'s visits are not counted.':'This browser\\'s visits are counted.'}
b.onclick=function(){try{localStorage.getItem(K)?localStorage.removeItem(K):localStorage.setItem(K,'1')}catch(e){}show()};show()})();
</script>
</main></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}
