import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp, Loader2, RefreshCw } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { DeleteButton } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { canSeeFinances, hasManagerAccess, useAuth } from '@/lib/auth'
import { usePumps } from '@/lib/irrigation'
import { usePowerPrices } from '@/lib/pivot-cost'
import {
  billedPricePerKwh,
  powerByPump,
  siteKey,
  useConfirmSitePump,
  useDeletePowerBill,
  usePowerBills,
  usePowerBillSites,
  useReadQbPowerBills,
  useRereadPowerBill,
  useSetSitePump,
  useUploadPowerBills,
  type PowerBill,
} from '@/lib/power-bills'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const money0 = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const kwh0 = (v: number) => `${Math.round(v).toLocaleString('en-CA')} kWh`
const cents = (v: number) => `${(v * 100).toFixed(1)}¢`
const period = (b: { period_start: string | null; period_end: string | null; bill_date?: string | null }) =>
  b.period_start && b.period_end ? `${b.period_start} – ${b.period_end}` : (b.period_end ?? b.bill_date ?? '—')

/**
 * Utilities → Power → Power bills (Sam, 7 Oct 2026: "Power bills per pump
 * site"). QuickBooks holds the power only as lump bank payments, so the bills
 * themselves are read: upload the PDFs, and each site on them lands on its
 * pump by the meter number. Each pump then has its real kWh, cost and ¢/kWh,
 * and the farm's grid price can be set from what the bills actually charged.
 */
export function PowerBills() {
  const { profile } = useAuth()
  const manager = hasManagerAccess(profile?.role)
  const finance = canSeeFinances(profile)
  const { data: bills } = usePowerBills()
  const readCount = (bills ?? []).filter((b) => b.status !== 'pending').length
  const { data: sites } = usePowerBillSites(readCount)
  const { data: pumps } = usePumps()
  const upload = useUploadPowerBills()
  const fromQb = useReadQbPowerBills()
  const reread = useRereadPowerBill()
  const setPump = useSetSitePump()
  const confirmPump = useConfirmSitePump()
  const del = useDeletePowerBill()
  const file = useRef<HTMLInputElement>(null)
  const [months, setMonths] = useState('12')
  const [now] = useState(() => Date.now())
  const { data: farm, prices } = usePowerPrices()
  const qc = useQueryClient()
  const setBuy = useMutation({
    mutationFn: async (v: number) => {
      const { error } = await supabase.from('farms').update({ power_buy_kwh: Math.round(v * 10000) / 10000 }).eq('id', farm!.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['farm-power-prices'] })
      void qc.invalidateQueries({ queryKey: ['farm-power-cost'] })
    },
  })

  if (!manager) return null
  const from = months === 'all' ? null : new Date(now - Number(months) * 30.44 * 86400_000).toISOString().slice(0, 10)
  const rows = powerByPump(sites ?? [], from)
  const billed = billedPricePerKwh(rows)
  const pumpName = new Map((pumps ?? []).map((p) => [p.id, p.name]))
  const pumpOptions = [{ value: '', label: 'Which pump?' }, ...[...(pumps ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en-CA', { numeric: true })).map((p) => ({ value: p.id, label: p.name }))]
  const pending = (bills ?? []).filter((b) => b.status === 'pending').length
  const errors = (bills ?? []).filter((b) => b.status === 'error')
  // Every bill of that site, not only those in the period shown.
  const siteIdsFor = (key: string) => (sites ?? []).filter((s) => siteKey(s) === key).map((s) => s.id)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Power bills by pump</h2>
        <div className="flex flex-wrap items-center gap-2">
          {finance && (
            <button
              type="button"
              onClick={() => fromQb.mutate()}
              disabled={fromQb.isPending}
              className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', fromQb.isPending && 'animate-spin')} /> Read the bills in QuickBooks
            </button>
          )}
          <button
            type="button"
            onClick={() => file.current?.click()}
            disabled={upload.isPending}
            className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Add bills
          </button>
          <input
            ref={file}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])]
              e.target.value = ''
              if (list.length) upload.mutate(list)
            }}
          />
        </div>
      </div>
      <HelpNote summary="Add the power bill PDFs; each site lands on its pump by the meter number." className="mt-0.5">
        <p>
          QuickBooks only has the power as bank payments to the retailer, with no sites, so the bills themselves are read. Add the monthly PDFs from the retailer
          (Epcor, Azgard/UtilNet, Hudson) or FortisAlberta; each site on a bill is matched to a pump by the meter number under Pump Information, or by its legal
          land. A site that matches no pump is listed below to pick by hand. Cost is before GST.
        </p>
      </HelpNote>
      {(upload.error || fromQb.error) && <p className="mt-2 text-sm text-red-600">{((upload.error ?? fromQb.error) as Error).message}</p>}
      {fromQb.data && <p className="mt-2 text-xs text-gray-600">{fromQb.data.queued ? `Reading ${fromQb.data.queued} bills from QuickBooks…` : 'Every power bill in QuickBooks is read already.'}</p>}
      {pending > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading {pending} bill{pending === 1 ? '' : 's'}…
        </p>
      )}

      {rows.length > 0 ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
            <label className="flex items-center gap-1.5">
              Bills ending in the last
              <Select
                value={months}
                onChange={setMonths}
                options={[
                  { value: '12', label: '12 months' },
                  { value: '24', label: '24 months' },
                  { value: 'all', label: 'all bills' },
                ]}
                size="sm"
                className="w-32"
                ariaLabel="Period"
              />
            </label>
            {billed && (
              <span className="flex items-center gap-2">
                Pumps paid {cents(billed.perKwh)}/kWh on {kwh0(billed.kwh)}
                {Math.abs(billed.perKwh - prices.buy) > 0.0005 && farm?.id && (
                  <button type="button" onClick={() => setBuy.mutate(billed.perKwh)} disabled={setBuy.isPending} className="text-brand-700 underline disabled:opacity-50">
                    Use as the grid price (now {cents(prices.buy)})
                  </button>
                )}
                {setBuy.isSuccess && <span className="text-green-700">Saved</span>}
              </span>
            )}
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Pump</th>
                  <th className="py-1 pr-3 text-right font-medium">Bills</th>
                  <th className="py-1 pr-3 text-right font-medium">kWh</th>
                  <th className="py-1 pr-3 text-right font-medium">Cost</th>
                  <th className="py-1 pr-3 text-right font-medium">¢/kWh</th>
                  <th className="py-1 pr-3 text-right font-medium">Demand $</th>
                  <th className="py-1 text-right font-medium">Peak kW</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1.5 pr-3 text-gray-900">
                      {r.pumpId ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link to={`/irrigation-info?tab=pump&pump=${r.pumpId}`} className="hover:text-brand-700 hover:underline">
                            {pumpName.get(r.pumpId) ?? 'Pump'}
                          </Link>
                          {r.unconfirmed && (
                            <>
                              <span className="font-semibold text-amber-700" title="Put on this pump by its size, not its meter: needs confirming">
                                *
                              </span>
                              <button
                                type="button"
                                onClick={() => confirmPump.mutate(r.pumpId!)}
                                disabled={confirmPump.isPending}
                                className="rounded border border-amber-300 px-1.5 text-[11px] text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                              >
                                Confirm
                              </button>
                              <Select
                                value=""
                                onChange={(v) =>
                                  v && setPump.mutate({ siteIds: (sites ?? []).filter((s) => s.pump_id === r.pumpId && s.pump_unconfirmed).map((s) => s.id), pumpId: v })
                                }
                                options={[{ value: '', label: 'or it’s…' }, ...pumpOptions.slice(1)]}
                                size="sm"
                                className="w-32"
                                ariaLabel={`${pumpName.get(r.pumpId!) ?? 'Pump'}: a different pump`}
                              />
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-amber-800">{r.label}</span>
                          <Select
                            value=""
                            onChange={(v) => v && setPump.mutate({ siteIds: siteIdsFor(r.key), pumpId: v })}
                            options={pumpOptions}
                            size="sm"
                            className="w-40"
                            ariaLabel={`${r.label}: which pump`}
                          />
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-gray-600">{r.bills}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-700">{Math.round(r.kwh).toLocaleString('en-CA')}</td>
                    <td className="py-1.5 pr-3 text-right font-medium text-gray-900">{money0(r.cost)}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-700">{r.perKwh != null ? cents(r.perKwh) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-600">{r.demandCharges ? money0(r.demandCharges) : '—'}</td>
                    <td className="py-1.5 text-right text-gray-600">{r.peakKw != null ? r.peakKw.toLocaleString('en-CA', { maximumFractionDigits: 0 }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.unconfirmed) && <p className="mt-1 text-xs text-amber-800">* Matched by the pump&apos;s size, not its meter: confirm it, or pick the right pump beside it.</p>}
          {(setPump.error || confirmPump.error) && <p className="mt-1 text-xs text-red-600">{((setPump.error ?? confirmPump.error) as Error).message}</p>}
        </>
      ) : (
        !pending && <p className="mt-3 text-sm text-gray-500">No bills read yet.</p>
      )}

      {errors.length > 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          {errors.length} bill{errors.length === 1 ? '' : 's'} could not be read — see the list below.
        </p>
      )}

      {(bills ?? []).length > 0 && (
        <Fold title="Every bill" summary={`${bills!.length} bills`} storageKey="power-bills-list" className="mt-3">
          <ul className="divide-y divide-gray-100 text-sm">
            {bills!.map((b) => (
              <BillRow key={b.id} b={b} onReread={() => reread.mutate(b.id)} onDelete={() => del.mutate(b)} />
            ))}
          </ul>
        </Fold>
      )}
    </section>
  )
}

function BillRow({ b, onReread, onDelete }: { b: PowerBill; onReread: () => void; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="text-gray-900">{b.retailer ?? b.file_name ?? 'Bill'}</span>
        <span className="ml-2 text-xs text-gray-500">{period(b)}</span>
        {b.source === 'quickbooks' && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800">QuickBooks</span>}
        {b.status === 'error' && <span className="block text-xs text-red-700">{b.error}</span>}
        {b.status === 'read' && b.error && <span className="block text-xs text-amber-800">{b.error}</span>}
        {b.notes && <span className="block text-xs text-gray-500">{b.notes}</span>}
      </span>
      <span className="tabular-nums text-gray-700">{b.total != null ? money0(Number(b.total)) : b.status === 'pending' ? 'Reading…' : '—'}</span>
      {b.status === 'error' && (
        <button type="button" onClick={onReread} className="text-xs text-brand-700 underline">
          Try again
        </button>
      )}
      {b.source === 'upload' && <DeleteButton onDelete={onDelete} confirm={`Delete ${b.file_name ?? 'this bill'} and its sites?`} />}
    </li>
  )
}
