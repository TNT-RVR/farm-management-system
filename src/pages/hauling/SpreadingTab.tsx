import { useMemo } from 'react'
import { useFields } from '@/lib/queries'
import { useBasics, useSpreaderInputs } from '@/lib/hauling-data'
import { useFuelModel } from '@/lib/operating-costs'
import { SPREADER_DEFAULTS, spreadingCost, type SpreaderInputs } from '@/lib/spreading'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { Card, SettingsGroup, type NumberField } from './ui'
import { FieldLink, money, n1 } from '../fertilizer/savings/ui'

const FIELDS: NumberField<keyof SpreaderInputs>[] = [
  { key: 'widthFt', label: 'Spread width', unit: 'ft', hint: 'the bout, not the spinner throw' },
  { key: 'speedKmh', label: 'Speed', unit: 'km/h' },
  { key: 'efficiency', label: 'Field efficiency', unit: '0–1', hint: 'share of the hour actually spreading' },
  { key: 'capacityT', label: 'Spreader holds', unit: 't' },
  { key: 'fillMin', label: 'Refill', unit: 'min', hint: 'including the drive to the tender' },
  { key: 'rateLbAc', label: 'Product rate', unit: 'lb/ac' },
  { key: 'fuelLph', label: 'Tractor diesel', unit: 'L/h' },
  { key: 'repairsPerHour', label: 'Repairs', unit: '$/h', hint: 'tractor + spreader' },
  { key: 'ownershipPerHour', label: 'Ownership', unit: '$/h', hint: 'depreciation, interest, insurance' },
  { key: 'customPerAc', label: 'Custom rate to compare', unit: '$/ac', hint: "what the retailer charges to spread" },
]

/** The questions only the farm can answer, in the order they matter. */
const NEEDED = [
  'Which tractor pulls the spreader, and which spreader — the Fertilizer Spreader "30-1" on the Deere list, or another?',
  'Its real spread width (the bout you drive, not the throw).',
  'The speed you actually spread at, and how much of an hour is spent spreading (turns, overlaps, waiting).',
  'How much it holds, and how long a refill takes including getting to the tender.',
  'The tractor\'s fuel burn spreading (the Deere display shows it, L/h).',
  'Repairs on the spreader and tractor a year, and what they are worth (for ownership $/h).',
  'What ICI or AgraCity charge an acre to spread, to compare against.',
  'The operator\'s wage (the Labour figure above).',
]

/**
 * Doing our own dry fertilizer spreading: $ an acre from the pieces Sam
 * named — width, speed, the machine, fuel — plus the refills and the drive
 * to each field.
 */
export function SpreadingTab({ isManager }: { isManager: boolean }) {
  const i = useSpreaderInputs()
  const b = useBasics()
  const m = useFuelModel()
  const { data: fields } = useFields()
  const base = spreadingCost(i, b.dieselPerL, b.wage)

  // The drive with the spreader: the "anything else" tractor's road burn and speed.
  const rows = useMemo(
    () =>
      (fields ?? [])
        .map((f) => {
          const acres = m.acresOf(f.id)
          const t = m.tripTo(f.id)
          if (!(acres > 0) || !t) return null
          const km = 2 * t.km
          const hours = km / m.settings.roadKmh.other
          const travelDollars = km * m.settings.roadLPerKm.other * b.dieselPerL + hours * (b.wage + i.repairsPerHour + i.ownershipPerHour)
          return { f, acres, km, c: spreadingCost(i, b.dieselPerL, b.wage, { acres, travelDollars }) }
        })
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((a, b2) => a.c.perAcre.total - b2.c.perAcre.total),
    [fields, m, i, b],
  )

  return (
    <div className="space-y-4">
      <Card title="Spreading our own fertilizer">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <dl className="space-y-1 text-sm">
              <Row k="Acres an hour, spreading" v={`${n1(base.acresPerHour)} ac/h`} />
              <Row k="With refills" v={`${n1(base.effectiveAcresPerHour)} ac/h (${n1(base.fillsPerAcre * 100)} fills per 100 ac)`} />
              <Row k="An hour costs" v={`${money(base.perHour.total)} — fuel ${money(base.perHour.fuel)}, operator ${money(base.perHour.labour)}, repairs ${money(base.perHour.repairs)}, ownership ${money(base.perHour.ownership)}`} />
              <Row k="An acre, in the field" v={money(base.perAcre.total, 2)} strong />
              <Row
                k={`Against custom at ${money(i.customPerAc, 2)}/ac`}
                v={<span className={cn(base.vsCustom < 0 ? 'text-green-800' : 'text-red-700')}>{base.vsCustom < 0 ? `${money(-base.vsCustom, 2)}/ac cheaper ourselves` : `${money(base.vsCustom, 2)}/ac dearer ourselves`}</span>}
              />
            </dl>
            <HelpNote
              className="mt-2"
              summary="“Default” numbers are a typical spinner spreader, not yet ours."
              title="How the cost is worked out"
            >
              Acres an hour = width (m) × speed (km/h) ÷ 10 × efficiency, in hectares, × 2.47. Refills = rate × acres ÷ what it holds. Every number
              with “default” beside it is a typical pull-type spinner spreader behind a mid-size tractor, not yet ours.
            </HelpNote>
          </div>
          {/* Folded: several of these are not a box below (which tractor,
              which spreader, where the burn is read), so they stay, just out
              of the way of the answer. */}
          <Fold title="The numbers we need from you" summary={`${NEEDED.length} questions`} storageKey="hauling-spreading-needed">
            <ol className="list-decimal space-y-0.5 pl-5 text-xs text-gray-700">
              {NEEDED.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ol>
          </Fold>
        </div>
        <div className="mt-4">
          <SettingsGroup settingKey="spreader" fields={FIELDS} values={i} defaults={SPREADER_DEFAULTS} isManager={isManager} />
        </div>
      </Card>

      <Card title="By field, with the drive there and back">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-1 font-medium">Field</th>
                <th className="px-2 py-1 text-right font-medium">Acres</th>
                <th className="px-2 py-1 text-right font-medium">Round trip</th>
                <th className="px-2 py-1 text-right font-medium">Hours</th>
                <th className="px-2 py-1 text-right font-medium">Drive $/ac</th>
                <th className="px-2 py-1 text-right font-medium">Total $/ac</th>
                <th className="px-2 py-1 text-right font-medium">Field</th>
                <th className="px-2 py-1 text-right font-medium">vs custom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ f, acres, km, c }) => (
                <tr key={f.id}>
                  <td className="px-2 py-1 text-gray-800">
                    <FieldLink id={f.id} name={f.name} to="work" />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{n1(acres)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600">{n1(km)} km</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600">{n1(c.hoursPerAcre * acres)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600">{money(c.perAcre.travel, 2)}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{money(c.perAcre.total, 2)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{money(c.perAcre.total * acres)}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', c.vsCustom < 0 ? 'text-green-800' : 'text-red-700')}>{money(c.vsCustom, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">One trip from the shop to the field's entry and back per field, with the tractor's road burn and speed from the Fuel tab (“anything else”).</p>
      </Card>
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-44 shrink-0 text-xs text-gray-500">{k}</dt>
      <dd className={cn('min-w-0 flex-1 text-gray-900', strong && 'font-semibold')}>{v}</dd>
    </div>
  )
}
