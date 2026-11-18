import { useMemo, useState } from 'react'
import { AddButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { useDeleteFuelTank, useFuelTanks, useSaveFuelTank, useSyncTelusGauges, type FuelTank } from '@/lib/fuel-data'
import { gaugeInfoText } from '@/lib/telus-fuel'
import { farmTz } from '@/lib/farm-context'
import { FUEL_PRODUCT_LABEL, type FuelProduct } from '@/lib/fuel-supplier-invoice'
import { cn } from '@/lib/utils'
import { MapPin, RefreshCw } from 'lucide-react'
import { FUEL_COLOUR, FuelTankMap } from './FuelTankMap'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { CardList, Dot, RowCard, SummaryLine } from '@/components/RowCards'

const L = (v: number) => `${Math.round(v).toLocaleString('en-CA')} L`

const FIELDS: EditField[] = [
  { key: 'name', label: 'Tank', kind: 'text', required: true, placeholder: 'e.g. Shop diesel' },
  { key: 'location', label: 'Where', kind: 'text', placeholder: 'e.g. Home yard' },
  {
    key: 'product',
    label: 'Holds',
    kind: 'select',
    required: true,
    options: (Object.keys(FUEL_PRODUCT_LABEL) as FuelProduct[]).map((p) => ({ value: p, label: FUEL_PRODUCT_LABEL[p] })),
  },
  { key: 'capacity_l', label: 'Capacity (L)', kind: 'number', required: true, int: true },
  { key: 'level_l', label: 'In it now (L)', kind: 'number', int: true, hint: 'Read off the tank. A gauge\'s next report replaces it.' },
  { key: 'level_on', label: 'Gauge read on', kind: 'date' },
  { key: 'notes', label: 'Note', kind: 'textarea', placeholder: 'Fill point, pump, who to call…' },
]

/** "12 min ago", "3 h ago", "2 days ago". */
function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

/** Hours without a report before a gauge counts as silent (the sync's SILENT_HOURS). */
const SILENT_MS = 24 * 3_600_000

/** "Oct 17, 3:04 p.m.", on the farm's clock whatever the device's. */
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: farmTz() })

/**
 * Why a tank's gauge has gone quiet, as far as Telus says: offline, when it
 * last got in touch, and any battery or signal figure in its last report.
 * Null for a tank without a gauge, or one reporting as it should.
 */
function gaugeTrouble(t: FuelTank): string | null {
  if (t.telus_device_id == null) return null
  const lastReport = t.level_source === 'telus' ? t.level_at : null
  const silent = !lastReport || Date.now() - new Date(lastReport).getTime() > SILENT_MS
  if (!silent && t.gauge_online !== false) return null
  const parts = [
    lastReport ? `No gauge report since ${when(lastReport)}` : 'Gauge has not reported',
    t.gauge_online === false ? 'Telus has it offline' : null,
    t.gauge_seen_at && (!lastReport || new Date(t.gauge_seen_at).getTime() - new Date(lastReport).getTime() > 3_600_000) ? `last in touch ${when(t.gauge_seen_at)}` : null,
    ...gaugeInfoText(t.gauge_info),
  ]
  return parts.filter(Boolean).join(' · ')
}

/** Room left in a tank, where its level is known. */
const roomOf = (t: FuelTank) => (t.level_l == null ? null : Math.max(0, t.capacity_l - t.level_l))

/** Where a tank's level came from and anything wrong with its gauge, under the level. */
function LevelNote({ t }: { t: FuelTank }) {
  return (
    <>
      {t.level_source === 'telus' && t.level_at ? (
        <p className="text-xs text-emerald-700" title={`TELUS gauge, read ${new Date(t.level_at).toLocaleString('en-CA')}`}>
          gauge · {ago(t.level_at)}
        </p>
      ) : t.level_source === 'typed' && t.level_at ? (
        <p className="text-xs text-gray-500" title="Typed in; the gauge's next report replaces it">
          typed · {ago(t.level_at)}
        </p>
      ) : (
        t.level_on && <p className="text-xs text-gray-400">{t.level_on}</p>
      )}
      {gaugeTrouble(t) && <p className="text-xs text-amber-700">{gaugeTrouble(t)}</p>}
    </>
  )
}

/**
 * The farm's fuel tanks: what each holds and how big it is, so an order can be
 * sized without walking the yard. Totals per fuel, and the room left where a
 * gauge reading is typed in.
 */
export function FuelTanks({ isManager }: { isManager: boolean }) {
  const { data: tanks, isLoading } = useFuelTanks()
  const save = useSaveFuelTank()
  const del = useDeleteFuelTank()
  const sync = useSyncTelusGauges()
  // null: closed; 'new': adding; a tank: editing it.
  const [open, setOpen] = useState<FuelTank | 'new' | null>(null)
  // The tank waiting for a click on the map.
  const [placingId, setPlacingId] = useState<string | null>(null)
  const placing = tanks?.find((t) => t.id === placingId) ?? null
  const unplaced = (tanks ?? []).filter((t) => t.lat == null || t.lng == null)
  const place = (id: string, lat: number, lng: number) => {
    setPlacingId(null)
    save.mutate({ id, patch: { lat, lng } })
  }
  const pinButton = (t: FuelTank) => (
    <button
      type="button"
      onClick={() => setPlacingId(placingId === t.id ? null : t.id)}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
        placingId === t.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
      )}
    >
      <MapPin className="h-3.5 w-3.5" /> {t.lat == null ? 'Pin' : 'Move'}
    </button>
  )

  const byFuel = useMemo(() => {
    // knownCapacity is the read tanks only, so what's in them + room adds up to it.
    const m = new Map<FuelProduct, { capacity: number; knownCapacity: number; room: number; unknown: number; count: number }>()
    for (const t of tanks ?? []) {
      const s = m.get(t.product) ?? { capacity: 0, knownCapacity: 0, room: 0, unknown: 0, count: 0 }
      s.capacity += t.capacity_l
      s.count++
      const room = roomOf(t)
      if (room == null) s.unknown++
      else {
        s.room += room
        s.knownCapacity += t.capacity_l
      }
      m.set(t.product, s)
    }
    return [...m.entries()]
  }, [tanks])

  const close = () => {
    save.reset()
    del.reset()
    setOpen(null)
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Fuel tanks</h2>
        {isManager && (
          <div className="flex items-center gap-2">
            {tanks?.some((t) => t.telus_device_id != null) && (
              <button
                type="button"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                title="Read the TELUS gauges now (they are read every 15 minutes)"
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} /> Read gauges
              </button>
            )}
            <AddButton label="Add a tank" onClick={() => setOpen('new')} />
          </div>
        )}
      </div>

      {isLoading ? null : !tanks?.length ? (
        <p className="py-2 text-sm text-gray-500">No tanks recorded yet.{isManager ? ' Add each one with what it holds and its size.' : ''}</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {byFuel.map(([p, s]) => (
              <div key={p} className="rounded-md bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">
                  {FUEL_PRODUCT_LABEL[p]} · {s.count} tank{s.count === 1 ? '' : 's'}
                </p>
                <p className="font-semibold tabular-nums text-gray-900">
                  {s.unknown === s.count ? (
                    <>
                      {L(s.capacity)} <span className="text-xs font-normal text-gray-500">capacity</span>
                    </>
                  ) : (
                    <>
                      {Math.round(s.knownCapacity - s.room).toLocaleString('en-CA')}{' '}
                      <span className="text-xs font-normal text-gray-500">of</span> {L(s.knownCapacity)}
                    </>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {s.unknown === s.count ? 'Levels not read' : `Room for ${L(s.room)}${s.unknown ? ` + ${s.unknown} not read` : ''}`}
                </p>
              </div>
            ))}
          </div>
          <FuelTankMap tanks={tanks} isManager={isManager} placing={placing} onPlace={place} onOpen={(t) => isManager && setOpen(t)} />
          <div className="mb-3 mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {placing ? (
              <button type="button" onClick={() => setPlacingId(null)} className="text-brand-700 underline">
                Cancel placing {placing.name}
              </button>
            ) : isManager && unplaced.length ? (
              <span>
                {unplaced.length} tank{unplaced.length === 1 ? '' : 's'} not on the map yet: press Pin on its row, then click the map.
              </span>
            ) : isManager ? (
              <span>Drag a pin to move it.</span>
            ) : null}
            {save.error && <span className="text-red-600">{(save.error as Error).message}</span>}
            {sync.error && <span className="text-red-600">{(sync.error as Error).message}</span>}
            {sync.data && !sync.isPending && <span className="text-emerald-700">{sync.data}</span>}
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200">
          {/* One tank a card on a phone (design review, Nov 2026). */}
          <CardList>
            {tanks.map((t) => {
              const room = roomOf(t)
              const pct = t.level_l == null ? null : Math.round((100 * t.level_l) / t.capacity_l)
              return (
                <RowCard
                  key={t.id}
                  onClick={isManager ? rowClick(() => setOpen(t)) : undefined}
                  heading={
                    <span className="flex flex-wrap items-center gap-x-2">
                      {t.name}
                      <span className="text-xs font-normal text-gray-600">
                        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: FUEL_COLOUR[t.product] }} />
                        {FUEL_PRODUCT_LABEL[t.product]}
                      </span>
                    </span>
                  }
                  actions={isManager && pinButton(t)}
                  facts={[]}
                  summary={
                    <div>
                      <SummaryLine>
                        {t.location && (
                          <>
                            <span>{t.location}</span>
                            <Dot />
                          </>
                        )}
                        <span className="tabular-nums">{L(t.capacity_l)} tank</span>
                        {t.level_l != null && (
                          <>
                            <Dot />
                            <span className="tabular-nums">
                              {L(t.level_l)} in it ({pct}%)
                            </span>
                          </>
                        )}
                        {room != null && (
                          <>
                            <Dot />
                            <span className="tabular-nums">{L(room)} room</span>
                          </>
                        )}
                      </SummaryLine>
                      {t.level_l != null && <LevelNote t={t} />}
                      {t.notes && <p className="text-xs text-gray-500">{t.notes}</p>}
                    </div>
                  }
                />
              )
            })}
          </CardList>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Tank</th>
                  <th className={TABLE_TH}>Where</th>
                  <th className={TABLE_TH}>Holds</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Capacity</th>
                  <th className={cn(TABLE_TH, 'text-right')}>In it</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Room</th>
                  {isManager && <th className={cn(TABLE_TH, 'w-px')} />}
                </tr>
              </thead>
              <tbody>
                {tanks.map((t) => {
                  const room = roomOf(t)
                  const pct = t.level_l == null ? null : Math.round((100 * t.level_l) / t.capacity_l)
                  return (
                    <tr
                      key={t.id}
                      onClick={isManager ? rowClick(() => setOpen(t)) : undefined}
                      className={cn('border-b border-gray-100', isManager && 'cursor-pointer hover:bg-gray-50')}
                    >
                      <td className="px-3 py-1.5 font-medium text-gray-900">
                        {t.name}
                        {t.notes && <p className="text-xs font-normal text-gray-500">{t.notes}</p>}
                      </td>
                      <td className="px-3 py-1.5 text-gray-700">{t.location ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-700">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: FUEL_COLOUR[t.product] }} />
                        {FUEL_PRODUCT_LABEL[t.product]}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{L(t.capacity_l)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {t.level_l == null ? (
                          '—'
                        ) : (
                          <>
                            {L(t.level_l)} <span className="text-gray-400">({pct}%)</span>
                            <LevelNote t={t} />
                          </>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{room == null ? '—' : L(room)}</td>
                      {isManager && (
                        <td className="px-3 py-1.5 text-right">{pinButton(t)}</td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
        </>
      )}

      {open && (
        <RecordEditModal
          title={open === 'new' ? 'Add a fuel tank' : open.name}
          fields={FIELDS}
          row={open === 'new' ? { product: 'farm_diesel' } : (open as unknown as Record<string, unknown>)}
          onClose={close}
          saving={save.isPending || del.isPending}
          error={((save.error ?? del.error) as Error | null)?.message ?? null}
          onSave={(patch) => {
            // A level typed in is marked as typed, with when: the gauge's next
            // report replaces it, and until then it is not shown as the gauge's.
            const before = open === 'new' ? null : open
            const typed =
              'level_l' in patch && patch.level_l != null && (before == null || patch.level_l !== before.level_l || ('level_on' in patch && patch.level_on !== before.level_on))
                ? { level_source: 'typed' as const, level_at: new Date().toISOString() }
                : {}
            return save
              .mutateAsync({ id: before?.id ?? null, patch: before ? { ...patch, ...typed } : { product: 'farm_diesel', ...patch, ...typed } })
              .then(close)
          }}
          onDelete={open === 'new' ? undefined : () => del.mutateAsync(open.id).then(close)}
          deleteConfirm={open === 'new' ? undefined : `Delete the ${open.name} tank?`}
        />
      )}
    </section>
  )
}
