import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, FileText, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { boundariesForYear, useAllBoundaries, useCrops, useFields } from '@/lib/queries'
import { buildSuccessionMap, buildSuccessionNotes, useSuccessionRules } from '@/lib/rotation'
import { useRotationContext } from '@/lib/rotation-context'
import { evaluate, objectiveScore, type CropInfo, type Preference } from '@/lib/rotation-engine'
import { breakevenYield, cornWetTonnesPerBu, marginPerAcre, payoffGrid, tieYield, yieldFor, type CompareSide } from '@/lib/crop-compare'
import { isActualYield } from '@/lib/forecast'
import { openChemicalLabel } from '@/lib/chemicals'
import { PageHeader } from '@/components/PageHeader'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { Fold } from '@/components/Fold'
import { cn } from '@/lib/utils'

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const money = (v: number) => `${v < 0 ? '−' : ''}$${n0(Math.abs(v))}`
const unitPrice = (v: number) => (v < 1 ? v.toFixed(3) : v.toFixed(2))
const fmtYield = (v: number, unit: string) => `${unit === 'bu' ? n0(v) : v.toFixed(unit === 'MT' || unit === 'ton' ? 2 : 1)} ${unit}`
const asNum = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))

type Overrides = { yield?: string; price?: string; cost?: string; extraAc?: string; extraUnit?: string }

/** A field's crops by year: ten years of history, and the plan for years not yet harvested. */
function useFieldTimeline(fieldId: string | null) {
  return useQuery({
    queryKey: ['crop-compare-field', 2, fieldId],
    enabled: Boolean(fieldId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [hist, plans, zones] = await Promise.all([
        supabase.from('crop_yields_v').select('crop_year, crop_id, acres, yield_per_acre, clean_yield_per_acre, yield_unit, source, field_id, exclude_from_averages, abnormal_reason').eq('field_id', fieldId!),
        supabase.from('crop_plans').select('crop_year, crop_id').eq('field_id', fieldId!),
        supabase.from('field_crop_zones').select('crop_year, crop_id').eq('field_id', fieldId!),
      ])
      for (const r of [hist, plans, zones]) if (r.error) throw r.error
      return { hist: hist.data ?? [], plans: plans.data ?? [], zones: zones.data ?? [] }
    },
  })
}

/**
 * Two crops on one field, side by side: what each leaves at the farm's own
 * yields, prices and costs (every figure editable), the yield at which one
 * overtakes the other, and what the rotation engine says about growing each
 * there at all.
 */
export function CropComparePage() {
  const [params, setParams] = useSearchParams()
  const { cropYear } = useCropYear()
  // From August on, the question is next year's crop.
  const defaultYear = new Date().getMonth() >= 7 ? cropYear + 1 : cropYear
  const year = Number(params.get('year')) || defaultYear
  const fieldId = params.get('field')
  const cropA = params.get('a') ?? ''
  const cropB = params.get('b') ?? ''
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const { data: fields } = useFields()
  // Every crop, retired ones too: history names crops no longer grown.
  const { data: allCrops } = useCrops()
  const cropName = useMemo(() => new Map((allCrops ?? []).map((c) => [c.id, c.name as string])), [allCrops])
  const { data: boundaries } = useAllBoundaries()
  const { data: rules } = useSuccessionRules()
  const ctx = useRotationContext(year)
  const timeline = useFieldTimeline(fieldId)

  const [acresTyped, setAcresTyped] = useState<Record<string, string>>({})
  const [over, setOver] = useState<Record<string, Overrides>>({})
  const [moisture, setMoisture] = useState('28')

  const field = (fields ?? []).find((f) => f.id === fieldId) ?? null
  const boundaryAcres = useMemo(() => {
    const b = boundariesForYear(boundaries ?? [], year).find((x) => x.field_id === fieldId)
    return b?.acres == null ? null : Number(b.acres)
  }, [boundaries, year, fieldId])
  const acres = asNum(acresTyped[fieldId ?? ''] ?? '') ?? boundaryAcres ?? 0

  // History first; a plan stands in only for a year with nothing harvested on record.
  const byYear = useMemo(() => {
    const m = new Map<number, { ids: string[]; planned: boolean }>()
    const t = timeline.data
    if (!t) return m
    for (const h of t.hist) {
      if (!h.crop_id || h.crop_year >= year) continue
      const e = m.get(h.crop_year) ?? { ids: [], planned: false }
      if (!e.ids.includes(h.crop_id)) e.ids.push(h.crop_id)
      m.set(h.crop_year, e)
    }
    const planned = new Map<number, string[]>()
    for (const z of t.zones) if (z.crop_id && z.crop_year < year) planned.set(z.crop_year, [...(planned.get(z.crop_year) ?? []), z.crop_id])
    for (const p of t.plans) if (p.crop_id && p.crop_year < year && !planned.has(p.crop_year)) planned.set(p.crop_year, [p.crop_id])
    for (const [y, ids] of planned) if (!m.has(y)) m.set(y, { ids: [...new Set(ids)], planned: true })
    return m
  }, [timeline.data, year])

  const fctx = useMemo(() => {
    if (!ctx.ready || !field) return null
    const overlay = new Map<number, string[]>()
    for (const [y, e] of byYear) if (e.planned) overlay.set(y, e.ids)
    return ctx.fieldCtx(field, acres, overlay, year, ctx.waterFor(year, new Map([[field.id, acres]])))
  }, [ctx, field, acres, byYear, year])

  const cropsById = useMemo(() => (ctx.ready ? ctx.cropLookup : new Map<string, CropInfo>()), [ctx])
  const cropOptions = useMemo(
    () => (ctx.ready ? ctx.cropInfo.filter((c) => !c.renterOnly && c.key !== 'other').sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name })) : []),
    [ctx],
  )
  const succession = useMemo(() => buildSuccessionMap(rules ?? []), [rules])
  const notes = useMemo(() => buildSuccessionNotes(rules ?? []), [rules])
  const pref = (prev: string, next: string) => {
    const p = succession.get(prev)?.get(next) as Preference | undefined
    return p ? { preference: p, notes: notes.get(`${prev}>${next}`)?.notes ?? null } : null
  }

  /** Everything about one side: the app's figures, what was typed over them, and the engine's read. */
  const sideFor = (cropId: string): SideData | null => {
    if (!ctx.ready || !fctx || !cropId || !field) return null
    const crop = cropsById.get(cropId)
    if (!crop) return null
    const basis = ctx.marginOn(field.id, cropId, year)
    const share = ctx.shareOn(field.id, year, cropId)
    const o = over[cropId] ?? {}
    // The farm's fixed expenses are the same whatever is planted, so a crop
    // is judged on its own inputs; the fixed share is a separate check.
    const allLines = ctx.costLines(cropId, year)
    const fixedIn = allLines.filter((l) => l.farm_fixed).reduce((t, l) => t + (Number(l.cost_per_acre) || 0), 0)
    const direct = basis.cost == null ? null : basis.cost - fixedIn
    const side: CompareSide = {
      yield: asNum(o.yield ?? '') ?? basis.yield ?? 0,
      price: asNum(o.price ?? '') ?? basis.price ?? 0,
      cost: asNum(o.cost ?? '') ?? direct ?? 0,
      extraPerAcre: asNum(o.extraAc ?? '') ?? 0,
      extraPerUnit: asNum(o.extraUnit ?? '') ?? 0,
      revShare: share.revShare,
      costShare: share.costShare,
    }
    const ev = evaluate(fctx, crop, year, cropsById, pref, ctx.rulesByReg)
    // Every harvest here; one marked not a normal year is listed and marked (the averages skip it).
    const grown = (timeline.data?.hist ?? [])
      .filter((h) => h.crop_id === cropId && isActualYield({ ...h, acres: h.acres == null ? null : Number(h.acres), exclude_from_averages: false }, basis.unit, null))
      .map((h) => ({ year: h.crop_year, y: Number(h.clean_yield_per_acre ?? h.yield_per_acre), ...(h.exclude_from_averages ? { abnormal: h.abnormal_reason ?? 'not a normal year' } : {}) }))
      .sort((a, b) => b.year - a.year)
    const waterIn = fctx.irrigated ? (fctx.waterNeedIn?.(cropId) ?? crop.waterNeedIn ?? null) : null
    return { crop, basis, share, side, ev, grown, waterIn, direct, lines: allLines.filter((l) => !l.farm_fixed), o }
  }
  const A = sideFor(cropA)
  const B = sideFor(cropB)
  // The engine's own read of the field: every crop it would allow here, best
  // first, scored as the "Most profitable" plan scores them (money with the
  // rotation effects, plus agronomy). C is the best one not already chosen.
  const ranked =
    ctx.ready && fctx
      ? ctx.cropInfo
          .filter((c) => !c.renterOnly && c.key !== 'other')
          .map((c) => ({ c, e: evaluate(fctx, c, year, cropsById, pref, ctx.rulesByReg) }))
          .filter((x) => !x.e.blocked.length && x.e.profit != null)
          .sort((a, b) => objectiveScore(b.e, 'profit') - objectiveScore(a.e, 'profit'))
      : []
  const pickC = ranked.find((x) => x.c.id !== cropA && x.c.id !== cropB)
  const C = field && (cropA || cropB) && pickC ? sideFor(pickC.c.id) : null
  const topIs = ranked[0] && (ranked[0].c.id === cropA ? 'A' : ranked[0].c.id === cropB ? 'B' : null)
  const setO = (cropId: string, k: keyof Overrides, v: string) => setOver((s) => ({ ...s, [cropId]: { ...s[cropId], [k]: v } }))

  // The same corn sold two ways (dry bushels vs wet tonnes): one harvest, two units.
  const cornPair =
    A && B && A.crop.key === 'corn' && B.crop.key === 'corn' && A.basis.unit !== B.basis.unit && [A, B].some((s) => s.basis.unit === 'bu') && [A, B].some((s) => s.basis.unit === 'MT')
      ? { bu: A.basis.unit === 'bu' ? A : B, mt: A.basis.unit === 'MT' ? A : B }
      : null
  const tPerBu = cornWetTonnesPerBu(asNum(moisture) ?? 28)
  const fixed = ctx.ready ? ctx.fixedPerAcre(year) : null

  const years = [cropYear, cropYear + 1, cropYear + 2, cropYear + 3]
  const fieldOptions = (fields ?? []).map((f) => ({ value: f.id, label: f.name }))

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader
        title="Compare crops"
        icon={<ArrowLeftRight className="h-5 w-5 text-brand-700" />}
        subtitle={field ? `${field.name} · ${n0(acres)} ac · ${year}` : 'Pick a field and two crops'}
        info={
          <HelpNote title="How the comparison works">
            Each crop starts from the farm's own numbers, the same ones the rotation plan uses: the yield is this field's average once it has five harvests of the
            crop, then the farm's average, then the crop's normal yield; the price is a contract, then your price for the year, then the elevator bid or Alberta
            market; the cost is the year's input budget without the farm's fixed expenses. Type over any of them. Custom work ($/ac) and per-unit costs such as
            drying, storage or hauling go in the two extra boxes. Fixed expenses (land, machinery, labour, overhead) are the same whatever is planted, so the
            crops are compared on what each makes over its own inputs; the "Against fixed costs" line and the farm check show whether that is enough to carry
            the farm. On a 50/50 or crop-share field only our side of it is counted. The warnings come from the rotation
            engine: what grew here, herbicide labels, scouting, salinity, heat units and irrigation, and they hold whatever the money says.
          </HelpNote>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <label className="col-span-2 text-xs text-gray-600 md:col-span-1">
          Field
          <Select value={fieldId ?? ''} options={fieldOptions} onChange={(v) => setParam('field', v)} ariaLabel="Field" placeholder="Choose a field…" />
        </label>
        <label className="text-xs text-gray-600">
          Crop year
          <Select value={String(year)} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(v) => setParam('year', v)} ariaLabel="Crop year" />
        </label>
        <label className="text-xs text-gray-600">
          Acres
          <input
            type="number"
            inputMode="decimal"
            value={acresTyped[fieldId ?? ''] ?? (boundaryAcres != null ? String(Math.round(boundaryAcres * 10) / 10) : '')}
            onChange={(e) => setAcresTyped((s) => ({ ...s, [fieldId ?? '']: e.target.value }))}
            className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums"
            aria-label="Acres"
          />
        </label>
        <label className="text-xs text-gray-600">
          Crop A
          <Select value={cropA} options={cropOptions} onChange={(v) => setParam('a', v)} ariaLabel="Crop A" placeholder="Choose…" />
        </label>
        <label className="text-xs text-gray-600">
          Crop B
          <Select value={cropB} options={cropOptions} onChange={(v) => setParam('b', v)} ariaLabel="Crop B" placeholder="Choose…" />
        </label>
      </div>

      {field && (
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          {[...byYear.entries()]
            .sort((a, b) => b[0] - a[0])
            .slice(0, 6)
            .map(([y, e]) => (
              <span key={y} className={cn('rounded-full border px-2 py-0.5', e.planned ? 'border-dashed border-gray-300 text-gray-500' : 'border-gray-200 bg-gray-50 text-gray-700')} title={e.planned ? 'Planned, not harvested yet' : undefined}>
                {y} · {e.ids.map((id) => cropName.get(id) ?? 'Unknown').join(' + ')}
              </span>
            ))}
          {!byYear.size && !timeline.isLoading && <span className="text-gray-500">No crop history on file for this field.</span>}
          {fctx && <span className="rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{fctx.irrigated ? 'Irrigated' : 'Dryland'}</span>}
        </div>
      )}

      {!ctx.ready && <p className="text-sm text-gray-500">Loading the farm's numbers…</p>}

      {cornPair && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
          <span>Same corn, sold two ways. At</span>
          <input
            type="number"
            value={moisture}
            onChange={(e) => setMoisture(e.target.value)}
            className="w-14 rounded border border-amber-300 bg-white px-1 py-0.5 text-right tabular-nums"
            aria-label="Harvest moisture %"
          />
          <span>% moisture, {n0(cornPair.bu.side.yield)} dry bu/ac weighs {(cornPair.bu.side.yield * tPerBu).toFixed(2)} wet t/ac.</span>
          <button
            type="button"
            onClick={() => setO(cornPair.mt.crop.id, 'yield', (cornPair.bu.side.yield * tPerBu).toFixed(2))}
            className="rounded-md bg-amber-700 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-800"
          >
            Use it for {cornPair.mt.crop.name}
          </button>
        </div>
      )}

      {field && (A || B) && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[A, B].map((s, i) =>
            s ? (
              <SideCard
                key={s.crop.id + i}
                letter={i === 0 ? 'A' : 'B'}
                s={s}
                acres={acres}
                fixed={fixed}
                tag={topIs === (i === 0 ? 'A' : 'B') ? 'Engine\'s top pick' : undefined}
                setO={(k, v) => setO(s.crop.id, k, v)}
              />
            ) : (
              <div key={i} className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                Choose crop {i === 0 ? 'A' : 'B'}
              </div>
            ),
          )}
          {C && (
            <SideCard
              letter="C"
              s={C}
              acres={acres}
              fixed={fixed}
              tag={topIs ? 'Next best' : 'Engine\'s pick'}
              setO={(k, v) => setO(C.crop.id, k, v)}
            />
          )}
        </div>
      )}

      {A && B && A.crop.id !== B.crop.id && <Verdict A={A} B={B} acres={acres} />}

      {field && fctx && (A || B) && (
        <AskClaude
          payload={() => ({
            field: {
              name: field.name,
              crop_year: year,
              acres: Math.round(acres),
              irrigated: fctx.irrigated,
              history: [...byYear.entries()]
                .sort((a, b) => b[0] - a[0])
                .slice(0, 8)
                .map(([y, e]) => ({ year: y, crops: e.ids.map((id) => cropName.get(id) ?? 'Unknown'), planned: e.planned })),
            },
            fixed_per_acre: fixed == null ? null : Math.round(fixed),
            crops: [
              ...(A ? [packSide(A, 'A (chosen)', fixed)] : []),
              ...(B ? [packSide(B, 'B (chosen)', fixed)] : []),
              ...(C ? [packSide(C, 'C (engine pick)', fixed)] : []),
            ],
            engine_ranking: ranked.slice(0, 6).map((x) => x.c.name),
          })}
          askKey={[field.id, year, cropA, cropB, C?.crop.id].join(':')}
        />
      )}

      {ctx.ready && (
        <FarmCheck
          year={year - 1}
          fixed={ctx.fixedPerAcre(year - 1)}
          ctx={ctx}
          highlight={[A, B, C].flatMap((s) => (s ? [{ name: s.crop.name, perAcre: marginPerAcre(s.side) }] : []))}
        />
      )}
    </div>
  )
}

/** One crop's side: the app's figures, what was typed over them, and the engine's read. */
type SideData = {
  crop: { id: string; name: string; key: string }
  basis: { unit: string; yield: number | null; yieldFrom: string; price: number | null; priceFrom: string; cost: number | null; costFrom: string; ownUse: boolean }
  share: { revShare: number; costShare: number; note: string }
  side: CompareSide
  ev: { blocked: string[]; cautions: string[]; plus: string[]; labels: { product: string; registration: string }[] }
  /** abnormal: the reason a year is marked not normal. */
  grown: { year: number; y: number; abnormal?: string }[]
  waterIn: number | null
  /** The input budget less the farm's fixed expenses, $/ac. */
  direct: number | null
  lines: { name?: string | null; cost_per_acre: number | null }[]
  o: Overrides
}

function Num({ label, value, placeholder, onChange, hint, step = 'any' }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; hint?: string; step?: string }) {
  return (
    <label className="block text-xs text-gray-600">
      <span className="flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {hint && <span className="truncate text-[11px] text-gray-400" title={hint}>{hint}</span>}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums placeholder:text-gray-400"
      />
    </label>
  )
}

function SideCard({
  letter,
  s,
  acres,
  fixed,
  tag,
  setO,
}: {
  letter: string
  s: SideData
  acres: number
  fixed: number | null
  /** A note beside the crop's name: the engine's pick. */
  tag?: string
  setO: (k: keyof Overrides, v: string) => void
}) {
  const u = s.basis.unit
  const m = marginPerAcre(s.side)
  const be = breakevenYield(s.side)
  const gross = s.side.revShare * s.side.yield * s.side.price
  const costs = gross - m
  const red = s.ev.blocked.length > 0
  return (
    <section className={cn('rounded-lg border bg-white p-3', red ? 'border-red-300' : 'border-gray-200')}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">{letter}</span>
        {s.crop.name}
        {tag && (
          <span className="inline-flex items-center gap-0.5 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">
            <Sparkles className="h-3 w-3" /> {tag}
          </span>
        )}
        {red ? <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">Not advised here</span> : s.ev.cautions.length ? <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Caution</span> : <span className="ml-auto rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800">Fits here</span>}
      </h2>

      {(s.ev.blocked.length > 0 || s.ev.cautions.length > 0 || s.ev.plus.length > 0) && (
        <ul className="mb-2 space-y-0.5 text-xs">
          {s.ev.blocked.map((t, i) => <li key={'b' + i} className="text-red-700">⛔ {t}</li>)}
          {s.ev.cautions.map((t, i) => <li key={'c' + i} className="text-amber-800">⚠ {t}</li>)}
          {s.ev.plus.map((t, i) => <li key={'p' + i} className="text-green-700">✓ {t}</li>)}
          {s.ev.labels.map((l) => (
            <li key={l.registration}>
              <button type="button" onClick={() => openChemicalLabel(l.registration)} className="inline-flex items-center gap-1 text-brand-700 underline">
                <FileText className="h-3 w-3" /> {l.product} label
              </button>
            </li>
          ))}
        </ul>
      )}
      {s.share.note && <p className="mb-2 text-xs text-gray-600">{s.share.note.replace(/^ · /, '')}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Num label={`Yield (${u}/ac)`} hint={s.basis.yieldFrom} value={s.o.yield ?? ''} placeholder={s.basis.yield != null ? String(Math.round(s.basis.yield * 100) / 100) : 'none on file'} onChange={(v) => setO('yield', v)} />
        <Num label={`Price ($/${u})`} hint={s.basis.priceFrom} value={s.o.price ?? ''} placeholder={s.basis.price != null ? unitPrice(s.basis.price) : 'none on file'} onChange={(v) => setO('price', v)} />
        <Num label="Inputs ($/ac)" hint={s.basis.costFrom} value={s.o.cost ?? ''} placeholder={s.direct != null ? String(Math.round(s.direct)) : 'none on file'} onChange={(v) => setO('cost', v)} />
        <Num label="Custom work ($/ac)" hint="combining, trucking…" value={s.o.extraAc ?? ''} placeholder="0" onChange={(v) => setO('extraAc', v)} />
        <Num label={`Per-${u} costs ($/${u})`} hint="drying, storage, hauling" value={s.o.extraUnit ?? ''} placeholder="0" onChange={(v) => setO('extraUnit', v)} />
      </div>
      {s.lines.length > 0 && (
        <details className="mt-1 text-[11px] text-gray-500">
          <summary className="cursor-pointer">What's in the inputs</summary>
          <ul className="mt-1 space-y-0.5">
            {s.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{l.name ?? 'Line'}</span>
                <span className="tabular-nums">${n0(Number(l.cost_per_acre ?? 0))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-sm">
        <dt className="text-gray-600">{s.basis.ownUse ? 'Feed value' : 'Gross'} /ac</dt>
        <dd className="text-right tabular-nums">{money(gross)}</dd>
        <dt className="text-gray-600">Inputs &amp; work /ac</dt>
        <dd className="text-right tabular-nums">−{money(costs)}</dd>
        <dt className="font-semibold text-gray-900">Over its inputs /ac</dt>
        <dd className={cn('text-right font-semibold tabular-nums', m < 0 ? 'text-red-700' : 'text-gray-900')}>{money(m)}</dd>
        <dt className="font-semibold text-gray-900">Field ({n0(acres)} ac)</dt>
        <dd className={cn('text-right font-semibold tabular-nums', m < 0 ? 'text-red-700' : 'text-gray-900')}>{money(m * acres)}</dd>
        <dt className="text-gray-600">Pays its inputs at</dt>
        <dd className="text-right tabular-nums">{be == null ? '—' : fmtYield(be, u)}</dd>
      </dl>
      {fixed != null && fixed > 0 && <AgainstFixed m={m} fixed={fixed} full={yieldFor(s.side, fixed)} unit={u} />}

      <p className="mt-2 text-[11px] text-gray-500">
        {s.grown.length ? `Grown here: ${s.grown.slice(0, 5).map((g) => `${g.year} ${fmtYield(g.y, u)}${g.abnormal ? ` (abnormal — left out of averages: ${g.abnormal})` : ''}`).join(' · ')}` : 'No harvest of this crop on record here.'}
        {s.waterIn != null && ` · Needs about ${Math.round(s.waterIn)}" of irrigation`}
      </p>
    </section>
  )
}

function Verdict({ A, B, acres }: { A: SideData; B: SideData; acres: number }) {
  const ma = marginPerAcre(A.side)
  const mb = marginPerAcre(B.side)
  const diff = ma - mb
  const win = diff >= 0 ? A : B
  const lose = diff >= 0 ? B : A
  const tieA = tieYield(A.side, B.side)
  const tieB = tieYield(B.side, A.side)
  const grid = payoffGrid(A.side, B.side, A.basis.unit, B.basis.unit)
  const blockedWinner = win.ev.blocked.length > 0
  return (
    <section className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-900">
        {Math.abs(diff) < 1 ? 'They come out even' : `${win.crop.name} makes ${money(Math.abs(diff))}/ac more over its inputs — ${money(Math.abs(diff) * acres)} on the field`}
      </h2>
      {blockedWinner && <p className="mt-1 text-xs font-medium text-red-700">But {win.crop.name} is not advised on this field — see its warnings.</p>}
      {!blockedWinner && lose.ev.blocked.length > 0 && <p className="mt-1 text-xs text-gray-600">{lose.crop.name} is not advised here anyway.</p>}
      <ul className="mt-2 space-y-1 text-sm text-gray-700">
        <li>
          {A.crop.name} beats {B.crop.name} (at {fmtYield(B.side.yield, B.basis.unit)}/ac) above <b>{tieA == null ? '—' : fmtYield(tieA, A.basis.unit)}/ac</b>.
        </li>
        <li>
          {B.crop.name} beats {A.crop.name} (at {fmtYield(A.side.yield, A.basis.unit)}/ac) above <b>{tieB == null ? '—' : fmtYield(tieB, B.basis.unit)}/ac</b>.
        </li>
      </ul>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs tabular-nums">
          <caption className="mb-1 text-left text-[11px] text-gray-500">
            {A.crop.name} less {B.crop.name}, $/ac, at yields either side of the expected ones. Green: {A.crop.name} wins. Red: {B.crop.name} wins.
          </caption>
          <thead>
            <tr>
              <th className="p-1 text-left font-medium text-gray-500">
                {A.basis.unit} ↓ · {B.basis.unit} →
              </th>
              {grid.yieldsB.map((y, j) => (
                <th key={j} className={cn('p-1 text-right font-medium', j === 2 ? 'text-gray-900' : 'text-gray-500')}>
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.yieldsA.map((y, i) => (
              <tr key={i}>
                <th className={cn('p-1 text-left font-medium', i === 2 ? 'text-gray-900' : 'text-gray-500')}>{y}</th>
                {grid.cells[i].map((d, j) => (
                  <td key={j} className={cn('p-1 text-right', d >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800', i === 2 && j === 2 && 'font-bold ring-1 ring-gray-400')}>
                    {money(d)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** How much of the farm's fixed $/ac a crop's earnings over its inputs cover. */
function AgainstFixed({ m, fixed, full, unit }: { m: number; fixed: number; full: number | null; unit: string }) {
  const pct = Math.max(0, m / fixed)
  const short = fixed - m
  return (
    <div className="mt-2 rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
      <div className="flex justify-between gap-2">
        <span>Against fixed costs ({money(fixed)}/ac)</span>
        <span className={cn('font-medium tabular-nums', short > 0 ? 'text-amber-700' : 'text-green-700')}>
          {short > 0 ? `covers ${Math.round(pct * 100)}% · ${money(short)}/ac short` : `covers them · ${money(-short)}/ac over`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-200">
        <div className={cn('h-full', short > 0 ? 'bg-amber-500' : 'bg-green-600')} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      {short > 0 && full != null && <div className="mt-0.5">Covers them too at {fmtYield(full, unit)}/ac</div>}
    </div>
  )
}

/** Last year's crops across the farm: what each made over its inputs, and whether together they carried the fixed costs. */
function FarmCheck({
  year,
  fixed,
  ctx,
  highlight,
}: {
  year: number
  fixed: number | null
  ctx: Extract<ReturnType<typeof useRotationContext>, { ready: true }>
  highlight: { name: string; perAcre: number }[]
}) {
  const q = useQuery({
    queryKey: ['crop-compare-farm', year],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [hist, plans, crops] = await Promise.all([
        supabase.from('crop_yields_v').select('field_id, crop_id, acres, yield_per_acre, clean_yield_per_acre, yield_unit, source').eq('crop_year', year),
        supabase.from('crop_plans').select('field_id, crop_id, planned_acres').eq('crop_year', year),
        supabase.from('crops').select('id, name, fixed_costs_apply'),
      ])
      for (const r of [hist, plans, crops]) if (r.error) throw r.error
      return { hist: hist.data ?? [], plans: plans.data ?? [], crops: crops.data ?? [] }
    },
  })
  const result = useMemo(() => {
    const d = q.data
    if (!d) return null
    const cropById = new Map(d.crops.map((c) => [c.id, c]))
    type Row = { fieldId: string; cropId: string; acres: number; actual: number | null; unit: string | null; source: string | null }
    const rows: Row[] = d.hist
      .filter((h) => h.crop_id && Number(h.acres) > 0)
      .map((h) => ({
        fieldId: h.field_id as string,
        cropId: h.crop_id as string,
        acres: Number(h.acres),
        actual: h.clean_yield_per_acre ?? h.yield_per_acre ?? null,
        unit: h.yield_unit,
        source: h.source,
      }))
    const seen = new Set(rows.map((r) => r.fieldId))
    for (const p of d.plans) {
      if (p.crop_id && !seen.has(p.field_id) && Number(p.planned_acres) > 0) rows.push({ fieldId: p.field_id, cropId: p.crop_id, acres: Number(p.planned_acres), actual: null, unit: null, source: null })
    }
    const byCrop = new Map<string, { name: string; acres: number; total: number; estimated: boolean }>()
    let rentedOut = 0
    let unpriced = 0
    for (const r of rows) {
      const crop = cropById.get(r.cropId)
      // Summer fallow and other people's potatoes carry no fixed share and earn nothing of ours.
      if (!crop || crop.fixed_costs_apply === false) continue
      const share = ctx.shareOn(r.fieldId, year, r.cropId)
      if (share.out && share.revShare === 0) {
        rentedOut += r.acres
        continue
      }
      const b = ctx.marginOn(r.fieldId, r.cropId, year)
      const real =
        r.actual != null &&
        isActualYield({ field_id: r.fieldId, crop_id: r.cropId, crop_year: year, acres: r.acres, yield_per_acre: Number(r.actual), yield_unit: r.unit, source: r.source }, b.unit, null)
      const y = real ? Number(r.actual) : b.yield
      if (y == null || b.price == null) {
        unpriced += r.acres
        continue
      }
      const direct = ctx
        .costLines(r.cropId, year)
        .filter((l) => !l.farm_fixed)
        .reduce((t, l) => t + (Number(l.cost_per_acre) || 0), 0)
      const perAcre = share.revShare * y * b.price - share.costShare * direct
      const e = byCrop.get(r.cropId) ?? { name: crop.name, acres: 0, total: 0, estimated: false }
      e.acres += r.acres
      e.total += perAcre * r.acres
      e.estimated ||= !real
      byCrop.set(r.cropId, e)
    }
    const list = [...byCrop.values()].sort((a, b) => b.total / b.acres - a.total / a.acres)
    const acres = list.reduce((t, c) => t + c.acres, 0)
    const total = list.reduce((t, c) => t + c.total, 0)
    return { list, acres, total, avg: acres > 0 ? total / acres : null, rentedOut, unpriced }
  }, [q.data, ctx, year])

  if (!result || result.avg == null) return null
  const avg = result.avg
  const over = fixed != null ? avg - fixed : null
  return (
    <section className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-900">Farm check · {year}</h2>
      <p className="mt-1 text-sm text-gray-700">
        {n0(result.acres)} ac of crops made <b>{money(avg)}/ac</b> over their inputs
        {fixed != null && over != null ? (
          <>
            {' '}against fixed costs of {money(fixed)}/ac, so the farm came out{' '}
            <b className={over < 0 ? 'text-red-700' : 'text-green-700'}>
              {money(Math.abs(over))}/ac {over < 0 ? 'short' : 'ahead'}
            </b>{' '}
            ({money(Math.abs(over) * result.acres)} in all).
          </>
        ) : (
          '.'
        )}
      </p>
      {highlight.length > 0 && (
        <p className="mt-1 text-xs text-gray-600">
          {highlight.map((h) => `${h.name} at ${money(h.perAcre)}/ac is ${h.perAcre >= avg ? 'above' : 'below'} that average`).join('; ')}. A crop under the
          average leans on the others to carry the fixed costs.
        </p>
      )}
      <Fold title="By crop" storageKey="crop-compare-farm-crops" className="mt-2">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-gray-500">
              <th className="p-1 text-left font-medium">Crop</th>
              <th className="p-1 text-right font-medium">Acres</th>
              <th className="p-1 text-right font-medium">Over inputs /ac</th>
              <th className="p-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {result.list.map((c) => {
              const pa = c.total / c.acres
              return (
                <tr key={c.name} className="border-t border-gray-100">
                  <td className="p-1">
                    {c.name}
                    {c.estimated && (
                      <span className="ml-1 text-gray-400" title="Some fields have no harvest on record, so the expected yield stands in">
                        est.
                      </span>
                    )}
                  </td>
                  <td className="p-1 text-right">{n0(c.acres)}</td>
                  <td className={cn('p-1 text-right', fixed != null && pa < fixed ? 'text-amber-700' : 'text-green-700')}>{money(pa)}</td>
                  <td className="p-1 text-right">{money(c.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-gray-500">
          Amber: doesn't cover the fixed costs on its own. Yields are that year's harvest where recorded.
          {result.rentedOut > 0 && ` ${n0(result.rentedOut)} ac rented out not counted.`}
          {result.unpriced > 0 && ` ${n0(result.unpriced)} ac with no price or yield not counted.`}
        </p>
      </Fold>
    </section>
  )
}

/** One crop as Claude is shown it: every figure worked out already, named in plain words. */
function packSide(s: SideData, role: string, fixed: number | null) {
  const r = (v: number | null, dp = 2) => (v == null ? null : +v.toFixed(dp))
  const m = marginPerAcre(s.side)
  return {
    role,
    name: s.crop.name,
    unit: s.basis.unit,
    expected_yield: r(s.side.yield),
    yield_source: s.o.yield ? 'typed on the page' : s.basis.yieldFrom,
    price: r(s.side.price, 3),
    price_source: s.o.price ? 'typed on the page' : s.basis.priceFrom,
    own_feed: s.basis.ownUse,
    inputs_per_ac: r(s.side.cost, 0),
    custom_work_per_ac: r(s.side.extraPerAcre, 0),
    per_unit_costs: r(s.side.extraPerUnit),
    our_share: s.share.note ? s.share.note.replace(/^ · /, '') : 'all ours',
    over_inputs_per_ac: r(m, 0),
    pays_inputs_at_yield: r(breakevenYield(s.side)),
    covers_fixed_at_yield: fixed != null ? r(yieldFor(s.side, fixed)) : null,
    past_yields_here: s.grown.slice(0, 5),
    irrigation_need_in: r(s.waterIn, 0),
    blocked: s.ev.blocked,
    cautions: s.ev.cautions,
    positives: s.ev.plus,
  }
}

/** Claude's pick between A, B and the engine's C, on request. */
function AskClaude({ payload, askKey }: { payload: () => unknown; askKey: string }) {
  const [answer, setAnswer] = useState<{ key: string; text: string } | null>(null)
  const ask = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/crop-compare-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify(payload()),
      })
      // A gateway timeout comes back as an HTML page, not JSON.
      const j = (await res.json().catch(() => ({}))) as { advice?: string; error?: string }
      if (!res.ok || !j.advice) throw new Error(j.error ?? (res.ok ? 'No advice came back' : `No answer from the advice service (${res.status})`))
      return j.advice
    },
    onSuccess: (text) => setAnswer({ key: askKey, text }),
  })
  const shown = answer?.key === askKey ? answer.text : null
  const stale = answer != null && !shown
  const inline = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>))
  return (
    <section className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-brand-700" /> Claude's pick
        </h2>
        <button
          type="button"
          onClick={() => ask.mutate()}
          disabled={ask.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {ask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {shown || stale ? 'Ask again' : 'Ask Claude'}
        </button>
      </div>
      {ask.isError && <p className="mt-2 text-xs text-red-700">{(ask.error as Error).message}</p>}
      {stale && !ask.isPending && <p className="mt-2 text-xs text-gray-500">The field or crops changed since Claude's last answer.</p>}
      {shown && (
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-gray-800">
          {shown
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l, i) => (
              <li key={i} className={cn(/^[-•*]\s/.test(l) && 'ml-4 list-disc')}>
                {inline(l.replace(/^[-•*]\s+/, ''))}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
