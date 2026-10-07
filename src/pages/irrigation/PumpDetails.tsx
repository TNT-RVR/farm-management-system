import { InfoPopover } from '@/components/InfoPopover'
import type { PumpRow } from '@/lib/irrigation'
import { meterLines, motorPlateLines, panelLines, pivotFlowChecks, pumpPlateLines } from '@/lib/equipment-details'
import { EquipmentPhotos, FlagList, PlateBlock } from '@/pages/irrigation/EquipmentBlocks'

/**
 * One pump's nameplates, control panel, flow and photos (Sam, 5 Oct 2026:
 * "Add the ability to add photos for each turbine/pump ... include electrical
 * information, serial numbers, model, etc."). Photos are kept the way scale
 * tickets keep theirs: a resized JPEG in pump_photos, the list read with the
 * pump, each image only when it is opened, and never saved on the device.
 */

/** The flow to show: measured when there is one, else the estimate, marked so. */
export function PumpFlow({ pump }: { pump: PumpRow }) {
  if (pump.gpm != null) return <span className="tabular-nums">{Math.round(Number(pump.gpm)).toLocaleString('en-CA')}</span>
  if (pump.gpm_estimate == null) return <span className="text-gray-400">—</span>
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-amber-800">
      ~{Math.round(Number(pump.gpm_estimate)).toLocaleString('en-CA')}
      <InfoPopover title={`${pump.name}: estimated flow`}>
        <div className="space-y-1.5 text-xs text-gray-700">
          <p>
            <b>
              About {Math.round(Number(pump.gpm_estimate)).toLocaleString('en-CA')} gpm
              {pump.gpm_estimate_low != null && pump.gpm_estimate_high != null &&
                ` (${Math.round(Number(pump.gpm_estimate_low)).toLocaleString('en-CA')}–${Math.round(Number(pump.gpm_estimate_high)).toLocaleString('en-CA')})`}
            </b>{' '}
            — estimated, not measured. Neither nameplate prints a flow.
          </p>
          {pump.gpm_basis && <p>{pump.gpm_basis}</p>}
          <p className="text-gray-500">Put the measured flow in GPM (edit the pump) once a flow meter or FieldNET shows it; that replaces this estimate.</p>
        </div>
      </InfoPopover>
    </span>
  )
}

const EMPTY = 'Not entered yet — edit the pump to add it.'

const VERDICT = {
  inside: 'inside the pump’s estimated range',
  above: 'more than the pump’s estimate gives — check the pivot figure or the head',
  below: 'less than the pump’s estimate — the head may be higher than guessed, or the figure is old',
} as const

export function PumpDetails({
  pump,
  pivots,
  isManager,
  meterShares = { sharesWith: null, alsoOnIt: [] },
}: {
  pump: PumpRow
  pivots: { name: string; gpm: number | null }[]
  isManager: boolean
  /** Names of the pump whose meter this one runs off, and of pumps that run off this one's. */
  meterShares?: { sharesWith: string | null; alsoOnIt: string[] }
}) {
  const fields = pivots.map((p) => p.name)
  // Full-load draw: the shaft horsepower over the motor's efficiency.
  const kw = pump.horse_power != null && pump.efficiency_pct != null ? (Number(pump.horse_power) * 0.7457) / (Number(pump.efficiency_pct) / 100) : null
  const panel = panelLines(pump)
  const hasPanel = panel.label.length > 0 || panel.parts.length > 0
  const checks = pivotFlowChecks(pump, pivots)
  const meter = meterLines(pump, meterShares)

  return (
    <div className="space-y-3 bg-gray-50/60 px-3 py-3">
      <p className="text-xs text-gray-600">
        Feeds:{' '}
        <b>
          {fields.length
            ? fields.join(', ')
            : (pump.purpose ?? 'irrigation') !== 'irrigation'
              ? `the ${pump.purpose} — not a pivot, so it stays out of the water and pumping costs`
              : 'no pivot linked yet'}
        </b>
        {fields.length > 1 && ' (one pump for all of them)'}
        {' · '}Flow: <PumpFlow pump={pump} /> gpm
        {kw != null && <> · full-load draw about {kw.toFixed(0)} kW</>}
      </p>
      {checks.length > 0 && (
        <ul className="space-y-0.5 text-xs text-gray-600">
          {checks.map((c) => (
            <li key={c.pivot}>
              {c.pivot}&apos;s record says {Math.round(c.gpm).toLocaleString('en-CA')} gpm:{' '}
              <span className={c.verdict === 'inside' ? 'text-gray-700' : 'font-medium text-amber-800'}>{VERDICT[c.verdict]}</span>.
            </li>
          ))}
        </ul>
      )}
      <FlagList text={pump.equipment_flags} />
      <div className="flex flex-col gap-4 sm:flex-row">
        <PlateBlock title="Pump plate" rows={pumpPlateLines(pump)} empty={EMPTY} />
        <PlateBlock title="Motor plate" rows={motorPlateLines(pump)} empty={EMPTY} />
      </div>
      {pump.motor_wiring && (
        <p className="text-xs text-gray-600">
          <span className="font-medium text-gray-700">Motor wiring:</span> {pump.motor_wiring}
        </p>
      )}
      {pump.notes && <p className="whitespace-pre-line text-xs text-gray-600">{pump.notes}</p>}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Control panel</p>
        {hasPanel ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row">
              <PlateBlock title="Label" rows={panel.label} empty="Nothing from the label yet." />
              <div className="min-w-0 flex-1">
                <PlateBlock title="Parts" rows={panel.parts} empty="No parts entered yet." />
                {panel.partsBasis && <p className="mt-1 text-[11px] italic text-amber-800">{panel.partsBasis}</p>}
              </div>
            </div>
            {pump.panel_note && <p className="text-xs text-gray-600">{pump.panel_note}</p>}
          </>
        ) : (
          <p className="text-xs text-gray-400">Not entered yet — edit the pump to add the panel&apos;s label and parts.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Power meter</p>
        {meter.length ? (
          <>
            <PlateBlock title="Meter" rows={meter} empty="" />
            {pump.power_meter_details && <p className="whitespace-pre-line text-xs text-gray-600">{pump.power_meter_details}</p>}
          </>
        ) : (
          <p className="text-xs text-gray-400">Not entered yet — edit the pump to add the meter number off the power bill or the meter face.</p>
        )}
      </div>

      <EquipmentPhotos
        kind="pump"
        ownerId={pump.id}
        ownerName={pump.name}
        isManager={isManager}
        emptyHint="add the nameplates, the pump and the panel."
      />
    </div>
  )
}
