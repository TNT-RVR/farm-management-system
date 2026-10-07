import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { farmRetailer } from './farm-context'

/**
 * What ICI put down, field by field, and what it cost — from the notes under
 * each invoice line (ici_field_lines) — set against ICI's own ticket (the
 * plan printed on the invoice), the acres actually farmed, the prescription
 * (fertility_rx) and the soil-test recommendation.
 */

export type Npks = { N: number; P: number; K: number; S: number }
const ZERO: Npks = { N: 0, P: 0, K: 0, S: 0 }
const LB_PER_T = 2204.62

export type IciLine = {
  id: string
  invoice_no: string
  invoice_date: string
  ref_no: string
  kind: 'blend' | 'edge' | 'floating' | 'delivery' | 'fertilizer' | 'other'
  description: string
  quantity: number | null
  unit: string | null
  amount: number
  field_id: string | null
  field_text: string | null
  crop_text: string | null
  rate_lb_ac: number | null
  ticket_acres: number | null
  cost_per_ac: number | null
  target: Record<string, number> | null
}

export type FieldIci = {
  fieldId: string
  name: string
  crop: string | null
  /** Acres in the crop plan — what is farmed. */
  mappedAcres: number | null
  /** Acres on ICI's ticket (their plan). */
  ticketAcres: number
  /** Acres billed for floating. */
  floatedAcres: number
  blends: { description: string; rate: number | null; acres: number; tonnes: number; amount: number; target: Record<string, number> | null; invoices: string[] }[]
  /** lb/ac of N, P2O5, K2O, S the ticket says went on. */
  applied: Npks
  rx: Npks | null
  rxLabel: string | null
  /** The crop the prescription was written for, when it isn't the crop grown. */
  rxOtherCrop: string | null
  soilRec: Npks | null
  cost: { blend: number; edge: number; floating: number; delivery: number; total: number }
  /** What the ticket said the product would cost (its $/ac × its acres). */
  ticketCost: number
  /** Product billed against product the ticket's rate × acres calls for. */
  billedLb: number
  ticketLb: number
  edgeKg: number
  invoices: string[]
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

/** "19.5-15.6-15.6-3.9" at 257 lb/ac → lb/ac of N, P2O5, K2O, S. */
export function analysisToNpks(analysis: string, rate: number): Npks {
  const parts = analysis.split('-').map((x) => parseFloat(x))
  return { N: ((parts[0] || 0) * rate) / 100, P: ((parts[1] || 0) * rate) / 100, K: ((parts[2] || 0) * rate) / 100, S: ((parts[3] || 0) * rate) / 100 }
}

export function buildFieldIci(
  lines: IciLine[],
  fields: { id: string; name: string }[],
  plans: { field_id: string; planned_acres: number | null; crop: string | null }[],
  rx: { field_id: string | null; crop_type: string | null; products: { analysis?: string; avgRate?: number; label?: string }[] | null }[],
  recs: { field_id: string; recommendation: { nutrient: string; lb_per_ac: number }[] | null }[],
): FieldIci[] {
  const byField = new Map<string, IciLine[]>()
  for (const l of lines) if (l.field_id && l.kind !== 'other') byField.set(l.field_id, [...(byField.get(l.field_id) ?? []), l])
  const out: FieldIci[] = []
  for (const [fieldId, ls] of byField) {
    const name = fields.find((f) => f.id === fieldId)?.name ?? '?'
    const plan = plans.filter((p) => p.field_id === fieldId)
    const mapped = plan.reduce((s, p) => s + n(p.planned_acres), 0) || null
    // One entry per blend (a blend split over two loads is one blend).
    const groups = new Map<string, FieldIci['blends'][number]>()
    for (const l of ls.filter((x) => x.kind === 'blend' || x.kind === 'fertilizer')) {
      const g = groups.get(l.description) ?? { description: l.description, rate: l.rate_lb_ac, acres: 0, tonnes: 0, amount: 0, target: l.target, invoices: [] }
      g.acres += n(l.ticket_acres)
      g.tonnes += /metric|tonne/i.test(`${l.unit} ${l.description}`) ? n(l.quantity) : 0
      g.amount += n(l.amount)
      if (!g.invoices.includes(l.invoice_no)) g.invoices.push(l.invoice_no)
      groups.set(l.description, g)
    }
    const blends = [...groups.values()]
    const maxAcres = Math.max(1, ...blends.map((b) => b.acres))
    const applied: Npks = { ...ZERO }
    for (const b of blends) {
      if (!b.target) continue
      const share = b.acres > 0 ? b.acres / maxAcres : 1
      for (const k of ['N', 'P', 'K', 'S'] as const) applied[k] += n(b.target[k]) * share
    }
    const sum = (k: IciLine['kind']) => ls.filter((l) => l.kind === k).reduce((s, l) => s + n(l.amount), 0)
    const blendCost = sum('blend') + sum('fertilizer')
    const r = rx.find((x) => x.field_id === fieldId)
    const rxN = r?.products?.length ? r.products.reduce((acc, p) => {
      const v = analysisToNpks(String(p.analysis ?? p.label ?? ''), n(p.avgRate))
      return { N: acc.N + v.N, P: acc.P + v.P, K: acc.K + v.K, S: acc.S + v.S }
    }, { ...ZERO }) : null
    // A prescription with no rate (NH3 at 0 for a carrot plan) prescribes nothing usable.
    const rxUsable = rxN && rxN.N + rxN.P + rxN.K + rxN.S > 0 ? rxN : null
    const rec = recs.find((x) => x.field_id === fieldId)
    const recN = rec?.recommendation?.length
      ? rec.recommendation.reduce((acc, x) => {
          const k = /^N/i.test(x.nutrient) ? 'N' : /^P/i.test(x.nutrient) ? 'P' : /^K/i.test(x.nutrient) ? 'K' : /^S/i.test(x.nutrient) ? 'S' : null
          if (k) acc[k] += n(x.lb_per_ac)
          return acc
        }, { ...ZERO })
      : null
    out.push({
      fieldId,
      name,
      crop: plan.find((p) => p.crop)?.crop ?? ls.find((l) => l.crop_text)?.crop_text ?? null,
      mappedAcres: mapped,
      ticketAcres: maxAcres === 1 && !blends.length ? 0 : maxAcres,
      floatedAcres: ls.filter((l) => l.kind === 'floating').reduce((s, l) => s + n(l.quantity), 0),
      blends,
      applied,
      rx: rxUsable,
      rxOtherCrop: r?.crop_type && (plan.find((p) => p.crop)?.crop ?? '').toLowerCase().split(/[- ]/)[0] !== r.crop_type.toLowerCase().split(/[- ]/)[0] ? r.crop_type : null,
      rxLabel: r?.products?.map((p) => `${p.analysis ?? p.label} @ ${Math.round(n(p.avgRate))} lb/ac`).join(' + ') ?? null,
      soilRec: recN,
      cost: { blend: blendCost, edge: sum('edge'), floating: sum('floating'), delivery: sum('delivery'), total: ls.reduce((s, l) => s + n(l.amount), 0) },
      ticketCost: blends.reduce((s, b) => s + n(ls.find((l) => l.description === b.description)?.cost_per_ac) * b.acres, 0),
      billedLb: blends.reduce((s, b) => s + b.tonnes * LB_PER_T, 0),
      ticketLb: blends.reduce((s, b) => s + n(b.rate) * b.acres, 0),
      edgeKg: ls.filter((l) => l.kind === 'edge').reduce((s, l) => s + n(l.quantity), 0),
      invoices: [...new Set(ls.map((l) => l.invoice_no))],
    })
  }
  return out.sort((a, b) => b.cost.total - a.cost.total)
}

export function useIciReview(year: number) {
  return useQuery({
    queryKey: ['ici-review', year],
    queryFn: async () => {
      const [lines, fields, plans, rx, reports] = await Promise.all([
        supabase.from('ici_field_lines').select('*').eq('crop_year', year),
        supabase.from('fields').select('id, name'),
        supabase.from('crop_plans').select('field_id, planned_acres, crops(name)').eq('crop_year', year),
        supabase.from('fertility_rx').select('field_id, crop_type, products').eq('crop_year', year),
        supabase.from('soil_test_reports').select('id, field_id, crop_year, report_date, soil_test_assessments(recommendation)').lte('crop_year', year).order('crop_year', { ascending: false }),
      ])
      for (const r of [lines, fields, plans, rx, reports]) if (r.error) throw r.error
      const all = (lines.data ?? []) as unknown as IciLine[]
      // The newest soil test per field that has a recommendation.
      const recs: { field_id: string; recommendation: { nutrient: string; lb_per_ac: number }[] | null }[] = []
      type Assess = { recommendation: { nutrient: string; lb_per_ac: number }[] | null }
      for (const rep of (reports.data ?? []) as unknown as { field_id: string; soil_test_assessments: Assess | Assess[] | null }[]) {
        // One assessment per report comes back as an object, several as a list.
        const list = Array.isArray(rep.soil_test_assessments) ? rep.soil_test_assessments : rep.soil_test_assessments ? [rep.soil_test_assessments] : []
        const rec = list.find((a) => a.recommendation?.length)?.recommendation
        if (rec && !recs.some((x) => x.field_id === rep.field_id)) recs.push({ field_id: rep.field_id, recommendation: rec })
      }
      const planRows = ((plans.data ?? []) as unknown as { field_id: string; planned_acres: number | null; crops: { name: string } | null }[]).map((p) => ({ field_id: p.field_id, planned_acres: p.planned_acres, crop: p.crops?.name ?? null }))
      const byField = buildFieldIci(all, (fields.data ?? []) as { id: string; name: string }[], planRows, (rx.data ?? []) as never, recs)
      const total = (k?: IciLine['kind']) => all.filter((l) => l.kind !== 'other' && (!k || l.kind === k)).reduce((s, l) => s + n(l.amount), 0)
      return {
        byField,
        unassigned: all.filter((l) => !l.field_id && l.kind !== 'other'),
        totals: { all: total(), blend: total('blend') + total('fertilizer'), edge: total('edge'), floating: total('floating'), delivery: total('delivery') },
        invoiceCount: new Set(all.map((l) => l.invoice_no)).size,
      }
    },
  })
}

export function useIciReviews(year: number) {
  return useQuery({
    queryKey: ['ici_fert_reviews', year],
    refetchInterval: (q) => ((q.state.data as { status: string }[] | undefined)?.[0]?.status === 'running' ? 8000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.from('ici_fert_reviews').select('*').eq('crop_year', year).order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data ?? []) as { id: string; status: 'running' | 'done' | 'error'; content: string | null; error: string | null; created_at: string; finished_at: string | null; model: string | null }[]
    },
  })
}

export type Straight = { name: string; n: number; p: number; k: number; s: number; price_per_tonne: number }

/**
 * What the same N-P-K-S would cost as straights (AS for the S, MAP for the P,
 * potash for the K, urea for the rest of the N) at the prices on file — the
 * yardstick for whether a blend was worth its price. Blending and application
 * are not in it.
 */
export function straightsCost(t: Npks, prices: Straight[]): { perAc: number; lb: Record<string, number> } | null {
  const find = (re: RegExp) => prices.find((p) => re.test(p.name))
  const urea = find(/46-0-0/)
  const map = find(/11-52-0/)
  const potash = find(/0-0-60/)
  const as = find(/21-0-0-24/)
  if (!urea || !map || !potash || !as) return null
  const asLb = t.S > 0 ? t.S / Number(as.s) : 0
  const mapLb = t.P > 0 ? t.P / Number(map.p) : 0
  const kLb = t.K > 0 ? t.K / Number(potash.k) : 0
  const nLeft = Math.max(0, t.N - asLb * Number(as.n) - mapLb * Number(map.n))
  const uLb = nLeft / Number(urea.n)
  const $ = (lb: number, p: Straight) => (lb * Number(p.price_per_tonne)) / LB_PER_T
  return { perAc: $(asLb, as) + $(mapLb, map) + $(kLb, potash) + $(uLb, urea), lb: { urea: uLb, MAP: mapLb, potash: kLb, AS: asLb } }
}

/* ------------------------------------------------------- contract terms */

export type IciTerms = {
  /** $/ac ICI bills for floating. */
  floatingPerAcre: number
  /** Edge, lb/ac on the ticket's acres. */
  edgeLbPerAcre: number
  /** Plain words for where each came from. */
  floatingFrom: string
  edgeFrom: string
}

export type TermLine = Pick<IciLine, 'kind' | 'invoice_date' | 'quantity' | 'amount' | 'field_id' | 'ticket_acres'> & { crop_year: number }

/** The value most of the lines share; a tie goes to the one billed latest. */
function commonest(values: { v: number; on: string }[]): { v: number; n: number } | null {
  const tally = new Map<number, { n: number; on: string }>()
  for (const x of values) {
    const t = tally.get(x.v) ?? { n: 0, on: '' }
    t.n += 1
    if (x.on > t.on) t.on = x.on
    tally.set(x.v, t)
  }
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].on.localeCompare(a[1].on))[0]
  return best ? { v: best[0], n: best[1].n } : null
}

/**
 * ICI's contract terms as they were last billed: the floating $/ac and the
 * Edge lb/ac, from the latest crop year's invoices that carry them, so a new
 * invoice moves the yardstick on its own. The rate is the one most lines were
 * billed at — one discounted field (Novak Main floated at $14.50 in 2026) or
 * an over-billed one (Creek Flat's Edge) must not move the figure the others are
 * judged by. A floating line billed at $0 (the "N" lines) charged nothing and
 * says nothing about the rate. Edge is the kilograms billed for a field over
 * the acres on its blend ticket. Either falls back to the stored figure.
 */
export function iciContractTerms(lines: TermLine[], fallback: { floatingPerAcre: number; edgeLbPerAcre: number }): IciTerms {
  const charged = (l: TermLine) => n(l.amount) > 0 && n(l.quantity) > 0
  const latestYear = (kind: IciLine['kind']) => Math.max(-Infinity, ...lines.filter((l) => l.kind === kind && charged(l)).map((l) => l.crop_year))

  const fy = latestYear('floating')
  const floats = lines
    .filter((l) => l.kind === 'floating' && l.crop_year === fy && charged(l))
    .map((l) => ({ v: Math.round((n(l.amount) / n(l.quantity)) * 100) / 100, on: l.invoice_date }))
  const f = commonest(floats)

  const ey = latestYear('edge')
  const ticket = new Map<string, number>()
  for (const l of lines) {
    if (l.crop_year !== ey || !l.field_id || (l.kind !== 'blend' && l.kind !== 'fertilizer')) continue
    ticket.set(l.field_id, Math.max(ticket.get(l.field_id) ?? 0, n(l.ticket_acres)))
  }
  const kg = new Map<string, { kg: number; on: string }>()
  for (const l of lines) {
    if (l.kind !== 'edge' || l.crop_year !== ey || !l.field_id || !(n(l.quantity) > 0)) continue
    const k = kg.get(l.field_id) ?? { kg: 0, on: '' }
    k.kg += n(l.quantity)
    if (l.invoice_date > k.on) k.on = l.invoice_date
    kg.set(l.field_id, k)
  }
  const edges = [...kg.entries()]
    .filter(([id]) => (ticket.get(id) ?? 0) > 0)
    .map(([id, k]) => ({ v: Math.round(((k.kg * 2.20462) / ticket.get(id)!) * 10) / 10, on: k.on }))
  const e = commonest(edges)

  return {
    floatingPerAcre: f?.v ?? fallback.floatingPerAcre,
    floatingFrom: f ? `${fy} ${farmRetailer()} invoices, ${f.n} of ${floats.length} charged floating lines` : `the stored figure (no ${farmRetailer()} invoice bills floating yet)`,
    edgeLbPerAcre: e?.v ?? fallback.edgeLbPerAcre,
    edgeFrom: e ? `${ey} ${farmRetailer()} invoices, ${e.n} of ${edges.length} fields` : `the stored figure (no ${farmRetailer()} invoice bills Edge yet)`,
  }
}

/** The lines iciContractTerms reads, every year: a few dozen a season. */
export function useIciTermLines() {
  return useQuery({
    queryKey: ['ici-term-lines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ici_field_lines')
        .select('crop_year, kind, invoice_date, quantity, amount, field_id, ticket_acres')
        .in('kind', ['floating', 'edge', 'blend', 'fertilizer'])
        .order('invoice_date', { ascending: false })
        .limit(1000)
      if (error) throw error
      return (data ?? []) as unknown as TermLine[]
    },
    staleTime: 10 * 60_000,
  })
}
