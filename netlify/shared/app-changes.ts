import type { SupabaseClient } from '@supabase/supabase-js'
import { advisorModel, alwaysThinks, type MessagesReply } from './anthropic-reply.ts'

/**
 * What changed in the app last week, written for the Monday meeting (Sam,
 * 7 Oct 2026: "a brief summary of all the app changes we have made in the
 * previous week with links to those changes").
 *
 * The week's commits (app_commits, recorded by every build) go to the model
 * with the app's pages (app_build_info 'routes'); it groups them into a short
 * list of changes in plain words, each linked to the page it shows on and the
 * commits behind it. Stored in app_change_weeks for the What's new page.
 */

export type ChangeItem = { title: string; detail: string; area: string; link: string | null; commits: string[] }

const TZ = 'America/Edmonton'
const dayIn = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The Monday of the week before the one `now` falls in (farm time): the week a Monday summary is about. */
export function lastWeekStart(now = new Date()): string {
  const today = dayIn(now)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay() // 0 Sunday
  const thisMonday = addDays(today, -((dow + 6) % 7))
  return addDays(thisMonday, -7)
}

/** The instant a farm-time day starts, as UTC (Mountain time is 6 or 7 hours behind). */
function startOfDay(iso: string): string {
  const noon = new Date(`${iso}T12:00:00Z`)
  const hour = Number(noon.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }))
  const offset = 12 - hour
  return new Date(Date.parse(`${iso}T00:00:00Z`) + offset * 3_600_000).toISOString()
}

const TOOL = {
  name: 'write_summary',
  description: 'The week’s changes to the farm app, for the Monday meeting.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: 18,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'What changed, a few plain words: "Feed prices update from AFSC".' },
            detail: { type: 'string', description: 'One or two plain sentences: what it does for the farm, and anything someone has to do.' },
            area: { type: 'string', description: 'The part of the app: Irrigation, Cattle, Money, Fields, Harvest, Settings…' },
            link: { type: ['string', 'null'], description: 'The page it shows on, exactly one `to` from the pages list, or null.' },
            commits: { type: 'array', items: { type: 'string' }, description: 'The short ids of the commits behind it.' },
          },
          required: ['title', 'detail', 'area', 'link', 'commits'],
        },
      },
    },
    required: ['items'],
  },
}

const SYSTEM = `You write the "what changed in the farm app last week" list for a farm's Monday morning meeting. The people reading run the farm (crops, irrigation, cattle, money); they are not programmers.

You get the week's commits (short id, date, subject, the body's first lines, the folders it touched) and the app's pages. Call the tool write_summary once with the list.

- Group commits that are one change into one item; most weeks are 8–15 items. Lead with what matters most to running the farm.
- Leave out what nobody would notice: tests, refactors, typos, merges, build and copy-of-the-app (demo, public export) work — unless it changed something people see.
- Plain words. Say what it does for the farm and anything someone now has to do ("connect it in Farm setup", "check the prices"). No code names, file names or jargon. One or two sentences.
- link: the page where the change shows, copied exactly from the pages list, or null if there is none.
- Never invent a change that is not in the commits.`

/** Write (or write again) the summary for the week starting `weekStart` (a Monday). */
export async function writeWeek(sb: SupabaseClient, weekStart: string, apiKey: string): Promise<{ items: number; commits: number }> {
  const weekEnd = addDays(weekStart, 6)
  const [{ data: commits, error }, { data: info }] = await Promise.all([
    sb
      .from('app_commits')
      .select('sha, committed_at, subject, body, files')
      .gte('committed_at', startOfDay(weekStart))
      .lt('committed_at', startOfDay(addDays(weekStart, 7)))
      .order('committed_at'),
    sb.from('app_build_info').select('key, value').in('key', ['routes']),
  ])
  if (error) throw new Error(error.message)
  const list = (commits ?? []) as { sha: string; committed_at: string; subject: string; body: string | null; files: string[] }[]
  const base = { week_start: weekStart, week_end: weekEnd, commits: list.map((c) => ({ sha: c.sha, date: c.committed_at, subject: c.subject })) }
  if (!list.length) {
    await sb.from('app_change_weeks').upsert({ ...base, items: [], status: 'done', error: null, written_at: new Date().toISOString() }, { onConflict: 'week_start' })
    return { items: 0, commits: 0 }
  }
  const routes = ((info ?? []).find((r) => r.key === 'routes')?.value ?? []) as { to: string; label: string }[]
  const areas = (files: string[]) => [...new Set(files.map((f) => f.split('/').slice(0, 3).join('/')))].slice(0, 6).join(', ')
  const lines = list.map((c) => `${c.sha.slice(0, 7)} | ${c.committed_at.slice(0, 10)} | ${c.subject} | ${(c.body ?? '').replace(/\s+/g, ' ').slice(0, 280)} | ${areas(c.files)}`)
  const prompt = [`Week: ${weekStart} to ${weekEnd}. ${list.length} commits.`, '', 'PAGES (to | label):', ...routes.map((r) => `${r.to} | ${r.label}`), '', 'COMMITS (id | date | subject | body | folders):', ...lines].join('\n')

  const model = advisorModel()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10 * 60_000),
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      ...(alwaysThinks(model) ? { output_config: { effort: 'medium' } } : { thinking: { type: 'disabled' }, tool_choice: { type: 'tool', name: TOOL.name } }),
      system: SYSTEM,
      tools: [TOOL],
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`The model could not write it (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const out = (await res.json()) as Omit<MessagesReply, 'content'> & { content: { type: string; name?: string; input?: { items?: ChangeItem[] } }[] }
  const call = out.content.find((c) => c.type === 'tool_use' && c.name === TOOL.name)
  if (!call?.input?.items) throw new Error(`No summary came back (stop: ${out.stop_reason ?? '?'})`)
  const known = new Set(routes.map((r) => r.to))
  const full = new Map(list.map((c) => [c.sha.slice(0, 7), c.sha]))
  const items: ChangeItem[] = call.input.items.map((i) => ({
    title: String(i.title ?? '').slice(0, 140),
    detail: String(i.detail ?? '').slice(0, 600),
    area: String(i.area ?? '').slice(0, 40),
    // Only a page the app has: a made-up path would be a broken link.
    link: i.link && known.has(i.link) ? i.link : null,
    commits: (i.commits ?? []).map((s) => full.get(String(s).slice(0, 7))).filter((s): s is string => !!s),
  }))
  const { error: e } = await sb
    .from('app_change_weeks')
    .upsert({ ...base, items, status: 'done', error: null, model, written_at: new Date().toISOString() }, { onConflict: 'week_start' })
  if (e) throw new Error(e.message)
  return { items: items.length, commits: list.length }
}
