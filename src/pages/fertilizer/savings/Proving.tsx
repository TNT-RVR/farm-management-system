import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { HelpNote } from '@/components/HelpNote'
import { Plus } from 'lucide-react'
import { rowClick, type EditField } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { withCurrent } from '@/lib/record-detail'
import { appliedFertiliser, weightedRate } from '@/lib/fertility-rx'
import { useSeasonOperations, type FieldOperation } from '@/lib/fieldOps'
import { analysisOf, farmTypical } from '@/lib/manure-credit'
import { useBinLoads } from '@/lib/bin-loads'
import { cropRemoval, nutrientBalance, overApplied, stripResult } from '@/lib/fert-savings/tools'
import { useFertMutations, useFertRows, type CheckStrip } from '@/lib/fert-savings/data'
import type { NutrientKey } from '@/lib/fert-savings/straights'
import { cn } from '@/lib/utils'
import { useReportSaving, useSavings } from './context'
import { S } from './sources'
import { Empty, FieldLink, Table, ToolCard, button, input, money, n0, td, tdNum } from './ui'
import { RowDelete, RowEditor } from './RowEditor'

type Nut = Record<'n' | 'p2o5' | 'k2o' | 's', number>
const zero = (): Nut => ({ n: 0, p2o5: 0, k2o: 0, s: 0 })

/** Pounds an acre of each nutrient the machines put on a field in a season. */
function appliedOn(ops: FieldOperation[], fieldId: string): { lb: Nut; passes: number; counted: number } {
  const passes = appliedFertiliser(ops.filter((o) => o.field_id === fieldId))
  const lb = zero()
  let counted = 0
  for (const p of passes) {
    if (!p.nutrients) continue
    counted++
    lb.n += p.nutrients.n
    lb.p2o5 += p.nutrients.p2o5
    lb.k2o += p.nutrients.k2o
    lb.s += p.nutrients.s
  }
  return { lb, passes: passes.length, counted }
}

const valueOf = (lb: Nut, perLb: Partial<Record<NutrientKey, number>>) =>
  lb.n * (perLb.n ?? 0) + lb.p2o5 * (perLb.p2o5 ?? 0) + lb.k2o * (perLb.k2o ?? 0) + lb.s * (perLb.s ?? 0)

/* ----------------------------------------------------------------- 18 */

export function OverAppliedCard() {
  const { inputs } = useSavings()
  const rows = useMemo(
    () =>
      inputs.rx
        .filter((rx) => rx.field_id && rx.zones.length)
        .map((rx) => {
          const applied = appliedOn(inputs.ops, rx.field_id!)
          const prescribed = { n: weightedRate(rx.zones, 'n'), p2o5: weightedRate(rx.zones, 'p2o5'), k2o: weightedRate(rx.zones, 'k2o'), s: weightedRate(rx.zones, 's') }
          const over = overApplied(prescribed, applied.lb)
          const acres = rx.total_acres ?? rx.acres ?? 0
          return { rx, applied, prescribed, over, dollars: valueOf(over, inputs.perLb) * acres }
        })
        .filter((x) => x.applied.counted > 0),
    [inputs.rx, inputs.ops, inputs.perLb],
  )
  const saving = rows.reduce((s, x) => s + x.dollars, 0)
  useReportSaving(18, saving)
  return (
    <ToolCard
      n={18}
      method={
        <>
          Prescribed is the acre-weighted rate across the zones; applied is every Deere pass on the field
          this season read through its product's analysis. Anything within 5% is taken as on target, and
          under-application is not counted as a saving.
        </>
      }
      sources={[S.rx, S.fields]}
      title="Applied versus prescribed, in dollars"
      why="Where the machines put on more than the prescription asked, priced — a sticky controller or a wrong rate shows up as money."
      saving={saving}
      savingLabel="over-applied"
      note={!rows.length ? `no machine records against ${inputs.cropYear} prescriptions` : saving <= 0 ? 'on target' : null}
    >
      {!rows.length ? (
        <Empty>No Deere fertilizer passes on a field with a {inputs.cropYear} prescription.</Empty>
      ) : (
        <Table head={['Field', 'Prescribed N · P · K · S', 'Applied N · P · K · S', 'Over', 'Worth']}>
          {rows.map((x) => (
            <tr key={x.rx.id}>
              <td className={td}>
                <FieldLink id={x.rx.field_id} name={x.rx.field_label} to="work" />
              </td>
              <td className={tdNum}>
                {n0(x.prescribed.n)} · {n0(x.prescribed.p2o5)} · {n0(x.prescribed.k2o)} · {n0(x.prescribed.s)}
              </td>
              <td className={tdNum}>
                {n0(x.applied.lb.n)} · {n0(x.applied.lb.p2o5)} · {n0(x.applied.lb.k2o)} · {n0(x.applied.lb.s)}
                {x.applied.passes > x.applied.counted && (
                  <span className="block text-[10px] text-gray-400">{x.applied.passes - x.applied.counted} pass(es) by volume not counted</span>
                )}
              </td>
              <td className={td}>
                {(['n', 'p2o5', 'k2o', 's'] as const)
                  .filter((k) => x.over[k] > 0)
                  .map((k) => `${n0(x.over[k])} lb ${k === 'n' ? 'N' : k === 'p2o5' ? 'P₂O₅' : k === 'k2o' ? 'K₂O' : 'S'}`)
                  .join(', ') || 'within 5%'}
              </td>
              <td className={cn(tdNum, x.dollars > 0 && 'text-red-700')}>{x.dollars > 0 ? money(x.dollars) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      {/* The pound-by-pound comparison, pass by pass, is the Prescriptions
          view's "Against what was applied"; this card only prices it and
          lists the farm on one table, which that view cannot. */}
      <p className="mt-2 text-xs text-gray-500">
        Pass by pass, field by field:{' '}
        <Link to="/fertilizer?tab=Prescriptions" className="text-brand-700 underline decoration-dotted">
          Prescriptions → Against what was applied
        </Link>
        .
      </p>
    </ToolCard>
  )
}

/* ----------------------------------------------------------------- 19 */

export function CostPerBushelCard() {
  const { inputs } = useSavings()
  const { data: loads } = useBinLoads()
  const rows = useMemo(() => {
    const fieldIds = new Set<string>([
      ...inputs.ops.map((o) => o.field_id).filter((x): x is string => !!x),
      ...inputs.history.filter((h) => h.crop_year === inputs.cropYear).map((h) => h.field_id),
    ])
    return [...fieldIds]
      .map((id) => {
        const applied = appliedOn(inputs.ops, id)
        const perAc = valueOf(applied.lb, inputs.perLb)
        const hist = inputs.history.find((h) => h.field_id === id && h.crop_year === inputs.cropYear)
        const req = inputs.requirements.find((r) => r.fieldId === id)
        const acres = hist?.acres ?? req?.acres ?? null
        const loaded = (loads ?? []).filter((l) => l.field_id === id && l.crop_year === inputs.cropYear).reduce((s, l) => s + Number(l.bushels), 0)
        const yieldPerAc = hist?.yield_per_acre ?? (loaded > 0 && acres ? loaded / acres : null)
        const fromLoads = hist?.yield_per_acre == null && loaded > 0
        return {
          id,
          name: inputs.fieldName(id),
          crop: hist?.crop ?? inputs.cropOf(inputs.planFor(id)?.crop_id)?.name ?? null,
          perAc,
          yieldPerAc,
          unit: hist?.yield_unit ?? 'bu/ac',
          fromLoads,
          perUnit: perAc > 0 && yieldPerAc ? perAc / yieldPerAc : null,
          counted: applied.counted,
        }
      })
      .filter((x) => x.counted > 0)
      .sort((a, b) => (b.perUnit ?? -1) - (a.perUnit ?? -1))
  }, [inputs, loads])
  useReportSaving(19, null)
  const ranked = rows.filter((r) => r.perUnit != null)
  return (
    <ToolCard
      n={19}
      method={
        <>
          Fertilizer $/ac is what the Deere passes put on, valued at today's cheapest pound of each
          nutrient, so fields compare like for like. Yield is the crop history, or bushels weighed into
          bins from the field this season where the history is not in yet.
        </>
      }
      sources={[S.fields, S.bins]}
      title="Fertilizer cost per bushel by field"
      why="Fertilizer dollars an acre over bushels an acre, ranked — the fields at the top are where to look first."
      saving={null}
      note={ranked.length ? `dearest: ${ranked[0].name} at ${money(ranked[0].perUnit, 2)}` : 'needs yields for this season'}
    >
      {!rows.length ? (
        <Empty>No fertilizer passes recorded for {inputs.cropYear}.</Empty>
      ) : (
        <Table head={['Field', 'Crop', 'Fertilizer $/ac', 'Yield', '$ per unit']}>
          {rows.map((x) => (
            <tr key={x.id}>
              <td className={td}>
                <FieldLink id={x.id} name={x.name} to="work" />
              </td>
              <td className={td}>{x.crop ?? '—'}</td>
              <td className={tdNum}>{money(x.perAc, 2)}</td>
              <td className={tdNum}>
                {x.yieldPerAc != null ? `${n0(x.yieldPerAc)} ${x.unit}` : '—'}
                {x.fromLoads && <span className="block text-[10px] text-gray-400">from bin loads so far</span>}
              </td>
              <td className={cn(tdNum, 'font-semibold')}>{x.perUnit != null ? money(x.perUnit, 2) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/**
 * Phosphate and potash on and off each field over the last three seasons.
 *
 * It was half of the check-strips card, which made one card answer two
 * unrelated questions. It sits with the running P and K balance now, which
 * asks the same question from the last soil test forward.
 */
export function ThreeSeasonBalance() {
  const { inputs } = useSavings()
  const y0 = inputs.cropYear
  const { data: ops0 } = useSeasonOperations(y0)
  const { data: ops1 } = useSeasonOperations(y0 - 1)
  const { data: ops2 } = useSeasonOperations(y0 - 2)

  const balance = useMemo(() => {
    const opsBy: Record<number, FieldOperation[]> = { [y0]: ops0 ?? [], [y0 - 1]: ops1 ?? [], [y0 - 2]: ops2 ?? [] }
    const ids = new Set<string>(Object.values(opsBy).flatMap((list) => list.map((o) => o.field_id).filter((x): x is string => !!x)))
    return [...ids]
      .map((id) => {
        const years = [y0 - 2, y0 - 1, y0].map((year) => {
          const a = appliedOn(opsBy[year], id).lb
          // Manure's whole P and K count toward the balance, spread over the field by the acres covered.
          const acres = inputs.requirements.find((r) => r.fieldId === id)?.acres ?? null
          for (const app of inputs.manure.filter((x) => x.field_id === id && x.crop_year === year)) {
            const an = analysisOf(app as unknown as { source: string; n_lb_ton: number | null; p2o5_lb_ton: number | null; k2o_lb_ton: number | null }, farmTypical(inputs.manure as never))
            const share = acres && app.acres ? Math.min(1, Number(app.acres) / acres) : 1
            a.p2o5 += an.p2o5 * Number(app.rate_tons_per_acre ?? 0) * share
            a.k2o += an.k2o * Number(app.rate_tons_per_acre ?? 0) * share
          }
          const h = inputs.history.find((x) => x.field_id === id && x.crop_year === year)
          const removed = h ? cropRemoval(h.crop, h.yield_per_acre, h.yield_unit) : null
          return { year, applied: { p2o5: a.p2o5, k2o: a.k2o }, removed: removed ? { p2o5: removed.p2o5, k2o: removed.k2o } : null }
        })
        return { id, name: inputs.fieldName(id), b: nutrientBalance(years) }
      })
      .sort((a, b) => b.b.p + b.b.k - (a.b.p + a.b.k))
  }, [ops0, ops1, ops2, inputs, y0])

  return (
    <>
      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Season by season, {y0 - 2}–{y0}
      </h4>
      {!balance.length ? (
        <Empty>No fertilizer passes in the last three seasons.</Empty>
      ) : (
        <Table head={['Field', ...[y0 - 2, y0 - 1, y0].map((y) => `${y} net P · K`), 'Running P₂O₅', 'Running K₂O']}>
          {balance.map((x) => (
            <tr key={x.id}>
              <td className={td}>
                <FieldLink id={x.id} name={x.name} to="history" />
              </td>
              {x.b.rows.map((r) => (
                <td key={r.year} className={tdNum}>
                  {n0(r.netP)} · {n0(r.netK)}
                  {!r.removed && <span className="block text-[10px] text-gray-400">no yield</span>}
                </td>
              ))}
              <td className={cn(tdNum, x.b.p > 50 ? 'text-sky-800' : x.b.p < -50 ? 'text-amber-800' : '')}>{n0(x.b.p)}</td>
              <td className={cn(tdNum, x.b.k > 50 ? 'text-sky-800' : x.b.k < -50 ? 'text-amber-800' : '')}>{n0(x.b.k)}</td>
            </tr>
          ))}
        </Table>
      )}
      <HelpNote className="mt-1" summary="Positive is building (blue past +50 lb/ac), negative is mining (amber past −50)." title="How the season balance is worked out">
        Positive is building (blue past +50 lb/ac), negative is mining (amber past −50). Applied is Deere passes plus manure; removed is the crop history&apos;s yield at CFI removal rates.
      </HelpNote>
    </>
  )
}

/* ----------------------------------------------------------------- 20 */

const NUTRIENTS = ['N', 'P2O5', 'K2O', 'S', 'other'] as const

/** A strip's form (Sam, 7 Oct 2026: the strips can be edited, not only added and deleted). */
const stripFields = (fieldOptions: { value: string; label: string }[], fieldId: string): EditField[] => [
  { key: 'field_id', label: 'Field', kind: 'select', required: true, options: withCurrent(fieldOptions, fieldId) },
  { key: 'nutrient', label: 'Nutrient', kind: 'select', required: true, options: NUTRIENTS.map((x) => ({ value: x, label: x })) },
  { key: 'field_rate', label: 'Field rate (lb/ac)', kind: 'number' },
  { key: 'strip_rate', label: 'Strip rate (lb/ac)', kind: 'number' },
  { key: 'strip_acres', label: 'Strip acres', kind: 'number' },
  { key: 'where_text', label: 'Where', kind: 'text', placeholder: '3rd pass from east' },
  { key: 'field_yield', label: 'Field yield', kind: 'number' },
  { key: 'strip_yield', label: 'Strip yield', kind: 'number' },
  { key: 'yield_unit', label: 'Yield unit', kind: 'text', placeholder: 'bu/ac' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]

export function BalanceAndStripsCard() {
  const { inputs } = useSavings()
  const y0 = inputs.cropYear
  const { data: strips } = useFertRows('fert_check_strips', y0)
  const m = useFertMutations('fert_check_strips')
  const [f, setF] = useState({ field_id: '', nutrient: 'N' as 'N' | 'P2O5' | 'K2O' | 'S' | 'other', field_rate: '', strip_rate: '', where: '', field_yield: '', strip_yield: '' })
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const [opened, setOpened] = useState<CheckStrip | null>(null)

  const stripRows = (strips ?? []).map((s) => {
    const cropId = inputs.planFor(s.field_id)?.crop_id
    const price = cropId ? (inputs.cropPrices.get(cropId) ?? null) : null
    const key = s.nutrient === 'N' ? 'n' : s.nutrient === 'P2O5' ? 'p2o5' : s.nutrient === 'K2O' ? 'k2o' : s.nutrient === 'S' ? 's' : null
    const res = stripResult(
      {
        field_rate: s.field_rate == null ? null : Number(s.field_rate),
        strip_rate: s.strip_rate == null ? null : Number(s.strip_rate),
        field_yield: s.field_yield == null ? null : Number(s.field_yield),
        strip_yield: s.strip_yield == null ? null : Number(s.strip_yield),
      },
      key ? (inputs.perLb[key] ?? null) : null,
      price,
    )
    return { s, res }
  })
  // Money a strip proved was wasted: extra fertilizer that returned less than it cost, per acre.
  const wasted = stripRows.reduce((sum, x) => {
    if (!x.res || x.res.paid == null || x.res.paid >= 0) return sum
    const acres = inputs.requirements.find((r) => r.fieldId === x.s.field_id)?.acres ?? 0
    return sum + -x.res.paid * acres
  }, 0)
  useReportSaving(20, wasted > 0 ? wasted : null)
  const fieldOptions = inputs.fields.map((fl) => ({ value: fl.id, label: fl.name }))

  return (
    <ToolCard
      n={20}
      method={<>Lay the strip at seeding with the rate in the prescription dropped for one pass; fill in both yields at harvest from the yield monitor or a weigh wagon.</>}
      sources={[S.fields]}
      title="Check strips"
      why="A strip left at a lower rate proves what the fertilizer returned. Which fields are overfed or mined is on the P and K running balance."
      saving={wasted > 0 ? wasted : null}
      savingLabel="proven over-fed"
      note={!strips?.length ? 'no check strips yet' : null}
    >
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Check strips, {y0}</h4>
      {!!stripRows.length && (
        <Table head={['Field', 'Nutrient', 'Field · strip rate', 'Field · strip yield', 'Extra fert cost', 'Extra crop value', 'Paid?', '']}>
          {stripRows.map(({ s, res }) => (
            <tr key={s.id} className="cursor-pointer hover:bg-gray-50" onClick={rowClick(() => setOpened(s))}>
              <td className={td}>
                {inputs.fieldName(s.field_id)}
                {s.where_text && <span className="block text-[10px] text-gray-400">{s.where_text}</span>}
              </td>
              <td className={td}>{s.nutrient}</td>
              <td className={tdNum}>
                {n0(s.field_rate == null ? null : Number(s.field_rate))} · {n0(s.strip_rate == null ? null : Number(s.strip_rate))}
              </td>
              <td className={tdNum}>
                {s.field_yield == null ? '—' : n0(Number(s.field_yield))} · {s.strip_yield == null ? '—' : n0(Number(s.strip_yield))}
              </td>
              <td className={tdNum}>{res?.cost != null ? money(res.cost, 2) : '—'}</td>
              <td className={tdNum}>{res?.value != null ? money(res.value, 2) : '—'}</td>
              <td className={cn(td, res?.paid != null && (res.paid >= 0 ? 'text-green-800' : 'text-red-700'))}>
                {res?.paid == null ? 'waiting for harvest' : res.paid >= 0 ? `yes, ${money(res.paid, 2)}/ac` : `no, lost ${money(-res.paid, 2)}/ac`}
              </td>
              <td className="px-2 py-1 text-right">
                {isMgr && <RowDelete onDelete={() => m.remove.mutate(s.id)} confirm={`Delete the ${s.nutrient} check strip on ${inputs.fieldName(s.field_id)}?`} label="Delete strip" />}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {opened && (
        <RowEditor
          title={`Check strip · ${inputs.fieldName(opened.field_id)}`}
          fields={stripFields(fieldOptions, opened.field_id)}
          row={opened}
          canEdit={isMgr}
          saving={m.update.isPending || m.remove.isPending}
          error={(m.update.error ?? m.remove.error)?.message ?? null}
          onClose={() => {
            m.update.reset()
            setOpened(null)
          }}
          onSave={(v) =>
            m.update.mutateAsync({
              id: opened.id,
              field_id: String(v.field_id),
              nutrient: v.nutrient as CheckStrip['nutrient'],
              field_rate: v.field_rate as number | null,
              strip_rate: v.strip_rate as number | null,
              strip_acres: v.strip_acres as number | null,
              where_text: v.where_text as string | null,
              field_yield: v.field_yield as number | null,
              strip_yield: v.strip_yield as number | null,
              yield_unit: v.yield_unit as string | null,
              note: v.note as string | null,
            })
          }
          onDelete={() => m.remove.mutateAsync(opened.id)}
          deleteConfirm={`Delete this ${opened.nutrient} check strip?`}
        />
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
        <Select value={f.field_id} onChange={(v) => setF({ ...f, field_id: v })} options={[{ value: '', label: 'Field…' }, ...fieldOptions]} size="sm" className="w-44" ariaLabel="Field" />
        <Select
          value={f.nutrient}
          onChange={(v) => setF({ ...f, nutrient: v as typeof f.nutrient })}
          options={NUTRIENTS.map((x) => ({ value: x, label: x }))}
          size="sm"
          className="w-20"
          ariaLabel="Nutrient"
        />
        <input value={f.field_rate} onChange={(e) => setF({ ...f, field_rate: e.target.value })} placeholder="Field lb/ac" inputMode="decimal" className={cn(input, 'w-20 text-right')} />
        <input value={f.strip_rate} onChange={(e) => setF({ ...f, strip_rate: e.target.value })} placeholder="Strip lb/ac" inputMode="decimal" className={cn(input, 'w-20 text-right')} />
        <input value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} placeholder="Where — 3rd pass from east" className={cn(input, 'w-44')} />
        <input value={f.field_yield} onChange={(e) => setF({ ...f, field_yield: e.target.value })} placeholder="Field yield" inputMode="decimal" className={cn(input, 'w-20 text-right')} />
        <input value={f.strip_yield} onChange={(e) => setF({ ...f, strip_yield: e.target.value })} placeholder="Strip yield" inputMode="decimal" className={cn(input, 'w-20 text-right')} />
        <button
          className={button}
          disabled={!f.field_id || m.add.isPending}
          onClick={() =>
            m.add.mutate(
              {
                field_id: f.field_id,
                crop_year: y0,
                nutrient: f.nutrient,
                field_rate: f.field_rate ? Number(f.field_rate) : null,
                strip_rate: f.strip_rate ? Number(f.strip_rate) : null,
                where_text: f.where || null,
                field_yield: f.field_yield ? Number(f.field_yield) : null,
                strip_yield: f.strip_yield ? Number(f.strip_yield) : null,
              },
              { onSuccess: () => setF({ ...f, field_rate: '', strip_rate: '', where: '', field_yield: '', strip_yield: '' }) },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add a strip
        </button>
      </div>
    </ToolCard>
  )
}
