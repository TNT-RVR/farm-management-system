import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QbAccount } from '../functions/_quickbooks.mts'
import { extractText, getDocumentProxy } from 'unpdf'

/**
 * What a supplier's invoices were for — labour, parts, freight, other — read
 * from the PDFs attached to their bills in QuickBooks, several at a time by a
 * fast model, and kept in qb_invoice_splits so a second question is instant.
 *
 * Why it exists (Sam, 7 Oct 2026): "What did we pay Rivers Electric, less
 * parts?" read 46 invoices one look-up at a time and ran out of time after 95
 * look-ups without answering. This answers it in one step.
 */

export type Split = {
  attachable_id: string
  txn_ref: string
  txn_date: string | null
  total: number | null
  labour: number | null
  parts: number | null
  freight: number | null
  other: number | null
  tax: number | null
  notes: string | null
}

type QbGet = <T>(a: QbAccount, path: string, accept?: string) => Promise<T>

const chunks = <T>(xs: T[], n = 150) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n))

const FAST_MODEL = () => process.env.ANTHROPIC_FAST_MODEL ?? 'claude-haiku-4-5-20251001'
const num = (v: unknown) =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)

const SPLIT_TOOL = {
  name: 'invoice_split',
  description:
    'How this supplier invoice divides between labour, parts, freight and other charges, before tax.',
  input_schema: {
    type: 'object',
    properties: {
      total: { type: ['number', 'null'], description: 'Invoice total including tax' },
      tax: { type: ['number', 'null'], description: 'GST/PST on the invoice' },
      labour: {
        type: ['number', 'null'],
        description: 'Labour, service calls, travel time, mileage and truck charges for the work',
      },
      parts: { type: ['number', 'null'], description: 'Parts, materials and supplies' },
      freight: { type: ['number', 'null'], description: 'Freight or delivery' },
      other: {
        type: ['number', 'null'],
        description: 'Anything else (shop supplies %, rentals, fees)',
      },
      notes: {
        type: ['string', 'null'],
        description: 'One short line on what the job was, or why the split is uncertain',
      },
    },
    required: ['total', 'tax', 'labour', 'parts', 'freight', 'other', 'notes'],
  },
}

async function splitOne(
  apiKey: string,
  fname: string,
  text: string | null,
  pdf: Buffer | null,
): Promise<Omit<Split, 'attachable_id' | 'txn_ref' | 'txn_date'> & { model: string }> {
  const content = text
    ? [{ type: 'text', text: `Supplier invoice ${fname}:\n\n${text.slice(0, 18000)}` }]
    : [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf!.toString('base64') },
        },
        { type: 'text', text: `Supplier invoice ${fname} (a scan).` },
      ]
  const model = FAST_MODEL()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system:
        'You read one supplier invoice for a farm and split its amount, before tax, into labour (service, travel, mileage, truck/service charges), parts (parts, materials, supplies), freight and other. Use the invoice line items. If the lines are not itemised, put the whole pre-tax amount where it plainly belongs and say so in notes. A progress or final invoice that subtracts earlier billings: split only what this invoice bills (scale its labour/parts so they add up to the pre-tax amount on this invoice) and start notes with "Progress billing:". Never invent a figure the invoice does not support; use null when there is none.',
      tools: [SPLIT_TOOL],
      tool_choice: { type: 'tool', name: SPLIT_TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`model ${res.status}`)
  const out = (await res.json()) as { content: { type: string; input?: Record<string, unknown> }[] }
  const i = out.content.find((c) => c.type === 'tool_use')?.input ?? {}
  return {
    total: num(i.total),
    tax: num(i.tax),
    labour: num(i.labour),
    parts: num(i.parts),
    freight: num(i.freight),
    other: num(i.other),
    notes: (i.notes as string) ?? null,
    model,
  }
}

/**
 * Split every invoice attached to a supplier's bills and purchases in a date
 * range. Kept splits are reused; new ones are read up to `concurrency` at a
 * time until `deadline`, after which the rest are reported as not read yet.
 */
export async function splitVendorInvoices(o: {
  sb: SupabaseClient
  realm: string
  party: string
  from: string | null
  to: string | null
  apiKey: string
  access: () => Promise<QbAccount>
  qbGet: QbGet
  deadline: number
  concurrency?: number
}): Promise<{
  splits: Split[]
  bills: number
  billsWithoutPdf: number
  notRead: number
  billTotal: number
}> {
  const { sb, realm } = o
  let q = sb
    .from('qb_entities')
    .select('id, entity, qb_id, txn_date, party_name, total')
    .eq('realm_id', realm)
    .in('entity', ['Bill', 'Purchase'])
    .ilike('party_name', `%${o.party.replace(/[%_,()]/g, ' ').trim()}%`)
  if (o.from) q = q.gte('txn_date', o.from)
  if (o.to) q = q.lte('txn_date', o.to)
  const { data: bills, error } = await q.order('txn_date')
  if (error) throw new Error(error.message)
  const refs = (bills ?? []).map((b) => `${b.entity}:${b.qb_id}`)
  const billTotal = (bills ?? []).reduce((s, b) => s + (Number(b.total) || 0), 0)
  if (!refs.length) return { splits: [], bills: 0, billsWithoutPdf: 0, notRead: 0, billTotal: 0 }

  const files: { qb_id: unknown; name: unknown; refs: unknown; raw: unknown }[] = []
  for (const part of chunks(refs)) {
    const { data, error: e } = await sb
      .from('qb_entities')
      .select('qb_id, name, refs, raw')
      .eq('realm_id', realm)
      .eq('entity', 'Attachable')
      .overlaps('refs', part)
    if (e) throw new Error(e.message)
    files.push(...(data ?? []))
  }
  const byRef = new Map((bills ?? []).map((b) => [`${b.entity}:${b.qb_id}`, b]))
  const pdfs = [...new Map(files.map((f) => [String(f.qb_id), f])).values()]
    .map((f) => ({
      id: String(f.qb_id),
      name: String(f.name ?? f.qb_id),
      type: String((f.raw as { ContentType?: string } | null)?.ContentType ?? ''),
      ref: ((f.refs as string[]) ?? []).find((r) => byRef.has(r)) ?? '',
    }))
    .filter((f) => f.ref && (/pdf|image/i.test(f.type) || /\.(pdf|jpe?g|png)$/i.test(f.name)))
    // One file per bill, a PDF before a photo, so a bill with two files is not counted twice.
    .sort((a, b) => Number(/pdf/i.test(b.type + b.name)) - Number(/pdf/i.test(a.type + a.name)))
    .filter((f, k, all) => all.findIndex((g) => g.ref === f.ref) === k)
  const covered = new Set(pdfs.map((p) => p.ref))

  const kept: Record<string, unknown>[] = []
  for (const part of chunks(pdfs.map((p) => p.id))) {
    const { data } = await sb.from('qb_invoice_splits').select('*').in('attachable_id', part)
    kept.push(...(data ?? []))
  }
  const have = new Map(kept.map((k) => [String(k.attachable_id), k]))
  const todo = pdfs.filter((p) => !have.has(p.id))
  const splits: Split[] = kept.map((k) => ({
    attachable_id: String(k.attachable_id),
    txn_ref: String(k.txn_ref),
    txn_date: k.txn_date as string | null,
    total: num(k.total),
    labour: num(k.labour),
    parts: num(k.parts),
    freight: num(k.freight),
    other: num(k.other),
    tax: num(k.tax),
    notes: (k.notes as string) ?? null,
  }))

  let notRead = 0
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const p = todo[next++]
      if (Date.now() > o.deadline) {
        notRead++
        continue
      }
      try {
        const a = await o.access()
        const link = (await o.qbGet<string>(a, `download/${p.id}`, 'text/plain')).trim()
        const res = await fetch(link)
        if (!res.ok) throw new Error(`download ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        let text: string | null = null
        if (/pdf/i.test(p.type) || /\.pdf$/i.test(p.name)) {
          try {
            text = String(
              (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true }))
                .text ?? '',
            ).trim()
          } catch {
            text = null
          }
          if (text && text.length < 150) text = null
        }
        if (!text && (buf.length > 9_000_000 || !/pdf/i.test(p.type + p.name)))
          throw new Error('not readable here')
        const s = await splitOne(o.apiKey, p.name, text, text ? null : buf)
        const bill = byRef.get(p.ref)!
        const row = {
          attachable_id: p.id,
          realm_id: realm,
          txn_ref: p.ref,
          party_name: bill.party_name,
          txn_date: bill.txn_date,
          ...s,
        }
        await sb.from('qb_invoice_splits').upsert(row, { onConflict: 'attachable_id' })
        splits.push({
          attachable_id: p.id,
          txn_ref: p.ref,
          txn_date: bill.txn_date as string | null,
          total: s.total,
          labour: s.labour,
          parts: s.parts,
          freight: s.freight,
          other: s.other,
          tax: s.tax,
          notes: s.notes,
        })
      } catch {
        notRead++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 6) }, worker))
  return {
    splits,
    bills: refs.length,
    billsWithoutPdf: refs.filter((r) => !covered.has(r)).length,
    notRead,
    billTotal,
  }
}

/** The splits as a few lines the asking model can quote: totals, then each invoice. */
export function splitSummary(r: Awaited<ReturnType<typeof splitVendorInvoices>>): string {
  const sum = (k: keyof Split) => r.splits.reduce((s, x) => s + (Number(x[k]) || 0), 0)
  const f = (v: number) => v.toFixed(2)
  return [
    `Bills and purchases found: ${r.bills} (total ${f(r.billTotal)} incl. tax). Invoices split: ${r.splits.length}. Bills with no PDF attached: ${r.billsWithoutPdf}. PDFs not read in time or unreadable: ${r.notRead}.`,
    `Across the split invoices: labour ${f(sum('labour'))}, parts ${f(sum('parts'))}, freight ${f(sum('freight'))}, other ${f(sum('other'))}, tax ${f(sum('tax'))}, total ${f(sum('total'))}.`,
    'Each invoice (date | bill | total | labour | parts | freight | other | tax | note):',
    ...r.splits
      .sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)))
      .map((s) =>
        [
          s.txn_date,
          s.txn_ref,
          s.total,
          s.labour,
          s.parts,
          s.freight,
          s.other,
          s.tax,
          s.notes ?? '',
        ]
          .map((v) => (v == null ? '-' : String(v)))
          .join(' | '),
      ),
  ].join('\n')
}
