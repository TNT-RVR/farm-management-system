import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { alwaysThinks, replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmProvinceName, farmTz, withFarm } from '../../src/lib/farm-context.ts'
import { admin } from '../shared/supabase-admin.ts'
import { callClaude, SONNET_5 } from '../shared/anthropic.ts'
import { runSearch } from '../../src/lib/search/records.ts'
import type { Place } from './app-ask.mts'

/**
 * Ask the app: answers one question in app_questions by looking it up in the
 * farm's records, step by step: which page covers it, which record it names,
 * which table holds it, then the rows themselves.
 *
 * Every look-up is read-only and runs with the ASKER'S login, so row-level
 * security gives the model exactly what that person may see; the service key
 * is used only to read the list of tables and to write the answer back. Each
 * look-up is logged on the row so an answer can be checked. Woken by
 * /api/app-ask with the worker key; never by a browser.
 */

/** A phone is waiting: the whole job, and the look-ups inside it. */
const JOB_BUDGET_MS = 5 * 60_000
const LOOKUP_BUDGET_MS = 3 * 60_000
const MAX_ROUNDS = 10
const MAX_TOOL_CHARS = 30_000
/** Rows read to add up or group, at most. */
const MAX_SUM_ROWS = 20_000

type Obj = Record<string, unknown>
type Block = { type: string; [k: string]: unknown }

// Tables the model is never shown or allowed to read, whatever the asker's role.
const BLOCKED = /secret|token|credential|api_key|push_sub|mfa|oauth|password|webhook|integration_accounts|audit_log|app_questions|qb_questions/

const SYSTEM = (ctx: { today: string; cropYear: number | null; name: string; page: string | null }) =>
  `You answer questions about a farm in ${farmProvinceName()}, from inside the farm's own app, for ${ctx.name}. Where the farm has described itself, that comes at the end.
Today is ${ctx.today}.${ctx.cropYear ? ` The crop year the app is showing is ${ctx.cropYear}.` : ''}${ctx.page ? ` They asked from the page ${ctx.page}; "this" or "here" may mean what is on it.` : ''}

You have read-only tools over the app. Work like someone who knows the app well:
- A question about where to find or do something: find_pages, and answer with the link.
- A question naming a field, person, machine, bin, crop or animal: search_records to find it and its id.
- A question about the farm's data: list_tables (search a word, e.g. "moisture", "bin", "spray") to see the tables and their columns, then query_table. Use sum and group_by to add up or count; never add up rows yourself.
- Do several look-ups in one turn when they don't depend on each other. Time is short: someone is waiting on a phone.
- The farm's own settings beat general knowledge: a crop's moisture limits, prices and rates are in its tables (crops, crop_inputs…); look them up rather than quoting a rule of thumb, and if you must use general knowledge, say that it is.
- Never invent a figure. If the data can't answer it, or a look-up was refused (they may not have access), say so plainly.

The answer is read on a phone and may be read aloud. Lead with the answer in one or two plain sentences. Then at most four short "- " bullets if they help. Under 120 words. No headings, no tables, no preamble. Bold at most the main figure with **.
Link what you mention to where it lives in the app, as markdown [words](/path). Use only paths from find_pages or search_records, or a record's own page: /fields/<id>, /tasks/<id>, /cattle/<id>, /equipment/<id>, /crops/<id>. End with the one link that best opens the answer, on its own line, as [Open …](/path).`

const TOOLS = [
  {
    name: 'find_pages',
    description: 'Pages, tabs and reports of the app this person can open, matching words. Returns label, what it is, and its path.',
    input_schema: { type: 'object', properties: { search: { type: 'string' } }, required: ['search'] },
  },
  {
    name: 'search_records',
    description: 'Finds fields, contacts, tasks, cattle, checklists, crops, calendar events, equipment, bins, contracts and grants by name or text. Returns each with its group and the path of its page (ids are in the path).',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'list_tables',
    description: 'The database tables. With search: the tables whose name or columns contain the word, with every column and its type. Without: just the names.',
    input_schema: { type: 'object', properties: { search: { type: 'string' } } },
  },
  {
    name: 'query_table',
    description:
      'Reads rows from one table, as the person asking (they see only what they may). select is PostgREST syntax (e.g. "id, name, crop_id, crops(name)"); filters are ANDed; op is eq, neq, gt, gte, lt, lte, ilike (use % wildcards), is (null/true/false) or in (value is an array). To filter on a joined table, embed it with !inner in select (crops!inner(name)) and filter on crops.name. Give sum (numeric columns) and/or group_by (one column) to get totals and counts worked out for you over every matching row instead of rows.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        select: { type: 'string', description: 'Default *' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'in'] }, value: {} },
            required: ['column', 'op', 'value'],
          },
        },
        order: { type: 'string', description: 'A column; add " desc" for newest or largest first' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        sum: { type: 'array', items: { type: 'string' } },
        group_by: { type: 'string' },
      },
      required: ['table'],
    },
  },
]

const NAME = /^[a-z_][a-z0-9_]*$/
const SELECT = /^[a-zA-Z0-9_,()*:!.\s-]+$/
const cut = (s: string) => (s.length > MAX_TOOL_CHARS ? `${s.slice(0, MAX_TOOL_CHARS)}\n…(cut short; narrow the look-up)` : s)
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)

export default async (req: Request) => {
  await hydrateSecrets()
  const apiKey = process.env.ANTHROPIC_API_KEY
  const workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!workerKey || req.headers.get('x-worker-key') !== workerKey) return new Response('Not authorised', { status: 403 })
  if (!apiKey) return new Response('Not configured', { status: 500 })

  const wake = (await req.json().catch(() => ({}))) as { id?: string; token?: string; anonKey?: string; places?: Place[]; cropYear?: number | null }
  if (!wake.id || !wake.token || !wake.anonKey) return new Response('id, token and key required', { status: 400 })
  const sb = admin()
  const { data: row } = await sb.from('app_questions').select('id, status, question, page, asked_by').eq('id', wake.id).single()
  // Only a waiting question: a retried wake-up must not answer it twice.
  if (!row || row.status !== 'pending') return new Response('nothing to do', { status: 200 })
  const id = row.id as string

  // The asker's own view of the database.
  const as: SupabaseClient = createClient(process.env.SUPABASE_URL!, wake.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${wake.token}` } },
  })
  const places = wake.places ?? []

  const model = process.env.ANTHROPIC_MODEL ?? SONNET_5
  const started = Date.now()
  const steps: { tool: string; input: unknown; summary: string }[] = []
  const progress = async (text: string) => {
    await sb.from('app_questions').update({ progress: text, steps }).eq('id', id)
  }
  const finish = async (patch: { status: 'done' | 'error'; answer?: string; error?: string }) => {
    const { error } = await sb.from('app_questions').update({ ...patch, model, steps, progress: null, finished_at: new Date().toISOString() }).eq('id', id)
    if (error) console.error('[app-ask] write failed:', error.message)
  }

  // The tables, read once, less the ones never shown.
  let schema: Map<string, string> | null = null
  const tables = async () => {
    if (schema) return schema
    const { data, error } = await sb.rpc('app_ask_schema')
    if (error) throw error
    schema = new Map(((data ?? []) as { table_name: string; columns: string }[]).filter((t) => !BLOCKED.test(t.table_name)).map((t) => [t.table_name, t.columns]))
    return schema
  }

  async function runTool(name: string, i: Obj): Promise<{ content: string; summary: string }> {
    if (name === 'find_pages') {
      const want = words(String(i.search ?? ''))
      const scored = places
        .map((p) => {
          const hay = `${p.label} ${p.sub ?? ''} ${p.to}`.toLowerCase()
          return { p, n: want.filter((w) => hay.includes(w)).length }
        })
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 25)
        .map((x) => x.p)
      return { content: JSON.stringify(scored), summary: `Pages for “${i.search}”: ${scored.length}` }
    }
    if (name === 'search_records') {
      const text = String(i.text ?? '').trim()
      if (text.length < 2) return { content: 'Search for at least two letters.', summary: 'Records: too short' }
      const hits = await runSearch(as, text)
      return { content: JSON.stringify(hits), summary: `Records for “${text}”: ${hits.length}` }
    }
    if (name === 'list_tables') {
      const all = await tables()
      const q = String(i.search ?? '').trim().toLowerCase()
      if (!q) return { content: [...all.keys()].join(', '), summary: 'Listed the tables' }
      const found = [...all].filter(([t, cols]) => t.includes(q) || cols.toLowerCase().includes(q)).slice(0, 25)
      return { content: cut(found.map(([t, cols]) => `${t}: ${cols}`).join('\n') || 'No table matches.'), summary: `Tables for “${q}”: ${found.length}` }
    }
    if (name === 'query_table') {
      const table = String(i.table ?? '')
      if (!NAME.test(table) || !(await tables()).has(table)) throw new Error(`No table ${table} (use list_tables)`)
      const sum = (Array.isArray(i.sum) ? i.sum : []).map(String)
      const groupBy = i.group_by ? String(i.group_by) : null
      for (const c of [...sum, ...(groupBy ? [groupBy] : [])]) if (!NAME.test(c)) throw new Error(`Bad column ${c}`)
      const select = sum.length || groupBy ? [...sum, ...(groupBy ? [groupBy] : [])].join(',') : String(i.select ?? '*')
      if (!SELECT.test(select)) throw new Error('Bad select')
      const filters = (Array.isArray(i.filters) ? i.filters : []) as { column: string; op: string; value: unknown }[]
      const build = (q: ReturnType<SupabaseClient['from']>, opts?: { count?: 'exact' }) => {
        let b = q.select(select, opts)
        for (const f of filters) {
          // A joined table's column (crops.name) filters as PostgREST does, with that table in select.
          if (!String(f.column).split('->')[0].split('.').every((part) => NAME.test(part))) throw new Error(`Bad column ${f.column}`)
          const v = f.op === 'in' ? `(${(Array.isArray(f.value) ? f.value : [f.value]).map((x) => JSON.stringify(String(x))).join(',')})` : String(f.value)
          b = b.filter(f.column, f.op, v)
        }
        return b
      }
      const desc = /\s+desc$/i.test(String(i.order ?? ''))
      const orderCol = String(i.order ?? '').replace(/\s+(asc|desc)$/i, '').trim()

      if (sum.length || groupBy) {
        const rows: Obj[] = []
        for (let from = 0; from < MAX_SUM_ROWS; from += 1000) {
          const { data, error } = await build(as.from(table)).range(from, from + 999)
          if (error) throw error
          rows.push(...((data ?? []) as Obj[]))
          if (!data || data.length < 1000) break
        }
        const groups = new Map<string, { rows: number; sums: Record<string, number> }>()
        for (const r of rows) {
          const k = groupBy ? String(r[groupBy] ?? '(none)') : 'all'
          const g = groups.get(k) ?? { rows: 0, sums: Object.fromEntries(sum.map((c) => [c, 0])) }
          g.rows++
          for (const c of sum) g.sums[c] += Number(r[c]) || 0
          groups.set(k, g)
        }
        const out = [...groups]
          .map(([k, g]) => ({ [groupBy ?? 'group']: k, rows: g.rows, ...Object.fromEntries(Object.entries(g.sums).map(([c, v]) => [`sum_${c}`, Math.round(v * 100) / 100])) }))
          .sort((a, b) => (sum.length ? Number(b[`sum_${sum[0]}`]) - Number(a[`sum_${sum[0]}`]) : b.rows - a.rows))
          .slice(0, 100)
        const capped = rows.length >= MAX_SUM_ROWS ? ` (stopped at ${MAX_SUM_ROWS} rows; narrow the filters)` : ''
        return { content: cut(JSON.stringify({ matching_rows: rows.length, groups: out }) + capped), summary: `Totals from ${table}: ${rows.length} rows` }
      }
      let q = build(as.from(table), { count: 'exact' })
      if (orderCol && NAME.test(orderCol)) q = q.order(orderCol, { ascending: !desc, nullsFirst: false })
      const { data, error, count } = await q.limit(Math.min(Number(i.limit) || 50, 200))
      if (error) throw error
      return { content: cut(JSON.stringify({ matching_rows: count, rows: data })), summary: `Read ${data?.length ?? 0} of ${count ?? '?'} rows from ${table}` }
    }
    throw new Error(`No tool ${name}`)
  }

  const label: Record<string, string> = {
    find_pages: 'Looking through the app…',
    search_records: 'Finding the records…',
    list_tables: 'Working out where that is kept…',
    query_table: 'Reading the records…',
  }

  const { data: who } = await sb.from('users').select('full_name').eq('id', row.asked_by).single()
  const system = withFarm(
    SYSTEM({
      today: new Date().toLocaleDateString('en-CA', { timeZone: farmTz(), weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      cropYear: wake.cropYear ?? null,
      name: (who?.full_name as string | undefined) ?? 'someone on the farm',
      page: (row.page as string | null) ?? null,
    }),
  )
  const messages: { role: 'user' | 'assistant'; content: string | Block[] }[] = [{ role: 'user', content: row.question as string }]

  try {
    await progress('Reading the question…')
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1 || Date.now() - started > LOOKUP_BUDGET_MS
      const left = JOB_BUDGET_MS - (Date.now() - started)
      if (left < 20_000) throw new Error('It took too long to work out; try a narrower question')
      if (last && round > 0) {
        const tail = messages[messages.length - 1]
        if (Array.isArray(tail.content)) tail.content.push({ type: 'text', text: 'Time is up for look-ups. Answer now from what you have found, and say plainly what you could not check.' })
        await progress('Writing the answer…')
      }
      const res = await callClaude(
        {
          model,
          maxTokens: 4000,
          // No extended thinking: someone is waiting on a phone.
          ...(alwaysThinks(model) ? { output_config: { effort: 'low' } } : { thinking: { type: 'disabled' } }),
          system,
          tools: TOOLS,
          ...(last ? { tool_choice: { type: 'none' } } : {}),
          messages,
        },
        { apiKey, signal: AbortSignal.timeout(Math.max(15_000, left - 10_000)) },
      )
      if (!res.ok) throw new Error(`The model could not answer (${res.status}): ${(await res.text()).slice(0, 300)}`)
      const out = (await res.json()) as MessagesReply & { content: Block[] }
      const uses = out.content.filter((c) => c.type === 'tool_use') as (Block & { id: string; name: string; input: Obj })[]
      if (out.stop_reason !== 'tool_use' || !uses.length) {
        const answer = replyText(out, '\n')
        const problem = replyProblem(out, answer)
        await finish(problem ? { status: 'error', error: problem } : { status: 'done', answer })
        return new Response('ok', { status: 200 })
      }
      messages.push({ role: 'assistant', content: out.content })
      await progress(label[uses[uses.length - 1].name] ?? 'Looking something up…')
      const results: Block[] = await Promise.all(
        uses.map(async (u): Promise<Block> => {
          try {
            const r = await runTool(u.name, u.input ?? {})
            steps.push({ tool: u.name, input: u.input, summary: r.summary })
            return { type: 'tool_result', tool_use_id: u.id, content: r.content }
          } catch (e) {
            const msg = ((e as { message?: string }).message ?? String(e)).slice(0, 500)
            steps.push({ tool: u.name, input: u.input, summary: `Failed: ${msg}` })
            return { type: 'tool_result', tool_use_id: u.id, content: `Error: ${msg}`, is_error: true }
          }
        }),
      )
      await progress('Thinking about what it found…')
      messages.push({ role: 'user', content: results })
    }
    throw new Error('It needed too many look-ups; try a narrower question')
  } catch (e) {
    const err = e as Error
    await finish({ status: 'error', error: err.name === 'TimeoutError' ? 'The model took too long to answer' : err.message.slice(0, 400) })
  }
  return new Response('ok', { status: 200 })
}
