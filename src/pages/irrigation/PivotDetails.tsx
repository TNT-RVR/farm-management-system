import { InfoPopover } from '@/components/InfoPopover'
import type { FieldPivotRow, PumpRow } from '@/lib/irrigation'
import { pivotPlateLines } from '@/lib/equipment-details'
import { depthCosts, usePowerPrices } from '@/lib/pivot-cost'
import { DEFAULT_APPLICATION_EFFICIENCY, pivotFlow, pivotHorsepower } from '@/lib/water-review'
import { EquipmentPhotos, FlagList, PlateBlock } from '@/pages/irrigation/EquipmentBlocks'

/**
 * A pivot's nameplate, the things on its record to check, its photos, and what
 * a ¼, ½, ¾ and 1 inch cost to put on — the pivot's half of what PumpDetails
 * shows for a pump. Photos live in pivot_photos, fetched one at a time when
 * opened and never kept on the device.
 */
export function PivotDetails({
  pivot,
  fieldName,
  isManager,
  pump,
  pivotsOnPump,
}: {
  pivot: FieldPivotRow
  fieldName: string
  isManager: boolean
  /** The pump that feeds it, and how many pivots that pump feeds. */
  pump?: PumpRow | null
  pivotsOnPump?: number
}) {
  return (
    <div className="space-y-2.5 border-t border-gray-100 pt-2.5">
      <FlagList text={pivot.equipment_flags} />
      <PivotWaterCost pivot={pivot} fieldName={fieldName} pump={pump ?? null} pivotsOnPump={pivotsOnPump ?? 0} />
      <PlateBlock title="Nameplate" rows={pivotPlateLines(pivot)} empty="Not entered yet — edit the pivot to add what its nameplate says." />
      {pivot.nameplate_note && <p className="text-xs text-gray-600">{pivot.nameplate_note}</p>}
      <EquipmentPhotos
        kind="pivot"
        ownerId={pivot.id}
        ownerName={`${fieldName} pivot`}
        isManager={isManager}
        emptyHint="add the nameplate (it is usually on the pivot point's control panel)."
      />
    </div>
  )
}

const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`
const DEPTH_LABEL: Record<number, string> = { 0.25: '¼ in', 0.5: '½ in', 0.75: '¾ in', 1: '1 in' }

/** The power cost of a ¼, ½, ¾ and 1 inch on this pivot, at the grid price. */
function PivotWaterCost({ pivot, fieldName, pump, pivotsOnPump }: { pivot: FieldPivotRow; fieldName: string; pump: PumpRow | null; pivotsOnPump: number }) {
  const { prices } = usePowerPrices()
  const title = <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Cost to put water on</p>
  if (pivot.operated_by)
    return (
      <div className="space-y-1">
        {title}
        <p className="text-xs text-gray-500">{pivot.operated_by} runs this pivot and its pump for us, so its power is not on our bills.</p>
      </div>
    )
  const acres = pivot.acres_irrigated != null ? Number(pivot.acres_irrigated) : null
  const pumpFlow = pump ? (pump.gpm ?? pump.gpm_estimate) : null
  const flow = pivotFlow(pivot, null, pump && pivotsOnPump === 1 ? { gpm: pump.gpm, gpm_estimate: pump.gpm_estimate } : null)
  const share = pivotHorsepower(pump ? { name: pump.name, horse_power: pump.horse_power, gpm: pumpFlow } : undefined, pivotsOnPump, flow.gpm)
  const price = prices.basis === 'sell' ? prices.sell : prices.buy
  const rows = depthCosts({
    acres,
    gpm: flow.gpm,
    hp: share.hp,
    pricePerKwh: price,
    passHours: pivot.time_to_full_circle_h != null ? Number(pivot.time_to_full_circle_h) : null,
    waterValueAf: prices.waterValueAf,
  })
  const missing = [!acres && 'irrigated acres', !flow.gpm && 'a flow (gpm)', !share.hp && 'a pump with its horsepower'].filter(Boolean) as string[]
  if (!rows || missing.length)
    return (
      <div className="space-y-1">
        {title}
        <p className="text-xs text-gray-400">Needs {missing.join(', ')} — edit the pivot{!share.hp ? ' and its pump' : ''} to add {missing.length > 1 ? 'them' : 'it'}.</p>
      </div>
    )
  const showTimer = rows.some((r) => r.timerPct != null)
  const showWater = rows.some((r) => r.waterValue != null)
  const eff = pivot.application_efficiency != null ? Number(pivot.application_efficiency) : DEFAULT_APPLICATION_EFFICIENCY
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {title}
        <InfoPopover title={`${fieldName}: how the cost is worked out`} width={340}>
          <div className="space-y-1.5 text-xs text-gray-700">
            <p>
              Water pumped, out of the nozzles: {acres!.toLocaleString('en-CA')} ac at {Math.round(flow.gpm!).toLocaleString('en-CA')} gpm ({flow.from}).
              An inch over an acre is 27,154 gallons.
            </p>
            <p>
              Power: {Math.round(share.hp!)} hp{share.note ? ` — ${share.note}` : ''}, at 0.746 kW a horsepower over 90% motor efficiency, priced at $
              {price}/kWh ({prices.basis === 'sell' ? 'the solar sell price' : 'the grid price'}).
            </p>
            <p>
              Into the soil takes about {Math.round((1 / eff - 1) * 100)}% more ({Math.round(eff * 100)}% application efficiency). Demand charges on the power bill
              are not in these figures; the meter&apos;s own readings will replace the horsepower estimate once they are in.
            </p>
            {showWater && (
              <p>
                Water: what the water itself is worth, ${prices.waterValueAf}/acre-foot (about ${(prices.waterValueAf! / 12).toFixed(0)} an acre-inch) — its value in a
                normal year from Alberta lease prices and irrigated-over-dryland returns; in a short year it is worth two to three times that. An inch over{' '}
                {acres!.toLocaleString('en-CA')} ac is {(acres! / 12).toFixed(1)} acre-feet.
              </p>
            )}
          </div>
        </InfoPopover>
      </div>
      <table className="text-xs tabular-nums">
        <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="py-0.5 pr-4 font-medium">Depth</th>
            {showTimer && <th className="py-0.5 pr-4 text-right font-medium">Timer</th>}
            <th className="py-0.5 pr-4 text-right font-medium">Hours</th>
            <th className="py-0.5 pr-4 text-right font-medium">kWh</th>
            <th className="py-0.5 pr-4 text-right font-medium">Cost</th>
            <th className="py-0.5 pr-4 text-right font-medium">$/ac</th>
            {showWater && <th className="py-0.5 pr-4 text-right font-medium">Water</th>}
            {showWater && <th className="py-0.5 text-right font-medium">Water $/ac</th>}
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {rows.map((r) => (
            <tr key={r.depthIn}>
              <td className="py-0.5 pr-4 font-medium text-gray-800">{DEPTH_LABEL[r.depthIn] ?? `${r.depthIn} in`}</td>
              {showTimer && <td className="py-0.5 pr-4 text-right">{r.timerPct != null ? `${r.timerPct.toFixed(r.timerPct < 10 ? 1 : 0)}%` : '—'}</td>}
              <td className="py-0.5 pr-4 text-right">{r.hours.toFixed(1)}</td>
              <td className="py-0.5 pr-4 text-right">{r.kwh != null ? Math.round(r.kwh).toLocaleString('en-CA') : '—'}</td>
              <td className="py-0.5 pr-4 text-right">{r.cost != null ? money(r.cost) : '—'}</td>
              <td className="py-0.5 pr-4 text-right">{r.perAcre != null ? `$${r.perAcre.toFixed(2)}` : '—'}</td>
              {showWater && <td className="py-0.5 pr-4 text-right">{r.waterValue != null ? money(r.waterValue) : '—'}</td>}
              {showWater && <td className="py-0.5 text-right">{r.waterValue != null ? `$${(r.waterValue / acres!).toFixed(2)}` : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
