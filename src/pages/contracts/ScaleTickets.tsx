import { useMemo, useState } from 'react'
import { Camera, Check, FileUp, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useBins } from '@/lib/bins'
import { useBinContents } from '@/lib/bin-contents'
import { useCrops, useFields } from '@/lib/queries'
import { isOpenLoad, useBinLoads, useDeliverySites } from '@/lib/bin-loads'
import { DeleteLoadButton, EditLoadDialog } from '@/pages/bins/WeighIn'
import { rowClick } from '@/components/RecordEditor'
import { cn } from '@/lib/utils'
import { ScaleTicketDetail } from './ScaleTicketDetail'
import { useContacts, useContracts, type ContractRow } from '@/lib/sales'
import { lbPerBushel, netInUnit, useScaleTicketMutations, useScaleTickets } from '@/lib/scale-tickets'
import { TicketPhotoButton, useTicketPhotoIndex } from './TicketPhoto'

/**
 * Scale tickets, in from the truck.
 *
 * Photograph the ticket (or drop in the PDF the buyer emails) and the figures
 * are read off it: gross, tare, net, moisture, dockage, the buyer's number and
 * which contract it names. They are shown for checking, the contract and the
 * bin it came out of are picked, and Save does three things at once — keeps
 * the ticket, moves the contract's delivered figure, and draws the bin down.
 *
 * Corn and beans are the two crops that go out on tickets here, and they are
 * counted differently: corn in bushels at 56 lb, beans in pounds. The crop on
 * the contract decides which.
 */
type Read = {
  buyer: string | null
  ticket_no: string | null
  delivered_on: string | null
  commodity: string | null
  gross_lb: number | null
  tare_lb: number | null
  net_lb: number | null
  moisture_pct: number | null
  dockage_pct: number | null
  protein_pct?: number | null
  net_stated: number | null
  net_stated_unit: string | null
  contract_no: string | null
  notes: string | null
  unsure: string[]
}

const n = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: d })

export function ScaleTickets({ cropYear }: { cropYear: number }) {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const { data: tickets } = useScaleTickets(cropYear)
  const { data: contracts } = useContracts(cropYear)
  const { data: contacts } = useContacts()
  const { data: crops } = useCrops()
  const { data: bins } = useBins()
  const { data: contents } = useBinContents()
  const { data: loads } = useBinLoads()
  const { data: sites } = useDeliverySites()
  const { data: fields } = useFields()
  const { data: photos } = useTicketPhotoIndex()
  const plantLoads = (loads ?? []).filter((l) => l.delivery_site_id && l.crop_year === cropYear && !isOpenLoad(l))
  const { save, remove } = useScaleTicketMutations()

  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<Read | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [contractId, setContractId] = useState('')
  const [binId, setBinId] = useState('')
  const [net, setNet] = useState('')
  const [drawBin, setDrawBin] = useState(true)
  // A ticket or a plant load opened from the lists below (Sam, 7 Oct 2026),
  // by id so an edit shows as soon as it is saved.
  const [ticketId, setTicketId] = useState<string | null>(null)
  const [loadId, setLoadId] = useState<string | null>(null)

  const cropOf = (c: ContractRow | undefined) => crops?.find((x) => x.id === c?.crop_id)
  const buyerOf = (c: ContractRow | undefined) =>
    contacts?.find((x) => x.id === c?.buyer_contact_id)?.contact_name ?? '—'
  const contract = contracts?.find((c) => c.id === contractId)
  const crop = cropOf(contract)
  const unit = crop?.yield_unit ?? 'bu'

  // Bins holding this contract's crop, most recently filled first: the one it
  // came out of is almost always at the top.
  const candidateBins = useMemo(() => {
    if (!crop) return []
    return (contents ?? [])
      // bin_contents_current is the open rows only, so nothing here is emptied.
      .filter((c) => c.crop_id === crop.id)
      .map((c) => ({ content: c, bin: bins?.find((b) => b.id === c.bin_id) }))
      .filter((x) => x.bin)
      .sort((a, b) => (b.content.filled_on ?? '').localeCompare(a.content.filled_on ?? ''))
  }, [contents, bins, crop])

  const readFile = async (file: File) => {
    setReading(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      const res = await fetch('/api/scale-ticket-extract', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'content-type': type,
          'x-media-type': type,
        },
        body: file,
      })
      const body = (await res.json().catch(() => ({}))) as Partial<Read> & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `Could not read the ticket (${res.status})`)
      const r = body as Read
      setRead(r)
      // Best guess at the contract: its number printed on the ticket, else the
      // one open contract for the commodity named.
      const byNo = r.contract_no
        ? contracts?.find((c) => c.contract_number && r.contract_no!.includes(c.contract_number))
        : undefined
      const byCrop = r.commodity
        ? contracts?.filter(
            (c) =>
              c.status !== 'cancelled' &&
              c.status !== 'delivered' &&
              (cropOf(c)?.name ?? '').toLowerCase().includes(r.commodity!.toLowerCase().split(' ')[0]),
          )
        : []
      const pick = byNo ?? (byCrop?.length === 1 ? byCrop[0] : undefined)
      setContractId(pick?.id ?? '')
      const u = cropOf(pick)?.yield_unit ?? 'bu'
      const units = netInUnit(r, u, cropOf(pick)?.name)
      setNet(units != null ? String(Math.round(units * 100) / 100) : '')
      setBinId('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  // Re-derive the net when the contract (and so the unit) changes.
  const pickContract = (id: string) => {
    setContractId(id)
    const c = contracts?.find((x) => x.id === id)
    const cr = cropOf(c)
    if (read) {
      const units = netInUnit(read, cr?.yield_unit ?? 'bu', cr?.name)
      setNet(units != null ? String(Math.round(units * 100) / 100) : '')
    }
    setBinId('')
  }

  const doSave = () => {
    if (!read || !contract) return
    const units = Number(net)
    if (!Number.isFinite(units) || units <= 0) {
      setError('Enter the net in the crop’s unit')
      return
    }
    save.mutate(
      {
        crop_year: cropYear,
        crop_id: contract.crop_id,
        contract_id: contract.id,
        bin_id: binId || null,
        buyer: read.buyer,
        ticket_no: read.ticket_no,
        delivered_on: read.delivered_on ?? new Date().toLocaleDateString('en-CA'),
        gross_lb: read.gross_lb,
        tare_lb: read.tare_lb,
        net_lb: read.net_lb,
        moisture_pct: read.moisture_pct,
        dockage_pct: read.dockage_pct,
        protein_pct: read.protein_pct ?? null,
        net_units: units,
        unit,
        notes: read.notes,
        extracted: read as unknown as Record<string, never>,
        // Bins are counted in bushels, so a bean bin cannot be drawn down in
        // pounds without lying about it. Corn can.
        drawBin: drawBin && binId && unit === 'bu' ? { binId, units } : null,
      },
      {
        onSuccess: () => {
          setRead(null)
          setContractId('')
          setBinId('')
          setNet('')
        },
        onError: (e) => setError((e as Error).message),
      },
    )
  }

  const totals = useMemo(() => {
    const m = new Map<string, { loads: number; units: number }>()
    for (const t of tickets ?? []) {
      const k = t.contract_id ?? 'none'
      const cur = m.get(k) ?? { loads: 0, units: 0 }
      m.set(k, { loads: cur.loads + 1, units: cur.units + (t.net_units ?? 0) })
    }
    return m
  }, [tickets])

  return (
    <div className="space-y-4">
      {canEdit && !read && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
          <p className="text-sm font-medium text-gray-800">Add a load</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Photograph the scale ticket at the elevator, or drop in the PDF the buyer sent. The
            figures are read off it for you to check.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">
              <Camera className="h-4 w-4" /> {reading ? 'Reading…' : 'Photograph a ticket'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={reading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void readFile(f)
                  e.target.value = ''
                }}
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <FileUp className="h-4 w-4" /> PDF or photo from a file
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                disabled={reading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void readFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}

      {read && (
        <div className="rounded-lg border border-brand-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">Check the ticket</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-xs text-gray-500">Buyer</dt>
            <dd>{read.buyer ?? '—'}</dd>
            <dt className="text-xs text-gray-500">Ticket</dt>
            <dd>{read.ticket_no ?? '—'}</dd>
            <dt className="text-xs text-gray-500">Date</dt>
            <dd>{read.delivered_on ?? '—'}</dd>
            <dt className="text-xs text-gray-500">Commodity</dt>
            <dd>{read.commodity ?? '—'}</dd>
            <dt className="text-xs text-gray-500">Gross / tare</dt>
            <dd className="tabular-nums">
              {n(read.gross_lb)} / {n(read.tare_lb)} lb
            </dd>
            <dt className="text-xs text-gray-500">Net</dt>
            <dd className="tabular-nums">{n(read.net_lb)} lb</dd>
            <dt className="text-xs text-gray-500">Moisture</dt>
            <dd className="tabular-nums">{read.moisture_pct != null ? `${read.moisture_pct}%` : '—'}</dd>
            <dt className="text-xs text-gray-500">Dockage</dt>
            <dd className="tabular-nums">{read.dockage_pct != null ? `${read.dockage_pct}%` : '—'}</dd>
            {read.protein_pct != null && (
              <>
                <dt className="text-xs text-gray-500">Protein</dt>
                <dd className="tabular-nums">{read.protein_pct}%</dd>
              </>
            )}
            {read.net_stated != null && (
              <>
                <dt className="text-xs text-gray-500">Ticket says</dt>
                <dd className="tabular-nums">
                  {n(read.net_stated, 2)} {read.net_stated_unit}
                </dd>
              </>
            )}
          </dl>
          {read.unsure.length > 0 && (
            <ul className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {read.unsure.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
          {read.notes && <p className="mt-2 text-xs text-gray-500">{read.notes}</p>}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-gray-500">
              Against contract
              <Select
                value={contractId}
                ariaLabel="Contract"
                className="mt-1"
                onChange={pickContract}
                options={[
                  { value: '', label: '—' },
                  ...(contracts ?? [])
                    .filter((c) => c.status !== 'cancelled')
                    .map((c) => ({
                      value: c.id,
                      label: `${cropOf(c)?.name ?? '?'} · ${buyerOf(c)}${c.contract_number ? ` · ${c.contract_number}` : ''}`,
                    })),
                ]}
              />
            </label>
            <label className="text-xs text-gray-500">
              Net against it ({unit})
              <input
                type="number"
                inputMode="decimal"
                value={net}
                onChange={(e) => setNet(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
              />
              {unit === 'bu' && read.net_lb != null && lbPerBushel(crop?.name) && (
                <span className="mt-0.5 block text-[11px] text-gray-400">
                  {n(read.net_lb)} lb ÷ {lbPerBushel(crop?.name)} = {n(read.net_lb / lbPerBushel(crop?.name)!, 1)} bu
                </span>
              )}
            </label>
            <label className="text-xs text-gray-500">
              Out of bin
              <Select
                value={binId}
                ariaLabel="Bin"
                className="mt-1"
                onChange={setBinId}
                options={[
                  { value: '', label: '—' },
                  ...candidateBins.map(({ bin, content }) => ({
                    value: bin!.id,
                    label: `${bin!.name}${content.bushels != null ? ` · ${Math.round(content.bushels).toLocaleString()} bu` : ''}`,
                  })),
                ]}
              />
              {binId && unit !== 'bu' && (
                <span className="mt-0.5 block text-[11px] text-gray-400">
                  Bins are counted in bushels, so a bean load is recorded but the bin is not drawn down.
                </span>
              )}
              {binId && unit === 'bu' && (
                <label className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                  <input type="checkbox" checked={drawBin} onChange={(e) => setDrawBin(e.target.checked)} />
                  draw the bin down by this load
                </label>
              )}
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={doSave}
              disabled={save.isPending || !contract}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save the load'}
            </button>
            <button
              onClick={() => setRead(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Contract</th>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 text-right font-medium">Gross lb</th>
              <th className="px-3 py-2 text-right font-medium">Net lb</th>
              <th className="px-3 py-2 text-right font-medium" title="Dockage: what the plant cleaned out of the net, and the clean weight left — what is paid on.">
                Clean-out
              </th>
              <th className="px-3 py-2 text-right font-medium">Clean lb</th>
              <th className="px-3 py-2 text-right font-medium">Moist.</th>
              <th className="px-3 py-2 text-right font-medium">Against</th>
              <th className="px-3 py-2 font-medium">Bin</th>
              <th className="w-8" />
              {canEdit && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {(tickets ?? []).length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-4 text-center text-sm text-gray-400">
                  No loads recorded for {cropYear} yet.
                </td>
              </tr>
            )}
            {(tickets ?? []).map((t) => {
              const c = contracts?.find((x) => x.id === t.contract_id)
              return (
                <tr
                  key={t.id}
                  onClick={rowClick(() => setTicketId(t.id))}
                  className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="px-3 py-2 tabular-nums">{t.delivered_on}</td>
                  <td className="px-3 py-2">
                    {c ? (
                      `${cropOf(c)?.name ?? '?'} · ${buyerOf(c)}`
                    ) : (
                      <span className="text-gray-500">
                        {[crops?.find((x) => x.id === t.crop_id)?.name, t.buyer].filter(Boolean).join(' · ') || '—'}
                        <span className="block text-[10px] text-gray-400">no contract</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {t.ticket_no ?? '—'}
                    {t.receipt_no && <span className="block text-[10px] text-gray-400">receipt {t.receipt_no}{t.grade ? ` · ${t.grade}` : ''}</span>}
                    {t.bin_load_id && (
                      <span className="block text-[10px] text-green-700">
                        settles the farm load of {(loads ?? []).find((l) => l.id === t.bin_load_id)?.loaded_on ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{n(t.gross_lb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(t.net_lb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.dockage_pct != null ? `${t.dockage_pct}%` : <span className="text-amber-700" title="Not on the ticket: it comes on the plant's receipt">waiting</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{t.clean_net_lb != null ? n(t.clean_net_lb) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.moisture_pct != null ? `${t.moisture_pct}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.net_units != null ? `${n(t.net_units, 1)} ${t.unit ?? ''}` : '—'}
                  </td>
                  <td className="px-3 py-2">{bins?.find((b) => b.id === t.bin_id)?.name ?? '—'}</td>
                  <td className="px-1 py-2 text-center">
                    <TicketPhotoButton ticketId={t.id} photoId={photos?.get(t.id)} label={`Ticket ${t.ticket_no ?? t.receipt_no ?? t.delivered_on}`} canEdit={canEdit} />
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => {
                          if (confirm('Remove this load? The contract total goes back down.')) remove.mutate(t.id)
                        }}
                        className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                        aria-label="Remove load"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totals.size > 0 && (
        <p className="text-xs text-gray-500">
          {[...totals.entries()].map(([k, v]) => {
            const c = contracts?.find((x) => x.id === k)
            return (
              <span key={k} className="mr-3">
                {c ? `${cropOf(c)?.name ?? '?'} · ${buyerOf(c)}` : 'Unassigned'}: {v.loads} load
                {v.loads === 1 ? '' : 's'}, {n(v.units, 1)} {cropOf(c)?.yield_unit ?? ''}
              </span>
            )
          })}
        </p>
      )}

      {plantLoads.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <p className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Farm loads straight to a plant ({plantLoads.length})
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Plant</th>
                <th className="px-3 py-2 font-medium">Contract</th>
                <th className="px-3 py-2 text-right font-medium">Farm scale</th>
                <th className="px-3 py-2 font-medium">Plant's ticket</th>
              </tr>
            </thead>
            <tbody>
              {plantLoads.map((l) => {
                const c = contracts?.find((x) => x.id === l.contract_id)
                const ticket = (tickets ?? []).find((t) => t.bin_load_id === l.id)
                return (
                  <tr
                    key={l.id}
                    onClick={canEdit ? rowClick(() => setLoadId(l.id)) : undefined}
                    title={canEdit ? 'Open the load to see or correct it' : undefined}
                    className={cn('border-b border-gray-100 last:border-0', canEdit && 'cursor-pointer hover:bg-gray-50')}
                  >
                    <td className="px-3 py-2 tabular-nums">{l.loaded_on}</td>
                    <td className="px-3 py-2">{fields?.find((f) => f.id === l.field_id)?.name ?? '—'}</td>
                    <td className="px-3 py-2">{sites?.find((x) => x.id === l.delivery_site_id)?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      {c ? `${c.contract_number ? `#${c.contract_number} · ` : ''}${cropOf(c)?.name ?? '?'} · ${buyerOf(c)}` : <span className="text-gray-400">none</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {n(l.net_kg == null ? null : Number(l.net_kg))} kg
                      <span className="block text-[11px] text-gray-500">{n(l.bushels == null ? null : Number(l.bushels), 1)} bu</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {ticket ? (
                        <span className="text-green-700">
                          {ticket.ticket_no ? `#${ticket.ticket_no}` : 'Recorded'} · {n(ticket.net_units, 1)} {ticket.unit ?? ''}
                        </span>
                      ) : c ? (
                        <span className="text-amber-700">Waiting — counted from the farm scale until it comes</span>
                      ) : (
                        <span className="text-gray-400">No contract picked</span>
                      )}
                      {canEdit && (
                        <span className="ml-1 align-middle">
                          <DeleteLoadButton load={l} />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-gray-400">
            A plant ticket recorded against the same contract within three days and 10% of the farm's net weight settles the load
            automatically, and its figure replaces the farm scale's in the contract's delivered total.
          </p>
        </div>
      )}

      {(() => {
        const t = (tickets ?? []).find((x) => x.id === ticketId)
        if (!t) return null
        const settled = (loads ?? []).find((l) => l.id === t.bin_load_id) ?? null
        return (
          <ScaleTicketDetail
            ticket={t}
            contracts={contracts ?? []}
            contractLabel={(c) => `${cropOf(c)?.name ?? '?'} · ${buyerOf(c)}${c.contract_number ? ` · ${c.contract_number}` : ''}`}
            crops={crops ?? []}
            bins={bins ?? []}
            load={settled}
            loadField={fields?.find((f) => f.id === settled?.field_id)?.name ?? null}
            photoId={photos?.get(t.id)}
            canEdit={canEdit}
            onOpenLoad={(l) => {
              setTicketId(null)
              setLoadId(l.id)
            }}
            onClose={() => setTicketId(null)}
          />
        )
      })()}
      {(() => {
        const l = (loads ?? []).find((x) => x.id === loadId)
        return l ? <EditLoadDialog load={l} onClose={() => setLoadId(null)} /> : null
      })()}
    </div>
  )
}
