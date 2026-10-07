import { DateField } from '@/components/DateField'
import { cropColour } from '@/lib/crop-colour'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileText, Settings2, Sparkles, Wand2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { Modal } from '@/components/Modal'
import { openChemicalLabel } from '@/lib/chemicals'
import type { Violation } from '@/lib/rotation'
import { SoilMoistureEntry } from '@/components/SoilMoistureEntry'
import { useCropYear } from '@/lib/crop-year'
import { useAllCropZones } from '@/lib/cropZones'
import {
  boundariesForYear,
  useAllBoundaries,
  useCropHistoryByYear,
  useCropPlans,
  useCrops,
  useFields,
} from '@/lib/queries'
import {
  buildSuccessionMap,
  buildSuccessionNotes,
  checkPlacement,
  suggestCrop,
  useBulkSetRotation,
  useFieldInspections,
  useSetCropReturnYears,
  useSetCropRotationSettings,
  useSetFieldInspection,
  useSetRotationCrop,
  useSuccessionMutations,
  useSuccessionRules,
  type CropInfo,
  type Preference,
  type FieldInspection,
} from '@/lib/rotation'
import { cn } from '@/lib/utils'
import { RotationAdvisor } from '@/pages/plan/RotationAdvisor'
import { useRotationContext } from '@/lib/rotation-context'
import { carryover, cropKey, groupOf, LIMIT_GROUPS, scoutHits } from '@/lib/rotation-engine'
import { volunteerConflicts } from '@/lib/canola-trait'
import { supabase } from '@/lib/supabase'
import { EMPTY_SOIL_READING, readingProblem, readingToMm, useFieldCapacity, useSaveSoilReading } from '@/lib/soil-moisture'
import { useUnitSystem } from '@/lib/units'

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')

export function RotationPlanner({ isManager }: { isManager: boolean }) {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: rules } = useSuccessionRules()
  const { data: allZones } = useAllCropZones()
  const { data: inspections } = useFieldInspections()
  const setInspection = useSetFieldInspection()
  const [inspecting, setInspecting] = useState<{
    fieldId: string
    fieldName: string
    year: number
    cropId: string | null
  } | null>(null)

  const inspByFieldYear = useMemo(() => {
    const m = new Map<string, FieldInspection>()
    for (const i of inspections ?? []) m.set(`${i.field_id}:${i.crop_year}`, i)
    return m
  }, [inspections])

  // (field_id, year) → the crop zones splitting that field (multi-crop fields).
  const zonesByFieldYear = useMemo(() => {
    const m = new Map<string, { crop_id: string; acres: number }[]>()
    for (const z of allZones ?? []) {
      const k = `${z.field_id}:${z.crop_year}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push({ crop_id: z.crop_id, acres: Number(z.acres ?? 0) })
    }
    return m
  }, [allZones])

  const { planYears, allYears } = useMemo(() => {
    const planYears = [cropYear, cropYear + 1, cropYear + 2, cropYear + 3]
    return { planYears, allYears: [cropYear - 2, cropYear - 1, ...planYears] }
  }, [cropYear])

  // Fixed-count hooks for the six columns.
  const h2 = useCropHistoryByYear(cropYear - 2)
  const h1 = useCropHistoryByYear(cropYear - 1)
  const p0 = useCropPlans(cropYear)
  const p1 = useCropPlans(cropYear + 1)
  const p2 = useCropPlans(cropYear + 2)
  const p3 = useCropPlans(cropYear + 3)

  const setCrop = useSetRotationCrop()
  const bulk = useBulkSetRotation()

  const activeCrops = useMemo<CropInfo[]>(
    () =>
      (crops ?? [])
        .filter((c) => c.active)
        .map((c) => ({
          id: c.id,
          name: c.name,
          min_return_years: c.min_return_years,
          max_in_a_row: c.max_in_a_row ?? 1,
          stand_max_years: c.stand_max_years ?? null,
          color: c.color,
        })),
    [crops],
  )
  const cropMap = useMemo(() => new Map(activeCrops.map((c) => [c.id, c])), [activeCrops])
  const succession = useMemo(() => buildSuccessionMap(rules ?? []), [rules])
  const successionNotes = useMemo(() => buildSuccessionNotes(rules ?? []), [rules])
  const ctx = useRotationContext(cropYear)
  const [showAdvisor, setShowAdvisor] = useState(true)
  // The crop cell whose rule breaks are open, with their label links.
  const [alertCell, setAlertCell] = useState<{ title: string; violations: Violation[] } | null>(null)

  /** Every rule a planned crop breaks: rotation, succession (with reasons), and herbicide carryover. */
  const problems = (fieldId: string, cid: string, y: number, sets: Map<number, Set<string>>) => {
    const v = checkPlacement(cid, y, sets, cropMap, succession, successionNotes)
    if (ctx.ready) {
      const name = cropMap.get(cid)?.name ?? ''
      for (const h of scoutHits(cropKey(name), ctx.scoutingByField.get(fieldId) ?? [], y)) {
        v.push(h.block ? { kind: 'succession', message: `🔎 ${h.message}` } : { kind: 'caution', message: `🔎 ${h.message}` })
      }
      for (const h of carryover(cropKey(name), ctx.appsByField.get(fieldId) ?? [], ctx.rulesByReg, `${y}-05-01`)) {
        const label = { registration: h.registration, quote: h.quote }
        v.push(h.block ? { kind: 'herbicide', message: h.message, ...label } : { kind: 'caution', message: `🧪 ${h.message}`, ...label })
      }
      // Seed canola on a field whose recent canola had the same herbicide trait.
      const trait = ctx.traitOf(cid)
      if (trait) {
        for (const m of volunteerConflicts({ name, trait }, y, ctx.canolaYears(fieldId, sets))) v.push({ kind: 'caution', message: m })
      }
    }
    return v
  }

  // field_id → acres (from the current boundary).
  const fieldAcres = useMemo(() => {
    const b = boundariesForYear(allBoundaries ?? [], cropYear)
    const m = new Map<string, number>()
    for (const bd of b) m.set(bd.field_id, Number(bd.acres ?? 0))
    return m
  }, [allBoundaries, cropYear])

  // field_id → (year → crop_id), from history + plans.
  const timelines = useMemo(() => {
    const m = new Map<string, Map<number, string>>()
    const put = (fid: string, year: number, cid: string | null | undefined) => {
      if (!cid) return
      if (!m.has(fid)) m.set(fid, new Map())
      m.get(fid)!.set(year, cid)
    }
    ;(h2.data ?? []).forEach((r) => put(r.field_id, cropYear - 2, r.crop_id))
    ;(h1.data ?? []).forEach((r) => put(r.field_id, cropYear - 1, r.crop_id))
    ;(p0.data ?? []).forEach((r) => put(r.field_id, cropYear, r.crop_id))
    ;(p1.data ?? []).forEach((r) => put(r.field_id, cropYear + 1, r.crop_id))
    ;(p2.data ?? []).forEach((r) => put(r.field_id, cropYear + 2, r.crop_id))
    ;(p3.data ?? []).forEach((r) => put(r.field_id, cropYear + 3, r.crop_id))
    return m
  }, [h2.data, h1.data, p0.data, p1.data, p2.data, p3.data, cropYear])

  // field_id → (year → set of crops that year). A split field carries several
  // crops in one year; used for rule checks (succession must follow each of them).
  const cropSetsByField = useMemo(() => {
    const m = new Map<string, Map<number, Set<string>>>()
    for (const f of fields ?? []) {
      const byYear = new Map<number, Set<string>>()
      for (const y of allYears) {
        const zones = zonesByFieldYear.get(`${f.id}:${y}`)
        if (zones && zones.length) byYear.set(y, new Set(zones.map((z) => z.crop_id)))
        else {
          const cid = timelines.get(f.id)?.get(y)
          if (cid) byYear.set(y, new Set([cid]))
        }
      }
      m.set(f.id, byYear)
    }
    return m
  }, [fields, timelines, zonesByFieldYear, allYears])

  // Per-year acres by crop (the forecast the user asked for). A split field
  // contributes its zone acres per crop; otherwise the whole field's acres go to
  // its single planned/historical crop.
  const totals = useMemo(() => {
    const byYear = new Map<number, Map<string, number>>(allYears.map((y) => [y, new Map()]))
    const addAc = (y: number, cid: string, ac: number) => {
      const ym = byYear.get(y)!
      ym.set(cid, (ym.get(cid) ?? 0) + ac)
    }
    for (const f of fields ?? []) {
      const tl = timelines.get(f.id)
      const ac = fieldAcres.get(f.id) ?? 0
      for (const y of allYears) {
        const zones = zonesByFieldYear.get(`${f.id}:${y}`)
        if (zones && zones.length) {
          for (const z of zones) addAc(y, z.crop_id, z.acres)
        } else {
          const cid = tl?.get(y)
          if (cid) addAc(y, cid, ac)
        }
      }
    }
    return byYear
  }, [fields, timelines, fieldAcres, allYears, zonesByFieldYear])

  const cropsInPlan = useMemo(() => {
    const ids = new Set<string>()
    for (const ym of totals.values()) for (const id of ym.keys()) ids.add(id)
    return activeCrops.filter((c) => ids.has(c.id))
  }, [totals, activeCrops])

  const [showRules, setShowRules] = useState(false)

  const cropOptions = [
    { value: '', label: '—' },
    ...activeCrops.map((c) => ({ value: c.id, label: c.name })),
  ]

  const cellColor = (cid: string | undefined) => (cid ? cropColour(cropMap.get(cid)) : undefined)

  // Clickable inspection dot: grey = none/pending, green = passed, red = failed.
  const inspBadge = (fieldId: string, fieldName: string, year: number, cid: string | undefined) => {
    const insp = inspByFieldYear.get(`${fieldId}:${year}`)
    const dot =
      insp?.status === 'passed'
        ? 'bg-green-500'
        : insp?.status === 'failed'
          ? 'bg-red-500'
          : 'border border-gray-300 bg-white'
    const title = insp
      ? `Inspection: ${insp.status}${insp.rating ? ` · ${insp.rating}` : ''}${insp.notes ? ` — ${insp.notes}` : ''}`
      : 'Record crop inspection'
    return (
      <button
        onClick={() => setInspecting({ fieldId, fieldName, year, cropId: cid ?? null })}
        title={title}
        aria-label="Crop inspection"
        className="shrink-0"
      >
        <span className={cn('inline-block h-2.5 w-2.5 rounded-full', dot)} />
      </button>
    )
  }

  const suggestEmpty = () => {
    const rows: {
      field_id: string
      crop_year: number
      crop_id: string
      planned_acres: number | null
    }[] = []
    for (const f of fields ?? []) {
      // Clone the field's crop-sets so later years see earlier suggestions.
      const sets = new Map<number, Set<string>>()
      for (const [y, s] of cropSetsByField.get(f.id) ?? []) sets.set(y, new Set(s))
      for (const y of planYears) {
        if (sets.get(y)?.size) continue // already planned (or a split year)
        const cid = suggestCrop(y, sets, activeCrops, cropMap, succession)
        if (cid) {
          sets.set(y, new Set([cid]))
          rows.push({
            field_id: f.id,
            crop_year: y,
            crop_id: cid,
            planned_acres: fieldAcres.get(f.id) ?? null,
          })
        }
      }
    }
    if (rows.length) bulk.mutate(rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          Plan crops {planYears[0]}–{planYears[3]} across your fields. Past two years are shown for
          context; cells that break a rotation rule are flagged.
        </p>
        {isManager && (
          <div className="flex gap-2">
            <button
              onClick={suggestEmpty}
              disabled={bulk.isPending}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />{' '}
              {bulk.isPending ? 'Filling…' : 'Suggest empty cells'}
            </button>
            <button
              onClick={() => setShowAdvisor((s) => !s)}
              className="flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100"
            >
              <Sparkles className="h-3.5 w-3.5" /> {showAdvisor ? 'Hide recommendations' : 'Recommend a rotation'}
            </button>
            <button
              onClick={() => setShowRules((s) => !s)}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Settings2 className="h-3.5 w-3.5" /> Rotation rules
            </button>
          </div>
        )}
      </div>

      {showRules && (
        <RotationRules isManager={isManager} crops={activeCrops} succession={succession} notes={successionNotes} />
      )}

      {showAdvisor && (
        <RotationAdvisor
          isManager={isManager}
          planYears={planYears}
          fields={(fields ?? []).map((f) => ({ id: f.id, name: f.name }))}
          fieldAcres={fieldAcres}
          cropSetsByField={cropSetsByField}
          succession={succession}
          notes={successionNotes}
          plannedFor={(fid, y) => timelines.get(fid)?.get(y)}
          // Auto-fill acts only on plans read from the server this visit, not
          // on the offline copy the page opens with.
          plansFresh={[p1, p2, p3].every((q) => q.isFetchedAfterMount && !q.isFetching)}
        />
      )}

      <p className="flex flex-wrap gap-x-4 text-[11px] text-gray-500">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-50 ring-2 ring-red-400" />
          breaks a rule — rotation, crop after crop, or herbicide carryover (hover for the product and the label&apos;s reason)
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-amber-400" />
          caution
        </span>
      </p>

      {/* Planner grid */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-2 py-2 text-right font-medium">Acres</th>
              {allYears.map((y) => (
                <th
                  key={y}
                  className={cn(
                    'px-2 py-2 text-center font-medium',
                    y < cropYear && 'text-gray-300',
                  )}
                >
                  {y}
                  {y < cropYear && <span className="ml-1 normal-case">(history)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(fields ?? []).map((f) => {
              const tl = timelines.get(f.id) ?? new Map<number, string>()
              const sets = cropSetsByField.get(f.id) ?? new Map<number, Set<string>>()
              return (
                <tr key={f.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-gray-900">{f.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                    {n0(fieldAcres.get(f.id) ?? 0)}
                  </td>
                  {allYears.map((y) => {
                    const cid = tl.get(y)
                    const isHist = y < cropYear
                    const zones = zonesByFieldYear.get(`${f.id}:${y}`)
                    if (zones && zones.length) {
                      return (
                        <td key={y} className="px-2 py-1.5 text-center">
                          <span
                            className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600"
                            title={`Split: ${zones.map((z) => `${cropMap.get(z.crop_id)?.name ?? 'crop'} ${Math.round(z.acres)}ac`).join(', ')} — edit on the map`}
                          >
                            {zones.map((z, i) => (
                              <span
                                key={i}
                                className="h-2 w-2 rounded-full"
                                style={{ background: cropColour(cropMap.get(z.crop_id)) }}
                              />
                            ))}
                            split · {zones.length}
                          </span>
                        </td>
                      )
                    }
                    if (isHist) {
                      return (
                        <td key={y} className="px-2 py-1.5 text-center">
                          {cid ? (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: cellColor(cid) ?? '#cbd5e1' }}
                              />
                              {cropMap.get(cid)?.name ?? '—'}
                              {inspBadge(f.id, f.name, y, cid)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      )
                    }
                    const violations = cid ? problems(f.id, cid, y, sets) : []
                    const bad = violations.some((v) => v.kind !== 'caution')
                    const warn = !bad && violations.length > 0
                    return (
                      <td key={y} className="px-1 py-1">
                        <div
                          className={cn('rounded-md', bad ? 'bg-red-50 ring-2 ring-red-400' : warn && 'ring-1 ring-amber-400')}
                          title={violations.length ? violations.map((v) => `${v.kind === 'herbicide' ? '🧪 ' : v.kind === 'caution' ? '⚠ ' : '⛔ '}${v.message}`).join('\n') : undefined}
                        >
                          <div className="flex items-center gap-1">
                            <Select
                              value={cid ?? ''}
                              size="sm"
                              disabled={!isManager}
                              ariaLabel={`${f.name} ${y} crop`}
                              className="min-w-[7rem] flex-1"
                              onChange={(v) =>
                                setCrop.mutate({
                                  field_id: f.id,
                                  crop_year: y,
                                  crop_id: v || null,
                                  planned_acres: v ? (fieldAcres.get(f.id) ?? null) : null,
                                })
                              }
                              options={cropOptions}
                            />
                            {(bad || warn) && (
                              <button
                                type="button"
                                onClick={() => setAlertCell({ title: `${f.name} · ${y} · ${cropMap.get(cid!)?.name ?? ''}`, violations })}
                                aria-label="What this crop breaks, with the labels"
                                className="shrink-0 rounded hover:bg-white"
                              >
                                <AlertTriangle className={cn('h-3.5 w-3.5', bad ? 'text-red-500' : 'text-amber-500')} />
                              </button>
                            )}
                            {cid && inspBadge(f.id, f.name, y, cid)}
                            {!cid && isManager && (
                              <button
                                title="Suggest a valid crop"
                                onClick={() => {
                                  const s = suggestCrop(y, sets, activeCrops, cropMap, succession)
                                  if (s)
                                    setCrop.mutate({
                                      field_id: f.id,
                                      crop_year: y,
                                      crop_id: s,
                                      planned_acres: fieldAcres.get(f.id) ?? null,
                                    })
                                }}
                                className="shrink-0 text-gray-300 hover:text-brand-700"
                              >
                                <Wand2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Acres per crop per year (the forecast) */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Total acres by crop &amp; year</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-medium">Crop</th>
                <th className="px-2 py-2 text-right font-medium">Max / yr</th>
                {allYears.map((y) => (
                  <th
                    key={y}
                    className={cn(
                      'px-2 py-2 text-right font-medium',
                      y < cropYear && 'text-gray-300',
                    )}
                  >
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cropsInPlan.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: cropColour(c) }}
                      />
                      {c.name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                    {ctx.ready && ctx.maxFor(c.id, cropYear) != null ? n0(ctx.maxFor(c.id, cropYear)!) : '—'}
                  </td>
                  {allYears.map((y) => {
                    const a = totals.get(y)?.get(c.id) ?? 0
                    const max = ctx.ready && y >= cropYear ? ctx.maxFor(c.id, y) : null
                    const over = max != null && a > max + 0.5
                    return (
                      <td
                        key={y}
                        className={cn(
                          'px-2 py-1.5 text-right tabular-nums',
                          y < cropYear ? 'text-gray-400' : over ? 'bg-red-50 font-semibold text-red-700' : 'text-gray-800',
                        )}
                        title={over ? `Over the ${n0(max!)} ac limit by ${n0(a - max!)}` : undefined}
                      >
                        {a > 0 ? n0(a) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {ctx.ready &&
                LIMIT_GROUPS.filter((g) => ctx.groupMaxFor(cropYear).has(g.group)).map((g) => {
                  const inGroup = cropsInPlan.filter((c) => groupOf(cropKey(c.name)) === g.group)
                  const cap = ctx.groupMaxFor(cropYear).get(g.group)!
                  return (
                    <tr key={g.group} className="border-t border-gray-200 bg-gray-50/60">
                      <td className="px-3 py-1.5 font-medium text-gray-700">{g.label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(cap)}</td>
                      {allYears.map((y) => {
                        const a = inGroup.reduce((sum, c) => sum + (totals.get(y)?.get(c.id) ?? 0), 0)
                        const max = y >= cropYear ? ctx.groupMaxFor(y).get(g.group) : undefined
                        const over = max != null && a > max + 0.5
                        return (
                          <td
                            key={y}
                            className={cn(
                              'px-2 py-1.5 text-right tabular-nums',
                              y < cropYear ? 'text-gray-400' : over ? 'bg-red-50 font-semibold text-red-700' : 'text-gray-800',
                            )}
                            title={over ? `Over the ${n0(max!)} ac limit by ${n0(a - max!)}` : undefined}
                          >
                            {a > 0 ? n0(a) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-3 py-2">Total planned</td>
                <td />
                {allYears.map((y) => {
                  const sum = [...(totals.get(y)?.values() ?? [])].reduce((s, v) => s + v, 0)
                  return (
                    <td key={y} className="px-2 py-2 text-right tabular-nums">
                      {sum > 0 ? n0(sum) : '—'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {alertCell && <RuleBreaks title={alertCell.title} violations={alertCell.violations} onClose={() => setAlertCell(null)} />}
      {inspecting && (
        <InspectionModal
          isManager={isManager}
          fieldId={inspecting.fieldId}
          fieldName={inspecting.fieldName}
          year={inspecting.year}
          cropName={inspecting.cropId ? (cropMap.get(inspecting.cropId)?.name ?? null) : null}
          existing={inspByFieldYear.get(`${inspecting.fieldId}:${inspecting.year}`) ?? null}
          onClose={() => setInspecting(null)}
          onSave={(patch) =>
            setInspection.mutate(
              {
                field_id: inspecting.fieldId,
                crop_year: inspecting.year,
                crop_id: inspecting.cropId,
                ...patch,
              },
              { onSuccess: () => setInspecting(null) },
            )
          }
        />
      )}
    </div>
  )
}

/**
 * What a planned crop breaks, opened from its warning icon: rotation and
 * crop-after-crop rules, scouting, and herbicide carryover — each sprayed
 * product with its label one click away (the current PMRA label, looked up at
 * the click) and the label's own words behind the rule.
 */
function RuleBreaks({ title, violations, onClose }: { title: string; violations: Violation[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <ul className="space-y-2 text-sm">
        {violations.map((v, i) => (
          <li key={i} className={cn('rounded-md border px-3 py-2', v.kind === 'caution' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50')}>
            <p className="text-gray-800">
              {v.kind === 'herbicide' ? '🧪 ' : v.kind === 'caution' ? '' : '⛔ '}
              {v.message}
            </p>
            {v.quote && <p className="mt-1 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600">&ldquo;{v.quote}&rdquo;</p>}
            {v.registration && (
              <button
                type="button"
                onClick={() => openChemicalLabel(v.registration!)}
                className="mt-1.5 inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-gray-50"
              >
                <FileText className="h-3.5 w-3.5" /> Open the label (PCP {v.registration})
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-gray-400">
        Labels open from Health Canada&apos;s pesticide registry, the current version at the moment you click.
      </p>
    </Modal>
  )
}

function InspectionModal({
  isManager,
  fieldId,
  fieldName,
  year,
  cropName,
  existing,
  onClose,
  onSave,
}: {
  isManager: boolean
  fieldId: string
  fieldName: string
  year: number
  cropName: string | null
  existing: FieldInspection | null
  onClose: () => void
  onSave: (patch: {
    status: string
    rating: string | null
    notes: string | null
    inspected_on: string | null
  }) => void
}) {
  const [status, setStatus] = useState(existing?.status ?? 'pending')
  const [rating, setRating] = useState(existing?.rating ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [on, setOn] = useState(existing?.inspected_on ?? '')
  // Optional soil moisture, filed as an AIMM reading on the inspection day
  // (today if none is set). Only for this season: a reading on an old or a
  // planned year's inspection has no balance to correct.
  const today = new Date().toLocaleDateString('en-CA')
  const readOn = on || today
  const soilSeason = year === Number(today.slice(0, 4)) && readOn <= today
  const [soil, setSoil] = useState(EMPTY_SOIL_READING)
  const u = useUnitSystem()
  const fc = useFieldCapacity(fieldId)
  const saveSoil = useSaveSoilReading()
  const soilMm = soilSeason ? readingToMm(soil, fc, u) : null
  const soilProblem = soilSeason ? readingProblem(soil, fc, u) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Crop inspection</h2>
        <p className="text-xs text-gray-500">
          {fieldName} · {year}
          {cropName ? ` · ${cropName}` : ''}
        </p>
        <div className="mt-3 space-y-3">
          <div className="flex rounded-md border border-gray-200 p-0.5 text-sm">
            {(['pending', 'passed', 'failed'] as const).map((s) => (
              <button
                key={s}
                disabled={!isManager}
                onClick={() => setStatus(s)}
                className={cn(
                  'flex-1 rounded px-3 py-1 capitalize',
                  status === s
                    ? s === 'passed'
                      ? 'bg-green-600 font-semibold text-white'
                      : s === 'failed'
                        ? 'bg-red-600 font-semibold text-white'
                        : 'bg-gray-700 font-semibold text-white'
                    : 'text-gray-600',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">
              Rating
              <input
                value={rating}
                disabled={!isManager}
                onChange={(e) => setRating(e.target.value)}
                placeholder="e.g. clean / grade / % volunteers"
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Inspected on
              <DateField
                value={on}
                onChange={(v) => setOn(v)}
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
          </div>
          <label className="block text-xs text-gray-500">
            Notes
            <textarea
              value={notes}
              disabled={!isManager}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Volunteers found, isolation, actions taken, why it failed even after the 4-year gap…"
              className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          {soilSeason && (
            <SoilMoistureEntry
              fieldId={fieldId}
              value={soil}
              onChange={setSoil}
              disabled={!isManager}
              readOnLabel={readOn === today ? 'today' : new Date(`${readOn}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
            />
          )}
          {saveSoil.error && <p className="text-xs text-red-700">Soil moisture not saved: {(saveSoil.error as Error).message}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {isManager ? 'Cancel' : 'Close'}
          </button>
          {isManager && (
            <button
              disabled={saveSoil.isPending || !!soilProblem}
              onClick={async () => {
                if (soilMm != null) {
                  try {
                    await saveSoil.mutateAsync({
                      fieldId,
                      readOn,
                      mm: soilMm,
                      fc,
                      method: soil.method,
                      note: soil.note.trim() || 'From a crop inspection',
                    })
                  } catch {
                    return
                  }
                }
                onSave({
                  status,
                  rating: rating.trim() || null,
                  notes: notes.trim() || null,
                  inspected_on: on || null,
                })
              }}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {saveSoil.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Rotation-rule settings: per-crop return interval + the crop-after-crop matrix. */
function RotationRules({
  isManager,
  crops,
  succession,
  notes,
}: {
  isManager: boolean
  crops: CropInfo[]
  succession: ReturnType<typeof buildSuccessionMap>
  notes: ReturnType<typeof buildSuccessionNotes>
}) {
  const setReturn = useSetCropReturnYears()
  const setSettings = useSetCropRotationSettings()
  const { data: allCrops } = useCrops()
  const { setPreference } = useSuccessionMutations()
  const [reading, setReading] = useState<string | null>(null)
  const qc = useQueryClient()
  const poll = useRef<number | null>(null)
  useEffect(() => () => void (poll.current != null && window.clearInterval(poll.current)), [])
  const CYCLE: (Preference | null)[] = [null, 'recommended', 'caution', 'no_go']
  const STYLE: Record<string, string> = {
    recommended: 'bg-green-500 text-white',
    possible: 'bg-green-100 text-green-800',
    caution: 'bg-amber-300 text-amber-950',
    no_go: 'bg-red-600 text-white',
  }
  const LETTER: Record<string, string> = { recommended: 'R', possible: 'ok', caution: 'C', no_go: 'N' }
  const readLabels = async () => {
    setReading('Starting…')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const res = await fetch('/.netlify/functions/recrop-extract-background', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    const started = res.ok || res.status === 202
    setReading(started ? 'Reading every label in the background — about 15 minutes; red cells appear as rules come in.' : `Could not start (${res.status})`)
    if (!started) return
    // The rotation data is cached (offline too), so pull the new rules in as
    // they land rather than whenever the cache next goes stale.
    let ticks = 0
    if (poll.current != null) window.clearInterval(poll.current)
    poll.current = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
      void qc.invalidateQueries({ queryKey: ['chemical_recrop_rules'] })
      if (++ticks >= 30 && poll.current != null) window.clearInterval(poll.current)
    }, 60_000)
  }

  return (
    <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Return, repeats and stands</h3>
        <p className="mb-2 text-xs text-gray-500">
          <b>Return</b>: years before the same crop comes back after it leaves (all beans count as one crop, canola with seed canola). <b>In a row</b>: years it may
          run back to back (1 = never twice). <b>Stand</b>: a perennial kept in at least the first number of years and taken out after the second.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1 font-medium">Crop</th>
                <th className="py-1 text-right font-medium">Return (yrs)</th>
                <th className="py-1 text-right font-medium">In a row</th>
                <th className="py-1 text-right font-medium">Stand min</th>
                <th className="py-1 text-right font-medium">Stand max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {crops.map((c) => {
                const full = allCrops?.find((x) => x.id === c.id)
                const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))))
                const box = 'w-14 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums'
                return (
                  <tr key={c.id}>
                    <td className="py-1 text-gray-800">{c.name}</td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        min={0}
                        max={12}
                        disabled={!isManager}
                        defaultValue={c.min_return_years}
                        onBlur={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value)))
                          if (v !== c.min_return_years) setReturn.mutate({ id: c.id, min_return_years: v })
                        }}
                        className={box}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        max={6}
                        disabled={!isManager}
                        defaultValue={full?.max_in_a_row ?? 1}
                        onBlur={(e) => {
                          const v = Math.min(6, Math.max(1, Math.round(Number(e.target.value) || 1)))
                          if (v !== (full?.max_in_a_row ?? 1)) setSettings.mutate({ id: c.id, max_in_a_row: v })
                        }}
                        className={box}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        max={10}
                        placeholder="—"
                        disabled={!isManager}
                        defaultValue={full?.stand_min_years ?? ''}
                        onBlur={(e) => {
                          const v = num(e.target.value)
                          if (v !== (full?.stand_min_years ?? null)) setSettings.mutate({ id: c.id, stand_min_years: v || null })
                        }}
                        className={box}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        placeholder="—"
                        disabled={!isManager}
                        defaultValue={full?.stand_max_years ?? ''}
                        onBlur={(e) => {
                          const v = num(e.target.value)
                          if (v !== (full?.stand_max_years ?? null)) setSettings.mutate({ id: c.id, stand_max_years: v || null })
                        }}
                        className={box}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900">Which crop can follow which</h3>
        <p className="mb-2 text-xs text-gray-500">
          Rows are last year&apos;s crop, columns the crop planted after it. <b className="text-green-700">R</b> recommended,{' '}
          <b className="text-amber-700">C</b> caution, <b className="text-red-700">N</b> never, blank = no rule. Hover a cell for the reason and
          whether it came from your rotation sheet or the research report. {isManager && 'Click to change.'}
        </p>
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-gray-500">
                  prev ↓ / next →
                </th>
                {crops.map((c) => (
                  <th key={c.id} className="px-1 py-1 font-medium text-gray-500">
                    <span className="block max-w-[3.5rem] truncate" title={c.name}>
                      {c.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crops.map((prev) => (
                <tr key={prev.id} className="border-t border-gray-100">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-gray-700">
                    <span className="block max-w-[8rem] truncate" title={prev.name}>
                      {prev.name}
                    </span>
                  </th>
                  {crops.map((next) => {
                    const p = succession.get(prev.id)?.get(next.id) ?? null
                    const n = notes.get(`${prev.id}>${next.id}`)
                    const title = p
                      ? `${prev.name} → ${next.name}: ${p.replace('_', ' ')}${n?.notes ? ` — ${n.notes}` : ''} [${n?.source === 'research' ? 'research report' : n?.source === 'suggested' ? 'suggested by Claude — click to change' : 'your rotation sheet'}]`
                      : `${prev.name} → ${next.name}: no rule`
                    return (
                      <td key={next.id} className="px-0.5 py-0.5 text-center">
                        <button
                          type="button"
                          disabled={!isManager}
                          title={title}
                          onClick={() => {
                            const i = CYCLE.indexOf(p === 'possible' ? null : p)
                            setPreference.mutate({ prev: prev.id, next: next.id, preference: CYCLE[(i + 1) % CYCLE.length] as 'recommended' | 'caution' | 'no_go' | null })
                          }}
                          className={cn('h-6 w-8 rounded text-[10px] font-semibold', p ? STYLE[p] : 'bg-gray-50 text-gray-300 hover:bg-gray-100', n?.source === 'research' && 'underline decoration-dotted', n?.source === 'suggested' && 'opacity-70 outline outline-1 outline-dashed outline-violet-500')}
                        >
                          {p ? LETTER[p] : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          Dotted underline = from the research report (Southern Alberta crop rotation, Table 3). Dashed purple outline = a suggestion filling a cell your sheet left
          empty; click it to set your own.
        </p>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700">
        <b>Herbicide carryover</b> comes from the product labels: what each label says may be planted after it, how many months later, and
        under what conditions. Planned crops that clash with a product sprayed on the field in the last four years turn red.
        {isManager && (
          <button type="button" onClick={readLabels} className="ml-2 rounded border border-gray-300 px-2 py-0.5 font-medium text-brand-700 hover:bg-gray-50">
            Read re-cropping rules from the labels
          </button>
        )}
        {reading && <span className="ml-2 text-gray-500">{reading}</span>}
      </div>
    </div>
  )
}
