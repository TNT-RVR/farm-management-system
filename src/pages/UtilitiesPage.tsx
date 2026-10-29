import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Flame, Plug, Sun, Zap } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { rowClick } from '@/components/RecordEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useFeature } from '@/lib/farm-setup'
import { usePumps } from '@/lib/irrigation'
import { usePowerPrices } from '@/lib/pivot-cost'
import { supabase } from '@/lib/supabase'
import { useTab } from '@/lib/useTab'
import { SolarPage } from '@/pages/SolarPage'
import { GasBills } from '@/pages/utilities/GasBills'
import { PowerBills } from '@/pages/utilities/PowerBills'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'

const TABS = ['solar', 'power', 'gas'] as const
type Tab = (typeof TABS)[number]

/**
 * Utilities (Sam, 6 Oct 2026: "Lets make a Utilities page and move the
 * solar to that page"): what the farm makes and what it pays for power.
 * Solar is what the panels produce (SolisCloud); Power is the grid and sell
 * prices and the pumps' FortisAlberta meters; Gas is the natural gas bills
 * (Direct Energy, read out of QuickBooks) by site. /solar still lands on the
 * Solar tab.
 */
export function UtilitiesPage() {
  const solarOn = useFeature('solar')
  const tabs = solarOn ? TABS : (['power', 'gas'] as const)
  const [tab, setTab] = useTab<Tab>('utilities', tabs)
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
      <PageHeader title="Utilities" icon={<Plug className="h-5 w-5 text-brand-700" />} subtitle="Solar, power and natural gas" />
      <PillTabs
        tabs={[
          ...(solarOn ? [{ key: 'solar' as const, label: <span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Solar</span> }] : []),
          { key: 'power' as const, label: <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Power</span> },
          { key: 'gas' as const, label: <span className="flex items-center gap-1.5"><Flame className="h-3.5 w-3.5" /> Gas</span> },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'solar' && solarOn ? <SolarPage embedded /> : tab === 'gas' ? <GasBills /> : <PowerTab />}
    </div>
  )
}

const price = (v: number) => `$${v.toFixed(v < 0.1 ? 3 : 2)}/kWh`

/**
 * One of the farm's two power prices, set here and only here (26 Oct 2026):
 * the water review, the irrigation-cost calculator and each pivot's cost table
 * read them and link back. A manager edits in place; everyone else reads.
 */
function PowerPriceCard({ label, note, value, onSave }: { label: string; note: string; value: number; onSave?: (v: number) => void }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      {onSave ? (
        <label className="flex items-center gap-1 text-xl font-semibold tabular-nums text-gray-900">
          $
          <input
            type="number"
            step="0.005"
            min="0"
            inputMode="decimal"
            key={value}
            defaultValue={value}
            aria-label={label}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (e.target.value !== '' && Number.isFinite(v) && v >= 0 && v !== value) onSave(v)
            }}
            className="w-24 rounded-md border border-gray-300 px-1.5 py-0.5 text-lg"
          />
          <span className="text-sm font-normal text-gray-500">/kWh</span>
        </label>
      ) : (
        <p className="text-xl font-semibold tabular-nums text-gray-900">{price(value)}</p>
      )}
      <p className="text-xs text-gray-500">{note}</p>
    </div>
  )
}

const round4 = (v: number) => Math.round(v * 10000) / 10000

/** The two power prices, and every pump's meter: the numbers a power bill is matched against. */
function PowerTab() {
  const { data: farm, prices } = usePowerPrices()
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role) && !!farm?.id
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: async (patch: { power_buy_kwh?: number; power_sell_kwh?: number; power_value_basis?: 'sell' | 'buy' }) => {
      const { error } = await supabase.from('farms').update(patch).eq('id', farm!.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['farm-power-prices'] })
      void qc.invalidateQueries({ queryKey: ['farm-power-cost'] })
    },
  })
  const { data: pumps } = usePumps()
  const navigate = useNavigate()
  const byId = new Map((pumps ?? []).map((p) => [p.id, p]))
  const rows = [...(pumps ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en-CA', { numeric: true }))
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <PowerPriceCard
            label="Grid power, what the farm pays"
            note="The pumps run on it: the solar is not at the pump sites."
            value={prices.buy}
            onSave={canEdit ? (v) => save.mutate({ power_buy_kwh: round4(v) }) : undefined}
          />
          <PowerPriceCard
            label="Solar, what it sells for"
            note="The value of the panels' kWh on the Solar tab, and the income a pump forgoes when it uses it."
            value={prices.sell}
            onSave={canEdit ? (v) => save.mutate({ power_sell_kwh: round4(v) }) : undefined}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <label className="flex items-center gap-1">
            Price pumping at
            <select
              value={prices.basis}
              disabled={!canEdit || save.isPending}
              onChange={(e) => save.mutate({ power_value_basis: e.target.value as 'sell' | 'buy' })}
              className="rounded-md border border-gray-300 px-1.5 py-1 text-xs"
              aria-label="Price pumping at"
            >
              <option value="sell">sell price (income forgone)</option>
              <option value="buy">buy price (grid)</option>
            </select>
          </label>
          {save.isPending && <span className="text-gray-400">saving…</span>}
          {save.error && <span className="text-red-700">{(save.error as Error).message}</span>}
        </div>
      </section>

      <PowerBills />

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center gap-1 px-3 pb-2 pt-3">
          <h2 className="text-sm font-semibold text-gray-900">Pump meters</h2>
          <InfoPopover title="The pumps' power meters">
            <p>
              The FortisAlberta number on the meter face is the one on the power bill, so it is how a bill is matched to a pump. Edit a pump under Irrigation → Pump
              Information to add its meter.
            </p>
          </InfoPopover>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={TABLE_TH}>Pump</th>
                <th className={TABLE_TH}>HP</th>
                <th className={TABLE_TH}>Utility</th>
                <th className={TABLE_TH}>Meter #</th>
                <th className={TABLE_TH}>Last reading</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((p) => {
                const shares = p.power_meter_shared_with ? byId.get(p.power_meter_shared_with) : null
                return (
                  // The whole row opens the pump's record on Pump Information,
                  // expanded and scrolled to (Sam, 7 Oct 2026).
                  <tr key={p.id} className="cursor-pointer hover:bg-gray-50" onClick={rowClick(() => navigate(`/irrigation-info?tab=pump&pump=${p.id}`))}>
                    <td className="px-3 py-1.5 text-gray-900">
                      <Link to={`/irrigation-info?tab=pump&pump=${p.id}`} className="hover:text-brand-700 hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-gray-700">{p.horse_power ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-700">{p.power_utility ?? '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums text-gray-700">
                      {p.power_meter_number ?? (shares ? <span className="text-gray-500">on {shares.name}&apos;s meter</span> : <span className="text-amber-700">not entered</span>)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-gray-700">
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
        <Link to="/irrigation-info?tab=pump" className="inline-block px-3 py-2 text-xs font-medium text-brand-700 hover:underline">
          Pump Information →
        </Link>
      </section>
    </div>
  )
}
