import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { openChemicalLabel } from '@/lib/chemicals'
import { supabase } from '@/lib/supabase'
import { useBulkSetRotation, type SuccessionMap, type SuccessionNotes } from '@/lib/rotation'
import { useRotationContext, useSetAcreLimit, useSetCropMargin, useSetCropWaterNeed, useSetGroupLimit, useSetOwnUse, useSetRenterOnly, useSetSisterValue } from '@/lib/rotation-context'
import { SeasonAhead } from '@/pages/plan/SeasonAhead'
import { buildPlan, LIMIT_GROUPS, OBJECTIVE_LABEL, SOIL_SCORE, type Objective, type Preference } from '@/lib/rotation-engine'
import { cn } from '@/lib/utils'
import { Fold } from '@/components/Fold'
import { AdminOnly } from '@/components/TechnicalDetails'

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const money = (v: number) => `${v < 0 ? '−' : ''}$${n0(Math.abs(v))}`

/** Hex SHA-256 of the request text, matching the one the function stores. */
async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Still being written. A request left pending past ten minutes has stalled: the job gets fifteen and gives up at twelve. */
const isWriting = (r: { status: string; created_at: string }) =>
  r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() < 10 * 60_000

const writtenAt = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Claude's bullets with **bold** shown as bold. */
function Advice({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const inline = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>))
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

/**
 * Three plans for one year — best rotation, most profitable, best for the
 * soil — each built by the rotation engine inside the farm's acre limits,
 * with every field's reasons, and Claude's read of which to take.
 */
export function RotationAdvisor({
  isManager,
  planYears,
  fields,
  fieldAcres,
  cropSetsByField,
  succession,
  notes,
  plannedFor,
  plansFresh = false,
}: {
  isManager: boolean
  planYears: number[]
  fields: { id: string; name: string }[]
  fieldAcres: Map<string, number>
  cropSetsByField: Map<string, Map<number, Set<string>>>
  succession: SuccessionMap
  notes: SuccessionNotes
  /** field → year → crop already planned. */
  plannedFor: (fieldId: string, year: number) => string | undefined
  /** The plans for the years ahead have been read from the server on this visit. */
  plansFresh?: boolean
}) {
  const [year, setYear] = useState(planYears[1] ?? planYears[0])
  const [objective, setObjective] = useState<Objective>('rotation')
  const ctx = useRotationContext(planYears[0])
  const setLimit = useSetAcreLimit()
  const setGroupLimit = useSetGroupLimit()
  const setRenterOnly = useSetRenterOnly()
  const setOwnUse = useSetOwnUse()
  const setSister = useSetSisterValue()
  const setWaterNeed = useSetCropWaterNeed()
  /** A what-if SMRID allotment (inches); null = the one on file. */
  const [whatIf, setWhatIf] = useState<number | null>(null)
  const [coolSummer, setCoolSummer] = useState(false)
  const setMargin = useSetCropMargin()
  const bulk = useBulkSetRotation()

  const pref = (prev: string, next: string) => {
    const p = succession.get(prev)?.get(next) as Preference | undefined
    return p ? { preference: p, notes: notes.get(`${prev}>${next}`)?.notes ?? null } : null
  }

  /** Everything the engine needs to plan one year, from what the farm holds before it. */
  const setupFor = (y: number, what: number | null, cool: boolean) => {
    if (!ctx.ready) return null
    const water = ctx.waterFor(y, fieldAcres, what)
    const fctx = fields
      .filter((f) => !ctx.rentedOut.has(`${f.id}:${y}`) && (fieldAcres.get(f.id) ?? 0) > 0)
      .map((f) => {
        const byYear = new Map<number, string[]>()
        for (const [yy, set] of cropSetsByField.get(f.id) ?? []) if (yy < y) byYear.set(yy, [...set])
        return ctx.fieldCtx(f, fieldAcres.get(f.id) ?? 0, byYear, y, water, cool)
      })
    const crops = ctx.cropInfo.filter((c) => c.key !== 'other')
    const max = new Map<string, number>()
    for (const c of crops) {
      const m = ctx.maxFor(c.id, y)
      if (m != null) max.set(c.id, m)
    }
    const groupMax = ctx.groupMaxFor(y)
    const contracts = ctx.contractMinimums(y)
    // The herd's winter feed is a minimum as a contract is; a crop that has
    // both (hay sold on contract and fed) needs the two together.
    const feed = ctx.feedMinimums(y)
    const minAcres = new Map([...contracts].map(([id, k]) => [id, k.acres]))
    const minNote = new Map([...contracts.keys()].map((id) => [id, 'Placed to fill a contract']))
    for (const [id, fm] of feed) {
      if (fm.acres == null || fm.acres <= 0) continue
      minAcres.set(id, (minAcres.get(id) ?? 0) + fm.acres)
      minNote.set(id, contracts.has(id) ? 'Placed to fill a contract and the herd\'s winter feed' : 'Placed to grow the herd\'s winter feed')
    }
    const opts = {
      minAcres,
      minNote,
      waterAvailable: new Map(water.sources.filter((w) => w.acreInches > 0).map((w) => [w.key, w.acreInches])),
    }
    return { fctx, crops, max, groupMax, water, contracts, feed, opts }
  }

  const plans = useMemo(() => {
    const st = setupFor(year, whatIf, coolSummer)
    if (!st || !ctx.ready) return null
    const out = {} as Record<Objective, ReturnType<typeof buildPlan>>
    for (const o of ['rotation', 'profit', 'soil'] as Objective[]) out[o] = buildPlan(o, year, st.fctx, st.crops, pref, ctx.rulesByReg, st.max, st.groupMax, new Map(), st.opts)
    return { out, ...st }
  }, [ctx, fields, fieldAcres, cropSetsByField, year, succession, notes, whatIf, coolSummer]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The request exactly as it is sent. Built from the plans on screen, so its
   * hash says whether saved advice was written from these plans or older ones.
   */
  const requestText = useMemo(() => {
    if (!plans || !ctx.ready) return null
    const name = (id: string | null) => ctx.cropInfo.find((c) => c.id === id)?.name ?? 'nothing allowed'
    const summarise = (o: Objective) => {
      const p = plans.out[o]
      return {
        objective: OBJECTIVE_LABEL[o],
        margin_total: Math.round(p.margin),
        unpriced_acres: Math.round(p.unpriced),
        acres_by_crop: Object.fromEntries([...p.acres].map(([id, ac]) => [name(id), Math.round(ac)])),
        fields: p.assignments.map((a) => {
          const f = plans.fctx.find((x) => x.id === a.fieldId)!
          return {
            field: f.name,
            acres: Math.round(f.acres),
            irrigated: f.irrigated,
            sandy: f.sandy,
            last_year: (f.crops.get(year - 1) ?? []).map(name),
            crop: name(a.cropId),
            cautions: a.evaluation?.cautions ?? [],
            reasons: a.evaluation?.plus ?? [],
            margin_basis: a.cropId ? (f.economics?.get(a.cropId)?.basis ?? null) : null,
            water_source: f.waterSource ?? null,
            heat_units: f.chu != null ? Math.round(f.chu) : null,
            scouting: (f.scouting ?? []).map((x) => `${x.subject} ${x.year} (severity ${x.severity})`),
          }
        }),
        water_needed_inches: Object.fromEntries(plans.water.sources.map((w) => [w.label, w.acres > 0 ? Math.round(((p.water.get(w.key) ?? 0) / w.acres) * 10) / 10 : null])),
        contracts_or_feed_short: Object.fromEntries([...p.shortOfContract].map(([id, ac]) => [name(id), Math.round(ac)])),
      }
    }
    return JSON.stringify({
      year,
      acre_limits: {
        ...Object.fromEntries([...plans.max].map(([id, m]) => [name(id), m])),
        ...Object.fromEntries([...plans.groupMax].map(([g, m]) => [LIMIT_GROUPS.find((x) => x.group === g)?.label ?? g, m])),
      },
      plans: (['rotation', 'profit', 'soil'] as Objective[]).map(summarise),
      season: {
        smrid_allotment_inches: plans.water.smridInches,
        smrid_allotment_is_what_if: whatIf != null,
        water_available_inches: Object.fromEntries(plans.water.sources.map((w) => [w.label, w.acres > 0 ? Math.round((w.acreInches / w.acres) * 10) / 10 : null])),
        reservoirs: ctx.waterSupply.filter((w) => w.kind === 'reservoir').map((w) => `${w.name}: ${Math.round(Number(w.pct_full))}% full${w.pct_full_last_year != null ? ` (last year ${Math.round(Number(w.pct_full_last_year))}%)` : ''}`),
        snow: ctx.waterSupply.filter((w) => w.kind === 'snow').map((w) => `${w.name}: ${w.value} ${w.unit}${w.pct_of_median != null ? `, ${Math.round(Number(w.pct_of_median))}% of median` : ''}`),
        smrid_notices: ctx.notices.map((n) => `${n.observed_on}: ${n.name}`),
        planning_for_cool_summer: coolSummer,
        climate: ctx.climate.map((c) => ({ heat_units_median: c.chu_median, heat_units_cool_year: c.chu_p20, frost_free_days: c.ffd_median, outlook: c.outlook })),
        margins: Object.fromEntries(ctx.cropInfo.filter((c) => !c.renterOnly && c.key !== 'other').map((c) => {
          const b = ctx.marginBasis(c.id, year)
          return [c.name, b.margin == null ? null : { margin: Math.round(b.margin), yield: b.yield, yield_from: b.yieldFrom, price: b.price, price_from: b.priceFrom, cost: b.cost, cost_from: b.costFrom }]
        })),
      },
    })
  }, [plans, ctx, year, whatIf, coolSummer])
  // Component state, not a query: the offline cache keeps query keys, and this
  // one would be the whole request.
  const [hashed, setHashed] = useState<{ text: string; hash: string } | null>(null)
  useEffect(() => {
    if (!requestText) return
    let live = true
    void sha256(requestText).then((hash) => live && setHashed({ text: requestText, hash }))
    return () => {
      live = false
    }
  }, [requestText])
  const requestHash = hashed?.text === requestText ? hashed.hash : null

  // The advice is written by a background job (about a minute and a half on
  // the advisor model) into rotation_advice; this reads the latest for the
  // year, and polls while one is being written.
  const qc = useQueryClient()
  const history = useQuery({
    queryKey: ['rotation_advice', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rotation_advice')
        .select('id, status, advice, error, model, request_hash, created_at, finished_at')
        .eq('crop_year', year)
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data ?? []
    },
    // Always re-read on opening: a "nothing asked yet" answer restored from the
    // offline cache let a second request go in while the first was being
    // written. And keep polling while one is written even if the page is not in
    // front — the note says it can be left.
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.[0] && isWriting(q.state.data[0]) ? 3000 : false),
    refetchIntervalInBackground: true,
  })
  const latest = history.data?.[0]
  const lastDone = history.data?.find((r) => r.status === 'done' && r.advice)
  const writing = !!latest && isWriting(latest)
  const stalled = latest?.status === 'pending' && !writing
  const outOfDate = !!lastDone && !!requestHash && lastDone.request_hash !== requestHash

  // Future years fill themselves: when a year ahead has fields with nothing
  // planned, they get the Best-rotation pick — fitted around what is already
  // planned, on the on-file water and a normal summer — one year at a time so
  // each builds on the one before. Only empty fields; a plan is never replaced.
  // A manager can switch it off for their browser.
  const [autoFill, setAutoFill] = useState(() => {
    try {
      return localStorage.getItem('rotation-autofill') !== 'off'
    } catch {
      return true
    }
  })
  const [autoNote, setAutoNote] = useState<string | null>(null)
  // Inserts only: a field someone planned since the page loaded keeps its plan.
  const fillQc = useQueryClient()
  const fill = useMutation({
    mutationFn: async (rows: { field_id: string; crop_year: number; crop_id: string; planned_acres: number | null }[]) => {
      const { data, error } = await supabase.from('crop_plans').upsert(rows, { onConflict: 'crop_year,field_id', ignoreDuplicates: true }).select('id')
      if (error) throw error
      return data?.length ?? 0
    },
    onSuccess: () => void fillQc.invalidateQueries({ queryKey: ['crop_plans'] }),
  })
  const tried = useRef(new Set<number>())
  useEffect(() => {
    if (!isManager || !autoFill || !ctx.ready || !plansFresh || fill.isPending) return
    for (const y of planYears.slice(1)) {
      if (tried.current.has(y)) continue
      const st = setupFor(y, null, false)
      if (!st) return
      const empty = st.fctx.filter((f) => !plannedFor(f.id, y))
      if (!empty.length) continue
      tried.current.add(y)
      const fixed = new Map<string, string>()
      for (const f of st.fctx) {
        const c = plannedFor(f.id, y)
        if (c) fixed.set(f.id, c)
      }
      const p = buildPlan('rotation', y, st.fctx, st.crops, pref, ctx.rulesByReg, st.max, st.groupMax, fixed, st.opts)
      const rows = p.assignments
        .filter((a) => a.cropId && !plannedFor(a.fieldId, y))
        .map((a) => ({ field_id: a.fieldId, crop_year: y, crop_id: a.cropId!, planned_acres: fieldAcres.get(a.fieldId) ?? null }))
      if (!rows.length) continue
      fill.mutate(rows, { onSuccess: (n) => setAutoNote((prev) => `${prev ? `${prev} ` : ''}Filled ${n} empty field${n === 1 ? '' : 's'} in ${y} with the Best-rotation pick.`) })
      return // one year at a time: the next waits for this one's plans to load
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useMutation({
    mutationFn: async () => {
      if (!requestText) throw new Error('Not ready')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/rotation-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: requestText,
      })
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !j.id) throw new Error(j.error ?? `Could not start the advice (${res.status})`)
      return j.id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rotation_advice', year] }),
  })

  if (!ctx.ready) return <p className="py-4 text-sm text-gray-400">Loading the farm&apos;s rotation data…</p>
  if (!plans) return null
  const plan = plans.out[objective]
  const cropName = (id: string | null | undefined) => ctx.cropInfo.find((c) => c.id === id)?.name ?? '—'

  const apply = (mode: 'empty' | 'all') => {
    // Filling the gaps: the fields already planned keep their crop and count
    // toward the acre limits, so the new crops fit around them.
    const fixed = new Map<string, string>()
    if (mode === 'empty') for (const f of plans.fctx) {
      const c = plannedFor(f.id, year)
      if (c) fixed.set(f.id, c)
    }
    const source = mode === 'empty' ? buildPlan(objective, year, plans.fctx, plans.crops, pref, ctx.rulesByReg, plans.max, plans.groupMax, fixed, plans.opts) : plan
    const rows = source.assignments
      .filter((a) => a.cropId && (mode === 'all' || !plannedFor(a.fieldId, year)))
      .map((a) => ({ field_id: a.fieldId, crop_year: year, crop_id: a.cropId!, planned_acres: fieldAcres.get(a.fieldId) ?? null }))
    if (!rows.length) return
    if (mode === 'all' && !confirm(`Replace the ${year} plan on ${rows.length} fields with the "${OBJECTIVE_LABEL[objective]}" plan?`)) return
    bulk.mutate(rows)
  }

  const cropsForLimits = ctx.cropInfo.filter((c) => c.key !== 'other')
  return (
    <section className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <h3 className="text-sm font-semibold text-gray-900">Rotation recommendations</h3>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" aria-label="Year">
          {planYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-600">
          Margin {money(plans.out[objective].margin)}
          {plan.unpriced > 0 && ` + ${n0(plan.unpriced)} ac with no margin set`}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {(['rotation', 'profit', 'soil'] as Objective[]).map((o) => {
          const p = plans.out[o]
          return (
            <button
              key={o}
              type="button"
              onClick={() => setObjective(o)}
              className={cn('rounded-md border bg-white p-2 text-left text-xs', o === objective ? 'border-violet-400 ring-1 ring-violet-300' : 'border-gray-200')}
            >
              <span className="block font-semibold text-gray-900">{OBJECTIVE_LABEL[o]}</span>
              <span className="block text-gray-600">
                {money(p.margin)} margin · {[...p.acres].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, ac]) => `${cropName(id)} ${n0(ac)}`).join(', ')}
              </span>
            </button>
          )
        })}
      </div>

      {/* Folded by default: it is read before planning, not on every visit.
          The summary says when a what-if is changing the plans, because the
          switches that set it are inside. */}
      <Fold
        title="Season outlook"
        storageKey="plan-season-outlook"
        bodyClassName="px-2 py-2"
        summary={[
          `Water, heat units and margins for ${year}`,
          whatIf != null ? `${whatIf}" allotment what-if on` : null,
          coolSummer ? 'planning for a cool summer' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
      <SeasonAhead
        ctx={ctx}
        year={year}
        plan={plan}
        water={plans.water}
        whatIf={whatIf}
        setWhatIf={setWhatIf}
        coolSummer={coolSummer}
        setCoolSummer={setCoolSummer}
        minAcres={plans.contracts}
        feed={plans.feed}
        fieldIds={plans.fctx.map((f) => f.id)}
        fieldNames={new Map(fields.map((f) => [f.id, f.name]))}
        isManager={isManager}
      />
      </Fold>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-2 py-1.5 font-medium">Field</th>
              <th className="px-2 py-1.5 font-medium">{year - 1}</th>
              <th className="px-2 py-1.5 font-medium">Planned now</th>
              <th className="px-2 py-1.5 font-medium">Recommended</th>
              <th className="px-2 py-1.5 font-medium">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plan.assignments.map((a) => {
              const f = plans.fctx.find((x) => x.id === a.fieldId)!
              const planned = plannedFor(a.fieldId, year)
              const e = a.evaluation
              return (
                <tr key={a.fieldId}>
                  <td className="px-2 py-1.5 text-gray-900">
                    {f.name}
                    <span className="block text-[10px] text-gray-400">
                      {n0(f.acres)} ac · {f.irrigated ? 'irrigated' : 'dryland'}
                      {f.sandy && ' · sandy'}
                      {f.ec != null && f.ec >= 1 && ` · EC ${f.ec.toFixed(1)}`}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-600">{(f.crops.get(year - 1) ?? []).map(cropName).join(', ') || '—'}</td>
                  <td className={cn('px-2 py-1.5', planned && planned !== a.cropId ? 'text-amber-700' : 'text-gray-600')}>{planned ? cropName(planned) : '—'}</td>
                  <td className="px-2 py-1.5 font-semibold text-gray-900">
                    {a.cropId ? cropName(a.cropId) : <span className="font-normal text-red-700">none</span>}
                    {e?.profit != null && <span className="block text-[10px] font-normal text-gray-500">{money(e.profit)}/ac</span>}
                  </td>
                  <td className="px-2 py-1.5 text-[11px] leading-snug text-gray-600">
                    {a.note && <span className="block">{a.note}</span>}
                    {(e?.plus ?? []).slice(0, 2).map((p, i) => (
                      <span key={i} className="block text-green-800">
                        + {p}
                      </span>
                    ))}
                    {(e?.cautions ?? []).slice(0, 2).map((c, i) => (
                      <span key={i} className="block text-amber-700">
                        ! {c}
                      </span>
                    ))}
                    {(e?.labels ?? []).map((l) => (
                      <button
                        key={l.registration}
                        type="button"
                        onClick={() => openChemicalLabel(l.registration)}
                        className="mr-2 inline-flex items-center gap-0.5 text-brand-700 underline hover:text-brand-800"
                      >
                        <FileText className="h-3 w-3" /> {l.product} label
                      </button>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {isManager && (
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={autoFill}
              onChange={(e) => {
                setAutoFill(e.target.checked)
                try {
                  localStorage.setItem('rotation-autofill', e.target.checked ? 'on' : 'off')
                } catch {
                  /* private window: the switch lasts this visit */
                }
              }}
            />
            Fill empty fields in the years ahead automatically (Best rotation; never replaces a plan)
          </label>
          {autoNote && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-900">{autoNote}</span>}
        </p>
      )}
      {isManager && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => apply('empty')} disabled={bulk.isPending} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
            Fill {year}&apos;s empty fields with this plan
          </button>
          <button type="button" onClick={() => apply('all')} disabled={bulk.isPending} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Replace all of {year} with this plan
          </button>
          <button
            type="button"
            onClick={() => ask.mutate()}
            disabled={ask.isPending || writing || !requestText}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" /> {ask.isPending || writing ? 'Claude is comparing…' : 'Ask Claude to compare the three'}
          </button>
        </div>
      )}
      {ask.error && <p className="text-xs text-red-700">{(ask.error as Error).message}</p>}
      {writing && (
        <p className="flex items-center gap-2 rounded-md border border-violet-200 bg-white p-3 text-xs text-gray-600">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />
          Claude is comparing the three plans. It takes about a minute and a half; you can leave this page and come back to it.
        </p>
      )}
      {(latest?.status === 'error' || stalled) && (
        <p className="text-xs text-red-700">
          The last request for advice did not finish: {stalled ? 'the job stopped without writing an answer' : latest?.error}. Ask again.
        </p>
      )}
      {lastDone && (
        <div className="rounded-md border border-violet-200 bg-white p-3">
          <p className="text-[11px] text-gray-500">
            Written {writtenAt(lastDone.finished_at ?? lastDone.created_at)}
            {lastDone.model && <AdminOnly>{` by ${lastDone.model}`}</AdminOnly>}
          </p>
          {outOfDate && (
            <p className="mt-1 text-[11px] font-medium text-amber-700">
              The plans or the season figures have changed since this was written. Ask again for advice on the ones shown here.
            </p>
          )}
          <Advice text={lastDone.advice!} />
        </div>
      )}

      <details className="rounded-md border border-gray-200 bg-white p-2">
        <summary className="cursor-pointer text-xs font-semibold text-gray-800">Acre limits and margins per crop</summary>
        <p className="mt-1 text-[11px] text-gray-500">
          The most of each crop you want or can grow in a year — every plan stays inside it. With no limit set, a plan keeps any one
          crop to 35% of the farm (50% in the profit plan) so it stays a rotation. Margins drive the &ldquo;most profitable&rdquo; plan;
          the seeded ones are Alberta&apos;s 2024 irrigated budget before land and capital, and crops it does not cover are blank until you set them.
          A renter&apos;s crop is never recommended; plan it by hand once a renter has the ground.
        </p>
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1 font-medium">Crop</th>
              <th className="py-1 text-right font-medium">Max acres / year</th>
              <th className="py-1 text-right font-medium">Margin $/ac</th>
              <th className="py-1 text-right font-medium" title="Gross irrigation in an average year, inches at the pivot: Alberta Agriculture's figure for southern Alberta (crop water use less Taber's normal rain, at an 84% pivot on a loam). Each field's water budget moves it for that field's soil, pivot efficiency and AIMM seasons. Typing a figure makes it the farm's own.">Water in/yr</th>
              <th className="py-1 text-right font-medium">Soil score</th>
              <th className="py-1 text-right font-medium" title="Grown here only by a renter: never recommended, still plannable by hand">Renter&apos;s crop</th>
              <th className="py-1 text-right font-medium" title="Grown for our own feed, not sold: its price is what the same feed would cost to buy">Own feed</th>
              <th className="py-1 text-right font-medium" title="Value the crop earns for a sister company (Seed Canola's leafcutter pollination goes to a pollination business — not commodity Canola's). Shown beside the margin, never added to it.">Sister co. $/ac</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {LIMIT_GROUPS.map((g) => {
              const lim = ctx.limits.find((l) => l.crop_group === g.group && l.crop_year == null)
              return (
                <tr key={g.group} className="bg-gray-50/60">
                  <td className="py-1 font-medium text-gray-800">{g.label}</td>
                  <td className="py-1 text-right">
                    <input
                      key={`${g.group}-${lim?.max_acres ?? ''}`}
                      defaultValue={lim?.max_acres ?? ''}
                      disabled={!isManager}
                      inputMode="decimal"
                      placeholder="no limit"
                      onBlur={(e) => {
                        const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                        if (v !== (lim ? Number(lim.max_acres) : null)) setGroupLimit.mutate({ group: g.group, maxAcres: v })
                      }}
                      className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                    />
                  </td>
                  <td colSpan={6} className="py-1 pl-3 text-[10px] text-gray-400">one limit across every crop in the group</td>
                </tr>
              )
            })}
            {cropsForLimits.map((c) => {
              const lim = ctx.limits.find((l) => l.crop_id === c.id && l.crop_year == null)
              const soil = SOIL_SCORE[c.key]
              return (
                <tr key={c.id}>
                  <td className="py-1 text-gray-800">{c.name}</td>
                  <td className="py-1 text-right">
                    <input
                      key={`${c.id}-${lim?.max_acres ?? ''}`}
                      defaultValue={lim?.max_acres ?? ''}
                      disabled={!isManager}
                      inputMode="decimal"
                      placeholder="no limit"
                      onBlur={(e) => {
                        const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                        if (v !== (lim ? Number(lim.max_acres) : null)) setLimit.mutate({ cropId: c.id, maxAcres: v })
                      }}
                      className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <input
                      key={`${c.id}-m-${c.margin ?? ''}`}
                      defaultValue={c.margin ?? ''}
                      disabled={!isManager}
                      inputMode="decimal"
                      placeholder="set"
                      title={ctx.marginSource.get(c.id) ?? undefined}
                      onBlur={(e) => {
                        const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                        if (v !== c.margin) setMargin.mutate({ cropId: c.id, margin: v })
                      }}
                      className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <input
                      key={`${c.id}-w-${c.waterNeedIn ?? ''}`}
                      defaultValue={c.waterNeedIn ?? ''}
                      disabled={!isManager}
                      inputMode="decimal"
                      placeholder="set"
                      onBlur={(e) => {
                        const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                        if (v !== (c.waterNeedIn ?? null)) setWaterNeed.mutate({ cropId: c.id, inches: v })
                      }}
                      className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                    />
                  </td>
                  <td className="py-1 text-right tabular-nums text-gray-600">
                    {soil.score}
                    {!soil.measured && <span className="text-gray-400">*</span>}
                  </td>
                  <td className="py-1 text-right">
                    <input
                      type="checkbox"
                      checked={Boolean(c.renterOnly)}
                      disabled={!isManager || setRenterOnly.isPending}
                      onChange={(e) => setRenterOnly.mutate({ cropId: c.id, renterOnly: e.target.checked })}
                      aria-label={`${c.name} is grown here only by a renter`}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <input
                      type="checkbox"
                      checked={ctx.marginBasis(c.id, year).ownUse}
                      disabled={!isManager || setOwnUse.isPending}
                      onChange={(e) => setOwnUse.mutate({ cropId: c.id, ownUse: e.target.checked })}
                      aria-label={`${c.name} is grown for our own feed`}
                    />
                  </td>
                  <td className="py-1 text-right">
                    {(() => {
                      const sv = ctx.sisterValue.get(c.id)
                      return (
                        <input
                          key={`${c.id}-s-${sv?.perAcre ?? ''}`}
                          defaultValue={sv?.perAcre ?? ''}
                          disabled={!isManager}
                          inputMode="decimal"
                          placeholder={sv?.note ? 'set' : '—'}
                          title={sv?.note ?? 'Value to a sister company, not counted in RVR\'s margin'}
                          onBlur={(e) => {
                            const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                            if (v !== (sv?.perAcre ?? null)) setSister.mutate({ cropId: c.id, perAcre: v })
                          }}
                          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                        />
                      )
                    })()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-gray-400">
          * Soil scores are estimates where the Vauxhall study did not measure the crop (carbon returned and residue left). Full sources in the
          rotation report.
        </p>
      </details>
    </section>
  )
}
