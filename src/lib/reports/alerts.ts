import { supabase } from '@/lib/supabase'
import { alertGuide } from '@/lib/alert-guides'
import { alertReport, FEED_COLUMNS, feedFor } from '@/lib/alert-report'
import { BUILD_SHA, BUILD_TIME } from '@/lib/buildInfo'
import { fetchAll, fileOf, longDate, pick, type Cell, type GatherContext, type Made, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * The alert error log: every notification this person had over a date range
 * (notifications are each person's own, so it is the admin's own alerts),
 * optionally one kind. The CSV is a row an alert; the PDF groups them by
 * kind under the guide's "what it means"; Markdown bundles the error log the
 * alert's own page downloads, one after another, for an AI chat.
 */

export type AlertLite = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; details: unknown }

/** "2026-10-02 14:05" in the browser's own time, the time the person saw it. */
export function alertWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * What an alert carried, on one line: its top-level facts as key: value, a
 * list as its count, anything nested as {…}. Enough to tell two alerts of a
 * kind apart in a spreadsheet; the Markdown keeps the whole of it.
 */
export function keyDetails(details: unknown, max = 280): string | null {
  if (details == null) return null
  if (typeof details !== 'object') return String(details).slice(0, max)
  const scalar = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${scalar(v) ?? (Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : '{…}')}`)
  if (!parts.length) return null
  const line = parts.join('; ')
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export const ALERT_COLUMNS = [{ label: 'When' }, { label: 'Kind' }, { label: 'Title' }, { label: 'Message' }, { label: 'Points to', link: true }, { label: 'Details' }]

/** A group a kind, by the guide's name; oldest first within it, as a log reads. */
export function alertGroups(alerts: AlertLite[]): ReportGroup[] {
  const kinds = [...new Set(alerts.map((a) => a.kind))]
  return kinds
    .map((k) => {
      const g = alertGuide(k)
      const rows: Cell[][] = alerts
        .filter((a) => a.kind === k)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((a) => [alertWhen(a.created_at), a.kind, a.title, a.body, a.link, keyDetails(a.details)])
      return { title: g.name, note: g.meaning, rows }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** The browser's local midnight at the start of a day, and at the end of another, as instants. */
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).toISOString()

/** Every alert's error log, one after another, under a heading that says what is in it. */
export function alertBundle(alerts: AlertLite[], o: { appName: string; buildSha: string; buildTime: string; device?: string; at: string; range: string; feeds: { label: string }[] }): string {
  const sorted = [...alerts].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const head = [
    `# Alert error log — ${o.appName}`,
    '',
    `${sorted.length} alert${sorted.length === 1 ? '' : 's'}, ${o.range}. Each is the error log its own page downloads; they are separated by horizontal rules. Look for alerts that repeat or that came together: one cause often raises several.`,
  ].join('\n')
  const each = sorted.map((a) =>
    alertReport({
      appName: o.appName,
      buildSha: o.buildSha,
      buildTime: o.buildTime,
      notification: a,
      guide: alertGuide(a.kind),
      feed: a.kind === 'integration_alert' ? (feedFor(a.title, o.feeds) as Record<string, unknown> | null) : null,
      device: o.device,
      at: o.at,
    }),
  )
  return [head, ...each].join('\n\n---\n\n') + '\n'
}

export async function gatherAlertLog(p: ParamValues, ctx: GatherContext): Promise<Made> {
  const from = p.from || ctx.today
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const kind = pick(p, 'kind')
  const alerts = await fetchAll<AlertLite>((a, b) => {
    let q = supabase.from('notifications').select('id, kind, title, body, link, created_at, details').gte('created_at', dayStart(from)).lte('created_at', dayEnd(to))
    if (kind) q = q.eq('kind', kind)
    return q.order('created_at').order('id').range(a, b)
  })
  const what = kind ? alertGuide(kind).name : 'All alerts'
  if (!alerts.length) throw new Error(`No ${kind ? `${what.toLowerCase()} ` : ''}alerts between ${longDate(from)} and ${longDate(to)}.`)
  const range = `${longDate(from)} to ${longDate(to)}`
  const filename = `Alert log ${kind ?? 'all'} ${from} to ${to}`

  if (ctx.format === 'MD') {
    // The feed's state now, for the feed alerts: it is what the page's own log carries.
    const feeds = alerts.some((a) => a.kind === 'integration_alert') ? ((await supabase.from('integration_health').select(FEED_COLUMNS)).data ?? []) : []
    const md = alertBundle(alerts, {
      appName: (typeof document !== 'undefined' && document.title) || 'Farm app',
      buildSha: BUILD_SHA,
      buildTime: BUILD_TIME,
      device: typeof navigator !== 'undefined' ? `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}` : undefined,
      at: new Date().toISOString(),
      range,
      feeds,
    })
    return fileOf(md, `${filename}.md`, 'text/markdown;charset=utf-8')
  }

  const groups = alertGroups(alerts)
  const report: ReportData = {
    title: 'Alert error log',
    subtitle: `${what} · ${range}`,
    meta: [
      ['Alerts', alerts.length],
      ['Kinds', groups.length],
      ['First', alertWhen(alerts[0].created_at)],
      ['Last', alertWhen(alerts.at(-1)!.created_at)],
    ],
    summary: ['Your own alerts in the range, by kind, each kind under what the app says it means. For an AI chat to diagnose, download Markdown: it carries every alert’s full details and where in the code it is raised.'],
    columns: ALERT_COLUMNS,
    groups,
    groupLabel: 'Alert type',
    orientation: 'landscape',
    filename,
  }
  return report
}
