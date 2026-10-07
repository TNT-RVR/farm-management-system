import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { Download, Loader2, Plus, Trash2 } from 'lucide-react'
import type { Geometry } from 'geojson'
import { DetailList, rowClick, type EditField } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { useAuth, hasManagerAccess } from '@/lib/auth'
import {
  convertYield,
  economicOptimum,
  fitBuffer,
  fitQuadratic,
  leachingRisk,
  nSufficiency,
  proteinCheck,
  salinityCap,
  saltTolerance,
  trialLayout,
  yieldGoalCheck,
  type YieldUnit,
} from '@/lib/fert-savings/checks'
import {
  useFallTests,
  useNStripMutations,
  useNStrips,
  useNTrialMutations,
  useNTrials,
  usePkHistory,
  useProtein,
  useSoilEc,
  useTrialStrips,
} from '@/lib/fert-savings/research-data'
import { cropRemoval } from '@/lib/fert-savings/tools'
import { appliedFertiliser } from '@/lib/fertility-rx'
import { analysisOf, farmTypical, type ManureApplication } from '@/lib/manure-credit'
import { ringsOf, trialPrescriptionZip, trialRxName } from '@/lib/fert-savings/trial-rx'
import { fileOf } from '@/lib/reports/framework'
import { downloadBlob } from '@/lib/table-report'
import type { FieldOperation } from '@/lib/fieldOps'
import type { Json } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { useBrand } from '@/lib/farm-setup'
import { useReportSaving, useSavings } from './context'
import { S } from './sources'
import { ThreeSeasonBalance } from './Proving'
import { Empty, FieldLink, Table, ToolCard, ghost, input, money, n0, n1, td, tdNum } from './ui'
import { RowEditor } from './RowEditor'

const UNITS = new Set(['bu', 'lbs', 'cwt', 'ton', 'MT'])
const asUnit = (u: string | null | undefined): YieldUnit | null => (u && UNITS.has(u) ? (u as YieldUnit) : null)

/** The season's planned fields with their crop, goal and irrigation. */
function usePlannedCrops() {
  const { inputs } = useSavings()
  return useMemo(
    () =>
      (inputs.plans ?? [])
        .filter((p) => p.crop_year === inputs.cropYear && p.field_id && p.crop_id)
        .map((p) => {
          const crop = inputs.cropOf(p.crop_id)
          const field = inputs.fields.find((f) => f.id === p.field_id)
          const goal = Number(p.yield_per_acre_override ?? crop?.default_yield_per_acre ?? 0) || null
          return { plan: p, crop, field, goal, irrigated: inputs.irrigated.has(p.field_id!) }
        })
        .filter((x) => x.field && x.crop),
    [inputs],
  )
}

/* ------------------------------------------------------------------ 29 */

export function YieldGoalCard() {
  const { inputs } = useSavings()
  const planned = usePlannedCrops()
  const rows = planned.map((x) => {
    const unit = asUnit(x.crop!.yield_unit)
    const lb = x.crop!.test_weight_lb_per_bu == null ? null : Number(x.crop!.test_weight_lb_per_bu)
    const history = inputs.history
      .filter((h) => h.field_id === x.plan.field_id && h.crop === x.crop!.name && h.crop_year < inputs.cropYear && h.yield_per_acre != null)
      .map((h) => (unit ? convertYield(Number(h.yield_per_acre), asUnit(h.yield_unit) ?? unit, unit, lb) : null))
      .filter((v): v is number => v != null)
    return { ...x, unit, check: yieldGoalCheck({ crop: x.crop!.name, goal: x.goal, unit, lbPerBu: lb, irrigated: x.irrigated, history }) }
  })
  const off = rows.filter((r) => r.check.verdict === 'high' || r.check.verdict === 'low')
  useReportSaving(29, null)
  return (
    <ToolCard
      n={29}
      warn={off.length > 0}
      method={
        <>
          Judged against the field&apos;s own median over three or more years where it has them; otherwise against southern Alberta&apos;s
          range — potatoes 300–550 cwt, dry beans 2,000–3,500 lb, corn 100–200 bu, irrigated canola 50–80 bu, alfalfa 4–7 t. More than 25%
          over the field&apos;s median is flagged high.
        </>
      }
      sources={[S.plan, S.crops, S.fields]}
      title="Yield goals that look off"
      why="N and P rates scale with the yield goal; a goal nobody will grow buys fertilizer for a crop that never comes."
      saving={null}
      note={off.length ? `${off.length} to check` : rows.length ? 'all within reach' : 'no plan yet'}
    >
      {!off.length ? (
        <Empty>
          {rows.length ? (
            `All ${rows.length} planned goals sit within this farm's record or southern Alberta's range.`
          ) : (
            <>
              No crop plan for this season yet. <SetupLink managerOnly to={SETUP_LINKS.cropPlan()}>Plan the crops</SetupLink>
            </>
          )}
        </Empty>
      ) : (
        <Table head={['Field', 'Crop', 'Goal', 'Verdict']}>
          {off.map((r) => (
            <tr key={r.plan.id}>
              <td className={td}>
                <FieldLink id={r.plan.field_id} name={r.field!.name} to="history" />
              </td>
              <td className={td}>{r.crop!.name}</td>
              <td className={tdNum}>
                {n0(r.goal)} <span className="text-[10px] text-gray-400">{r.unit}</span>
              </td>
              <td className={td}>
                <span className={cn('font-semibold', r.check.verdict === 'high' ? 'text-amber-800' : 'text-sky-800')}>{r.check.verdict === 'high' ? 'High' : 'Low'}</span> — {r.check.why}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 30 */

export function SalinityCard() {
  const { inputs } = useSavings()
  const planned = usePlannedCrops()
  const { data: ec } = useSoilEc(inputs.cropYear)
  const rows = planned
    .map((x) => {
      const soil = ec?.get(x.plan.field_id!)
      if (!soil) return null
      const cap = salinityCap(x.crop!.name, soil.sites.map((s) => ({ ec: s.ec })))
      return { ...x, soil, cap, tol: saltTolerance(x.crop!.name) }
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.cap.factor != null && r.cap.factor < 0.98)
  // What the goal overstates, priced at the crop: the fertilizer for yield the salt will not let grow.
  useReportSaving(30, null)
  return (
    <ToolCard
      n={30}
      warn={rows.length > 0}
      method={
        <>
          Maas–Hoffman salt tolerance (FAO 29/48): yield falls by a set share for every dS/m of saturated-paste EC over the crop&apos;s
          threshold — dry beans and carrots from 1.0, corn, potatoes and flax from 1.7, alfalfa 2.0, wheat 6.0, barley 8.0, canola 11.0.
          Each soil-test site counts for an equal share of the field. Beans, peas and corn are the ones to keep off the salty ground.
        </>
      }
      sources={[S.soil, S.plan]}
      title="Salty ground caps the yield goal"
      why="Salt takes yield before fertilizer can put it back; the goal on salty ground should come down with it."
      saving={null}
      note={rows.length ? `${rows.length} field${rows.length === 1 ? '' : 's'} capped` : 'no salt limit on this year’s crops'}
    >
      {!rows.length ? (
        <Empty>No planned crop sits on soil salty enough to cost it yield, going by the EC in the latest soil tests.</Empty>
      ) : (
        <Table head={['Field', 'Crop', 'Salinity (EC) by site, dS/m', 'Yield it allows', 'Goal → capped']}>
          {rows.map((r) => (
            <tr key={r.plan.id}>
              <td className={td}>
                <FieldLink id={r.plan.field_id} name={r.field!.name} to="sampling" />
              </td>
              <td className={td}>
                {r.crop!.name}
                {r.tol && <span className="block text-[10px] text-gray-400">losses start at {r.tol.threshold} dS/m</span>}
              </td>
              <td className={tdNum}>{r.soil.sites.map((s) => s.ec.toFixed(2)).join(', ')}</td>
              <td className={tdNum}>
                {Math.round(r.cap.factor! * 100)}%
                <span className="block text-[10px] text-gray-400">{Math.round(r.cap.affectedShare * 100)}% of sites short</span>
              </td>
              <td className={tdNum}>
                {n0(r.goal)} → <strong>{n0(r.goal ? r.goal * r.cap.factor! : null)}</strong>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 31 */

export function ResampleCard() {
  const { inputs } = useSavings()
  const { data: tests, isLoading } = useFallTests(inputs.cropYear)
  const rows = (tests ?? [])
    .map((t) => {
      const field = inputs.fields.find((f) => f.id === t.fieldId)
      const risk = leachingRisk({
        fallNitrateLbAc: t.residualN,
        texture: field?.soil_texture,
        drainageMm: t.drainageMm,
        fallIrrigationMm: t.fallIrrigationMm,
        winterPrecipMm: t.winterPrecipMm,
      })
      return { t, field, risk }
    })
    .sort((a, b) => Number(b.risk.resample) - Number(a.risk.resample) || (b.t.residualN ?? 0) - (a.t.residualN ?? 0))
  const resample = rows.filter((r) => r.risk.resample)
  // A resample costs a test; relying on nitrate that has moved costs the N it credited.
  const saving = resample.reduce((s, r) => s + Math.max(0, (r.t.residualN ?? 0) - 40) * (inputs.perLb.n ?? 0) * (inputs.requirements.find((q) => q.fieldId === r.t.fieldId)?.acres ?? 0) * 0.3, 0)
  useReportSaving(31, saving || null)
  return (
    <ToolCard
      n={31}
      warn={resample.length > 0}
      method={
        <>
          Resample when fall nitrate is over 60 lb/ac and the ground is sandy, took 50 mm+ of irrigation after sampling, drained 25 mm+
          past the root zone (the irrigation water balance), or had 100 mm+ of winter precipitation. The figure at risk counts 30% of the
          credit above 40 lb/ac at today&apos;s N price.
        </>
      }
      sources={[S.soil, S.fields, S.pivots, S.weather]}
      title="Fall nitrate at risk — resample in spring"
      why="Nitrate found in the fall can be gone by seeding on sandy or wet ground; a spring test says whether the credit is still there."
      saving={saving || null}
      savingLabel="credit at risk"
      note={isLoading ? 'reading the water balance…' : !rows.length ? `no fall tests for ${inputs.cropYear}` : `${resample.length} to resample`}
    >
      {!rows.length ? (
        <Empty>No soil test for {inputs.cropYear} was taken the fall before. This watches fall tests; spring tests need no second look.</Empty>
      ) : (
        <Table head={['Field', 'Sampled', 'Nitrate lb/ac', 'Risk', 'Why', 'Resample?']}>
          {rows.map((r) => (
            <tr key={r.t.fieldId + r.t.reportDate}>
              <td className={td}>
                <FieldLink id={r.t.fieldId} name={r.field?.name ?? '—'} to="sampling" />
              </td>
              <td className={td}>{r.t.reportDate}</td>
              <td className={tdNum}>{n0(r.t.residualN)}</td>
              <td className={td}>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    r.risk.level === 'high' ? 'bg-amber-100 text-amber-800' : r.risk.level === 'moderate' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800',
                  )}
                >
                  {r.risk.level}
                </span>
              </td>
              <td className={cn(td, 'text-[11px]')}>{r.risk.reasons.join('; ') || '—'}</td>
              <td className={td}>{r.risk.resample ? <strong className="text-amber-800">Yes</strong> : 'No'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 32 */

function lateJune(cropYear: number) {
  return new Date() > new Date(`${cropYear}-06-30T23:59:59`)
}

const N_STRIP_FIELDS: EditField[] = [
  { key: 'label', label: 'Name', kind: 'text', placeholder: 'Middle pass' },
  { key: 'extra_lb_n', label: 'Extra N (lb/ac)', kind: 'number' },
  { key: 'notes', label: 'Note', kind: 'textarea' },
]

export function NRichStripCard() {
  const { inputs } = useSavings()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data } = useNStrips(inputs.cropYear)
  const m = useNStripMutations(inputs.cropYear)
  const [adding, setAdding] = useState(false)
  const [fieldId, setFieldId] = useState('')
  const [width, setWidth] = useState('18.3')
  const [offset, setOffset] = useState('0')
  const [extra, setExtra] = useState('50')
  // Sam, 7 Oct 2026: a strip opens to its readings, and its name, extra N and note can be edited.
  const [opened, setOpened] = useState<string | null>(null)
  const past = lateJune(inputs.cropYear)

  const rows = (data?.strips ?? []).map((s) => {
    const latest = (data?.readings ?? []).find((r) => r.strip_id === s.id) ?? null
    const suff = nSufficiency(latest?.field_ndre, latest?.strip_ndre)
    return { s, latest, suff, field: inputs.fields.find((f) => f.id === s.field_id) }
  })
  const topUp = rows.filter((r) => r.suff.verdict === 'short' && !past)
  useReportSaving(32, null)

  return (
    <ToolCard
      n={32}
      warn={topUp.length > 0}
      method={
        <>
          Sufficiency index = the field&apos;s NDRE over the strip&apos;s, from the same Sentinel-2 pass (the strip read 5 m inside its edges).
          Under 0.95 the field is short; 20–40 lb N by how far under, through the pivot, before the late-June fertigation cut-off (Holzapfel et
          al. 2009 cut canola N 34 kg/ha this way with no yield loss outside drought). Not validated in Alberta — a guide, not a rate.
        </>
      }
      sources={[S.fields, S.pivots, { label: 'Sentinel-2 red edge (Copernicus)', href: 'https://documentation.dataspace.copernicus.eu/' }]}
      title="N-rich strips and the satellite red edge"
      why="A strip with more N than the crop can use shows what 'enough' looks like; the field falling behind it on the red edge is short of N."
      saving={null}
      note={!rows.length ? 'no strips this season' : topUp.length ? `${topUp.length} short` : 'all keeping up'}
      actions={
        isManager && !adding ? (
          <button type="button" className={ghost} onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" /> Lay a strip
          </button>
        ) : null
      }
    >
      {adding && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-md bg-gray-50 p-2 text-xs text-gray-600 sm:grid-cols-5">
          <label className="col-span-2">
            Field
            <Select
              value={fieldId}
              onChange={setFieldId}
              size="sm"
              className="mt-1"
              ariaLabel="Field"
              options={[{ value: '', label: 'Choose…' }, ...inputs.fields.filter((f) => f.active).map((f) => ({ value: f.id, label: f.name }))]}
            />
          </label>
          <label>
            Width (m)
            <input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" className={cn(input, 'mt-1 w-full text-right')} />
          </label>
          <label>
            Off middle (m)
            <input value={offset} onChange={(e) => setOffset(e.target.value)} inputMode="decimal" className={cn(input, 'mt-1 w-full text-right')} />
          </label>
          <label>
            Extra N (lb/ac)
            <input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" className={cn(input, 'mt-1 w-full text-right')} />
          </label>
          <div className="col-span-2 flex gap-2 sm:col-span-5">
            <button
              type="button"
              disabled={!fieldId || m.create.isPending}
              className={cn(ghost, 'bg-brand-700 text-white hover:bg-brand-800')}
              onClick={() =>
                m.create.mutate(
                  { fieldId, widthM: Number(width) || 18.3, offsetM: Number(offset) || 0, extraLb: Number(extra) || 50 },
                  { onSuccess: () => setAdding(false) },
                )
              }
            >
              {m.create.isPending ? 'Laying…' : 'Save strip'}
            </button>
            <button type="button" className={ghost} onClick={() => setAdding(false)}>
              Cancel
            </button>
            {m.create.error && <span className="text-red-700">{(m.create.error as Error).message}</span>}
          </div>
          <p className="col-span-2 text-[11px] text-gray-500 sm:col-span-5">
            One pass wide (18.3 m is 60 ft), the length of the field the way it is farmed, through the middle unless moved off it. Put
            the extra N on that strip at seeding; the satellite scores it with the field every pass from then on.
          </p>
        </div>
      )}
      {!rows.length ? (
        <Empty>No N-rich strips this season. Lay one per field you want watched, and apply it with extra N at seeding.</Empty>
      ) : (
        <Table head={['Field', 'Strip', 'Last pass', 'Field / strip red edge (NDRE, crop greenness)', 'Sufficiency', 'Advice', '']}>
          {rows.map((r) => (
            <tr key={r.s.id} className="cursor-pointer hover:bg-gray-50" onClick={rowClick(() => setOpened(r.s.id))}>
              <td className={td}>
                <FieldLink id={r.s.field_id} name={r.field?.name ?? '—'} to="work" />
                {r.s.label && <span className="block text-[10px] text-gray-400">{r.s.label}</span>}
              </td>
              <td className={tdNum}>
                {n1(r.s.acres)} ac
                {r.s.extra_lb_n != null && <span className="block text-[10px] text-gray-400">+{n0(r.s.extra_lb_n)} lb N</span>}
              </td>
              <td className={td}>{r.latest?.sensed_on ?? 'no clear pass yet'}</td>
              <td className={tdNum}>{r.latest ? `${Number(r.latest.field_ndre).toFixed(3)} / ${Number(r.latest.strip_ndre).toFixed(3)}` : '—'}</td>
              <td className={tdNum}>{r.suff.si != null ? r.suff.si.toFixed(2) : '—'}</td>
              <td className={td}>
                {r.suff.verdict === 'short' ? (
                  past ? (
                    <span className="text-gray-500">short, but past the late-June cut-off</span>
                  ) : (
                    <strong className="text-amber-800">{r.suff.lbN} lb N through the pivot</strong>
                  )
                ) : r.suff.verdict === 'ok' ? (
                  <span className="text-green-800">keeping up</span>
                ) : (
                  <span className="text-gray-400">waiting on a clear pass</span>
                )}
              </td>
              <td className="px-1 text-right">
                {isManager && (
                  <button type="button" aria-label="Delete strip" onClick={() => confirm('Delete this strip?') && m.remove.mutate(r.s.id)} className="rounded p-1 text-gray-300 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {(() => {
        const r = rows.find((x) => x.s.id === opened)
        if (!r) return null
        const readings = (data?.readings ?? []).filter((x) => x.strip_id === r.s.id)
        return (
          <RowEditor
            title={`N-rich strip · ${r.field?.name ?? ''}`}
            fields={N_STRIP_FIELDS}
            row={r.s}
            canEdit={isManager}
            saving={m.update.isPending || m.remove.isPending}
            error={(m.update.error ?? m.remove.error)?.message ?? null}
            onClose={() => {
              m.update.reset()
              setOpened(null)
            }}
            onSave={(v) =>
              m.update.mutateAsync({ id: r.s.id, label: v.label as string | null, extra_lb_n: v.extra_lb_n as number | null, notes: v.notes as string | null })
            }
            onDelete={() => m.remove.mutateAsync(r.s.id)}
            deleteConfirm="Delete this strip?"
          >
            <DetailList
              className="mt-3 text-xs"
              rows={[
                ['Acres', `${n1(r.s.acres)} ac`],
                ['Laid', r.s.created_at?.slice(0, 10)],
                [
                  'Passes read',
                  readings.length
                    ? readings
                        .slice(0, 8)
                        .map((x) => `${x.sensed_on}: ${Number(x.field_ndre).toFixed(3)} / ${Number(x.strip_ndre).toFixed(3)}`)
                        .join('\n')
                    : 'none yet',
                ],
              ]}
            />
          </RowEditor>
        )
      })()}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 33 */

/** A little map of the strips, shaded by rate — enough to see the layout. */
function StripPreview({ strips }: { strips: { strip: number; rate: number; geojson: Json }[] }) {
  const polys = strips.flatMap((s) => ringsOf(s.geojson as unknown as Geometry).map((p) => ({ s, p })))
  const pts = polys.flatMap(({ p }) => p[0])
  if (!pts.length) return null
  const lat0 = (Math.min(...pts.map((c) => c[1])) + Math.max(...pts.map((c) => c[1]))) / 2
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = pts.map((c) => c[0] * k)
  const ys = pts.map((c) => c[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const W = 320
  const sc = W / Math.max(x1 - x0, y1 - y0)
  const H = (y1 - y0) * sc
  const max = Math.max(...strips.map((s) => s.rate), 1)
  return (
    <svg viewBox={`0 0 ${W} ${Math.max(H, 40)}`} className="h-auto w-full max-w-sm rounded border border-gray-200 bg-white">
      {polys.map(({ s, p }, i) => (
        <path
          key={i}
          d={p.map((ring) => ring.map((c, j) => `${j ? 'L' : 'M'}${((c[0] * k - x0) * sc).toFixed(1)},${((y1 - c[1]) * sc).toFixed(1)}`).join(' ') + 'Z').join(' ')}
          fill={`rgba(21, 128, 61, ${0.12 + 0.75 * (s.rate / max)})`}
          stroke="#14532d"
          strokeWidth={0.5}
        >
          <title>{`Strip ${s.strip}: ${s.rate} lb N/ac`}</title>
        </path>
      ))}
    </svg>
  )
}

function TrialRow({ trial }: { trial: ReturnType<typeof useNTrials>['data'] extends (infer T)[] | undefined ? T : never }) {
  const { inputs } = useSavings()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [open, setOpen] = useState(false)
  const { data: strips } = useTrialStrips(open ? trial.id : null)
  const m = useNTrialMutations(inputs.cropYear)
  const saved = (Array.isArray(trial.results) ? trial.results : []) as { strip: number; yield: number | null }[]
  const [yields, setYields] = useState<Record<number, string>>(() => Object.fromEntries(saved.map((r) => [r.strip, r.yield == null ? '' : String(r.yield)])))
  const field = inputs.fields.find((f) => f.id === trial.field_id)
  const crop = inputs.cropOf(trial.crop_id)
  const price = trial.crop_id ? (inputs.cropPrices.get(trial.crop_id) ?? null) : null
  const ratio = inputs.perLb.n != null && price ? inputs.perLb.n / price : null

  const entered = (trial.layout as number[]).map((rate, i) => ({ n: Number(rate), y: Number(yields[i + 1]) })).filter((p) => Number.isFinite(p.y) && p.y > 0)
  const fit = entered.length >= 4 ? fitQuadratic(entered) : null
  const rates = (trial.rates as number[]).map(Number)
  const eonr = fit && ratio ? economicOptimum(fit, ratio, [Math.min(...rates), Math.max(...rates)]) : null

  // The same file the Reports page makes for this trial.
  const download = () => {
    if (!strips?.length) return
    const f = fileOf(trialPrescriptionZip(field?.name, trial.crop_year, strips), `${trialRxName(field?.name, trial.crop_year)}.zip`, 'application/zip')
    downloadBlob(f.blob, f.filename)
  }

  return (
    <div className="rounded-md border border-gray-200">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 px-2.5 py-1.5 text-left text-xs">
        <span className="font-semibold text-gray-900">{field?.name ?? '—'}</span>
        <span className="text-gray-500">
          {crop?.name ?? 'crop not set'} · {(trial.rates as number[]).join(' / ')} lb N · {trial.reps} reps · {trial.status}
        </span>
        {eonr && <span className="ml-auto font-semibold text-green-800">pays best at {eonr.n} lb N</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-100 p-2.5 text-xs">
          {strips?.length ? <StripPreview strips={strips} /> : <p className="text-gray-400">Laying out the strips…</p>}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={ghost} onClick={download} disabled={!strips?.length}>
              <Download className="h-3 w-3" /> Prescription (.zip shapefile)
            </button>
            {isManager && (
              <>
                {(['planned', 'applied', 'harvested'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={cn(ghost, trial.status === s && 'bg-gray-100 font-semibold')}
                    onClick={() => m.save.mutate({ ...trialBody(trial), status: s })}
                  >
                    {s}
                  </button>
                ))}
                <button type="button" className={ghost} onClick={() => confirm('Delete this trial?') && m.remove.mutate(trial.id)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </>
            )}
          </div>
          <Table head={['Strip', 'Rep', 'N lb/ac', 'Acres', `Yield (${crop?.yield_unit ?? 'per ac'})`]}>
            {(strips ?? []).map((s) => (
              <tr key={s.strip}>
                <td className={tdNum}>{s.strip}</td>
                <td className={tdNum}>{s.rep}</td>
                <td className={tdNum}>{n0(Number(s.rate))}</td>
                <td className={tdNum}>{n1(Number(s.acres))}</td>
                <td className="px-2 py-0.5 text-right">
                  <input
                    inputMode="decimal"
                    value={yields[s.strip] ?? ''}
                    onChange={(e) => setYields((y) => ({ ...y, [s.strip]: e.target.value }))}
                    className={cn(input, 'w-20 py-0.5 text-right text-xs')}
                    aria-label={`Yield of strip ${s.strip}`}
                    disabled={!isManager}
                  />
                </td>
              </tr>
            ))}
          </Table>
          {isManager && (
            <button
              type="button"
              className={ghost}
              disabled={m.save.isPending}
              onClick={() =>
                m.save.mutate({
                  ...trialBody(trial),
                  results: Object.entries(yields)
                    .filter(([, v]) => v.trim() !== '')
                    .map(([k, v]) => ({ strip: Number(k), yield: Number(v) })) as unknown as Json,
                  yield_unit: crop?.yield_unit ?? null,
                  status: entered.length ? 'harvested' : trial.status,
                })
              }
            >
              {m.save.isPending ? 'Saving…' : 'Save yields'}
            </button>
          )}
          {fit ? (
            <p className="rounded bg-green-50 px-2 py-1.5 text-green-900">
              Fitted response: yield = {fit.a.toFixed(1)} + {fit.b.toFixed(3)}·N {fit.c < 0 ? '−' : '+'} {Math.abs(fit.c).toFixed(5)}·N² (R² {fit.r2.toFixed(2)}).{' '}
              {eonr
                ? `At N ${money(inputs.perLb.n, 2)}/lb and ${crop?.name.toLowerCase() ?? 'crop'} ${money(price, 2)}, the last pound pays up to ${eonr.n} lb N${eonr.capped ? ' — at the edge of the rates tried, so try higher (or lower) next year' : ''}.`
                : fit.c >= 0
                  ? 'Yield was still climbing at the top rate — the trial did not find the top; widen the rates.'
                  : 'Needs a nitrogen and a crop price to find the economic rate.'}
            </p>
          ) : (
            <p className="text-gray-500">Enter at least four strip yields — from the yield monitor&apos;s strip averages or a weigh wagon — and the response is fitted.</p>
          )}
        </div>
      )}
    </div>
  )
}

function trialBody(t: { id: string; field_id: string; crop_id: string | null; name: string | null; rates: number[]; reps: number; layout: number[]; base_rate: number | null; strip_width_m: number; seed: number }) {
  return {
    id: t.id,
    field_id: t.field_id,
    crop_id: t.crop_id,
    name: t.name,
    rates: t.rates,
    reps: t.reps,
    layout: t.layout,
    base_rate: t.base_rate,
    strip_width_m: Number(t.strip_width_m),
    seed: t.seed,
  }
}

export function NTrialCard() {
  const { inputs } = useSavings()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: trials } = useNTrials(inputs.cropYear)
  const m = useNTrialMutations(inputs.cropYear)
  const planned = usePlannedCrops()
  const [adding, setAdding] = useState(false)
  const [fieldId, setFieldId] = useState('')
  const [rates, setRates] = useState('')
  const [reps, setReps] = useState('3')
  const [width, setWidth] = useState('18.3')

  const pick = (id: string) => {
    setFieldId(id)
    const rec = inputs.requirements.find((r) => r.fieldId === id)
    const recN = (rec?.lines ?? []).filter((l) => (l.nutrient ?? '').toUpperCase() === 'N').reduce((s, l) => s + (l.lbPerAc || 0), 0)
    const r = recN > 0 ? recN : 120
    const round5 = (x: number) => Math.round(x / 5) * 5
    setRates([0, round5(r * 0.5), round5(r), round5(r * 1.5)].join(', '))
  }
  const rateList = rates
    .split(/[,\s]+/)
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 0)
  const plan = planned.find((p) => p.plan.field_id === fieldId)
  useReportSaving(33, null)

  return (
    <ToolCard
      n={33}
      method={
        <>
          After harvest, enter each strip&apos;s yield (the yield monitor&apos;s average over the strip, or a weigh wagon). A quadratic is
          fitted and solved where the last pound of N pays at today&apos;s N-to-crop price ratio. Two or three seasons on a crop make a curve
          worth trusting over the provincial one.
        </>
      }
      sources={[S.plan, S.requirements, S.market]}
      title="On-farm N-rate trials"
      why="Alberta's curves are 2013 cultivars on someone else's ground; strips at four or five rates find this farm's own rate."
      saving={null}
      note={trials?.length ? `${trials.length} this season` : 'none this season'}
      actions={
        isManager && !adding ? (
          <button type="button" className={ghost} onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" /> New trial
          </button>
        ) : null
      }
    >
      {adding && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-md bg-gray-50 p-2 text-xs text-gray-600 sm:grid-cols-5">
          <label className="col-span-2">
            Field
            <Select
              value={fieldId}
              onChange={pick}
              size="sm"
              className="mt-1"
              ariaLabel="Field"
              options={[{ value: '', label: 'Choose…' }, ...planned.map((p) => ({ value: p.plan.field_id!, label: `${p.field!.name} — ${p.crop!.name}` }))]}
            />
          </label>
          <label className="col-span-2 sm:col-span-1">
            Rates (lb N/ac)
            <input value={rates} onChange={(e) => setRates(e.target.value)} className={cn(input, 'mt-1 w-full')} />
          </label>
          <label>
            Reps
            <input value={reps} onChange={(e) => setReps(e.target.value)} inputMode="numeric" className={cn(input, 'mt-1 w-full text-right')} />
          </label>
          <label>
            Strip width (m)
            <input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" className={cn(input, 'mt-1 w-full text-right')} />
          </label>
          <div className="col-span-2 flex gap-2 sm:col-span-5">
            <button
              type="button"
              disabled={!fieldId || rateList.length < 3 || m.save.isPending}
              className={cn(ghost, 'bg-brand-700 text-white hover:bg-brand-800')}
              onClick={() => {
                const n = Math.min(8, Math.max(1, Math.round(Number(reps) || 3)))
                const seed = Math.floor(Math.random() * 2 ** 31)
                m.save.mutate(
                  {
                    field_id: fieldId,
                    crop_id: plan?.plan.crop_id ?? null,
                    name: null,
                    rates: rateList,
                    reps: n,
                    layout: trialLayout(rateList, n, seed),
                    base_rate: null,
                    strip_width_m: Number(width) || 18.3,
                    seed,
                  },
                  { onSuccess: () => setAdding(false) },
                )
              }}
            >
              {m.save.isPending ? 'Laying out…' : 'Save trial'}
            </button>
            <button type="button" className={ghost} onClick={() => setAdding(false)}>
              Cancel
            </button>
            {m.save.error && <span className="text-red-700">{(m.save.error as Error).message}</span>}
          </div>
          <p className="col-span-2 text-[11px] text-gray-500 sm:col-span-5">
            Default rates are 0, half, the full and one-and-a-half times the field&apos;s recommended N. Each rep holds every rate once in a
            random order; strips are one pass wide across the middle of the field. Download the prescription and load it into Operations
            Center as a shapefile (rate column N_LB_AC, or UREA_LB for product).
          </p>
        </div>
      )}
      {!trials?.length ? (
        <Empty>No trials this season. One field per crop per year is enough to start learning the farm&apos;s own N response.</Empty>
      ) : (
        <div className="space-y-2">
          {trials.map((t) => (
            <TrialRow key={t.id} trial={t} />
          ))}
        </div>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 34 */

export function ProteinCard() {
  const { inputs } = useSavings()
  const { data } = useProtein(inputs.cropYear)
  const groups = new Map<string, { fieldId: string | null; cropId: string | null; wsum: number; w: number; n: number }>()
  for (const l of data?.loads ?? []) {
    const k = `${l.field_id ?? ''}|${l.crop_id}`
    const g = groups.get(k) ?? { fieldId: l.field_id, cropId: l.crop_id, wsum: 0, w: 0, n: 0 }
    const w = Number(l.net_kg ?? 1) || 1
    g.wsum += Number(l.protein_pct) * w
    g.w += w
    g.n++
    groups.set(k, g)
  }
  for (const t of data?.tickets ?? []) {
    if (t.bin_load_id) continue // already counted on its load
    const k = `|${t.crop_id}`
    const g = groups.get(k) ?? { fieldId: null, cropId: t.crop_id, wsum: 0, w: 0, n: 0 }
    const w = Number(t.net_lb ?? 1) || 1
    g.wsum += Number(t.protein_pct) * w
    g.w += w
    g.n++
    groups.set(k, g)
  }
  const rows = [...groups.values()].map((g) => {
    const crop = inputs.cropOf(g.cropId)
    const protein = g.w ? g.wsum / g.w : null
    return { ...g, crop, protein, check: proteinCheck(crop?.name, protein) }
  })
  const short = rows.filter((r) => r.check.short)
  useReportSaving(34, null)
  return (
    <ToolCard
      n={34}
      warn={short.length > 0}
      method={<>Weighted by the weight of each load. Heard 2022 (Agvise): CWRS under 13.2% and durum under 13.5% point to late-season N shortage.</>}
      sources={[S.bins, S.fields]}
      title="Protein says the N ran short"
      why="Wheat under 13.2% protein (durum 13.5%) usually ran out of N late — next year's rate on that field wants a second look."
      saving={null}
      note={!rows.length ? 'no protein recorded' : short.length ? `${short.length} low` : 'protein fine'}
    >
      {!rows.length ? (
        <Empty>
          No protein recorded for {inputs.cropYear}. It comes off the elevator ticket; type it on the weigh-in for wheat and durum loads, or
          it is read off scanned scale tickets.
        </Empty>
      ) : (
        <Table head={['Field', 'Crop', 'Protein', 'Loads', 'Verdict']}>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={td}>{r.fieldId ? <FieldLink id={r.fieldId} name={inputs.fieldName(r.fieldId)} to="history" /> : 'tickets, field not known'}</td>
              <td className={td}>{r.crop?.name ?? '—'}</td>
              <td className={tdNum}>{r.protein != null ? `${r.protein.toFixed(1)}%` : '—'}</td>
              <td className={tdNum}>{r.n}</td>
              <td className={td}>
                {r.check.line == null ? (
                  <span className="text-gray-400">no protein line for this crop</span>
                ) : r.check.short ? (
                  <strong className="text-amber-800">under {r.check.line}% — likely N-short late</strong>
                ) : (
                  <span className="text-green-800">at or over {r.check.line}%</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 35 */

type Nutrients = { p2o5: number; k2o: number }

export function PkBalanceCard() {
  const { inputs } = useSavings()
  const { data } = usePkHistory()
  const farm = useMemo(() => farmTypical(inputs.manure as unknown as ManureApplication[]), [inputs.manure])

  const model = useMemo(() => {
    if (!data) return null
    const opsBy = new Map<string, FieldOperation[]>()
    for (const o of data.ops as unknown as FieldOperation[]) {
      const k = `${o.field_id}|${o.crop_season}`
      opsBy.set(k, [...(opsBy.get(k) ?? []), o])
    }
    // A season counts only where its fertilizer is actually on record — a
    // Deere pass that carried nutrients, or a manure spread. Deere logs the
    // seeding and harvest either way, but fertilizer put on by the retailer's
    // floater or a custom applicator never reaches it; treating those seasons
    // as bare removal taught the buffer that fertilizer lowers the soil test.
    const recorded = (fieldId: string, year: number) =>
      appliedFertiliser(opsBy.get(`${fieldId}|${year}`) ?? []).some((p) => p.nutrients) ||
      inputs.manure.some((m) => m.field_id === fieldId && m.crop_year === year)
    /** Surplus (applied − removed) for one field in one crop year. */
    const surplus = (fieldId: string, year: number): (Nutrients & { known: boolean }) => {
      const applied: Nutrients = { p2o5: 0, k2o: 0 }
      const known = recorded(fieldId, year)
      for (const p of appliedFertiliser(opsBy.get(`${fieldId}|${year}`) ?? [])) {
        if (!p.nutrients) continue
        applied.p2o5 += p.nutrients.p2o5
        applied.k2o += p.nutrients.k2o
      }
      const acres = inputs.requirements.find((r) => r.fieldId === fieldId)?.acres ?? null
      for (const app of inputs.manure.filter((m) => m.field_id === fieldId && m.crop_year === year)) {
        const an = analysisOf(app as unknown as ManureApplication, farm)
        const share = acres && app.acres ? Math.min(1, Number(app.acres) / acres) : 1
        applied.p2o5 += an.p2o5 * Number(app.rate_tons_per_acre ?? 0) * share
        applied.k2o += an.k2o * Number(app.rate_tons_per_acre ?? 0) * share
      }
      const h = inputs.history.find((x) => x.field_id === fieldId && x.crop_year === year)
      const removed = h ? cropRemoval(h.crop, h.yield_per_acre, h.yield_unit) : null
      return { p2o5: applied.p2o5 - (removed?.p2o5 ?? 0), k2o: applied.k2o - (removed?.k2o ?? 0), known }
    }

    // Learn the buffer from every pair of successive tests on a field.
    const byField = new Map<string, typeof data.tests>()
    for (const t of data.tests) byField.set(t.fieldId, [...(byField.get(t.fieldId) ?? []), t])
    const pPts: { surplusLb: number; deltaPpm: number }[] = []
    const kPts: { surplusLb: number; deltaPpm: number }[] = []
    for (const tests of byField.values()) {
      const sorted = [...tests].sort((a, b) => a.year - b.year)
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]
        const b = sorted[i]
        if (b.year <= a.year) continue
        let sp = 0, sk = 0, known = true
        for (let y = a.year; y < b.year; y++) {
          const s = surplus(a.fieldId, y)
          sp += s.p2o5
          sk += s.k2o
          known &&= s.known
        }
        if (!known) continue
        if (a.olsen != null && b.olsen != null) pPts.push({ surplusLb: sp, deltaPpm: b.olsen - a.olsen })
        if (a.k != null && b.k != null) kPts.push({ surplusLb: sk, deltaPpm: b.k - a.k })
      }
    }
    // A learned buffer must point the right way: surplus raises the test. One
    // that comes out flat or negative is noise (a sampling-site shift, a lab
    // change) and is not used.
    const sane = (f: { ppmPer100Lb: number | null; n: number }) => ({ ...f, rejected: f.ppmPer100Lb != null && !(f.ppmPer100Lb > 0), ppmPer100Lb: f.ppmPer100Lb != null && f.ppmPer100Lb > 0 ? f.ppmPer100Lb : null })
    const pFit = sane(fitBuffer(pPts))
    const kFit = sane(fitBuffer(kPts))
    // Alberta's default: about 28 lb P2O5 moves Olsen 1 ppm (20 on sand, 37 on clay).
    const pBuffer = pFit.ppmPer100Lb ?? 100 / 28

    const rows = [...byField.entries()]
      .map(([fieldId, tests]) => {
        const last = [...tests].sort((a, b) => b.year - a.year)[0]
        let sp = 0, sk = 0
        const years: number[] = []
        for (let y = last.year; y < inputs.cropYear; y++) {
          const s = surplus(fieldId, y)
          if (!s.known) continue
          sp += s.p2o5
          sk += s.k2o
          years.push(y)
        }
        return {
          fieldId,
          last,
          sp,
          sk,
          years,
          olsenNow: last.olsen != null ? last.olsen + (sp * pBuffer) / 100 : null,
          kNow: last.k != null && kFit.ppmPer100Lb != null ? last.k + (sk * kFit.ppmPer100Lb) / 100 : null,
        }
      })
      .filter((r) => inputs.fields.some((f) => f.id === r.fieldId && f.active))
      .sort((a, b) => a.sp - b.sp)
    return { rows, pFit, kFit, pBuffer }
  }, [data, inputs, farm])

  useReportSaving(35, null)
  const mining = (model?.rows ?? []).filter((r) => r.sp < -40)
  return (
    <ToolCard
      n={35}
      warn={mining.length > 0}
      method={
        <>
          Applied is every fertilizer pass Deere recorded plus manure (the farm&apos;s own tested analysis where there is one); removed is the
          harvested crop at the removal rates. Every pair of tests on a field with a balance between them teaches the buffer; Swift Current
          tracked Olsen P against the balance this way over 39 years.
        </>
      }
      sources={[S.soil, S.fields, S.manure]}
      title="P and K running balance, learned from our tests"
      why="What went on less what came off, field by field since its last test — and how far this farm's soil test actually moves per pound."
      saving={null}
      note={!model ? 'reading every season…' : mining.length ? `${mining.length} drawing down` : 'no field drawing down hard'}
    >
      {!model?.rows.length ? (
        <Empty>No soil tests to start a balance from.</Empty>
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-600">
            Olsen P moves{' '}
            <strong>
              {model.pBuffer.toFixed(1)} ppm per 100 lb P₂O₅ of surplus
            </strong>{' '}
            {model.pFit.ppmPer100Lb != null
              ? `— learned from ${model.pFit.n} pairs of this farm's tests`
              : model.pFit.rejected
                ? `— Alberta's default; the ${model.pFit.n} test pairs so far pointed the wrong way (fertilizer applied without a machine record, or sampling noise), so they are not trusted yet`
                : "— Alberta's default until two tests with every season's fertilizer on record between them exist"}
            . K:{' '}
            {model.kFit.ppmPer100Lb != null
              ? `${model.kFit.ppmPer100Lb.toFixed(1)} ppm per 100 lb K₂O, learned from ${model.kFit.n} pairs`
              : 'not enough recorded test pairs to learn yet'}
            .
          </p>
          <Table head={['Field', 'Last test', 'Soil P (Olsen) / K then', 'Surplus since (P₂O₅ · K₂O)', 'Soil P (Olsen) now (est.)', 'K now (est.)']}>
            {model.rows.map((r) => (
              <tr key={r.fieldId}>
                <td className={td}>
                  <FieldLink id={r.fieldId} name={inputs.fieldName(r.fieldId)} to="sampling" />
                </td>
                <td className={td}>{r.last.year}</td>
                <td className={tdNum}>
                  {n0(r.last.olsen)} / {n0(r.last.k)}
                </td>
                <td className={cn(tdNum, r.sp < -40 && 'font-semibold text-amber-800')}>
                  {r.years.length ? (
                    <>
                      {n0(r.sp)} · {n0(r.sk)}
                      <span className="block text-[10px] font-normal text-gray-400">{r.years.join(', ')}</span>
                    </>
                  ) : (
                    <span className="text-gray-400">no recorded season since</span>
                  )}
                </td>
                <td className={tdNum}>{n1(r.olsenNow)}</td>
                <td className={tdNum}>{r.kNow != null ? n0(r.kNow) : '—'}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <ThreeSeasonBalance />
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 36 */

export function NerpPackCard() {
  const { inputs } = useSavings()
  const { farmName } = useBrand()
  const [fieldId, setFieldId] = useState('all')
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const planned = usePlannedCrops()

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const { buildNerpPack } = await import('@/lib/fert-savings/nerp-pack')
      const { tableReportToCsv, tableReportToPdf } = await import('@/lib/table-report')
      const ids = fieldId === 'all' ? planned.map((p) => p.plan.field_id!) : [fieldId]
      const report = await buildNerpPack(ids, inputs.cropYear, inputs, farmName)
      const name = `4R NERP record ${fieldId === 'all' ? 'all fields' : inputs.fieldName(fieldId)} ${inputs.cropYear}`
      if (format === 'csv') downloadBlob(new Blob([tableReportToCsv(report)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`)
      else downloadBlob(await tableReportToPdf(report), `${name}.pdf`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useReportSaving(36, null)
  return (
    <ToolCard
      n={36}
      method={
        <>
          Per field: crop and acres, the soil test, the written recommendation (rate, product, timing), what the machines actually put on
          (Deere passes), manure, tissue tests and the yield — plus the season&apos;s fertilizer invoices. NERP credit value is small; the
          records are what OFCAF and buyers&apos; sustainability programs pay for.
        </>
      }
      sources={[S.nerp, S.fert4r, S.soil, S.requirements]}
      title="4R / NERP record pack"
      why="Source, rate, time and place for every field-year in one file — what a 4R audit, a NERP project or an OFCAF claim asks to see."
      saving={null}
      note="export"
    >
      <div className="flex flex-wrap items-end gap-2 text-xs text-gray-600">
        <label>
          Field
          <Select
            value={fieldId}
            onChange={setFieldId}
            size="sm"
            className="mt-1 w-56"
            ariaLabel="Field"
            options={[{ value: 'all', label: `All ${planned.length} planned fields` }, ...planned.map((p) => ({ value: p.plan.field_id!, label: p.field!.name }))]}
          />
        </label>
        <label className="flex items-center gap-1 pb-1.5">
          <input type="radio" checked={format === 'pdf'} onChange={() => setFormat('pdf')} /> PDF
        </label>
        <label className="flex items-center gap-1 pb-1.5">
          <input type="radio" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV
        </label>
        <button type="button" className={ghost} disabled={busy || !planned.length} onClick={run}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Export {inputs.cropYear}
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </ToolCard>
  )
}
