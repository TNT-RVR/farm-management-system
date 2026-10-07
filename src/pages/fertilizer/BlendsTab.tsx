import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Save, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { RecordEditModal, type EditField } from '@/components/RecordEditor'
import { supabase } from '@/lib/supabase'
import { useCrops, useCropPlans, useFields } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { usePrescriptions, weightedRate } from '@/lib/fertility-rx'
import { parseAnalysis } from '@/lib/fertilizer-analysis'
import { useJdProducts } from '@/lib/products'
import { seedRowPCap } from '@/lib/fert-savings/alberta'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import {
  blendsUsing,
  LB_PER_TONNE,
  leastCostBlends,
  NUTRIENT_KEYS,
  NUTRIENT_LABEL,
  sheetBlend,
  summarise,
  type BlendLine,
  type BlendProduct,
  type BlendResult,
  type Targets,
} from '@/lib/blend'
import { cn } from '@/lib/utils'

const money = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-CA', { maximumFractionDigits: v < 100 ? 2 : 0 })}`)
const lb = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: v < 10 ? 1 : 0 })
/** Nutrient names as the advice model is sent them — plain ASCII, one spelling everywhere. */
const ADVICE_NAME: Record<keyof Targets, string> = { n: 'N', p: 'P2O5', k: 'K2O', s: 'S', zn: 'Zn' }
const analysisLabel = (p: BlendProduct) =>
  [p.n, p.p, p.k, p.s].map((x) => +(x * 100).toFixed(1)).join('-') + (p.zn ? `-${+(p.zn * 100).toFixed(1)}Zn` : '')

function useBlendProducts() {
  return useQuery({
    queryKey: ['fert_blend_products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fert_blend_products').select('*').order('sort_order').order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

function useSavedBlends() {
  return useQuery({
    queryKey: ['fert_blends'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fert_blends').select('*').order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      return data ?? []
    },
  })
}

/** One blend's lines and totals, for any of the three ways of building it. */
function BlendTable({ result, acres, title, badge, action }: { result: BlendResult; acres: number; title: string; badge?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {badge && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">{badge}</span>}
        <span className="ml-auto text-lg font-bold tabular-nums text-gray-900">{money(result.costPerAc)}/ac</span>
      </div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="py-1 font-medium">Product</th>
            <th className="py-1 text-right font-medium">lb/ac</th>
            <th className="hidden py-1 text-right font-medium sm:table-cell">Tonnes</th>
            <th className="py-1 text-right font-medium">$/ac</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {result.lines.map((l) => (
            <tr key={l.product.id}>
              <td className="py-1 text-gray-800">
                {l.product.name} <span className="text-gray-400">{analysisLabel(l.product)}</span>
              </td>
              <td className="py-1 text-right tabular-nums">{lb(l.lbPerAc)}</td>
              <td className="hidden py-1 text-right tabular-nums text-gray-600 sm:table-cell">{((l.lbPerAc * acres) / LB_PER_TONNE).toFixed(1)}</td>
              <td className="py-1 text-right tabular-nums">{l.product.pricePerTonne == null ? '—' : money((l.lbPerAc / LB_PER_TONNE) * l.product.pricePerTonne)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>
          Rate <b className="tabular-nums text-gray-900">{lb(result.rate)} lb/ac</b>
        </span>
        <span>
          Supplies{' '}
          <b className="tabular-nums text-gray-900">
            {NUTRIENT_KEYS.filter((k) => result.supplied[k] > 0.05)
              .map((k) => `${lb(result.supplied[k])} ${NUTRIENT_LABEL[k]}`)
              .join(' · ')}
          </b>
        </span>
        {result.density != null && <span>Density {result.density.toFixed(1)} lb/ft³</span>}
        {result.costPerTonne != null && <span>{money(result.costPerTonne)}/t of blend</span>}
        {acres > 0 && result.costPerAc != null && (
          <span>
            {((result.rate * acres) / LB_PER_TONNE).toFixed(1)} t · {money(result.costPerAc * acres)} for {lb(acres)} ac
          </span>
        )}
      </div>
      {(Object.keys(result.short).length > 0 || Object.keys(result.over).length > 0 || result.densitySpread > 8) && (
        <p className="mt-1 text-[11px] text-amber-700">
          {Object.entries(result.short).map(([k, v]) => `${lb(v!)} lb ${NUTRIENT_LABEL[k as keyof Targets]} short`).join(', ')}
          {Object.keys(result.short).length > 0 && Object.keys(result.over).length > 0 ? '; ' : ''}
          {Object.entries(result.over).map(([k, v]) => `${lb(v!)} lb extra ${NUTRIENT_LABEL[k as keyof Targets]}`).join(', ')}
          {result.densitySpread > 8 && ` · densities differ by ${result.densitySpread.toFixed(0)} lb/ft³ — may separate in the cart`}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * Fertilizer → Blends. Sam's blend calculator spreadsheet, plus the
 * cheapest mixes that hit the same targets, a custom blend to adjust and save,
 * and Claude's read of which to pick.
 */
export function BlendsTab() {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const { cropYear } = useCropYear()
  const qc = useQueryClient()
  const { data: rows } = useBlendProducts()
  const { data: saved } = useSavedBlends()
  const { data: fields } = useFields()
  const { data: plans } = useCropPlans(cropYear)
  const { data: crops } = useCrops()
  const { data: rx } = usePrescriptions(cropYear)
  const { data: book } = useJdProducts()

  const [fieldId, setFieldId] = useState('')
  const [acres, setAcres] = useState('65')
  const [targets, setTargets] = useState<Targets>({ n: 80, p: 40, k: 12, s: 0, zn: 0 })
  const [locks, setLocks] = useState<Record<string, string>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState<BlendLine[] | null>(null)
  const [advice, setAdvice] = useState<string | null>(null)
  const [blendName, setBlendName] = useState('')
  // Sam, 7 Oct 2026: a saved blend can be renamed and its details corrected.
  const [editBlend, setEditBlend] = useState<string | null>(null)

  const products: BlendProduct[] = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.active)
        .map((r) => ({
          id: r.id,
          name: r.name,
          n: Number(r.n),
          p: Number(r.p),
          k: Number(r.k),
          s: Number(r.s),
          zn: Number(r.zn),
          pricePerTonne: r.price_per_tonne == null ? null : Number(r.price_per_tonne),
          density: r.density_lb_ft3 == null ? null : Number(r.density_lb_ft3),
        })),
    [rows],
  )
  const ac = Number(acres) || 0
  const locked: BlendLine[] = products.filter((p) => Number(locks[p.id]) > 0).map((p) => ({ product: p, lbPerAc: Number(locks[p.id]) }))
  const pool = products.filter((p) => !excluded.has(p.id))
  const sheet = useMemo(() => sheetBlend(targets, products, locked), [targets, products, locks]) // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => leastCostBlends(targets, pool, { locked, top: 4 }), [targets, products, locks, excluded]) // eslint-disable-line react-hooks/exhaustive-deps
  const customResult = custom ? summarise(custom, targets) : null

  // The field's crop and prescription, to fill the targets from.
  const field = fields?.find((f) => f.id === fieldId)
  const plan = plans?.find((p) => p.field_id === fieldId)
  const cropName = crops?.find((c) => c.id === plan?.crop_id)?.name ?? null
  const fieldRx = rx?.find((r) => r.field_id === fieldId)
  const fromRx = () => {
    if (!fieldRx) return
    setTargets({
      n: Math.round(weightedRate(fieldRx.zones, 'n') ?? 0),
      p: Math.round(weightedRate(fieldRx.zones, 'p2o5') ?? 0),
      k: Math.round(weightedRate(fieldRx.zones, 'k2o') ?? 0),
      s: Math.round(weightedRate(fieldRx.zones, 's') ?? 0),
      zn: targets.zn,
    })
    if (fieldRx.acres) setAcres(String(fieldRx.acres))
  }

  // What the farm last paid for a product of the same analysis, from the invoices.
  const lastPaid = (p: BlendProduct) => {
    const hit = (book?.products ?? []).find((b) => {
      if (b.category !== 'fertilizer' || b.price_per_unit == null || b.unit !== 'kg') return false
      const a = parseAnalysis(b.name)
      return !!a && Math.abs(a.n - p.n * 100) < 0.6 && Math.abs(a.p2o5 - p.p * 100) < 0.6 && Math.abs(a.k2o - p.k * 100) < 0.6 && Math.abs(a.s - p.s * 100) < 0.6
    })
    return hit ? { perTonne: Number(hit.price_per_unit) * 1000, on: hit.price_updated_on } : null
  }

  const saveProduct = useMutation({
    mutationFn: async (v: { id?: string; patch: Record<string, unknown> }) => {
      const { error } = v.id
        ? await supabase.from('fert_blend_products').update({ ...v.patch, updated_at: new Date().toISOString() }).eq('id', v.id)
        : await supabase.from('fert_blend_products').insert(v.patch as { name: string })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fert_blend_products'] }),
  })

  const ask = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      // Every amount goes out under the nutrient's own name (N, P2O5, K2O, S,
      // Zn), the same in targets and supplies: bare p/k keys beside p2o5/k2o
      // ones had the model quote the S target as the P2O5 one. Shortfalls,
      // excess and the seed-row P check are worked out here, not by the model.
      const named = (t: Partial<Targets>) =>
        Object.fromEntries(NUTRIENT_KEYS.filter((k) => t[k] != null).map((k) => [ADVICE_NAME[k], +t[k]!.toFixed(1)]))
      const seedRow = seedRowPCap(cropName ?? fieldRx?.crop_type)
      const pack = (r: BlendResult) => ({
        cost_per_ac: r.costPerAc == null ? null : +r.costPerAc.toFixed(2),
        rate_lb_ac: +r.rate.toFixed(1),
        density_lb_ft3: r.density == null ? null : +r.density.toFixed(1),
        density_spread: +r.densitySpread.toFixed(1),
        supplies_lb_ac: named(r.supplied),
        short_of_target_lb_ac: named(r.short),
        over_target_lb_ac: named(r.over),
        p2o5_over_seed_row_limit_lb_ac: seedRow ? Math.max(0, +(r.supplied.p - seedRow.cap).toFixed(1)) : null,
        products: r.lines.map((l) => ({ name: l.product.name, analysis: analysisLabel(l.product), lb_per_ac: +l.lbPerAc.toFixed(1) })),
      })
      const res = await fetch('/api/blend-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({
          field: field ? { name: field.name, crop: cropName, crop_year: cropYear, acres: ac, prescription_crop: fieldRx?.crop_type ?? null } : { acres: ac },
          targets_lb_ac: named(targets),
          seed_row_p2o5_limit: seedRow ? { lb_ac: seedRow.cap, note: seedRow.note } : null,
          locked: locked.map((l) => ({ name: l.product.name, lb_per_ac: l.lbPerAc })),
          spreadsheet_method: pack(sheet),
          cheapest_options: options.map(pack),
          custom_blend: customResult ? pack(customResult) : null,
          available_products: pool.map((p) => ({ name: p.name, analysis: analysisLabel(p), price_per_tonne: p.pricePerTonne, density: p.density })),
        }),
      })
      // A gateway timeout comes back as an HTML page, not JSON.
      const j = (await res.json().catch(() => ({}))) as { advice?: string; error?: string }
      if (!res.ok || !j.advice) throw new Error(j.error ?? (res.ok ? 'No advice came back' : `No answer from the advice service (${res.status})`))
      return j.advice
    },
    onSuccess: setAdvice,
  })

  const saveBlend = useMutation({
    mutationFn: async (r: BlendResult) => {
      const { error } = await supabase.from('fert_blends').insert({
        name: blendName.trim() || `${field?.name ?? 'Blend'} ${cropYear}`,
        field_id: fieldId || null,
        crop_year: cropYear,
        acres: ac || null,
        targets,
        lines: r.lines.map((l) => ({
          product_id: l.product.id,
          name: l.product.name,
          lb_per_ac: +l.lbPerAc.toFixed(2),
          n: l.product.n,
          p: l.product.p,
          k: l.product.k,
          s: l.product.s,
          zn: l.product.zn,
          price_per_tonne: l.product.pricePerTonne,
        })),
        cost_per_ac: r.costPerAc,
        rate_lb_ac: r.rate,
        advice,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setBlendName('')
      void qc.invalidateQueries({ queryKey: ['fert_blends'] })
    },
  })
  const deleteBlend = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fert_blends').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fert_blends'] }),
  })
  const updateBlend = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { name: string; field_id: string | null; crop_year: number | null; acres: number | null; notes: string | null } }) => {
      const { error } = await supabase.from('fert_blends').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fert_blends'] }),
  })
  // A product goes for good (Sam, 7 Oct 2026); saved blends keep their own
  // copy of its analysis and price, so they still read, but no longer open
  // with it in them. Every saved blend is checked, not only the 50 listed.
  const deleteProduct = useMutation({
    mutationFn: async (p: { id: string; name: string }) => {
      const { data, error: readErr } = await supabase.from('fert_blends').select('name, lines')
      if (readErr) throw readErr
      const using = blendsUsing(data ?? [], p)
      const msg = using.length
        ? `Delete ${p.name}? It is in ${using.length} saved blend${using.length === 1 ? '' : 's'} (${using.slice(0, 5).join(', ')}${using.length > 5 ? '…' : ''}). They keep their figures but open without it. Untick it instead to just leave it out of the mixes.`
        : `Delete ${p.name} from the products?`
      if (!window.confirm(msg)) return
      const { error } = await supabase.from('fert_blend_products').delete().eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fert_blend_products'] }),
  })

  const cheapest = options[0]
  const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums'

  return (
    <div className="space-y-4">
      {/* Targets */}
      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
          <div>
            <label className="text-xs text-gray-500">Field (optional)</label>
            <Select
              value={fieldId}
              ariaLabel="Field"
              onChange={setFieldId}
              options={[{ value: '', label: 'No field — just the numbers' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))]}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Acres</label>
            <input className={input} inputMode="decimal" value={acres} onChange={(e) => setAcres(e.target.value)} />
          </div>
        </div>
        {fieldId && (
          <p className="mt-1 text-xs text-gray-600">
            {cropName ? `${cropName} ${cropYear}` : `No crop planned for ${cropYear}`}
            {fieldRx ? (
              <>
                {' · '}
                <button type="button" onClick={fromRx} className="font-medium text-brand-700 underline">
                  Fill from the {cropYear} prescription
                </button>
              </>
            ) : (
              ' · no prescription on file'
            )}
          </p>
        )}
        <p className="mt-3 text-xs font-medium text-gray-700">Nutrient wanted, lb/ac</p>
        <div className="mt-1 grid grid-cols-5 gap-2">
          {NUTRIENT_KEYS.map((k) => (
            <label key={k} className="text-[11px] text-gray-500">
              {NUTRIENT_LABEL[k]}
              <input
                className={cn(input, 'text-base font-semibold')}
                inputMode="decimal"
                value={targets[k] || ''}
                placeholder="0"
                onChange={(e) => setTargets({ ...targets, [k]: Number(e.target.value) || 0 })}
              />
            </label>
          ))}
        </div>
      </section>

      {/* Results */}
      <section className="grid gap-3 lg:grid-cols-2">
        <BlendTable result={sheet} acres={ac} title="Standard method" action={
          <button type="button" onClick={() => setCustom(sheet.lines)} className="text-xs font-medium text-brand-700 underline">
            Start a custom blend from this
          </button>
        } />
        {cheapest ? (
          <BlendTable
            result={cheapest}
            acres={ac}
            title="Cheapest mix"
            badge={sheet.costPerAc != null && cheapest.costPerAc != null && sheet.costPerAc - cheapest.costPerAc > 0.5 ? `saves ${money(sheet.costPerAc - cheapest.costPerAc)}/ac` : undefined}
            action={
              <button type="button" onClick={() => setCustom(cheapest.lines)} className="text-xs font-medium text-brand-700 underline">
                Start a custom blend from this
              </button>
            }
          />
        ) : (
          <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No mix of the products ticked below meets every target.</p>
        )}
      </section>

      {options.length > 1 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Other efficient mixes</h3>
          <div className="grid gap-3 lg:grid-cols-3">
            {options.slice(1).map((o, i) => (
              <BlendTable
                key={o.key}
                result={o}
                acres={ac}
                title={`Option ${i + 2}`}
                badge={cheapest.costPerAc != null && o.costPerAc != null ? `+${money(o.costPerAc - cheapest.costPerAc)}/ac` : undefined}
                action={
                  <button type="button" onClick={() => setCustom(o.lines)} className="text-xs font-medium text-brand-700 underline">
                    Use this
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* AI */}
      <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-900">Recommendation</h3>
          <button
            type="button"
            onClick={() => ask.mutate()}
            disabled={ask.isPending || !options.length}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" /> {ask.isPending ? 'Thinking…' : advice ? 'Ask again' : 'Ask Claude which to pick'}
          </button>
        </div>
        {ask.error && <p className="mt-1 text-xs text-red-700">{(ask.error as Error).message}</p>}
        {advice ? (
          <Advice text={advice} />
        ) : (
          <HelpNote className="mt-1 text-xs" summary="AI second opinion on which mix to use · check rates" title="What the recommendation reads">
            Claude reads the field, the targets and the costed options above — the numbers are already worked out — and says which to use and
            why: slow-release N under the pivots, sulphate for canola, seed-row safety, blends that separate.
          </HelpNote>
        )}
      </section>

      {/* Custom blend */}
      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Custom blend</h3>
          {!custom && (
            <button type="button" onClick={() => setCustom([])} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline">
              <Plus className="h-3.5 w-3.5" /> start empty
            </button>
          )}
        </div>
        {custom ? (
          <>
            <div className="mt-2 space-y-1.5">
              {custom.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={l.product.id}
                    ariaLabel="Product"
                    className="flex-1"
                    onChange={(id) => setCustom(custom.map((x, j) => (j === i ? { ...x, product: products.find((p) => p.id === id)! } : x)))}
                    options={products.map((p) => ({ value: p.id, label: `${p.name} (${analysisLabel(p)})` }))}
                  />
                  <input
                    className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
                    inputMode="decimal"
                    value={+l.lbPerAc.toFixed(1)}
                    onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, lbPerAc: Number(e.target.value) || 0 } : x)))}
                    aria-label="lb per acre"
                  />
                  <span className="text-xs text-gray-500">lb/ac</span>
                  <button type="button" onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label="Remove" className="rounded p-1 text-gray-400 hover:bg-gray-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {products.length > 0 && (
                <button type="button" onClick={() => setCustom([...custom, { product: products[0], lbPerAc: 0 }])} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline">
                  <Plus className="h-3.5 w-3.5" /> add a product
                </button>
              )}
            </div>
            {customResult && customResult.lines.length > 0 && (
              <div className="mt-3">
                <BlendTable result={customResult} acres={ac} title="Your blend" />
                {isMgr && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={blendName} onChange={(e) => setBlendName(e.target.value)} placeholder={`${field?.name ?? 'Blend'} ${cropYear}`} className="w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                    <button
                      type="button"
                      onClick={() => saveBlend.mutate(customResult)}
                      disabled={saveBlend.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" /> Save blend
                    </button>
                    {saveBlend.error && <span className="text-xs text-red-700">{(saveBlend.error as Error).message}</span>}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-gray-500">Start from any result above, or empty, and change the products and rates.</p>
        )}
      </section>

      {/* Products */}
      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <h3 className="text-sm font-semibold text-gray-900">Products</h3>
        <HelpNote className="text-xs" summary="Untick to leave out of the mixes; lock a rate to build around it." title="Using the product list">
          Untick a product to keep it out of the cheapest mixes. Lock one at a rate (lb/ac) to build around it — the way the spreadsheet puts
          ESN or 40 Rock in first.
        </HelpNote>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1 font-medium">Use</th>
                <th className="py-1 font-medium">Product</th>
                <th className="py-1 font-medium">N-P-K-S</th>
                <th className="py-1 text-right font-medium">$/tonne</th>
                <th className="hidden py-1 text-right font-medium sm:table-cell">lb/ft³</th>
                <th className="py-1 text-right font-medium">
                  <Lock className="inline h-3 w-3" /> lb/ac
                </th>
                {isMgr && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(rows ?? []).filter((r) => r.active).map((r) => {
                const p = products.find((x) => x.id === r.id)!
                const paid = lastPaid(p)
                return (
                  <tr key={r.id}>
                    <td className="py-1">
                      <input
                        type="checkbox"
                        checked={!excluded.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(excluded)
                          if (e.target.checked) next.delete(r.id)
                          else next.add(r.id)
                          setExcluded(next)
                        }}
                        aria-label={`Use ${r.name}`}
                      />
                    </td>
                    <td className="py-1 text-gray-800">{r.name}</td>
                    <td className="py-1 tabular-nums text-gray-600">{analysisLabel(p)}</td>
                    <td className="py-1 text-right">
                      {isMgr ? (
                        <input
                          key={`${r.id}-${r.price_per_tonne}`}
                          defaultValue={r.price_per_tonne ?? ''}
                          inputMode="decimal"
                          className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                          onBlur={(e) => {
                            const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                            if (v !== (r.price_per_tonne == null ? null : Number(r.price_per_tonne)))
                              saveProduct.mutate({ id: r.id, patch: { price_per_tonne: v, price_note: 'Set by hand' } })
                          }}
                          aria-label={`${r.name} price per tonne`}
                        />
                      ) : (
                        <span className="tabular-nums">{money(p.pricePerTonne)}</span>
                      )}
                      <span className="block text-[10px] text-gray-400">
                        {r.price_note}
                        {paid && ` · last invoice ${money(paid.perTonne)}${paid.on ? ` (${paid.on.slice(0, 7)})` : ''}`}
                      </span>
                    </td>
                    <td className="hidden py-1 text-right tabular-nums text-gray-600 sm:table-cell">{r.density_lb_ft3 ?? '—'}</td>
                    <td className="py-1 text-right">
                      <input
                        value={locks[r.id] ?? ''}
                        onChange={(e) => setLocks({ ...locks, [r.id]: e.target.value })}
                        inputMode="decimal"
                        placeholder="—"
                        className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                        aria-label={`Lock ${r.name} at lb per acre`}
                      />
                    </td>
                    {isMgr && (
                      <td className="py-1 pl-1 text-right">
                        <button
                          type="button"
                          onClick={() => deleteProduct.mutate({ id: r.id, name: r.name })}
                          disabled={deleteProduct.isPending}
                          aria-label={`Delete ${r.name}`}
                          className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {deleteProduct.error && <p className="mt-1 text-xs text-red-700">{(deleteProduct.error as Error).message}</p>}
        {isMgr && <AddProduct onAdd={(patch) => saveProduct.mutate({ patch })} />}
      </section>

      {/* Saved */}
      {(saved?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-gray-900">Saved blends</h3>
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {saved!.map((b) => {
              const lines = (Array.isArray(b.lines) ? b.lines : []) as { name: string; lb_per_ac: number }[]
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="font-medium text-gray-900">{b.name}</span>
                  <span className="text-xs text-gray-500">
                    {fields?.find((f) => f.id === b.field_id)?.name ?? ''} {b.crop_year ?? ''} · {lines.map((l) => `${l.name} ${lb(l.lb_per_ac)}`).join(' + ')}
                  </span>
                  <span className="ml-auto tabular-nums text-gray-900">{money(b.cost_per_ac)}/ac</span>
                  <button
                    type="button"
                    onClick={() => {
                      const t = b.targets as Targets
                      setTargets({ n: t.n ?? 0, p: t.p ?? 0, k: t.k ?? 0, s: t.s ?? 0, zn: t.zn ?? 0 })
                      if (b.field_id) setFieldId(b.field_id)
                      if (b.acres) setAcres(String(b.acres))
                      setCustom(
                        lines
                          .map((l) => ({ product: products.find((p) => p.name === l.name), lbPerAc: l.lb_per_ac }))
                          .filter((l): l is BlendLine => !!l.product),
                      )
                      setAdvice(b.advice)
                    }}
                    className="text-xs font-medium text-brand-700 underline"
                  >
                    open
                  </button>
                  {isMgr && (
                    <button type="button" onClick={() => setEditBlend(b.id)} aria-label="Edit" className="rounded p-1 text-gray-400 hover:bg-gray-100">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {isMgr && (
                    <button type="button" onClick={() => confirm(`Delete "${b.name}"?`) && deleteBlend.mutate(b.id)} aria-label="Delete" className="rounded p-1 text-gray-400 hover:bg-gray-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {b.notes && <span className="w-full text-xs text-gray-500">{b.notes}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {(() => {
        const b = saved?.find((x) => x.id === editBlend)
        if (!b) return null
        const fieldsForm: EditField[] = [
          { key: 'name', label: 'Name', kind: 'text', required: true },
          {
            key: 'field_id',
            label: 'Field',
            kind: 'select',
            options: [{ value: '', label: '— none —' }, ...(fields ?? []).filter((f) => f.active || f.id === b.field_id).map((f) => ({ value: f.id, label: f.name }))],
          },
          { key: 'crop_year', label: 'Crop year', kind: 'number', int: true },
          { key: 'acres', label: 'Acres', kind: 'number' },
          { key: 'notes', label: 'Note', kind: 'textarea' },
        ]
        return (
          <RecordEditModal
            title={`Saved blend · ${b.name}`}
            fields={fieldsForm}
            row={b}
            saving={updateBlend.isPending}
            error={updateBlend.error ? (updateBlend.error as Error).message : null}
            onClose={() => {
              updateBlend.reset()
              setEditBlend(null)
            }}
            onSave={(v) =>
              updateBlend.mutateAsync({
                id: b.id,
                patch: {
                  name: String(v.name),
                  field_id: (v.field_id as string | null) || null,
                  crop_year: v.crop_year as number | null,
                  acres: v.acres as number | null,
                  notes: v.notes as string | null,
                },
              })
            }
            onDelete={() => deleteBlend.mutateAsync(b.id)}
            deleteConfirm={`Delete "${b.name}"?`}
          />
        )
      })()}

      <HelpNote summary="P is P₂O₅ and K is K₂O, as fertilizer is sold. Tonnes are metric." title="How the blends are worked out">
        P is P₂O₅ and K is K₂O, as fertilizer is sold. The standard method — the one the blend spreadsheet uses — puts locked products in
        first, then MAP for P₂O₅, potash for K₂O, ammonium sulphate for S and urea for the N still short. The cheapest mixes try every
        combination of the ticked products and keep the ones that meet every target for the least money. Tonnes are metric; density is the
        weight-averaged lb/ft³.
      </HelpNote>
    </div>
  )
}

/** Claude's bullets, with **bold** shown as bold and nothing else interpreted. */
function Advice({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>))
  return (
    <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-gray-800">
      {lines.map((l, i) => (
        <li key={i} className={cn(/^[-•*]\s/.test(l) && 'ml-4 list-disc')}>
          {inline(l.replace(/^[-•*]\s+/, ''))}
        </li>
      ))}
    </ul>
  )
}

/** A product to blend from, typed by name with its analysis read from it. */
function AddProduct({ onAdd }: { onAdd: (patch: Record<string, unknown>) => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [density, setDensity] = useState('')
  const a = parseAnalysis(name)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-xs">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New product, e.g. 12-51-0 or 0-0-0-90" className="w-56 rounded border border-gray-300 px-2 py-1" />
      <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="$/tonne" className="w-20 rounded border border-gray-300 px-2 py-1" />
      <input value={density} onChange={(e) => setDensity(e.target.value)} inputMode="decimal" placeholder="lb/ft³" className="w-16 rounded border border-gray-300 px-2 py-1" />
      <span className="text-gray-500">{a ? `reads as ${a.n}-${a.p2o5}-${a.k2o}-${a.s}${a.micro.Zn ? `-${a.micro.Zn}Zn` : ''}` : 'put the analysis in the name'}</span>
      <button
        type="button"
        disabled={!a || !name.trim()}
        onClick={() => {
          onAdd({
            name: name.trim(),
            n: a!.n / 100,
            p: a!.p2o5 / 100,
            k: a!.k2o / 100,
            s: a!.s / 100,
            zn: (a!.micro.Zn ?? 0) / 100,
            price_per_tonne: price ? Number(price) : null,
            price_note: price ? 'Set by hand' : null,
            density_lb_ft3: density ? Number(density) : null,
          })
          setName('')
          setPrice('')
          setDensity('')
        }}
        className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 font-semibold text-white disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  )
}
