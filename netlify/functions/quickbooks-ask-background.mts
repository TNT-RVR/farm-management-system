import { extractText, getDocumentProxy } from 'unpdf'
import { admin, qbAccess, qbGet, type QbAccount } from './_quickbooks.mts'
import { advisorModel, alwaysThinks, replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmProvinceName, withFarm } from '../../src/lib/farm-context.ts'
import { splitSummary, splitVendorInvoices } from '../shared/qb-invoice-split.ts'

/**
 * Ask QuickBooks: answers one question in qb_questions by looking things up
 * in the books, step by step, the way the accountant would — find how the
 * vendor is spelled, add up its bills, open the ones that matter, read the
 * invoice PDF behind a lump-sum bill, or run QuickBooks' own report.
 *
 * The model never touches the database directly: every look-up is one of the
 * tools below, read-only, and each is logged on the row so an answer can be
 * checked. Woken by /api/quickbooks-ask with the worker key; never by a browser.
 */

const MODEL_TIMEOUT_MS = 4 * 60_000
/** The whole job, inside the fifteen minutes a background function gets. */
const JOB_BUDGET_MS = 13 * 60_000
/** After this the look-ups stop and it answers with what it has. */
const LOOKUP_BUDGET_MS = 9 * 60_000
const MAX_ROUNDS = 14
const MAX_TOOL_CHARS = 40_000
const MAX_FILE_BYTES = 9_000_000

type Obj = Record<string, unknown>
type Block = { type: string; [k: string]: unknown }

const SYSTEM = () => `You answer questions about the QuickBooks Online books of a farm in ${farmProvinceName()}, for its owners and their accountant. Where the farm has described itself, that comes at the end.

You have read-only tools over the books (synced from QuickBooks into the farm's app) and over QuickBooks itself. Work like a careful bookkeeper:
- Start with books_overview when you need the date range, how fresh the sync is, or whether these are the live books or the sandbox.
- Names in a question are rarely spelled the way QuickBooks has them. Use find_names first (search a distinctive word, e.g. "Rivers"), then filter on the exact name.
- sum_lines adds up lines. side "out" is money spent (bills, cheques and card purchases, less vendor credits); "in" is money earned (invoices and sales receipts, less credit memos); "raw" is every line as stored (journal entries net to zero; credits are negative).
- When a question needs the split inside a supplier's bills — parts or materials against labour, service calls, travel, freight — use split_bills with the exact vendor name and dates: it reads every attached invoice at once and remembers them. Only open single bills (get_transaction, read_attachment) to check one, never to work through many. Invoices noted "Progress billing" are stages of one job: check the stages add up to the job and its parts are not counted twice. Say how many bills were split, how many had no invoice attached or could not be read, and what you did with those (e.g. reported their total separately).
- Time is limited. Do several look-ups in one turn when they don't depend on each other.
- run_report gives QuickBooks' own reports (profit and loss, balance sheet, aged payables, and so on) for questions about the business as a whole.
- Never invent or estimate a figure the books don't hold. If the data can't answer it, say exactly what is missing.

The answer is read on a phone. Lead with the answer in one or two sentences, with the figure in Canadian dollars. Then a few "- " bullets: the arithmetic (what was added and what was taken out), the date range covered, and anything doubtful (unsplit bills, GST included or not, sandbox data). Under 250 words. No headings, no tables, no preamble. Bold at most the main figure with **.`

const TOOLS = [
  {
    name: 'books_overview',
    description: 'The connected company, live books or sandbox, when it last synced, the date range of the synced transactions and how many of each type there are.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_names',
    description: 'Names as QuickBooks spells them, with how many lines use each and the date range. kind: party (vendors, customers, employees), account, item (products and services), class.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['party', 'account', 'item', 'class'] },
        search: { type: 'string', description: 'Part of the name, case-insensitive. Omit to list the most used.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['kind'],
    },
  },
  {
    name: 'sum_lines',
    description: 'Adds up transaction lines, grouped. Filters are case-insensitive "contains" matches. Returns label, amount, lines, transactions, first and last date per group.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        party: { type: 'string', description: 'Vendor/customer name contains' },
        account: { type: 'string' },
        item: { type: 'string' },
        class: { type: 'string' },
        text: { type: 'string', description: 'Line description or memo contains' },
        types: { type: 'array', items: { type: 'string', enum: ['Bill', 'Purchase', 'VendorCredit', 'Invoice', 'SalesReceipt', 'CreditMemo', 'Deposit', 'JournalEntry'] } },
        group_by: { type: 'string', enum: ['none', 'party', 'account', 'item', 'class', 'customer', 'month', 'year', 'entity', 'description', 'transaction'] },
        side: { type: 'string', enum: ['out', 'in', 'raw'] },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['group_by', 'side'],
    },
  },
  {
    name: 'list_lines',
    description: 'Individual transaction lines, newest first: date, type, id, doc number, name, account, item, description, qty, unit price, amount. Same filters as sum_lines.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        party: { type: 'string' },
        account: { type: 'string' },
        item: { type: 'string' },
        class: { type: 'string' },
        text: { type: 'string' },
        types: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 400 },
      },
    },
  },
  {
    name: 'get_transaction',
    description: 'One transaction: its header (doc number, date, name, total, balance, memo), every line, and the files attached to it (ids for read_attachment).',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', description: 'e.g. Bill, Purchase, Invoice' }, id: { type: 'string', description: 'The QuickBooks id' } },
      required: ['type', 'id'],
    },
  },
  {
    name: 'read_attachment',
    description: 'Reads a file attached in QuickBooks (usually the supplier invoice PDF behind a bill): its text, or the page itself when it is a scan.',
    input_schema: { type: 'object', properties: { attachment_id: { type: 'string' } }, required: ['attachment_id'] },
  },
  {
    name: 'split_bills',
    description:
      "Splits a vendor's bills and purchases in a date range into labour, parts, freight, other and tax, from the invoice PDFs attached in QuickBooks — many at once, remembered for next time. Returns the totals, each invoice, and how many bills had no file or could not be read.",
    input_schema: {
      type: 'object',
      properties: {
        party: { type: 'string', description: 'The vendor name as find_names spells it' },
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      },
      required: ['party'],
    },
  },
  {
    name: 'run_report',
    description:
      'Runs a QuickBooks report live and returns its rows. Common params: start_date, end_date (YYYY-MM-DD), accounting_method (Cash|Accrual), summarize_column_by (Total|Month|Quarter|Year|Vendors|Customers|Classes), vendor (id), customer (id), account (id).',
    input_schema: {
      type: 'object',
      properties: {
        report: {
          type: 'string',
          enum: ['ProfitAndLoss', 'ProfitAndLossDetail', 'BalanceSheet', 'CashFlow', 'GeneralLedger', 'TransactionList', 'VendorExpenses', 'VendorBalance', 'VendorBalanceDetail', 'AgedPayables', 'AgedPayableDetail', 'CustomerSales', 'CustomerIncome', 'CustomerBalance', 'AgedReceivables', 'AgedReceivableDetail', 'ItemSales', 'TrialBalance', 'AccountList', 'ClassSales'],
        },
        params: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['report'],
    },
  },
  {
    name: 'qb_query',
    description:
      'A read-only QuickBooks query for things not covered above (e.g. SELECT * FROM BillPayment WHERE TxnDate >= \'2026-01-01\', or Employee, Payment, Estimate, PurchaseOrder). SELECT only; at most 200 rows come back.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
]

const clip = (s: string) => (s.length > MAX_TOOL_CHARS ? `${s.slice(0, MAX_TOOL_CHARS)}\n… (cut off at ${MAX_TOOL_CHARS.toLocaleString()} characters — narrow the filters)` : s)
const cell = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
// A "contains" filter: wildcards escaped, and the characters that would break
// a PostgREST or() list (commas, brackets) dropped.
const like = (v: unknown) => {
  const s = typeof v === 'string' ? v.replace(/[,()]/g, ' ').trim() : ''
  return s ? s.replace(/[%_]/g, (m) => `\\${m}`) : null
}

/** A QuickBooks report as indented text rows: label | columns. */
function flattenReport(r: Obj): string {
  const header = (r.Header ?? {}) as Obj
  const cols = (((r.Columns as Obj | undefined)?.Column as Obj[] | undefined) ?? []).map((c) => cell(c.ColTitle) || cell(c.ColType))
  const out: string[] = [`${cell(header.ReportName)} ${cell(header.StartPeriod)} to ${cell(header.EndPeriod)} (${cell(header.ReportBasis)})`, cols.join(' | ')]
  const colData = (o: Obj | undefined) => ((o?.ColData as Obj[] | undefined) ?? []).map((c) => cell(c.value)).join(' | ')
  const walk = (rows: Obj[] | undefined, depth: number) => {
    for (const row of rows ?? []) {
      const pad = '  '.repeat(depth)
      if (row.Header) out.push(pad + colData(row.Header as Obj))
      if (row.ColData) out.push(pad + colData(row))
      walk(((row.Rows as Obj | undefined)?.Row as Obj[] | undefined) ?? undefined, depth + 1)
      if (row.Summary) out.push(`${pad}${colData(row.Summary as Obj)}`)
    }
  }
  walk(((r.Rows as Obj | undefined)?.Row as Obj[] | undefined) ?? undefined, 0)
  return out.join('\n')
}

export default async (req: Request) => {
  await hydrateSecrets()
  const apiKey = process.env.ANTHROPIC_API_KEY
  const workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!workerKey || req.headers.get('x-worker-key') !== workerKey) return new Response('Not authorised', { status: 403 })
  if (!apiKey) return new Response('Not configured', { status: 500 })

  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return new Response('id required', { status: 400 })
  const sb = admin()
  const { data: row } = await sb.from('qb_questions').select('id, status, question').eq('id', id).single()
  // Only a waiting question: a retried wake-up must not answer it twice.
  if (!row || row.status !== 'pending') return new Response('nothing to do', { status: 200 })

  const model = advisorModel()
  const started = Date.now()
  const steps: { tool: string; input: unknown; summary: string }[] = []
  const progress = async (text: string) => {
    await sb.from('qb_questions').update({ progress: text, steps }).eq('id', id)
  }
  const finish = async (patch: { status: 'done' | 'error'; answer?: string; error?: string }) => {
    const { error } = await sb
      .from('qb_questions')
      .update({ ...patch, model, steps, progress: null, finished_at: new Date().toISOString() })
      .eq('id', id)
    if (error) console.error('[quickbooks-ask] write failed:', error.message)
  }

  const { data: acct } = await sb
    .from('integration_accounts')
    .select('status, external_org_id, external_org_name, last_sync_at, meta')
    .eq('provider', 'quickbooks')
    .single()
  const realm = acct?.external_org_id as string | undefined
  if (!realm) {
    await finish({ status: 'error', error: 'QuickBooks is not connected' })
    return new Response('ok', { status: 200 })
  }
  // Opened once, on the first look-up that needs QuickBooks itself.
  let live: QbAccount | null = null
  const qb = async () => (live ??= await qbAccess(sb))

  const lineQuery = (i: Obj) => {
    let q = sb
      .from('qb_lines')
      .select('entity, qb_id, txn_date, party_name, customer_name, account_name, item_name, class_name, description, qty, unit_price, amount, entity_row_id')
      .eq('realm_id', realm)
    if (day(i.from)) q = q.gte('txn_date', day(i.from)!)
    if (day(i.to)) q = q.lte('txn_date', day(i.to)!)
    if (like(i.party)) q = q.or(`party_name.ilike.%${like(i.party)}%,customer_name.ilike.%${like(i.party)}%`)
    if (like(i.account)) q = q.ilike('account_name', `%${like(i.account)}%`)
    if (like(i.item)) q = q.ilike('item_name', `%${like(i.item)}%`)
    if (like(i.class)) q = q.ilike('class_name', `%${like(i.class)}%`)
    if (like(i.text)) q = q.ilike('description', `%${like(i.text)}%`)
    if (Array.isArray(i.types) && i.types.length) q = q.in('entity', i.types as string[])
    return q
  }

  /** Runs one tool; returns what the model reads and a short line for the log. */
  async function runTool(name: string, i: Obj): Promise<{ content: string | Block[]; summary: string }> {
    switch (name) {
      case 'books_overview': {
        const { data, error } = await sb.rpc('qb_ask_sum', { p_realm: realm, p_group: 'entity', p_side: 'raw', p_limit: 50 })
        if (error) throw new Error(error.message)
        const rows = (data ?? []) as { label: string; lines: number; transactions: number; first_date: string; last_date: string }[]
        const text = [
          `Company: ${acct!.external_org_name ?? '(unnamed)'}; ${acct!.meta?.environment === 'production' ? 'LIVE books' : 'SANDBOX (Intuit test data, not the farm)'}`,
          `Last synced: ${acct!.last_sync_at ?? 'never'}`,
          'Synced transactions by type (type: transactions, lines, first–last date):',
          ...rows.map((r) => `${r.label}: ${r.transactions}, ${r.lines} lines, ${r.first_date ?? '?'} – ${r.last_date ?? '?'}`),
        ].join('\n')
        return { content: text, summary: `${rows.reduce((s, r) => s + Number(r.transactions), 0)} transactions synced` }
      }
      case 'find_names': {
        const { data, error } = await sb.rpc('qb_ask_names', { p_realm: realm, p_kind: String(i.kind), p_search: like(i.search), p_limit: Number(i.limit ?? 40) })
        if (error) throw new Error(error.message)
        const rows = (data ?? []) as { name: string; lines: number; raw_total: number; first_date: string; last_date: string }[]
        return {
          content: rows.length ? rows.map((r) => `${r.name} | ${r.lines} lines | ${r.first_date} – ${r.last_date}`).join('\n') : 'No names match.',
          summary: `${rows.length} ${i.kind} names${i.search ? ` matching "${i.search}"` : ''}`,
        }
      }
      case 'sum_lines': {
        const { data, error } = await sb.rpc('qb_ask_sum', {
          p_realm: realm,
          p_from: day(i.from),
          p_to: day(i.to),
          p_party: like(i.party),
          p_account: like(i.account),
          p_item: like(i.item),
          p_class: like(i.class),
          p_text: like(i.text),
          p_entities: Array.isArray(i.types) && i.types.length ? i.types : null,
          p_group: String(i.group_by ?? 'none'),
          p_side: String(i.side ?? 'out'),
          p_limit: Number(i.limit ?? 100),
        })
        if (error) throw new Error(error.message)
        const rows = (data ?? []) as { label: string; amount: number; lines: number; transactions: number; first_date: string; last_date: string }[]
        return {
          content: rows.length
            ? ['label | amount | lines | transactions | first – last', ...rows.map((r) => `${r.label} | ${Number(r.amount).toFixed(2)} | ${r.lines} | ${r.transactions} | ${r.first_date} – ${r.last_date}`)].join('\n')
            : 'No lines match.',
          summary: `Added up ${i.side} by ${i.group_by}${i.party ? ` for "${i.party}"` : ''}: ${rows.length} rows`,
        }
      }
      case 'list_lines': {
        const limit = Math.min(Math.max(Number(i.limit ?? 200), 1), 400)
        const { data, error } = await lineQuery(i).order('txn_date', { ascending: false }).limit(limit)
        if (error) throw new Error(error.message)
        const rows = (data ?? []) as Obj[]
        const docs = new Map<string, string | null>()
        const ids = [...new Set(rows.map((r) => r.entity_row_id as string).filter(Boolean))]
        for (let k = 0; k < ids.length; k += 200) {
          const { data: e } = await sb.from('qb_entities').select('id, doc_number').in('id', ids.slice(k, k + 200))
          for (const x of e ?? []) docs.set(x.id as string, (x.doc_number as string) ?? null)
        }
        return {
          content: rows.length
            ? [
                'date | type id | doc | name | account | item | description | qty | unit price | amount',
                ...rows.map((r) =>
                  [r.txn_date, `${r.entity} ${r.qb_id}`, docs.get(r.entity_row_id as string), r.party_name ?? r.customer_name, r.account_name, r.item_name, r.description, r.qty, r.unit_price, r.amount]
                    .map(cell)
                    .join(' | '),
                ),
                ...(rows.length === limit ? [`(${limit} lines shown — there may be more; narrow the dates or use sum_lines)`] : []),
              ].join('\n')
            : 'No lines match.',
          summary: `Listed ${rows.length} lines${i.party ? ` for "${i.party}"` : ''}`,
        }
      }
      case 'get_transaction': {
        const { data: e } = await sb
          .from('qb_entities')
          .select('id, entity, qb_id, txn_date, doc_number, party_name, total, balance, memo')
          .eq('realm_id', realm)
          .eq('entity', String(i.type))
          .eq('qb_id', String(i.id))
          .maybeSingle()
        if (!e) return { content: `No ${i.type} ${i.id} in the synced books.`, summary: `${i.type} ${i.id} not found` }
        const { data: lines } = await sb
          .from('qb_lines')
          .select('line_no, account_name, item_name, description, qty, unit_price, amount, class_name')
          .eq('entity_row_id', e.id)
          .order('line_no')
        const { data: files } = await sb
          .from('qb_entities')
          .select('qb_id, name, total')
          .eq('realm_id', realm)
          .eq('entity', 'Attachable')
          .contains('refs', [`${e.entity}:${e.qb_id}`])
        return {
          content: [
            `${e.entity} ${e.qb_id} | doc ${e.doc_number ?? '-'} | ${e.txn_date} | ${e.party_name ?? '-'} | total ${e.total} | balance ${e.balance ?? '-'} | memo: ${cell(e.memo)}`,
            'Lines (no | account | item | description | qty | unit price | amount | class):',
            ...(lines ?? []).map((l) => [l.line_no, l.account_name, l.item_name, l.description, l.qty, l.unit_price, l.amount, l.class_name].map(cell).join(' | ')),
            files?.length ? `Attachments: ${files.map((f) => `${f.qb_id} (${f.name ?? 'file'})`).join(', ')}` : 'No attachments.',
          ].join('\n'),
          summary: `Opened ${e.entity} ${e.doc_number ?? e.qb_id} (${files?.length ?? 0} files)`,
        }
      }
      case 'read_attachment': {
        const fid = String(i.attachment_id ?? '')
        if (!/^\d+$/.test(fid)) return { content: 'attachment_id must be the numeric QuickBooks id', summary: 'Bad attachment id' }
        const { data: meta } = await sb.from('qb_entities').select('name, raw').eq('realm_id', realm).eq('entity', 'Attachable').eq('qb_id', fid).maybeSingle()
        const a = await qb()
        const link = (await qbGet<string>(a, `download/${fid}`, 'text/plain')).trim()
        if (!/^https:\/\//.test(link)) return { content: 'QuickBooks did not return a download link.', summary: 'No download link' }
        const res = await fetch(link)
        if (!res.ok) return { content: `The file did not download (${res.status}).`, summary: 'Download failed' }
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > MAX_FILE_BYTES) return { content: `The file is ${(buf.length / 1e6).toFixed(1)} MB, too large to read here.`, summary: 'File too large' }
        const type = String((meta?.raw as Obj | undefined)?.ContentType ?? res.headers.get('content-type') ?? '')
        const fname = String(meta?.name ?? fid)
        if (/pdf/i.test(type) || /\.pdf$/i.test(fname)) {
          let text = ''
          try {
            const pdf = await getDocumentProxy(new Uint8Array(buf))
            text = String((await extractText(pdf, { mergePages: true })).text ?? '').trim()
          } catch {
            /* a damaged or image-only PDF: sent as a document below */
          }
          if (text.length > 150) return { content: clip(`${fname} (text of the PDF):\n${text}`), summary: `Read ${fname}` }
          return {
            content: [
              { type: 'text', text: `${fname} (a scanned PDF, attached as the document):` },
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
            ],
            summary: `Read ${fname} (scan)`,
          }
        }
        const img = /png/i.test(type) ? 'image/png' : /jpe?g/i.test(type) ? 'image/jpeg' : /gif/i.test(type) ? 'image/gif' : /webp/i.test(type) ? 'image/webp' : null
        if (img && buf.length <= 4_500_000) {
          return {
            content: [
              { type: 'text', text: `${fname}:` },
              { type: 'image', source: { type: 'base64', media_type: img, data: buf.toString('base64') } },
            ],
            summary: `Looked at ${fname}`,
          }
        }
        return { content: `${fname} is a ${type || 'file'} this can't read.`, summary: `Could not read ${fname}` }
      }
      case 'split_bills': {
        const party = typeof i.party === 'string' ? i.party.trim() : ''
        if (party.length < 3) return { content: 'party is required (the vendor name)', summary: 'No vendor given' }
        const r = await splitVendorInvoices({
          sb,
          realm: realm!,
          party,
          from: day(i.from),
          to: day(i.to),
          apiKey: apiKey!,
          access: qb,
          qbGet,
          deadline: started + LOOKUP_BUDGET_MS,
        })
        return { content: clip(splitSummary(r)), summary: `Split ${r.splits.length} of ${r.bills} ${party} bills${r.notRead ? ` (${r.notRead} not read)` : ''}` }
      }
      case 'run_report': {
        const report = String(i.report ?? '')
        if (!/^[A-Za-z]+$/.test(report)) return { content: 'Unknown report', summary: 'Bad report name' }
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries((i.params as Obj | undefined) ?? {})) if (/^[a-z_]+$/.test(k) && v != null) params.set(k, String(v))
        const a = await qb()
        const r = await qbGet<Obj>(a, `reports/${report}${params.size ? `?${params}` : ''}`)
        return { content: clip(flattenReport(r)), summary: `Ran ${report}${params.get('start_date') ? ` from ${params.get('start_date')}` : ''}` }
      }
      case 'qb_query': {
        const query = String(i.query ?? '').trim().replace(/;+\s*$/, '')
        if (!/^select\s/i.test(query)) return { content: 'Only SELECT queries are allowed.', summary: 'Refused a non-SELECT query' }
        const q = /maxresults\s+\d+/i.test(query) ? query : `${query} MAXRESULTS 200`
        const a = await qb()
        const r = await qbGet<{ QueryResponse?: Obj }>(a, `query?query=${encodeURIComponent(q)}`)
        const resp = r.QueryResponse ?? {}
        const key = Object.keys(resp).find((k) => Array.isArray(resp[k]))
        const items = key ? (resp[key] as Obj[]).slice(0, 200) : []
        return { content: clip(items.length ? items.map((x) => JSON.stringify(x)).join('\n') : 'No rows.'), summary: `Queried QuickBooks: ${items.length} ${key ?? 'rows'}` }
      }
      default:
        return { content: `No tool called ${name}`, summary: `Unknown tool ${name}` }
    }
  }

  const label: Record<string, string> = {
    books_overview: 'Checking what is in the books…',
    find_names: 'Looking up names…',
    sum_lines: 'Adding up transactions…',
    list_lines: 'Reading bill lines…',
    get_transaction: 'Opening a transaction…',
    read_attachment: 'Reading an attached invoice…',
    split_bills: 'Reading the invoices behind the bills…',
    run_report: 'Running a QuickBooks report…',
    qb_query: 'Asking QuickBooks directly…',
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
  const messages: { role: 'user' | 'assistant'; content: string | Block[] }[] = [
    { role: 'user', content: `Today is ${today}.\n\nQUESTION: ${row.question}` },
  ]

  try {
    await progress('Reading the question…')
    let outOfTime = false
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Out of look-up time or turns: answer now with what it has rather than stop.
      const last = outOfTime || round === MAX_ROUNDS - 1 || Date.now() - started > LOOKUP_BUDGET_MS
      const left = JOB_BUDGET_MS - (Date.now() - started)
      if (left < 30_000) throw new Error('It took too long to work out; try a narrower question (a vendor, an account, a date range)')
      if (last && round > 0) {
        const tail = messages[messages.length - 1]
        if (Array.isArray(tail.content) && !tail.content.some((c) => c.type === 'text')) tail.content.push({ type: 'text', text: 'Time is up for look-ups. Answer now from what you have found, and say plainly what you could not check.' })
        await progress('Writing the answer…')
      }
      // A look-up turn leaves 2½ minutes for the answer; if it runs into them, the answer comes next.
      let res: Response
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          signal: AbortSignal.timeout(last ? left : Math.max(20_000, Math.min(MODEL_TIMEOUT_MS, left - 150_000))),
          body: JSON.stringify({
            model,
            max_tokens: 16000,
            ...(alwaysThinks(model) ? { output_config: { effort: 'medium' } } : { thinking: { type: 'disabled' } }),
            system: withFarm(SYSTEM()),
            tools: TOOLS,
            ...(last ? { tool_choice: { type: 'none' } } : {}),
            messages,
          }),
        })
      } catch (e) {
        if (!last && (e as Error).name === 'TimeoutError' && round > 0) {
          outOfTime = true
          continue
        }
        throw e
      }
      if (!res.ok) throw new Error(`The model could not answer (${res.status}): ${(await res.text()).slice(0, 300)}`)
      const out = (await res.json()) as MessagesReply & { content: Block[] }
      const uses = out.content.filter((c) => c.type === 'tool_use') as (Block & { id: string; name: string; input: Obj })[]
      if (out.stop_reason !== 'tool_use' || !uses.length) {
        const answer = replyText(out, '\n')
        const problem = replyProblem(out, answer)
        await finish(problem ? { status: 'error', error: problem } : { status: 'done', answer })
        return new Response('ok', { status: 200 })
      }
      // The whole turn goes back unchanged: its thinking blocks are signed.
      messages.push({ role: 'assistant', content: out.content })
      // The turn's look-ups run together; one that would start after the look-up time is skipped.
      await progress(label[uses[uses.length - 1].name] ?? 'Looking something up…')
      const results: Block[] = await Promise.all(
        uses.map(async (u): Promise<Block> => {
          if (Date.now() - started > LOOKUP_BUDGET_MS) {
            steps.push({ tool: u.name, input: u.input, summary: 'Skipped: out of time' })
            return { type: 'tool_result', tool_use_id: u.id, content: 'Not run: out of time for look-ups.', is_error: true }
          }
          try {
            const r = await runTool(u.name, u.input ?? {})
            steps.push({ tool: u.name, input: u.input, summary: r.summary })
            return { type: 'tool_result', tool_use_id: u.id, content: r.content }
          } catch (e) {
            const msg = (e as Error).message.slice(0, 500)
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
