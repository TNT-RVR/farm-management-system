import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Select } from '@/components/Select'
import { creditSpreadOver, farmTypical, type ManureApplication } from '@/lib/manure-credit'
import { rateValue } from '@/lib/soil-help'
import { rangesFor } from '@/lib/tissue'
import { useGenerateAssessment } from '@/lib/soilTests'
import { byField, fieldSpread, useYieldZones, WORTH_VARYING } from '@/lib/yield-zones'
import { rxKind } from '@/lib/fertility-rx'
import { checkFractionFor, economicNRate, legumeCreditAfterTest, nitrogenLossRisk } from '@/lib/fert-savings/agronomy'
import { kRateAlberta, nRateAlberta, pRateAlberta, seedRowPCap, upfrontSplitFor } from '@/lib/fert-savings/alberta'
import { cropRemoval, enhancedAdvice, splitPlan, suggestedRate, tissueGate, vrSaving } from '@/lib/fert-savings/tools'
import { lbInTonne, straightKeyOf } from '@/lib/fert-savings/straights'
import { useFertMutations, useFertRows } from '@/lib/fert-savings/data'
import type { FieldRequirement } from '@/lib/fertilizer-plan'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { useReportSaving, useSavings } from './context'
import { S } from './sources'
import { Empty, FieldLink, Table, ToolCard, ghost, input, money, n0, perLbFmt, td, tdNum } from './ui'

/** Pounds an acre of one nutrient across a requirement's lines. */
function lineLb(r: FieldRequirement, nutrient: 'N' | 'P' | 'K' | 'S'): number {
  if (!r.lines) return 0
  return r.lines
    .filter((l) => {
      const n = (l.nutrient ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      return nutrient === 'N' ? n === 'N' : nutrient === 'S' ? n === 'S' : n.startsWith(nutrient)
    })
    .reduce((s, l) => s + (l.lbPerAc || 0), 0)
}

function usePlanned() {
  const { inputs } = useSavings()
  return useMemo(() => inputs.requirements.filter((r) => r.lines && r.acres), [inputs.requirements])
}

function RewriteButton({ reportId }: { reportId: string | undefined }) {
  const gen = useGenerateAssessment()
  const [sent, setSent] = useState(false)
  if (!reportId) return null
  return (
    <button
      className={ghost}
      disabled={gen.isPending || sent}
      onClick={() => gen.mutate(reportId, { onSuccess: () => setSent(true) })}
      title="Write the recommendation again with everything now on record"
    >
      <RefreshCw className="h-3 w-3" /> {sent ? 'rewriting…' : 'Rewrite'}
    </button>
  )
}

/* ------------------------------------------------------------------ 9 */

export function ManureCreditCard() {
  const { inputs } = useSavings()
  const planned = usePlanned()
  const rows = useMemo(
    () =>
      planned
        .map((r) => {
          const apps = inputs.manure.filter((m) => m.field_id === r.fieldId) as unknown as (ManureApplication & { created_at: string })[]
          const credit = creditSpreadOver(apps, inputs.cropYear, r.acres, farmTypical(inputs.manure as unknown as ManureApplication[]))
          if (credit.n + credit.p2o5 + credit.k2o < 1) return null
          const soil = inputs.soil.get(r.fieldId)
          const recordedAt = apps.map((a) => a.created_at).sort().pop() ?? null
          const newer = !!recordedAt && (!soil?.assessedAt || recordedAt > soil.assessedAt)
          const rec = { n: lineLb(r, 'N'), p: lineLb(r, 'P'), k: lineLb(r, 'K') }
          const missed = newer ? { n: Math.min(credit.n, rec.n), p: Math.min(credit.p2o5, rec.p), k: Math.min(credit.k2o, rec.k) } : { n: 0, p: 0, k: 0 }
          const dollars =
            (missed.n * (inputs.perLb.n ?? 0) + missed.p * (inputs.perLb.p2o5 ?? 0) + missed.k * (inputs.perLb.k2o ?? 0)) * (r.acres ?? 0)
          return { r, credit, newer, rec, dollars, reportId: soil?.reportId }
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [planned, inputs],
  )
  const saving = rows.reduce((s, x) => s + x.dollars, 0)
  useReportSaving(9, saving)
  return (
    <ToolCard
      n={9}
      warn={rows.some((x) => x.newer)}
      method={
        <>
          Credits are the available share only — release rate by year and surface loss taken off — and
          spread over the whole field by the acres the manure covered. "Rewrite" writes the
          recommendation again now that the spread is on record.
        </>
      }
      sources={[S.manure, S.soil, S.requirements]}
      title="Manure credits in the prescription"
      why="Manure spread on a field, credited against its recommendation — and flagged where the recommendation was written before the spread was recorded."
      saving={saving}
      note={!rows.length ? `no manure credit for ${inputs.cropYear}` : saving <= 0 ? 'credits already counted' : null}
    >
      {!rows.length ? (
        <Empty>No manure recorded that credits a {inputs.cropYear} crop.</Empty>
      ) : (
        <Table head={['Field', 'Credit N · P₂O₅ · K₂O lb/ac', 'Recommended', 'Counted?', 'Worth', '']}>
          {rows.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={tdNum}>
                {n0(x.credit.n)} · {n0(x.credit.p2o5)} · {n0(x.credit.k2o)}
              </td>
              <td className={tdNum}>
                {n0(x.rec.n)} · {n0(x.rec.p)} · {n0(x.rec.k)}
              </td>
              <td className={td}>
                {x.newer ? <span className="font-semibold text-amber-800">No — spread recorded after</span> : <span className="text-gray-500">Yes, in the write-up</span>}
              </td>
              <td className={tdNum}>{x.dollars > 0 ? money(x.dollars) : '—'}</td>
              <td className="px-2 py-1 text-right">{x.newer && <RewriteButton reportId={x.reportId} />}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ----------------------------------------------------------------- 10 */

export function PriorCropCard() {
  const { inputs } = useSavings()
  const planned = usePlanned()
  const rows = useMemo(
    () =>
      planned.map((r) => {
        const prior = inputs.priorCrop(r.fieldId, inputs.cropYear - 1)
        const soil = inputs.soil.get(r.fieldId)
        const before = inputs.priorCrop(r.fieldId, inputs.cropYear - 2)
        // A test taken for this crop year was taken after last year's legume
        // came off, and already holds most of a pulse credit.
        const credit = legumeCreditAfterTest({ lastYear: prior?.crop, twoYearsBack: before?.crop, tested: soil?.reportYear === inputs.cropYear })
        const legume = credit.lbN > 0 ? credit : null
        const notes = (soil?.recs ?? []).map((x) => `${x.note ?? ''}`).join(' ').toLowerCase()
        // Named by any word of the crop, singular or plural ("Beans-Pinto" is
        // "bean", "pinto"), or by the credit itself ("legume", "pulse", "N credit").
        const stems = `${prior?.crop ?? ''} ${legume && !prior?.crop ? (before?.crop ?? '') : ''}`
          .toLowerCase()
          .split(/[\s-]+/)
          .filter((w) => w.length > 2 && w !== 'seed')
          .map((w) => w.replace(/s$/, ''))
        const mentions = stems.some((w) => notes.includes(w)) || /legume|pulse|n credit|nitrogen credit|fixed n|fixation/.test(notes)
        const nitrateCounted = /nitrate|residual/.test(notes)
        const recN = lineLb(r, 'N')
        const missed = legume && !mentions ? Math.min(legume.lbN, recN) : 0
        return { r, prior: prior?.crop ?? null, legume, mentions, residual: soil?.residualN ?? null, nitrateCounted, recN, missed, dollars: missed * (inputs.perLb.n ?? 0) * (r.acres ?? 0), reportId: soil?.reportId }
      }),
    [planned, inputs],
  )
  const saving = rows.reduce((s, x) => s + x.dollars, 0)
  useReportSaving(10, saving)
  const shown = rows.filter((x) => x.legume || x.residual != null)
  return (
    <ToolCard
      n={10}
      method={
        <>
          Legume credits: about 100 lb N the first year after breaking an alfalfa or sainfoin stand
          and 50 the second, 20 after faba beans and peas, 15 after lentils, 10 after dry beans and
          soybeans. A nitrate test taken after the legume already holds a pulse credit and half the
          forage one, so only the rest is counted. A credit is counted as missed only where the
          recommendation never names the crop.
        </>
      }
      sources={[S.fields, S.soil, S.requirements]}
      title="Previous-crop and residual nitrate credits"
      why="Nitrogen left by alfalfa, beans and peas, and by last year's unused nitrate, checked against each recommendation."
      saving={saving}
      note={!rows.some((x) => x.legume) ? 'no legume ahead of this crop' : null}
    >
      {!shown.length ? (
        <Empty>No soil nitrate or legume history for these fields.</Empty>
      ) : (
        <Table head={['Field', 'Last crop', 'Legume credit', 'Soil nitrate', 'Rec N', 'Credit taken?', 'Worth', '']}>
          {shown.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={td}>{x.prior ?? 'not recorded'}</td>
              <td className={tdNum}>
                {x.legume ? `${x.legume.lbN} lb` : '—'}
                {x.legume?.label && <span className="block text-[10px] text-gray-400">{x.legume.label}</span>}
              </td>
              <td className={tdNum}>
                {x.residual != null ? `${n0(x.residual)} lb` : '—'}
                {x.residual != null && <span className="block text-[10px] text-gray-400">{x.nitrateCounted ? 'counted' : 'not mentioned'}</span>}
              </td>
              <td className={tdNum}>{n0(x.recN)}</td>
              <td className={td}>
                {!x.legume ? '—' : x.mentions ? <span className="text-gray-500">named in the write-up</span> : <span className="font-semibold text-amber-800">not named</span>}
              </td>
              <td className={tdNum}>{x.dollars > 0 ? money(x.dollars) : '—'}</td>
              <td className="px-2 py-1 text-right">{x.missed > 0 && <RewriteButton reportId={x.reportId} />}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ----------------------------------------------------------------- 11 */

export function EconomicNCard() {
  const { inputs } = useSavings()
  const planned = usePlanned()
  const overrides = inputs.settings.get('check_fraction') ?? {}
  const rows = useMemo(
    () =>
      planned
        .map((r) => {
          const recN = lineLb(r, 'N')
          if (!(recN > 0)) return null
          const plan = inputs.planFor(r.fieldId)
          const crop = inputs.cropOf(plan?.crop_id)
          const rx = inputs.rx.find((x) => x.field_id === r.fieldId)
          const yieldGoal = Number(plan?.yield_per_acre_override ?? crop?.default_yield_per_acre ?? rx?.yield_goal ?? 0)
          const price = plan?.crop_id ? (inputs.cropPrices.get(plan.crop_id) ?? null) : null
          const soilN = inputs.soil.get(r.fieldId)?.residualN ?? null
          const f = checkFractionFor(crop?.name, crop ? overrides[crop.name] : null, soilN)
          const nPerLb = inputs.perLb.n ?? null
          // Alberta's own response curves where it publishes one for the crop.
          const ab =
            soilN != null && price != null && nPerLb != null
              ? nRateAlberta({ crop: crop?.name, soilN, yieldGoal: yieldGoal || null, nPerLb, cropPerUnit: price })
              : null
          const res = ab
            ? { rate: ab.fertN, cut: Math.max(0, recN - ab.fertN), ratio: nPerLb! / price! }
            : f != null && price != null && nPerLb != null
              ? economicNRate({ recN, yieldGoal, checkFraction: f, nPerLb, cropPerUnit: price })
              : null
          // Net: the nitrogen not bought, less the crop it would have grown.
          let net: number | null = null
          if (ab && res && price != null && nPerLb != null) {
            // Off the curve itself: yield lost by stopping at the economic rate.
            net = Math.max(0, res.cut * nPerLb - Math.max(0, ab.yieldAt(recN) - ab.expectedYield) * price) * (r.acres ?? 0)
          } else if (res && f != null && price != null && nPerLb != null && yieldGoal > 0) {
            const c = ((1 - f) * yieldGoal) / (recN * recN)
            net = (res.cut * nPerLb - price * c * res.cut * res.cut) * (r.acres ?? 0)
          }
          return { r, crop: crop?.name ?? r.cropLabel, recN, yieldGoal, unit: crop?.yield_unit ?? '', price, f, res, net, ab, soilN }
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [planned, inputs, overrides],
  )
  const saving = rows.reduce((s, x) => s + Math.max(0, x.net ?? 0), 0)
  useReportSaving(11, saving)
  return (
    <ToolCard
      n={11}
      method={
        <>
          For wheat, durum, barley and canola the rate comes from Alberta's irrigated response curves
          (Agdex 100/541-1): yield by soil nitrate 0–24 in plus fertilizer, solved at today's N:crop
          price ratio and never past Alberta's cap. The 2:1 figure is Alberta's conservative rate — two
          dollars back for every dollar of N. Other crops use a quadratic reaching its top at the
          recommended rate, with the no-N check yield read off the soil nitrate. At{' '}
          {perLbFmt(inputs.perLb.n)} N, net gain is nitrogen not bought less the crop it would have grown.
        </>
      }
      sources={[S.plan, S.crops, S.requirements, S.market]}
      title="Economic nitrogen rate"
      why="The N rate that pays best when nitrogen is dear against the crop — the last pounds up to the full rate add least."
      saving={saving}
      note={inputs.perLb.n == null ? 'needs a nitrogen price' : null}
    >
      {!rows.length ? (
        <Empty>No nitrogen in this season's recommendations.</Empty>
      ) : (
        <Table head={['Field', 'Crop', 'Rec N', 'Yield goal', 'Crop $', 'N:crop ratio', 'Pays best at', 'Net gain']}>
          {rows.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={td}>{x.crop ?? '—'}</td>
              <td className={tdNum}>{n0(x.recN)}</td>
              <td className={tdNum}>
                {x.yieldGoal ? n0(x.yieldGoal) : '—'} <span className="text-[10px] text-gray-400">{x.unit}</span>
              </td>
              <td className={tdNum}>{x.price != null ? money(x.price, 2) : '—'}</td>
              <td className={tdNum}>{x.res ? x.res.ratio.toFixed(2) : '—'}</td>
              <td className={tdNum}>
                {x.res ? `${n0(x.res.rate)} lb` : x.f == null ? <span className="text-[10px] text-gray-400">no response data for this crop</span> : '—'}
                {x.ab && (
                  <span className="block text-[10px] text-gray-400" title={x.ab.source}>
                    Alberta curve · {n0(x.ab.fertN2to1)} at 2:1 · cap {n0(x.ab.cap)} total
                  </span>
                )}
              </td>
              <td className={tdNum}>{x.net != null && x.net > 0 ? money(x.net) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------ 12, 13 */

function useSoilRows() {
  const { inputs } = useSavings()
  const planned = usePlanned()
  return useMemo(
    () =>
      planned.map((r) => {
        const soil = inputs.soil.get(r.fieldId)
        const pRating = soil?.oP != null ? rateValue('p_bicarb_ppm', soil.oP) : null
        const kRating = soil?.k != null ? rateValue('k_ppm', soil.k) : null
        const last = inputs.priorCrop(r.fieldId, inputs.cropYear - 1)
        const removal = last ? cropRemoval(last.crop, last.yield_per_acre, last.yield_unit) : null
        const plan = inputs.planFor(r.fieldId)
        const crop = inputs.cropOf(plan?.crop_id)?.name ?? r.cropLabel
        const irrigated = inputs.irrigated.has(r.fieldId)
        const zone = inputs.settings.get('soil_zone')
        const texture = inputs.fields.find((f) => f.id === r.fieldId)?.soil_texture ?? null
        const abP = pRateAlberta({ crop, olsenPpm: soil?.oP, irrigated, zone })
        const abK = kRateAlberta({ crop, kPpm: soil?.k })
        const seedCap = seedRowPCap(crop)
        return { r, soil, pRating, kRating, recP: lineLb(r, 'P'), recK: lineLb(r, 'K'), last, removal, crop, abP, abK, seedCap, texture }
      }),
    [planned, inputs],
  )
}

export function DontApplyCard() {
  const { inputs } = useSavings()
  const rows = useSoilRows()
  const list = rows
    .map((x) => {
      // Alberta's table rate is the floor: a very-high field keeps its starter
      // (up to the table rate); only what is over it is skipped.
      const p = x.pRating === 'high' ? Math.max(0, x.recP - (x.abP?.rate ?? 0)) : 0
      const k = x.kRating === 'high' ? Math.max(0, x.recK - (x.abK?.rate ?? 0)) : 0
      return { ...x, cutP: p, cutK: k, dollars: (p * (inputs.perLb.p2o5 ?? 0) + k * (inputs.perLb.k2o ?? 0)) * (x.r.acres ?? 0) }
    })
    .filter((x) => x.pRating === 'high' || x.kRating === 'high')
  const saving = list.reduce((s, x) => s + x.dollars, 0)
  useReportSaving(12, saving)
  return (
    <ToolCard
      n={12}
      method={
        <>
          Very high is above about 41 ppm Olsen P (≈100 lb/ac on Alberta's Modified Kelowna scale) or 250 ppm K — the same bands the soil-sampling
          tab colours. Alberta's tables still give irrigated crops a 10–20 lb P₂O₅ starter until soil P passes 200 lb/ac (about Olsen 85), so only the
          recommendation above the Alberta table rate counts as skippable.
        </>
      }
      sources={[S.soil, S.requirements]}
      title="Don't-apply list"
      why="Fields whose soil phosphate or potash is already high, where the right rate is zero this year."
      saving={saving}
      note={!list.length ? 'no field tests high' : null}
    >
      {!list.length ? (
        <Empty>No field's latest soil test reads high in P or K.</Empty>
      ) : (
        <Table head={['Field', 'Soil P (Olsen ppm)', 'Soil K ppm', 'Rec P₂O₅', 'Rec K₂O', 'Alberta table', 'Could skip', 'Worth']}>
          {list.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={cn(tdNum, x.pRating === 'high' && 'font-semibold text-sky-800')}>{n0(x.soil?.oP)}</td>
              <td className={cn(tdNum, x.kRating === 'high' && 'font-semibold text-sky-800')}>{n0(x.soil?.k)}</td>
              <td className={tdNum}>{n0(x.recP)}</td>
              <td className={tdNum}>{n0(x.recK)}</td>
              <td className={tdNum} title={[x.abP?.source, x.abK?.source].filter(Boolean).join(' · ')}>
                {x.abP ? `${n0(x.abP.rate)} P₂O₅` : '—'}
                {x.abK ? ` · ${n0(x.abK.rate)} K₂O` : ''}
              </td>
              <td className={td}>{[x.cutP ? `${n0(x.cutP)} lb P₂O₅` : null, x.cutK ? `${n0(x.cutK)} lb K₂O` : null].filter(Boolean).join(', ') || 'already zero'}</td>
              <td className={tdNum}>{x.dollars > 0 ? money(x.dollars) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

export function RemovalCard() {
  const { inputs } = useSavings()
  const rows = useSoilRows()
  const list = rows
    .map((x) => {
      const p = suggestedRate(x.pRating as 'low' | 'marginal' | 'ok' | 'high' | null, x.recP, x.removal?.p2o5 ?? null, { nutrient: 'p', olsenPpm: x.soil?.oP, texture: x.texture })
      const k = suggestedRate(x.kRating as 'low' | 'marginal' | 'ok' | 'high' | null, x.recK, x.removal?.k2o ?? null, { nutrient: 'k' })
      const maintainP = p.rule === 'maintain' ? x.recP - p.rate : 0
      const maintainK = k.rule === 'maintain' ? x.recK - k.rate : 0
      return { ...x, p, k, dollars: (maintainP * (inputs.perLb.p2o5 ?? 0) + maintainK * (inputs.perLb.k2o ?? 0)) * (x.r.acres ?? 0) }
    })
    .filter((x) => x.recP > 0 || x.recK > 0)
  const saving = list.reduce((s, x) => s + x.dollars, 0)
  useReportSaving(13, saving)
  return (
    <ToolCard
      n={13}
      method={
        <>
          Removal is the harvested crop only, per bushel (per cwt for dry beans and potatoes, per ton for
          hay and silage), from Alberta and IPNI figures. Low-P fields build toward Olsen 15 over four
          years at the soil's buffer (about 20 lb P₂O₅ per ppm on sand, 37 on clay); adequate fields
          replace removal; very high fields take only a starter. The saving counts only the "maintain"
          fields; very high fields are on the don't-apply list.
        </>
      }
      sources={[S.soil, S.fields, S.requirements]}
      title="Removal-based P and K"
      why="Replace only what the last crop took off where the soil is adequate; build where it is low; draw down where it is high."
      saving={saving}
      note={!list.some((x) => x.removal) ? 'needs last year’s yields' : null}
    >
      {!list.length ? (
        <Empty>No phosphate or potash in this season's recommendations.</Empty>
      ) : (
        <Table head={['Field', 'Last crop', 'Removed P₂O₅ · K₂O', 'Rec P₂O₅ · K₂O', 'Rule', 'Suggested', 'Worth']}>
          {list.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={td}>
                {x.last?.crop ?? '—'}
                {x.last?.yield_per_acre != null && (
                  <span className="block text-[10px] text-gray-400">
                    {n0(x.last.yield_per_acre)} {x.last.yield_unit}
                  </span>
                )}
              </td>
              <td className={tdNum}>{x.removal ? `${n0(x.removal.p2o5)} · ${n0(x.removal.k2o)}` : '—'}</td>
              <td className={tdNum}>
                {n0(x.recP)} · {n0(x.recK)}
              </td>
              <td className={td}>
                P {x.p.rule}, K {x.k.rule}
              </td>
              <td className={tdNum}>
                {n0(x.p.rate)} · {n0(x.k.rate)}
              </td>
              <td className={tdNum}>{x.dollars > 0 ? money(x.dollars) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------ 14, 15 */

/**
 * What tools 12 and 13 found on each soil-tested field, in dollars: the
 * phosphate and potash a high test says to skip, and the excess over crop
 * removal where the soil is adequate. Tool 28 weighs these against what the
 * sampling cost.
 */
export function useSoilFindings() {
  const { inputs } = useSavings()
  const rows = useSoilRows()
  return useMemo(() => {
    const out = new Map<string, { name: string; acres: number | null; testYear: number | null; skip: number; maintain: number }>()
    for (const x of rows) {
      if (!x.soil) continue
      const skip =
        ((x.pRating === 'high' ? Math.max(0, x.recP - (x.abP?.rate ?? 0)) : 0) * (inputs.perLb.p2o5 ?? 0) +
          (x.kRating === 'high' ? Math.max(0, x.recK - (x.abK?.rate ?? 0)) : 0) * (inputs.perLb.k2o ?? 0)) *
        (x.r.acres ?? 0)
      const p = suggestedRate(x.pRating as 'low' | 'marginal' | 'ok' | 'high' | null, x.recP, x.removal?.p2o5 ?? null, { nutrient: 'p', olsenPpm: x.soil?.oP, texture: x.texture })
      const k = suggestedRate(x.kRating as 'low' | 'marginal' | 'ok' | 'high' | null, x.recK, x.removal?.k2o ?? null, { nutrient: 'k' })
      const maintain =
        ((p.rule === 'maintain' ? x.recP - p.rate : 0) * (inputs.perLb.p2o5 ?? 0) + (k.rule === 'maintain' ? x.recK - k.rate : 0) * (inputs.perLb.k2o ?? 0)) * (x.r.acres ?? 0)
      out.set(x.r.fieldId, { name: x.r.fieldName, acres: x.r.acres, testYear: x.soil.reportYear, skip, maintain: Math.max(0, maintain) })
    }
    return out
  }, [rows, inputs.perLb])
}

function useSplitRows() {
  const { inputs } = useSavings()
  const planned = usePlanned()
  const { data: plans } = useFertRows('fert_split_plans', inputs.cropYear)
  const def = Number(inputs.settings.get('split_upfront_pct') ?? 70)
  const byCrop = inputs.settings.get('split_upfront_by_crop')
  const uan = inputs.costs.find((c) => c.key === '28-0-0')?.perLb ?? inputs.perLb.n ?? null
  return useMemo(
    () =>
      planned
        .filter((r) => inputs.irrigated.has(r.fieldId) && lineLb(r, 'N') > 0)
        .map((r) => {
          const row = (plans ?? []).find((p) => p.field_id === r.fieldId) ?? null
          // A saved plan stands; otherwise the crop's own split (canola and
          // cereals 75% up front, corn 70, potatoes 60), then the farm default.
          const crop = inputs.cropOf(inputs.planFor(r.fieldId)?.crop_id)?.name ?? r.cropLabel
          const pct = row ? Number(row.upfront_pct) : upfrontSplitFor(crop, byCrop, def)
          const sp = splitPlan(lineLb(r, 'N'), pct, r.acres ?? 0)
          return { r, row, pct, sp, recN: lineLb(r, 'N'), inSeasonValue: uan != null ? sp.inSeasonLbAc * (r.acres ?? 0) * uan : null }
        }),
    [planned, plans, def, byCrop, uan, inputs],
  )
}

export function SplitCard() {
  const { inputs } = useSavings()
  const rows = useSplitRows()
  const m = useFertMutations('fert_split_plans')
  const saving = rows.filter((x) => x.row?.status === 'skipped').reduce((s, x) => s + (x.inSeasonValue ?? 0), 0)
  useReportSaving(14, saving)
  const save = (fieldId: string, patch: { upfront_pct?: number; status?: 'planned' | 'applied' | 'skipped' }, cur: { pct: number; status: string }) =>
    m.upsert.mutate({
      row: {
        field_id: fieldId,
        crop_year: inputs.cropYear,
        upfront_pct: patch.upfront_pct ?? cur.pct,
        status: (patch.status ?? cur.status) as 'planned' | 'applied' | 'skipped',
        decided_on: patch.status && patch.status !== 'planned' ? new Date().toISOString().slice(0, 10) : null,
      },
      onConflict: 'field_id,crop_year',
    })
  return (
    <ToolCard
      n={14}
      method={
        <>
          The in-season share is decided in July against the tissue test and the AIMM water balance, not
          in the spring. A top-up marked skipped counts as saved, at the UAN price.
        </>
      }
      sources={[S.pivots, S.requirements]}
      title="In-season splits through the pivot"
      why="Part of the nitrogen held back and put on as UAN through the pivot in season, so it is only bought if the crop needs it."
      saving={saving}
      savingLabel="saved by skipping"
      note={!rows.length ? 'no irrigated field with N' : `${rows.length} irrigated fields`}
    >
      {!rows.length ? (
        <Empty>No irrigated field has nitrogen in its recommendation this season.</Empty>
      ) : (
        <Table head={['Field', 'Rec N', 'At seeding', 'Through the pivot', 'UAN 28 (liquid N)', 'Status']}>
          {rows.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={tdNum}>{n0(x.recN)}</td>
              <td className={tdNum}>
                <input
                  defaultValue={x.pct}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v >= 0 && v <= 100 && v !== x.pct) save(x.r.fieldId, { upfront_pct: v }, { pct: x.pct, status: x.row?.status ?? 'planned' })
                  }}
                  className={cn(input, 'w-14 text-right')}
                />
                % · {n0(x.sp.upfrontLbAc)} lb
              </td>
              <td className={tdNum}>{n0(x.sp.inSeasonLbAc)} lb/ac</td>
              <td className={tdNum}>
                {n0(x.sp.uanLitresPerAc)} L/ac
                <span className="block text-[10px] text-gray-400">{n0(x.sp.uanLitresTotal)} L</span>
              </td>
              <td className={td}>
                <Select
                  value={x.row?.status ?? 'planned'}
                  size="sm"
                  className="w-24"
                  ariaLabel="Status"
                  onChange={(v) => save(x.r.fieldId, { status: v as 'planned' | 'applied' | 'skipped' }, { pct: x.pct, status: x.row?.status ?? 'planned' })}
                  options={[
                    { value: 'planned', label: 'Planned' },
                    { value: 'applied', label: 'Applied' },
                    { value: 'skipped', label: 'Skipped' },
                  ]}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

export function TissueGateCard() {
  const { inputs } = useSavings()
  const rows = useSplitRows()
  const m = useFertMutations('fert_split_plans')
  const gated = rows
    .filter((x) => (x.row?.status ?? 'planned') === 'planned')
    .map((x) => {
      const test = inputs.tissue.find((t) => t.field_id === x.r.fieldId) ?? null
      const band = test ? (rangesFor(test.crop, test.growth_stage)?.ranges.n_pct ?? null) : null
      return { ...x, test, band, gate: tissueGate(test ? { n_pct: test.n_pct == null ? null : Number(test.n_pct) } : null, band) }
    })
  const saving = gated.filter((x) => x.gate === 'skip').reduce((s, x) => s + (x.inSeasonValue ?? 0), 0)
  useReportSaving(15, saving)
  return (
    <ToolCard
      n={15}
      warn={gated.some((x) => x.gate === 'apply')}
      method={<>Only this season's test on the field counts, judged against the band for its crop and growth stage on the tissue-test tab.</>}
      sources={[S.tissue, S.pivots]}
      title="Tissue-test gate on top-ups"
      why="A planned in-season top-up is flagged to skip when the crop's tissue test says its nitrogen is already in band."
      saving={saving}
      note={!gated.some((x) => x.test) ? 'no tissue tests on these fields' : null}
    >
      {!gated.length ? (
        <Empty>No planned top-ups this season.</Empty>
      ) : (
        <Table head={['Field', 'Tissue N', 'Band', 'Verdict', 'Top-up worth', '']}>
          {gated.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={tdNum}>
                {x.test?.n_pct != null ? `${Number(x.test.n_pct).toFixed(2)}%` : '—'}
                {x.test && <span className="block text-[10px] text-gray-400">{x.test.sampled_on}</span>}
              </td>
              <td className={tdNum}>{x.band ? `${x.band[0]}–${x.band[1]}%` : '—'}</td>
              <td className={td}>
                {x.gate === 'skip' ? (
                  <span className="font-semibold text-green-800">in band — skip</span>
                ) : x.gate === 'apply' ? (
                  <span className="font-semibold text-amber-800">short — apply</span>
                ) : (
                  <span className="text-gray-400">take a test first</span>
                )}
              </td>
              <td className={tdNum}>{x.inSeasonValue != null ? money(x.inSeasonValue) : '—'}</td>
              <td className="px-2 py-1 text-right">
                {x.gate === 'skip' && (
                  <button
                    className={ghost}
                    onClick={() =>
                      m.upsert.mutate({
                        row: { field_id: x.r.fieldId, crop_year: inputs.cropYear, upfront_pct: x.pct, status: 'skipped', decided_on: new Date().toISOString().slice(0, 10) },
                        onConflict: 'field_id,crop_year',
                      })
                    }
                  >
                    Skip it
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ----------------------------------------------------------------- 16 */

export function EnhancedCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const planned = usePlanned()
  const esn = inputs.priced.currentOf('44-0-0')
  const urea = inputs.priced.currentOf('46-0-0')
  const premiumPerLbN = esn && urea ? esn.perTonne / lbInTonne(44) - urea.perTonne / lbInTonne(46) : null
  const rows = planned
    .filter((r) => lineLb(r, 'N') > 0)
    .map((r) => {
      const field = inputs.fields.find((f) => f.id === r.fieldId)
      const nLines = (r.lines ?? []).filter((l) => (l.nutrient ?? '').toUpperCase() === 'N')
      const said = nLines.map((l) => `${l.timing ?? ''} ${l.product ?? ''} ${l.note ?? ''}`).join(' ').toLowerCase()
      const risk = nitrogenLossRisk(field?.soil_texture, inputs.irrigated.has(r.fieldId), {
        fall: /fall/.test(said),
        surface: /broadcast|top.?dress|surface/.test(said) && !/incorporat|band|inject/.test(said),
      })
      const advice = enhancedAdvice(risk.risk)
      const esnLb = (r.lines ?? []).filter((l) => straightKeyOf(l.product) === '44-0-0' || /esn|stabili|agrotain|super ?u/i.test(l.product)).reduce((s, l) => s + l.lbPerAc, 0)
      const wasted = !advice.use && esnLb > 0 && premiumPerLbN != null ? esnLb * premiumPerLbN * (r.acres ?? 0) : 0
      return { r, texture: field?.soil_texture ?? null, risk, advice, esnLb, wasted }
    })
  const saving = rows.reduce((s, x) => s + x.wasted, 0)
  useReportSaving(16, saving)
  return (
    <ToolCard
      n={16}
      method={<>Risk is from the field's recorded soil texture, whether a pivot covers it, and whether the recommendation puts N on in the fall or broadcast on the surface. The premium is ESN's cost per pound of N over urea's, at the current {retailerName}, quote or DTN prices.</>}
      sources={[S.fields, S.pivots, S.market]}
      title="ESN and stabilizers where they pay"
      why="Protected nitrogen recommended only where it is likely to be lost; plain urea everywhere else."
      saving={saving}
      note={premiumPerLbN == null ? 'quote ESN to price the premium' : `ESN premium ${perLbFmt(premiumPerLbN)} N`}
    >
      {!rows.length ? (
        <Empty>No nitrogen in this season's recommendations.</Empty>
      ) : (
        <Table head={['Field', 'Soil', 'Irrigated', 'Loss risk', 'Advice', 'ESN planned', 'Premium not needed']}>
          {rows.map((x) => (
            <tr key={x.r.fieldId}>
              <td className={td}><FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" /></td>
              <td className={td}>{x.texture ?? '—'}</td>
              <td className={td}>{inputs.irrigated.has(x.r.fieldId) ? 'yes' : 'no'}</td>
              <td className={td}>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    x.risk.risk === 'high' ? 'bg-amber-100 text-amber-800' : x.risk.risk === 'moderate' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800',
                  )}
                  title={x.risk.reasons.join('; ')}
                >
                  {x.risk.risk}
                </span>
              </td>
              <td className={td}>{x.advice.text}</td>
              <td className={tdNum}>{x.esnLb ? `${n0(x.esnLb)} lb N` : '—'}</td>
              <td className={tdNum}>{x.wasted > 0 ? money(x.wasted) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ----------------------------------------------------------------- 17 */

export function VrCard() {
  const { inputs } = useSavings()
  const { data: yz } = useYieldZones()
  const rows = inputs.rx
    .filter((rx) => rx.zones.length > 1)
    .map((rx) => {
      const parts = (['n', 'p2o5', 'k2o'] as const).map((k) => {
        const v = vrSaving(rx.zones.map((z) => ({ acres: z.acres, rate: z[k] })))
        return { k, v, dollars: v ? v.lbSaved * (inputs.perLb[k] ?? 0) : 0 }
      })
      return { rx, parts, kind: rxKind(rx.zones), dollars: parts.reduce((s, p) => s + p.dollars, 0) }
    })
    .filter((x) => x.kind === 'variable')
  const saving = rows.reduce((s, x) => s + x.dollars, 0)
  useReportSaving(17, saving)
  const withRx = new Set(rows.map((x) => x.rx.field_id))
  const candidates = byField(yz ?? [])
    .map((f) => ({ ...f, spread: fieldSpread(f.zones) }))
    .filter((f) => f.spread && f.spread.spread >= WORTH_VARYING && !withRx.has(f.fieldId))
  return (
    <ToolCard
      n={17}
      warn={candidates.length > 0}
      method={<>A flat rate is taken at the top zone's rate, which is what it takes to be sure of the best ground. Against the field-average rate a prescription saves nothing in tonnes — it moves them to where they pay.</>}
      sources={[S.rx, S.zones]}
      title="Variable rate versus flat"
      why="What each zone prescription saves against a flat rate set high enough for the best ground."
      saving={saving}
      note={!rows.length ? `no variable-rate prescriptions for ${inputs.cropYear}` : null}
    >
      {!rows.length ? (
        <Empty>No variable-rate prescriptions for {inputs.cropYear}.</Empty>
      ) : (
        <Table head={['Field', 'Acres', 'N weighted · top', 'P₂O₅ weighted · top', 'K₂O weighted · top', 'Saved vs flat']}>
          {rows.map((x) => (
            <tr key={x.rx.id}>
              <td className={td}>{x.rx.field_label}</td>
              <td className={tdNum}>{n0(x.rx.total_acres ?? x.rx.acres)}</td>
              {x.parts.map((p) => (
                <td key={p.k} className={tdNum}>
                  {p.v ? `${n0(p.v.weighted)} · ${n0(p.v.top)}` : '—'}
                </td>
              ))}
              <td className={tdNum}>{x.dollars > 0 ? money(x.dollars) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      {!!candidates.length && (
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <strong>Worth a zone prescription:</strong>{' '}
          {candidates.map((c) => `${c.name} (yields ${n0(c.spread!.lo)}–${n0(c.spread!.hi)})`).join(', ')} — the productivity zones differ by {WORTH_VARYING}+ and there is no variable prescription.
        </div>
      )}
    </ToolCard>
  )
}
