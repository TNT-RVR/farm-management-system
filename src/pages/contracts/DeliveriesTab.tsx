import { useMemo } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useBinOnHand, useBins } from '@/lib/bins'
import { useBinContents, isCarryOver } from '@/lib/bin-contents'
import { useCrops } from '@/lib/queries'
import { loadsFor, planDeliveries, type PlanBin, type PlanContract } from '@/lib/delivery-plan'
import { HelpNote } from '@/components/HelpNote'
import { useTruckSettings } from '@/lib/hauling-data'
import { cn } from '@/lib/utils'

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—')

/**
 * Every open contract in the order it comes due, what is left to haul, and
 * which bins to haul it from — carry-over first, then the fullest bin.
 */
export function DeliveriesTab({ cropYear }: { cropYear: number }) {
  const { data: contracts } = useQuery({
    queryKey: ['contracts', 'open-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*').in('status', ['open', 'partial'])
      if (error) throw error
      return data ?? []
    },
  })
  const { data: bins } = useBins()
  const { data: onHand } = useBinOnHand()
  const { data: contents } = useBinContents()
  const { data: crops } = useCrops()
  // The highway truck from Trucking's settings; 42 t until someone changes it.
  const payloadT = useTruckSettings().highway.payloadT || 42
  const today = new Date().toLocaleDateString('en-CA')

  const plan = useMemo(() => {
    const cs: PlanContract[] = (contracts ?? []).map((c) => ({
      id: c.id,
      label: c.contract_number || 'contract',
      cropId: c.crop_id,
      remainingBu: Math.max(0, Number(c.bushels ?? 0) - Number(c.delivered_bu ?? 0)),
      deliveryStart: c.delivery_start,
      deliveryEnd: c.delivery_end,
    }))
    const nameOf = new Map((bins ?? []).map((b) => [b.id, b.name]))
    const bs: PlanBin[] = (onHand ?? [])
      .filter((o) => o.onhand_bu > 0)
      .map((o) => {
        const content = (contents ?? []).find((c) => c.bin_id === o.bin_id)
        return { binId: o.bin_id, name: nameOf.get(o.bin_id) ?? 'bin', cropId: o.crop_id, bu: o.onhand_bu, carryOver: !!content && isCarryOver(content, cropYear) }
      })
    return planDeliveries(cs, bs)
  }, [contracts, bins, onHand, contents, cropYear])

  const cropOf = (id: string | null) => (crops ?? []).find((c) => c.id === id)

  if (!plan.length) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
        No open contracts. Add one on the Contracts tab and its delivery plan appears here — which bins to haul from, and how many loads.{' '}
        <SetupLink managerOnly to={SETUP_LINKS.contracts()}>Add a contract</SetupLink>
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {plan.map((p) => {
        const crop = cropOf(p.contract.cropId)
        const lb = crop?.test_weight_lb_per_bu == null ? null : Number(crop.test_weight_lb_per_bu)
        const loads = loadsFor(p.contract.remainingBu, lb, payloadT * 1000)
        const late = p.contract.deliveryEnd && p.contract.deliveryEnd < today
        const daysLeft = p.contract.deliveryEnd ? Math.round((Date.parse(`${p.contract.deliveryEnd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : null
        return (
          <div key={p.contract.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Truck className="h-4 w-4 text-gray-500" />
              <span className="font-semibold text-gray-900">{p.contract.label}</span>
              <span className="text-gray-600">{crop?.name ?? 'crop not set'}</span>
              <span className="text-gray-500">
                window {fmt(p.contract.deliveryStart)} – {fmt(p.contract.deliveryEnd)}
              </span>
              {daysLeft != null && (
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', late ? 'bg-red-100 text-red-800' : daysLeft <= 14 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700')}>
                  {late ? `${-daysLeft} days past the window` : `${daysLeft} days left`}
                </span>
              )}
              <span className="ml-auto tabular-nums text-gray-900">
                {n0(p.contract.remainingBu)} bu to haul{loads ? ` · about ${loads} Super B load${loads === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              {p.draws.map((d) => (
                <span key={d.binId} className="rounded bg-gray-100 px-2 py-0.5 tabular-nums text-gray-700">
                  {d.name}: {n0(d.bu)} bu
                </span>
              ))}
              {p.shortfallBu > 0 && (
                <span className="rounded bg-red-50 px-2 py-0.5 tabular-nums font-semibold text-red-800">short {n0(p.shortfallBu)} bu — not in the bins</span>
              )}
            </div>
          </div>
        )
      })}
      <HelpNote summary="Earliest window first; carry-over grain, then the fullest bin." title="How the plan is made">
        Contracts are filled earliest window first; for each, last year&apos;s grain goes before this year&apos;s, then the fullest bin, so fewer
        bins are opened. Loads assume a Super B at about {payloadT} tonnes. Bushels on hand are the bins&apos; running balance on the Harvest tab.
      </HelpNote>
    </div>
  )
}
