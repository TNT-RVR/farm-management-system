import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { AdminOnly } from '@/components/TechnicalDetails'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { iciContractTerms, straightsCost, useIciReview, useIciReviews, useIciTermLines, type FieldIci, type Npks, type Straight } from '@/lib/ici-review'
import { useFertSettings } from '@/lib/fert-savings/data'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { ImportHint } from '@/components/ImportHint'

const $0 = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`
const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('en-CA'))

/** Claude's text with **bold** and "- " bullets. */
function Review({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const inline = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>))
  return (
    <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-gray-800">
      {lines.map((l, i) => (
        <li key={i} className={cn(/^[-•*]\s/.test(l) ? 'ml-4 list-disc' : 'pt-1')}>
          {inline(l.replace(/^[-•*]\s+/, ''))}
        </li>
      ))}
    </ul>
  )
}

/** Applied against the prescription and the soil test, nutrient by nutrient. */
function NutrientCompare({ f }: { f: FieldIci }) {
  const { retailerName } = useFarmSettings()
  const keys: (keyof Npks)[] = ['N', 'P', 'K', 'S']
  const label: Record<keyof Npks, string> = { N: 'N', P: 'P₂O₅', K: 'K₂O', S: 'S' }
  const tone = (applied: number, ref: number | undefined) => {
    if (ref == null) return 'text-gray-700'
    const d = applied - ref
    return d > 15 ? 'font-semibold text-red-700' : d < -15 ? 'font-semibold text-amber-700' : 'text-emerald-700'
  }
  return (
    <table className="text-[11px] tabular-nums">
      <thead>
        <tr className="text-gray-400">
          <td className="pr-2" />
          {keys.map((k) => (
            <td key={k} className="px-1 text-right">
              {label[k]}
            </td>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="pr-2 text-gray-500">{retailerName} put on</td>
          {keys.map((k) => (
            <td key={k} className={cn('px-1 text-right', tone(f.applied[k], f.soilRec?.[k] ?? f.rx?.[k]))}>
              {n0(f.applied[k])}
            </td>
          ))}
        </tr>
        <tr className="text-gray-500">
          <td className="pr-2">Prescription{f.rxOtherCrop ? ` (${f.rxOtherCrop})` : ''}</td>
          {keys.map((k) => (
            <td key={k} className="px-1 text-right">
              {f.rx ? n0(f.rx[k]) : '—'}
            </td>
          ))}
        </tr>
        <tr className="text-gray-500">
          <td className="pr-2">Soil test</td>
          {keys.map((k) => (
            <td key={k} className="px-1 text-right">
              {f.soilRec ? n0(f.soilRec[k]) : '—'}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

/**
 * Fertilizer → ICI: what ICI put on each field this year, what it cost, how
 * that sits against the prescription and the soil test, ICI's ticket against
 * the bill (the estimate against the actual), and Claude's review of whether
 * each choice was the best one.
 */
export function IciTab({ isManager }: { isManager: boolean }) {
  const { retailerName } = useFarmSettings()
  const { cropYear } = useCropYear()
  const { data, isLoading, error } = useIciReview(cropYear)
  const { data: reviews } = useIciReviews(cropYear)
  // Floating $/ac and Edge lb/ac as ICI last billed them, else the stored terms.
  const { data: termLines } = useIciTermLines()
  const settings = useFertSettings()
  const storedFloat = Number(settings.get('ici_floating_per_acre')) || 15.5
  const storedEdge = Number(settings.get('ici_edge_lb_per_acre')) || 7.5
  const terms = useMemo(
    () => iciContractTerms(termLines ?? [], { floatingPerAcre: storedFloat, edgeLbPerAcre: storedEdge }),
    [termLines, storedFloat, storedEdge],
  )
  const floatRate = terms.floatingPerAcre
  const edgeLbAc = terms.edgeLbPerAcre
  const qc = useQueryClient()
  const [starting, setStarting] = useState<string | null>(null)
  // The ticket-against-bill table is only worth reading where something is
  // off; the rest is a confirmation nobody needs field by field.
  const [allTickets, setAllTickets] = useState(false)
  const { data: straights } = useQuery({
    queryKey: ['fert_blend_products', 'straights'],
    queryFn: async () => {
      const { data: rows, error: e } = await supabase.from('fert_blend_products').select('name, n, p, k, s, price_per_tonne').eq('active', true)
      if (e) throw e
      return (rows ?? []) as unknown as Straight[]
    },
  })

  const rows = useMemo(
    () =>
      (data?.byField ?? []).map((f) => {
        const acres = f.mappedAcres ?? f.ticketAcres
        const str = straights ? straightsCost(f.applied, straights) : null
        return { f, acres, perAc: acres ? f.cost.total / acres : null, blendPerAc: f.ticketAcres ? f.cost.blend / f.ticketAcres : null, straightsPerAc: str?.perAc ?? null }
      }),
    [data, straights],
  )
  // Each field's ticket against its bill, with what is worth asking ICI about.
  const tickets = useMemo(
    () =>
      rows.map(({ f }) => {
        const farmed = f.mappedAcres
        const edgeAgreed = f.edgeKg > 0 && farmed ? (edgeLbAc * farmed) / 2.20462 : null
        const flags: string[] = []
        if (farmed && f.ticketAcres > farmed * 1.05) flags.push(`ticket is on ${n0(f.ticketAcres - farmed)} more acres than you farm`)
        if (farmed && f.floatedAcres > farmed * 1.05) flags.push(`floating billed on ${n0(f.floatedAcres - farmed)} extra acres (${$0((f.floatedAcres - farmed) * floatRate)})`)
        if (f.ticketLb > 0 && f.billedLb > f.ticketLb * 1.05) flags.push(`${n0(f.billedLb - f.ticketLb)} lb more product billed than the ticket's rate × acres`)
        if (edgeAgreed && f.edgeKg > edgeAgreed * 1.1) flags.push(`Edge ${Math.round((f.edgeKg * 2.20462) / (farmed ?? 1) * 10) / 10} lb/ac, not ${edgeLbAc}`)
        return { f, farmed, edgeAgreed, flags }
      }),
    [rows, edgeLbAc, floatRate],
  )
  const flagged = tickets.filter((t) => t.flags.length > 0)
  const ticketShown = allTickets ? tickets : flagged
  const latest = reviews?.[0]
  // A review still 'running' after fourteen minutes has stalled (the job gives up at twelve).
  const [openedAt] = useState(() => Date.now())
  const running = latest?.status === 'running' && openedAt - new Date(latest.created_at).getTime() < 14 * 60_000

  const runReview = async () => {
    setStarting('Starting…')
    const request = JSON.stringify(
      rows.map(({ f, acres, perAc, blendPerAc, straightsPerAc }) => ({
        field: f.name,
        crop: f.crop,
        acres_farmed: f.mappedAcres,
        ici_ticket_acres: Math.round(f.ticketAcres * 10) / 10,
        ici_blends: f.blends.map((b) => ({ product: b.description.replace(/^Tonne\s+/, ''), rate_lb_ac: b.rate, acres: b.acres, target_lb_ac: b.target })),
        applied_lb_ac: { N: Math.round(f.applied.N), P2O5: Math.round(f.applied.P), K2O: Math.round(f.applied.K), S: Math.round(f.applied.S) },
        prescription_lb_ac: f.rx && { N: Math.round(f.rx.N), P2O5: Math.round(f.rx.P), K2O: Math.round(f.rx.K), S: Math.round(f.rx.S), products: f.rxLabel },
        prescription_written_for_another_crop: f.rxOtherCrop,
        soil_test_recommendation_lb_ac: f.soilRec && { N: Math.round(f.soilRec.N), P2O5: Math.round(f.soilRec.P), K2O: Math.round(f.soilRec.K), S: Math.round(f.soilRec.S) },
        blend_cost_per_ac: blendPerAc && Math.round(blendPerAc),
        same_nutrients_as_straights_per_ac: straightsPerAc && Math.round(straightsPerAc),
        edge_kg: f.edgeKg || null,
        edge_cost: f.cost.edge || null,
        floating_cost: f.cost.floating || null,
        total_cost: Math.round(f.cost.total),
        total_per_acre_farmed: perAc && Math.round(perAc),
        acres_for_per_acre: acres,
      })),
    )
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const r = await fetch('/.netlify/functions/ici-review-background', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ year: cropYear, request }) })
    setStarting(r.ok || r.status === 202 ? null : `Couldn't start (${r.status})`)
    setTimeout(() => void qc.invalidateQueries({ queryKey: ['ici_fert_reviews'] }), 3000)
  }

  if (isLoading) return <p className="py-10 text-center text-sm text-gray-400">Loading…</p>
  if (error) return <p className="py-10 text-center text-sm text-red-600">{(error as Error).message}</p>
  if (!data || !data.byField.length)
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
        <p>No {retailerName} fertilizer on file for {cropYear}. Ask your admin to import the invoices.</p>
        <ImportHint what="the retailer's fertilizer invoices" script="scripts/import-ici-field-lines.mjs" screen="Fertilizer → Prices → the retailer view">
          <p className="mt-1 text-xs">Import with scripts/import-ici-field-lines.mjs.</p>
        </ImportHint>
      </div>
    )

  const t = data.totals
  const farmed = rows.reduce((s, r) => s + (r.acres ?? 0), 0)
  const onFields = rows.reduce((s, r) => s + r.f.cost.total, 0)

  return (
    <div className="space-y-5">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Paid to {retailerName} for fertilizer, {cropYear}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{$0(t.all)}</p>
          <p className="text-[11px] text-gray-400">{data.invoiceCount} invoices</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Product</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{$0(t.blend)}</p>
          <p className="text-[11px] text-gray-400">Edge {$0(t.edge)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Application</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{$0(t.floating)}</p>
          <p className="text-[11px] text-gray-400">floating · delivery {$0(t.delivery)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Per acre farmed</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{farmed ? `$${Math.round(onFields / farmed)}` : '—'}</p>
          <p className="text-[11px] text-gray-400">
            {rows.length} fields, {n0(farmed)} ac · {$0(t.all - onFields)} not on a field
          </p>
        </div>
      </div>

      {/* The review */}
      <section className="rounded-lg border border-violet-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Sparkles className="h-4 w-4 text-violet-600" /> Was {retailerName}&apos;s choice the best one?
            <InfoPopover title="How the review is done">
              <p>Claude (the advisor model) is given the table below for every field: {retailerName}&apos;s blend, rate, acres and nutrient target from the invoice ticket, the prescription on file, the latest soil-test recommendation, what {retailerName} charged per acre, and what the same nutrients would cost as straights (urea, MAP, potash, ammonium sulphate) at this year&apos;s Alberta average prices.</p>
              <p>It judges each field against those numbers and Alberta guidance for irrigated crops — over- or under-application, nutrients paid for that the soil didn&apos;t need, anything missing, and the blend&apos;s price against straights — then sums up the year. It works only from what it is given; where there is no soil test it says so.</p>
            </InfoPopover>
          </h2>
          {isManager && (
            <button type="button" disabled={running || !!starting} onClick={() => void runReview()} className="flex items-center gap-1.5 rounded-md bg-violet-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {running ? 'Reviewing (a minute or two)…' : latest?.status === 'done' ? 'Review again' : 'Review with AI'}
            </button>
          )}
        </div>
        {starting && <p className="mt-1 text-xs text-gray-500">{starting}</p>}
        {latest?.status === 'done' && latest.content ? (
          <>
            <Review text={latest.content} />
            <p className="mt-2 text-[11px] text-gray-400">
              AI second opinion, written {new Date(latest.finished_at ?? latest.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · check rates
              <AdminOnly> · {latest.model}</AdminOnly>
            </p>
          </>
        ) : latest?.status === 'error' ? (
          <p className="mt-2 text-xs text-red-700">The last review failed: {latest.error}</p>
        ) : !running ? (
          <p className="mt-2 text-xs text-gray-500">No review yet{isManager ? ' — press Review with AI.' : '.'}</p>
        ) : null}
      </section>

      {/* Field by field */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-gray-900">What {retailerName} put on each field</h2>
          <span className="text-[11px] text-gray-500">
            lb/ac · <span className="text-red-700">red</span> 15+ over the soil test (or the prescription where there&apos;s no test) · <span className="text-amber-700">amber</span> 15+ under
          </span>
        </div>
        <div className="overflow-x-auto">
          {/* Edge and floating sit in the Total's tooltip rather than in two
              columns of their own: they are the same few dollars an acre on
              every field, and two more columns pushed the table to 980px. */}
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 font-medium">{retailerName} blend and rate</th>
                <th className="px-2 py-1.5 font-medium">Nutrients, lb/ac</th>
                <th className="px-2 py-1.5 text-right font-medium">Product</th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Total
                    <InfoPopover title="What the total includes">
                      <p>Product (the blend), plus Edge and floating, for this field.</p>
                      <p>
                        <b>Edge</b> (Edge Micro Active) is a micronutrient product {retailerName} adds to the blend at an agreed
                        rate per acre ({edgeLbAc} lb/ac). <b>Floating</b> is {retailerName}&apos;s charge for
                        spreading the product with its floater, billed per acre (${floatRate.toFixed(2)}/ac).
                      </p>
                      <p>Each total shows its Edge and floating dollars underneath.</p>
                    </InfoPopover>
                  </span>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">$/ac</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Straights $/ac
                    <InfoPopover title="As straights">
                      <p>What the same N, P₂O₅, K₂O and S would cost bought as straights — ammonium sulphate for the S, MAP for the P, potash for the K, urea for the rest of the N — at this year&apos;s Alberta average prices, before blending and application. Against {retailerName}&apos;s product $/ac (the blend alone) it shows what the blend and its micronutrients cost over the plain nutrients.</p>
                    </InfoPopover>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 align-top">
              {rows.map(({ f, perAc, blendPerAc, straightsPerAc }) => (
                <tr key={f.fieldId}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900" title={f.invoices.length ? `Invoices ${f.invoices.join(', ')}` : undefined}>
                      {f.name}
                    </p>
                    <p className="text-[11px] text-gray-500">{f.crop ?? '—'}</p>
                  </td>
                  <td className="px-2 py-2 text-xs text-gray-700">
                    {f.blends.map((b) => (
                      <p key={b.description}>
                        {b.description.replace(/^Tonne\s+/, '').replace(/\s+[YN]$/, '')} <span className="text-gray-500">@ {n0(b.rate)} lb/ac on {n0(b.acres)} ac</span>
                      </p>
                    ))}
                    {f.edgeKg > 0 && <p className="text-gray-500">Edge {n0(f.edgeKg)} kg</p>}
                  </td>
                  <td className="px-2 py-2">
                    <NutrientCompare f={f} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {$0(f.cost.blend)}
                    {blendPerAc && <span className="block text-[11px] text-gray-400">${Math.round(blendPerAc)}/ac</span>}
                  </td>
                  <td
                    className="px-2 py-2 text-right font-semibold tabular-nums"
                    title={`Edge ${f.cost.edge ? $0(f.cost.edge) : '—'} · Floating ${f.cost.floating ? $0(f.cost.floating) : '—'}`}
                  >
                    {$0(f.cost.total)}
                    {(f.cost.edge > 0 || f.cost.floating > 0) && (
                      <span className="block text-[11px] font-normal text-gray-400">
                        incl. Edge {f.cost.edge ? $0(f.cost.edge) : '—'} · float {f.cost.floating ? $0(f.cost.floating) : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{perAc ? `$${Math.round(perAc)}` : '—'}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums', straightsPerAc && blendPerAc && blendPerAc > straightsPerAc * 1.25 ? 'font-semibold text-red-700' : 'text-gray-600')}>
                    {straightsPerAc ? `$${Math.round(straightsPerAc)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Ticket against bill */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            {retailerName}&apos;s plan against the bill
            <InfoPopover title="Estimate against actual">
              <p>
                There is no written {retailerName} estimate on file, so each field&apos;s &ldquo;estimate&rdquo; is {retailerName}&apos;s own ticket — the rate, acres and $/ac printed under the blend — and the acres you actually farm (the crop plan). &ldquo;Actual&rdquo; is what the invoice billed.
              </p>
              <p>
                Product: the ticket&apos;s rate × its acres against the tonnes billed. Floating: the acres billed at ${floatRate.toFixed(2)} against the acres farmed. Edge: the agreed {edgeLbAc} lb/ac on the acres farmed against the kilograms billed.
              </p>
              <p>
                <b>Ticket acres</b> are the acres printed on {retailerName}&apos;s ticket under the blend. <b>Floated acres</b> are the acres {retailerName} billed for spreading it with the floater. <b>Edge</b> is the Edge Micro Active micronutrient {retailerName} adds, agreed per acre and billed in kilograms.
              </p>
              <p>
                The ${floatRate.toFixed(2)} and {edgeLbAc} lb/ac are what {retailerName} billed most often — floating from {terms.floatingFrom}; Edge from {terms.edgeFrom} — so the next season&apos;s invoices reset them on their own.
              </p>
            </InfoPopover>
          </h2>
          <span className="flex items-center gap-2 text-[11px] text-gray-500">
            {flagged.length} of {tickets.length} fields worth asking about
            <button
              type="button"
              onClick={() => setAllTickets((v) => !v)}
              className="rounded-md border border-gray-200 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
            >
              {allTickets ? 'Show only worth asking' : 'Show all fields'}
            </button>
          </span>
        </div>
        {ticketShown.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-gray-400">
            Nothing on the bills looks worth asking {retailerName} about.
          </p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 text-right font-medium">Acres farmed</th>
                <th className="px-2 py-1.5 text-right font-medium">Ticket acres</th>
                <th className="px-2 py-1.5 text-right font-medium">Floated acres</th>
                <th className="px-2 py-1.5 text-right font-medium">Product: ticket lb</th>
                <th className="px-2 py-1.5 text-right font-medium">Billed lb</th>
                <th className="px-2 py-1.5 text-right font-medium">Edge: agreed kg</th>
                <th className="px-2 py-1.5 text-right font-medium">Billed kg</th>
                <th className="px-3 py-1.5 font-medium">Worth asking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ticketShown.map(({ f, farmed, edgeAgreed, flags }) => {
                return (
                  <tr key={f.fieldId}>
                    <td className="px-3 py-1.5 font-medium text-gray-900">{f.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{n0(farmed)}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', farmed && f.ticketAcres > farmed * 1.05 && 'font-semibold text-red-700')}>{n0(f.ticketAcres)}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', farmed && f.floatedAcres > farmed * 1.05 && 'font-semibold text-red-700')}>{f.floatedAcres ? n0(f.floatedAcres) : '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{n0(f.ticketLb)}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', f.ticketLb > 0 && f.billedLb > f.ticketLb * 1.05 && 'font-semibold text-red-700')}>{n0(f.billedLb)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{edgeAgreed ? n0(edgeAgreed) : '—'}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', edgeAgreed && f.edgeKg > edgeAgreed * 1.1 && 'font-semibold text-red-700')}>{f.edgeKg ? n0(f.edgeKg) : '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-700">{flags.join('; ') || <span className="text-gray-300">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      {data.unassigned.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700">
          <p className="font-semibold text-gray-900">Not on a field ({$0(data.unassigned.reduce((s, l) => s + Number(l.amount), 0))})</p>
          <ul className="mt-1 space-y-0.5">
            {data.unassigned.map((l) => (
              <li key={l.id}>
                {l.invoice_no} · {l.description.replace(/^Tonne\s+/, '')} · {$0(Number(l.amount))}
                {l.field_text && <span className="text-gray-400"> — “{l.field_text}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
