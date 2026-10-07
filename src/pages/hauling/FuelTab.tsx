import { useMemo } from 'react'
import { useFields } from '@/lib/queries'
import { useSeasonFuelOps } from '@/lib/hauling-data'
import { fuelByOp, useFuelModel } from '@/lib/operating-costs'
import { FUEL_DEFAULTS, MIN_LOGGED_PASSES, OP_KINDS, kindOf, sumFuel, type OpKind } from '@/lib/fuel'
import { HelpNote } from '@/components/HelpNote'
import { Card, SettingsGroup, type NumberField } from './ui'
import { FieldLink, Sources, money, n0, n1 } from '../fertilizer/savings/ui'

const KIND_FIELDS = (unit: string): NumberField<OpKind>[] => OP_KINDS.map((k) => ({ key: k.key, label: k.label, unit, hint: k.machine }))

/**
 * Fuel by field for the year: what the machines logged working each field,
 * the estimate for passes they did not log, and the road from the shop and
 * back. The same figures as each pass on a field's Work list.
 */
export function FuelTab({ year, isManager }: { year: number; isManager: boolean }) {
  const { data: fields } = useFields()
  const { data: ops, isLoading } = useSeasonFuelOps(year)
  const m = useFuelModel()

  const rows = useMemo(() => {
    if (!m.ready || !ops) return []
    const byField = new Map<string, typeof ops>()
    for (const o of ops) {
      if (!o.field_id) continue
      const l = byField.get(o.field_id) ?? []
      l.push(o)
      byField.set(o.field_id, l)
    }
    return (fields ?? [])
      .filter((f) => byField.has(f.id))
      .map((f) => {
        const list = byField.get(f.id)!
        const fuel = fuelByOp(list, f.id, m)
        const all = [...fuel.values()]
        const byKind = new Map<OpKind, number>()
        for (const o of list) {
          const x = fuel.get(o.id)
          if (x) byKind.set(kindOf(o.operation_type), (byKind.get(kindOf(o.operation_type)) ?? 0) + x.litres)
        }
        const passes = all.filter((x) => x.inField.basis !== 'none')
        return { f, s: sumFuel(all), passes: passes.length, logged: passes.filter((x) => x.inField.basis === 'logged').length, byKind, acres: m.acresOf(f.id) }
      })
      .sort((a, b) => b.s.litres - a.s.litres)
  }, [ops, fields, m])

  const farm = rows.reduce(
    (t, r) => ({ inField: t.inField + r.s.inField, travel: t.travel + r.s.travel, km: t.km + r.s.travelKm, hours: t.hours + r.s.travelHours, logged: t.logged + r.s.logged }),
    { inField: 0, travel: 0, km: 0, hours: 0, logged: 0 },
  )
  const d = m.settings.dieselPerL

  return (
    <div className="space-y-4">
      <Card
        title={`Fuel by field, ${year}`}
        right={
          <span className="text-xs text-gray-500">
            {n0(farm.inField + farm.travel)} L · {money((farm.inField + farm.travel) * d)} · {n0(farm.logged)} L of it logged by the machines
          </span>
        }
      >
        <Sources
          sources={[
            { label: 'Passes: John Deere Operations Center', to: '/field-progress' },
            { label: "Fuel logged: the FUEL column of each pass's per-point export" },
            { label: 'Road: the Distances tab', to: '/hauling?tab=distances' },
          ]}
        />
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-1 font-medium">Field</th>
                  <th className="px-2 py-1 text-right font-medium">Passes</th>
                  <th className="px-2 py-1 text-right font-medium">In the field</th>
                  <th className="px-2 py-1 text-right font-medium">Road</th>
                  <th className="px-2 py-1 text-right font-medium">Road km</th>
                  <th className="px-2 py-1 text-right font-medium">Road hours</th>
                  {OP_KINDS.slice(0, 4).map((k) => (
                    <th key={k.key} className="px-2 py-1 text-right font-medium">
                      {k.label.split(' ')[0]}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-medium">Fuel $</th>
                  <th className="px-2 py-1 text-right font-medium">$/ac</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ f, s, passes, logged, byKind, acres }) => (
                  <tr key={f.id}>
                    <td className="px-2 py-1 text-gray-800">
                      <FieldLink id={f.id} name={f.name} to="work" />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                      {passes}
                      <span className="text-gray-400"> ({logged} logged)</span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{n0(s.inField)} L</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n0(s.travel)} L</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{n0(s.travelKm)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{n1(s.travelHours)}</td>
                    {OP_KINDS.slice(0, 4).map((k) => (
                      <td key={k.key} className="px-2 py-1 text-right tabular-nums text-gray-500">
                        {byKind.get(k.key) ? `${n0(byKind.get(k.key)!)} L` : '—'}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{money(s.litres * d)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{acres > 0 ? money((s.litres * d) / acres, 2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <HelpNote
          className="mt-2"
          summary="Field: what the machine logged. Road: a round trip per day worked."
          title="What is counted"
        >
          In the field: what the machine logged while working (implement down, booms on), read off Deere's per-point export — or, for a pass not
          logged, litres an acre × the acres it covered. Road: one round trip from the shop to the field's entry for each day the machine worked the field, at the
          road (and trail) distance and the machine's road burn. Not in it: headland turns with everything off, waiting on a fill, and the pickups that
          follow the machines.
        </HelpNote>
      </Card>

      <Card title="Litres an acre">
        <table className="mb-3 w-full max-w-xl text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1 font-medium">Work</th>
              <th className="py-1 text-right font-medium">Our machines logged</th>
              <th className="py-1 text-right font-medium">Default</th>
              <th className="py-1 text-right font-medium">Used for unlogged passes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {OP_KINDS.map((k) => {
              const a = m.farm[k.key]
              const ours = a && a.passes >= MIN_LOGGED_PASSES
              return (
                <tr key={k.key}>
                  <td className="py-1 text-gray-700">{k.label}</td>
                  <td className="py-1 text-right tabular-nums">{a ? `${a.lPerAc.toFixed(2)} L/ac · ${a.passes} passes, ${n0(a.acres)} ac` : '—'}</td>
                  <td className="py-1 text-right tabular-nums text-gray-500">{m.settings.lPerAc[k.key].toFixed(1)} L/ac</td>
                  <td className="py-1 text-right font-medium">{ours ? 'ours' : 'default'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="space-y-4">
          <SettingsGroup settingKey="fuel_l_per_ac" title="Default litres an acre (until our own passes say)" fields={KIND_FIELDS('L/ac')} values={m.settings.lPerAc} defaults={FUEL_DEFAULTS.lPerAc} isManager={isManager} />
          <SettingsGroup settingKey="road_l_per_km" title="Road burn, driving to the field" fields={KIND_FIELDS('L/km')} values={m.settings.roadLPerKm} defaults={FUEL_DEFAULTS.roadLPerKm} isManager={isManager} />
          <SettingsGroup settingKey="road_kmh" title="Road speed" fields={KIND_FIELDS('km/h')} values={m.settings.roadKmh} defaults={FUEL_DEFAULTS.roadKmh} isManager={isManager} />
        </div>
        <HelpNote
          className="mt-2"
          summary={`Defaults from Iowa State PM 709; ours take over after ${MIN_LOGGED_PASSES} logged passes.`}
          title="Where the defaults come from"
        >
          Default litres an acre from Iowa State Extension PM 709, Fuel Required for Field Operations (field cultivator 0.70 gal/ac, planter or air
          seeder 0.40, self-propelled sprayer 0.10, combine in corn 1.75). Our machines' own figure takes over once {MIN_LOGGED_PASSES} passes of
          that kind are logged. Road burn and speed are round numbers — the ones to correct first.
        </HelpNote>
      </Card>
    </div>
  )
}
