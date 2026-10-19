import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Droplets, ExternalLink, Receipt } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCropYear } from '@/lib/crop-year'
import { useFields } from '@/lib/queries'
import { useDistrictRate, useFieldPivots, usePumps } from '@/lib/irrigation'
import { usePowerPrices } from '@/lib/pivot-cost'
import { DEFAULT_APPLICATION_EFFICIENCY, pivotFlow, pivotHorsepower } from '@/lib/water-review'
import { allottedInchesFor, smridAllotmentFor } from '@/lib/water-allocation'
import { useBasics } from '@/lib/hauling-data'
import { useFarmSettings } from '@/lib/farm-setup'
import { useIrrigationSeason } from '@/lib/operation-cost-data'
import { inchesFrom, irrigationCost, pivotRunsOnUs, type WaterUnit } from '@/lib/irrigation-cost'
import { cn } from '@/lib/utils'

const box = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none'
const lbl = 'mb-0.5 block text-xs text-gray-500'
const money = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `$${v.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const pct = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`

const UNITS: { key: WaterUnit; label: string }[] = [
  { key: 'in', label: 'in' },
  { key: 'mm', label: 'mm' },
  { key: 'af', label: 'acre-ft' },
]

export function IrrigationCostCalculator() {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: pivots } = useFieldPivots()
  const { data: pumps } = usePumps()
  const { prices } = usePowerPrices()
  const basics = useBasics()
  const { districtName } = useFarmSettings()
  const { data: rate } = useDistrictRate(cropYear)

  const [fieldId, setFieldId] = useState('')
  const [pivotId, setPivotId] = useState('')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<WaterUnit>('in')
  const [labourHours, setLabourHours] = useState('')
  const { data: season } = useIrrigationSeason(fieldId || null, cropYear)

  const nameOf = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f.name])), [fields])
  const fieldOptions = useMemo(() => {
    const ids = [...new Set((pivots ?? []).map((p) => p.field_id))].filter((id) => nameOf.has(id))
    return ids
      .map((id) => ({ value: id, label: nameOf.get(id)! }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [pivots, nameOf])

  const onField = useMemo(() => (pivots ?? []).filter((p) => p.field_id === fieldId), [pivots, fieldId])
  const pivot = onField.find((p) => p.id === pivotId) ?? onField[0] ?? null
  const runs = pivot ? pivotRunsOnUs(pivot) : null
  const pump = pivot?.pump_id ? ((pumps ?? []).find((p) => p.id === pivot.pump_id) ?? null) : null
  const onPump = pump ? (pivots ?? []).filter((p) => p.pump_id === pump.id).length : 0

  const acres = pivot?.acres_irrigated != null ? Number(pivot.acres_irrigated) : null
  const flow = pivot ? pivotFlow(pivot, null, pump && onPump === 1 ? { gpm: pump.gpm, gpm_estimate: pump.gpm_estimate } : null) : { gpm: null, from: null }
  const share = pivotHorsepower(pump ? { name: pump.name, horse_power: pump.horse_power, gpm: pump.gpm ?? pump.gpm_estimate } : undefined, onPump, flow.gpm)
  const price = prices.basis === 'sell' ? prices.sell : prices.buy
  const eff = pivot?.application_efficiency != null ? Number(pivot.application_efficiency) : DEFAULT_APPLICATION_EFFICIENCY
  const smrid = smridAllotmentFor(season?.allotments ?? [], cropYear)
  const allot = pivot ? allottedInchesFor(pivot, smrid.inches) : { inches: null, from: null }
  const inches = inchesFrom(Number(amount), unit, acres)
  const hrs = labourHours.trim() === '' ? null : Number(labourHours)

  const c =
    pivot && runs?.ok
      ? irrigationCost({
          acres,
          gpm: flow.gpm,
          hp: share.hp,
          pricePerKwh: price,
          inches,
          efficiency: eff,
          wage: basics.wage,
          labourHours: hrs != null && Number.isFinite(hrs) ? hrs : null,
          waterValueAf: prices.waterValueAf,
          allottedIn: allot.inches,
          licenceAf: pivot.acre_feet_allotment != null ? Number(pivot.acre_feet_allotment) : null,
          usedIn: season ? season.usedIn : null,
        })
      : null
  const missing = pivot && runs?.ok ? ([!acres && 'irrigated acres', !flow.gpm && 'a flow (gpm)', !share.hp && 'a pump with its horsepower'].filter(Boolean) as string[]) : []
  const canal = pivot?.water_source === 'smrid' || pivot?.smrid_area != null

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:col-span-2 lg:grid-cols-2">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Droplets className="h-4 w-4 text-brand-700" /> The water
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Field</label>
            <Select
              value={fieldId}
              ariaLabel="Field"
              className="w-full"
              onChange={(v) => {
                setFieldId(v)
                setPivotId('')
              }}
              options={[{ value: '', label: 'Pick a field' }, ...fieldOptions]}
            />
          </div>
          {onField.length > 1 && (
            <div>
              <label className={lbl}>Pivot</label>
              <Select
                value={pivot?.id ?? ''}
                ariaLabel="Pivot"
                className="w-full"
                onChange={setPivotId}
                options={onField.map((p, i) => {
                  const r = pivotRunsOnUs(p)
                  return {
                    value: p.id,
                    label: `${p.meter_name || p.brand || `Pivot ${i + 1}`}${p.acres_irrigated != null ? ` — ${Math.round(Number(p.acres_irrigated))} ac` : ''}${r.ok ? '' : ' (not ours to run)'}`,
                  }
                })}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={lbl}>Amount pumped</label>
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" step="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(box, 'w-28')} />
              <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                {UNITS.map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    onClick={() => setUnit(u.key)}
                    className={cn('px-2.5 py-1.5 text-xs', unit === u.key ? 'bg-brand-700 font-semibold text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={lbl}>Labour hours (checks, moves)</label>
            <input type="number" inputMode="decimal" value={labourHours} onChange={(e) => setLabourHours(e.target.value)} className={box} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Receipt className="h-4 w-4 text-brand-700" /> Cost
        </h2>
        {!pivot ? (
          <p className="text-sm text-gray-400">Pick a field with a pivot.</p>
        ) : !runs?.ok ? (
          <p className="text-sm text-gray-500">Not costed: {runs?.ok === false ? runs.why : ''}.</p>
        ) : missing.length || !c ? (
          <p className="text-xs text-gray-500">
            Needs {missing.length ? missing.join(', ') : 'an amount'} —{' '}
            <Link to="/irrigation-info" className="underline">
              Pivot Information
            </Link>
            {!share.hp && (
              <>
                {' / '}
                <Link to="/irrigation-info?tab=pump" className="underline">
                  Pump Information
                </Link>
              </>
            )}
            .
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-brand-50 px-3 py-2.5">
              <span className="text-2xl font-bold tabular-nums text-brand-900">{money(c.total)}</span>
              <span className="text-sm font-semibold tabular-nums text-brand-900">{money(c.perAcre, 2)}/ac</span>
              <span className="text-sm tabular-nums text-brand-900">{money(c.perAcreInch, 2)}/ac-in</span>
              <span className="ml-auto text-xs text-brand-900/70">
                {c.hours.toFixed(1)} h pumping · {c.kwh != null ? `${Math.round(c.kwh).toLocaleString('en-CA')} kWh` : '— kWh'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              {c.inches.toFixed(2)} in · {Math.round(c.mm)} mm · {c.acreFeet.toFixed(1)} acre-ft over {acres} ac
              {c.intoSoilIn != null && ` · about ${c.intoSoilIn.toFixed(2)} in into the soil at ${Math.round(eff * 100)}%`}
            </p>

            <table className="mt-3 w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-100 align-top">
                  <td className="py-1.5 pr-2">
                    <div className="font-medium text-gray-800">Power</div>
                    <div className="text-[11px] text-gray-500">
                      {Math.round(flow.gpm!).toLocaleString('en-CA')} gpm ({flow.from}); {Math.round(share.hp!)} hp{share.note ? ` — ${share.note}` : ''}, 90% motor efficiency; $
                      {price}/kWh ({prices.basis === 'sell' ? 'solar sell price' : 'grid price'})
                      <Link to="/utilities?tab=power" className="ml-1 inline-flex align-middle text-gray-400 hover:text-brand-700" aria-label="Power prices">
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">{money(c.power)}</td>
                </tr>
                <tr className="border-b border-gray-100 align-top">
                  <td className="py-1.5 pr-2">
                    <div className="font-medium text-gray-800">Labour</div>
                    <div className="text-[11px] text-gray-500">
                      {c.labour != null ? `${hrs} h × $${basics.wage.toFixed(2)}/h (${basics.wageSource})` : 'add labour hours to count it'}
                      <Link to="/hauling?tab=trucking" className="ml-1 inline-flex align-middle text-gray-400 hover:text-brand-700" aria-label="Wage">
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      {c.labour != null && <span className="text-gray-400"> · the payroll is also in the fixed $/ac</span>}
                    </div>
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">{money(c.labour)}</td>
                </tr>
                {canal && (
                  <tr className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium text-gray-400">{districtName} rate</div>
                      <div className="text-[11px] text-gray-400">
                        not added — a flat {rate ? `$${rate.ratePerAcre.toFixed(2)}` : ''} an assessed acre a year, not by the inch
                      </div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-gray-400">—</td>
                  </tr>
                )}
                {c.waterValue != null && (
                  <tr className="align-top">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium text-gray-400">Water value</div>
                      <div className="text-[11px] text-gray-400">not added — not cash; ${prices.waterValueAf}/acre-ft</div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-gray-400">{money(c.waterValue)}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-3 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">
              {c.allotment ? (
                <p>
                  <span className="font-medium">{pct(c.allotment.pct)}</span> of the {c.allotment.allottedIn} in allotment (
                  {allot.from === 'override' ? "this pivot's override" : `${districtName}${smrid.setFor && smrid.setFor !== cropYear ? `, ${smrid.setFor} figure` : ''}`})
                  {c.allotment.afterPct != null && (
                    <span className="text-gray-500">
                      {' '}
                      · {c.allotment.usedIn!.toFixed(1)} in used so far → <span className={cn(c.allotment.afterPct > 100 && 'font-semibold text-red-700')}>{pct(c.allotment.afterPct)}</span> after
                    </span>
                  )}
                </p>
              ) : null}
              {c.licence ? (
                <p>
                  <span className="font-medium">{pct(c.licence.pct)}</span> of the {c.licence.shareAf} acre-ft licence share
                  {c.licence.afterPct != null && (
                    <span className="text-gray-500">
                      {' '}
                      · {c.licence.usedAf!.toFixed(1)} acre-ft used so far → <span className={cn(c.licence.afterPct > 100 && 'font-semibold text-red-700')}>{pct(c.licence.afterPct)}</span> after
                    </span>
                  )}
                </p>
              ) : null}
              {!c.allotment && !c.licence && <p className="text-gray-400">No allotment or licence share on file for this pivot.</p>}
              <Link to={`/fields/${fieldId}/irrigation`} className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-brand-700">
                Water rights <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
