import { Droplets, RefreshCw } from 'lucide-react'
import { useWaterSCredit } from '@/lib/fert-savings/data'
import { WATER_S_BY_SOURCE } from '@/lib/fert-savings/alberta'
import { WQ_PARAMS, usePullWaterQuality, useWaterQualityLatest } from '@/lib/water-quality'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { WaterConcerns } from './WaterConcerns'
import { useFarmSettings } from '@/lib/farm-setup'

const fmt = (v: number, digits: number) =>
  v.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: digits })

/**
 * What is in the irrigation water, from the province's own sampling.
 *
 * The number that matters is the sulphur: a foot of water carries 24–43 lb S,
 * which is why a low sulphate test on irrigated ground is less urgent than on
 * dryland. The fertilizer formulas and the soil write-ups use the median shown
 * at the top of each column; nitrate is shown so a change would be noticed —
 * it is below detection all summer, which is why no N is credited from water.
 * Above the table: anything in the water over a guideline, and every
 * pesticide found (WaterConcerns).
 */
export function WaterQualityCard({ isManager }: { isManager: boolean }) {
  const { data, isLoading } = useWaterQualityLatest()
  const { data: credit, isLoading: creditLoading } = useWaterSCredit()
  const pull = usePullWaterQuality()
  const { districtName } = useFarmSettings()
  const stations = (data?.stations ?? []).filter((s) => s.water_source)

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Droplets className="h-4 w-4 text-sky-600" />
        <h3 className="text-sm font-semibold text-gray-900">Water quality</h3>
        <span className="text-xs text-gray-500">Oldman River and {districtName} canal, pulled monthly from the province</span>
        {isManager && (
          <button
            type="button"
            onClick={() => pull.mutate()}
            disabled={pull.isPending || pull.isSuccess}
            className="ml-auto flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', pull.isPending && 'animate-spin')} />
            {pull.isSuccess ? 'Pulling — back in a minute' : 'Pull now'}
          </button>
        )}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {(['smrid', 'oldman'] as const).map((k) => {
          const c = credit?.get(k)
          return (
            <div key={k} className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <p className="font-semibold">{WATER_S_BY_SOURCE[k].label}</p>
              {creditLoading ? (
                <p className="text-sky-700">Reading…</p>
              ) : c?.lb_s_per_inch != null ? (
                <p>
                  <strong>{c.lb_s_per_inch} lb S per inch</strong> applied — sulphate median {c.so4_median_mg_l} mg/L over{' '}
                  {c.so4_samples} May–Sep samples, the last five seasons. Nitrate{' '}
                  {c.no3n_all_below_dl ? 'below detection every time' : `median ${c.no3n_median_mg_l} mg/L`}
                  {c.ec_median_us_cm != null ? `; EC ${c.ec_median_us_cm} µS/cm` : ''}
                  {c.sar_median != null ? `; SAR ${c.sar_median}` : ''}.
                </p>
              ) : (
                <p>
                  No samples pulled yet — the formulas use {WATER_S_BY_SOURCE[k].lbPerInch} lb S per inch from the research until
                  they are.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <WaterConcerns stations={stations} />

      {isLoading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : !stations.length ? null : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-1 font-medium">Station</th>
                <th className="px-2 py-1 font-medium">Latest</th>
                {WQ_PARAMS.map((p) => (
                  <th key={p.key} className="px-2 py-1 text-right font-medium">
                    {p.label}
                    {p.unit && <span className="block normal-case text-gray-300">{p.unit}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stations.map((s) => {
                const m = data?.latest.get(s.station_id)
                const at = m ? [...m.values()].map((x) => x.at).sort().pop() : null
                return (
                  <tr key={s.station_id}>
                    <td className="px-2 py-1">
                      {s.name}
                      {s.for_credit && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">in the credit</span>}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-gray-500">{at ? at.slice(0, 10) : 'none yet'}</td>
                    {WQ_PARAMS.map((p) => {
                      const r = m?.get(p.key)
                      return (
                        <td key={p.key} className="px-2 py-1 text-right tabular-nums">
                          {r ? (r.below && r.value === 0 ? 'ND' : `${r.below ? '<' : ''}${fmt(r.value, p.digits)}`) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <HelpNote className="mt-2" summary="Provincial samples, published months after they are taken." title="Where the samples come from">
        <p>
          River: Alberta Environment&apos;s Long-Term River Network, monthly samples, published about six months later. Canal: the Irrigation
          District Water Quality program, about four samples a summer, published after the season. The sulphur credit is the sulphate
          median × 0.0756 lb S per acre-inch; set which water a farm uses under Fertilizer → Savings → settings.
        </p>
      </HelpNote>
    </div>
  )
}
