import { useMemo } from 'react'
import { useFields } from '@/lib/queries'
import {
  useBasics,
  useFieldCrops,
  useHaulPlans,
  useSaveHaulPlan,
  useSites,
  useTrips,
  useTruckSettings,
} from '@/lib/hauling-data'
import { truckingFor } from '@/lib/operating-costs'
import { HAUL_MODES, TRUCK_DEFAULTS, type HaulMode, type TruckSettings } from '@/lib/trucking'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { Card, SettingsGroup, type NumberField } from './ui'
import { FieldLink, Sources, money, n0, n1 } from '../fertilizer/savings/ui'

const TRUCK_FIELDS: NumberField<keyof TruckSettings>[] = [
  { key: 'payloadT', label: 'Payload', unit: 't a load' },
  { key: 'lPerKm', label: 'Diesel', unit: 'L/km', hint: 'loaded out, empty back, averaged' },
  { key: 'loadMin', label: 'Filling', unit: 'min a load' },
  { key: 'unloadMin', label: 'Dumping', unit: 'min a load', hint: 'scale and pit at an elevator' },
  { key: 'timeFactor', label: 'Slower than a car by', unit: '×', hint: '1.15 = 15% longer than the router says' },
]

/**
 * Where each field's crop goes, and what getting it there costs in diesel
 * and driver hours. Pick the plan per field; the cost follows.
 */
export function TruckingTab({ year, isManager }: { year: number; isManager: boolean }) {
  const { data: fields } = useFields()
  const { data: crops } = useFieldCrops(year)
  const { data: plans } = useHaulPlans(year)
  const { data: sites } = useSites()
  const { trip } = useTrips()
  const truck = useTruckSettings()
  const basics = useBasics()
  const save = useSaveHaulPlan()
  const elevators = (sites ?? []).filter((s) => s.active)

  const rows = useMemo(
    () =>
      (fields ?? [])
        .filter((f) => crops?.has(f.id))
        .map((f) => {
          const c = crops!.get(f.id)!
          const plan = plans?.get(f.id) ?? null
          const t = truckingFor({
            fieldId: f.id,
            plan,
            sites: sites ?? [],
            crop: { name: c.cropName, unit: c.unit, quantity: c.quantity, lbPerBu: c.lbPerBu },
            trip,
            truck,
            basics,
          })
          return { f, c, plan, t }
        }),
    [fields, crops, plans, sites, trip, truck, basics],
  )
  const total = rows.reduce((s, r) => s + (r.t.cost?.total ?? 0), 0)
  const planned = rows.filter((r) => r.plan).length

  return (
    <div className="space-y-4">
      <Card title={`Trucking the ${year} crop`} right={<span className="text-xs text-gray-500">{planned} of {rows.length} fields planned · {money(total)} in diesel and driver time</span>}>
        <Sources
          sources={[
            { label: 'Crop and acres: the crop plan; yield off the scale once it is in, the plan yield until then', to: '/plan' },
            { label: 'Distances: the Distances tab', to: '/hauling?tab=distances' },
            { label: 'Elevators: the Distances tab' },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-1 font-medium">Field</th>
                <th className="px-2 py-1 font-medium">Crop</th>
                <th className="px-2 py-1 text-right font-medium">Tonnes</th>
                <th className="px-2 py-1 font-medium">Where it goes</th>
                <th className="px-2 py-1 text-right font-medium">Loads</th>
                {/* The make-up of Total: its own columns on a wide screen, a
                    line under Total on a phone, so eleven columns fit. */}
                <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Km</th>
                <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Hours</th>
                <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Diesel</th>
                <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Driver</th>
                <th className="px-2 py-1 text-right font-medium">Total</th>
                <th className="px-2 py-1 text-right font-medium">$/t</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ f, c, plan, t }) => {
                const mode = HAUL_MODES.find((m) => m.key === plan?.mode)
                const cost = t.cost
                return (
                  <tr key={f.id} className="align-top">
                    <td className="px-2 py-1.5 text-gray-800">
                      <FieldLink id={f.id} name={f.name} to="work" />
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">
                      {c.cropName ?? '—'}
                      <span className="block text-[10px] text-gray-400">
                        {c.quantity != null ? `${n0(c.quantity)} ${c.unit ?? ''} · ${c.quantitySource === 'scale' ? 'off the scale' : 'plan yield'}` : 'no yield'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.tonnes != null ? n0(t.tonnes) : '—'}</td>
                    <td className="px-2 py-1.5">
                      {isManager ? (
                        <div className="flex flex-wrap gap-1">
                          <select
                            value={plan?.mode ?? ''}
                            onChange={(e) =>
                              save.mutate({
                                field_id: f.id,
                                crop_year: year,
                                mode: (e.target.value || null) as HaulMode | null,
                                delivery_site_id: plan?.delivery_site_id ?? (elevators.length === 1 ? elevators[0].id : null),
                              })
                            }
                            className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                            aria-label={`Where ${f.name}'s crop goes`}
                          >
                            <option value="">not planned</option>
                            {HAUL_MODES.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          {mode?.needsSite && (
                            <select
                              value={plan?.delivery_site_id ?? ''}
                              onChange={(e) => save.mutate({ field_id: f.id, crop_year: year, mode: plan!.mode, delivery_site_id: e.target.value || null })}
                              className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                              aria-label="Which elevator"
                            >
                              <option value="">which elevator?</option>
                              {elevators.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-700">
                          {mode?.label ?? 'not planned'}
                          {t.site ? ` — ${t.site.name}` : ''}
                        </span>
                      )}
                      {mode && <span className="block text-[10px] text-gray-400">{mode.hint}</span>}
                      {t.why && plan && <span className="block text-[10px] text-amber-700">{t.why}</span>}
                      {cost?.legs.some((l) => l.note) && <span className="block text-[10px] text-amber-700">Distance is the straight line × 1.3 — see Distances.</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{cost?.legs.length ? n0(cost.legs.reduce((s, l) => s + l.loads, 0)) : '—'}</td>
                    <td className="hidden px-2 py-1.5 text-right tabular-nums md:table-cell">{cost?.legs.length ? n0(cost.legs.reduce((s, l) => s + l.km, 0)) : '—'}</td>
                    <td className="hidden px-2 py-1.5 text-right tabular-nums md:table-cell">{cost?.legs.length ? n1(cost.hours) : '—'}</td>
                    <td className="hidden px-2 py-1.5 text-right tabular-nums md:table-cell">{cost?.legs.length ? money(cost.fuel) : '—'}</td>
                    <td className="hidden px-2 py-1.5 text-right tabular-nums md:table-cell">{cost?.legs.length ? money(cost.labour) : '—'}</td>
                    <td className={cn('px-2 py-1.5 text-right font-semibold tabular-nums', !cost?.legs.length && 'font-normal text-gray-300')}>
                      {cost?.legs.length ? money(cost.total) : '—'}
                      {cost?.legs.length ? (
                        <span className="block whitespace-nowrap text-[10px] font-normal text-gray-500 md:hidden">
                          {n0(cost.legs.reduce((s, l) => s + l.km, 0))} km · {n1(cost.hours)} h · diesel {money(cost.fuel)} · driver {money(cost.labour)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{cost?.perTonne != null ? money(cost.perTonne, 2) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <HelpNote
          className="mt-2"
          summary={`Diesel at $${basics.dieselPerL.toFixed(2)}/L, the driver at $${basics.wage.toFixed(2)}/h; truck ownership and repairs not counted yet.`}
          title="How trucking is costed"
        >
          Loads = tonnes ÷ payload, rounded up. Each load is a round trip at the road distance, plus the filling and dumping minutes. Diesel at{' '}
          ${basics.dieselPerL.toFixed(2)}/L, the driver at ${basics.wage.toFixed(2)}/h. Not counted yet: the truck's own ownership and repairs,
          and the combine waiting on a truck. Field legs run from the field's entry to the bins (Distances). A buyer who collects from the bins pays the trip on from there, so only field → bins is ours. Once
          the scale has the crop, its fuel goes on the field's Profit/Loss books as “Trucking the crop”. The driver doesn't: his wages are on
          the payroll, which the fixed expenses already charge every acre, so he is counted here only to price a haul.
        </HelpNote>
      </Card>

      <Card title="The trucks">
        <div className="space-y-4">
          <SettingsGroup settingKey="truck_field" title="Field truck (field → elevator or bin yard)" fields={TRUCK_FIELDS} values={truck.field} defaults={TRUCK_DEFAULTS.field} isManager={isManager} />
          <SettingsGroup settingKey="truck_highway" title="Highway truck (bin yard → elevator)" fields={TRUCK_FIELDS} values={truck.highway} defaults={TRUCK_DEFAULTS.highway} isManager={isManager} />
          <HelpNote summary="Defaults: a Super B carrying 42 t, about 0.55 L/km." title="Where the defaults come from">
            Defaults: a Super B carrying 42 t (the app's figure; the ten loads weighed in so far averaged 44 t), about 0.55 L/km averaged over the
            loaded trip out and the empty one back, 20 minutes filling and 15–20 dumping.
          </HelpNote>
        </div>
      </Card>
    </div>
  )
}
