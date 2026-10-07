import { Link, useNavigate } from 'react-router-dom'
import { Plug, Sun, Zap } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { rowClick } from '@/components/RecordEditor'
import { useFeature } from '@/lib/farm-setup'
import { usePumps } from '@/lib/irrigation'
import { usePowerPrices } from '@/lib/pivot-cost'
import { useTab } from '@/lib/useTab'
import { SolarPage } from '@/pages/SolarPage'
import { PowerBills } from '@/pages/utilities/PowerBills'

const TABS = ['solar', 'power'] as const
type Tab = (typeof TABS)[number]

/**
 * Utilities (Sam, 6 Oct 2026: "Lets make a Utilities page and move the
 * solar to that page"): what the farm makes and what it pays for power.
 * Solar is what the panels produce (SolisCloud); Power is the grid and sell
 * prices and the pumps' FortisAlberta meters. /solar still lands on the
 * Solar tab.
 */
export function UtilitiesPage() {
  const solarOn = useFeature('solar')
  const tabs = solarOn ? TABS : (['power'] as const)
  const [tab, setTab] = useTab<Tab>('utilities', tabs, solarOn ? 'solar' : 'power')
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
      <PageHeader title="Utilities" icon={<Plug className="h-5 w-5 text-brand-700" />} subtitle="Solar production and power" />
      <PillTabs
        tabs={[
          ...(solarOn ? [{ key: 'solar' as const, label: <span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Solar</span> }] : []),
          { key: 'power' as const, label: <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Power</span> },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'solar' && solarOn ? <SolarPage embedded /> : <PowerTab />}
    </div>
  )
}

const price = (v: number) => `$${v.toFixed(v < 0.1 ? 3 : 2)}/kWh`

/** The two power prices, and every pump's meter: the numbers a power bill is matched against. */
function PowerTab() {
  const { prices } = usePowerPrices()
  const { data: pumps } = usePumps()
  const navigate = useNavigate()
  const byId = new Map((pumps ?? []).map((p) => [p.id, p]))
  const rows = [...(pumps ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en-CA', { numeric: true }))
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Grid power, what the farm pays</p>
          <p className="text-xl font-semibold tabular-nums text-gray-900">{price(prices.buy)}</p>
          <p className="text-xs text-gray-500">The pumps run on it: the solar is not at the pump sites.</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Solar, what it sells for</p>
          <p className="text-xl font-semibold tabular-nums text-gray-900">{price(prices.sell)}</p>
          <p className="text-xs text-gray-500">The value of the panels&apos; kWh on the Solar tab.</p>
        </div>
      </section>

      <PowerBills />

      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center gap-1">
          <h2 className="text-sm font-semibold text-gray-900">Pump meters</h2>
          <InfoPopover title="The pumps' power meters">
            <p>
              The FortisAlberta number on the meter face is the one on the power bill, so it is how a bill is matched to a pump. Edit a pump under Irrigation → Pump
              Information to add its meter.
            </p>
          </InfoPopover>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Pump</th>
                <th className="py-1 pr-3 font-medium">HP</th>
                <th className="py-1 pr-3 font-medium">Utility</th>
                <th className="py-1 pr-3 font-medium">Meter #</th>
                <th className="py-1 font-medium">Last reading</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((p) => {
                const shares = p.power_meter_shared_with ? byId.get(p.power_meter_shared_with) : null
                return (
                  // The whole row opens the pump's record on Pump Information,
                  // expanded and scrolled to (Sam, 7 Oct 2026).
                  <tr key={p.id} className="cursor-pointer hover:bg-gray-50" onClick={rowClick(() => navigate(`/irrigation-info?tab=pump&pump=${p.id}`))}>
                    <td className="py-1.5 pr-3 text-gray-900">
                      <Link to={`/irrigation-info?tab=pump&pump=${p.id}`} className="hover:text-brand-700 hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-gray-700">{p.horse_power ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-gray-700">{p.power_utility ?? '—'}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-gray-700">
                      {p.power_meter_number ?? (shares ? <span className="text-gray-500">on {shares.name}&apos;s meter</span> : <span className="text-amber-700">not entered</span>)}
                    </td>
                    <td className="py-1.5 tabular-nums text-gray-700">
                      {p.power_meter_reading_kwh != null
                        ? `${Number(p.power_meter_reading_kwh).toLocaleString('en-CA')} kWh${p.power_meter_read_on ? ` · ${p.power_meter_read_on}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Link to="/irrigation-info?tab=pump" className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">
          Pump Information →
        </Link>
      </section>
    </div>
  )
}
