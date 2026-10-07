import { useMemo, useState } from 'react'
import { MoistureTestNote } from '@/pages/harvest/SampleCondition'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft, Download, Flag, PenLine, Plus, Scale, Settings2, Thermometer } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Fold } from '@/components/Fold'
import { supabase } from '@/lib/supabase'
import { useCrops, useFields } from '@/lib/queries'
import { useBinAllocations, useBinOnHand, useBins, type BinRow } from '@/lib/bins'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useDismissBinAirAlert } from '@/lib/moisture-queries'
import { useBinContents, contentLabel, isCarryOver } from '@/lib/bin-contents'
import { isOpenLoad, useBinLoads } from '@/lib/bin-loads'
import { rowClick } from '@/components/RecordEditor'
import { GRAIN_MOVEMENT_TYPES, type GrainMovementRow } from '@/lib/inventory'
import { cropColour } from '@/lib/crop-colour'
import { cn } from '@/lib/utils'
import { BinDrawing } from './BinDrawing'
import { BinMonitoring } from './BinMonitoring'
import { BinEditForm, BinExportPanel } from './BinTools'
import { DeleteLoadButton, EditLoadDialog } from './WeighIn'
import { MovementDetail } from './MovementDetail'
import { MoistureTestDetail } from '@/pages/harvest/MoistureTestDetail'

const bu = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} bu`
const kg = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} kg`

/** Everything recorded against one bin, newest first where it is a history. */
function useBinHistory(binId: string) {
  return useQuery({
    queryKey: ['bin_detail', binId],
    queryFn: async () => {
      const [moves, tests, alerts, readings] = await Promise.all([
        supabase.from('grain_movements').select('*').eq('bin_id', binId).order('moved_at').order('created_at'),
        supabase.from('moisture_tests').select('*').eq('bin_id', binId).order('tested_at', { ascending: false }).limit(20),
        supabase.from('bin_air_alerts').select('*').eq('bin_id', binId).is('dismissed_at', null).order('raised_at', { ascending: false }),
        supabase.from('bin_readings').select('*').eq('bin_id', binId).order('reading_at', { ascending: false }).limit(10),
      ])
      for (const r of [moves, tests, alerts, readings]) if (r.error) throw r.error
      return {
        moves: (moves.data ?? []) as GrainMovementRow[],
        tests: tests.data ?? [],
        alerts: alerts.data ?? [],
        readings: readings.data ?? [],
      }
    },
    staleTime: 30_000,
  })
}

/**
 * One bin, all of it: how full, what with, which field it was given this
 * year, whether it needs air, every load into it and every bushel that moved.
 *
 * Opened by clicking a bin's row. The row keeps its own controls for the
 * quick jobs; this is for "what is going on with #21".
 */
export function BinDetail({
  bin,
  cropYear,
  canEdit,
  onClose,
  onWeighIn,
  onAdd,
  onMove,
  onRecord,
  extra,
}: {
  bin: BinRow
  cropYear: number
  canEdit: boolean
  onClose: () => void
  onWeighIn: () => void
  onAdd: () => void
  onMove: () => void
  onRecord: () => void
  /** More buttons from where it was opened — the bin map's pin controls. */
  extra?: React.ReactNode
}) {
  const { data: crops } = useCrops()
  const { data: fields } = useFields()
  const { data: onHand } = useBinOnHand()
  const { data: contents } = useBinContents()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: loads } = useBinLoads(bin.id)
  const { data: history, isLoading } = useBinHistory(bin.id)
  const { data: allBins } = useBins()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const dismiss = useDismissBinAirAlert()
  const [panel, setPanel] = useState<'export' | 'edit' | null>(null)
  // Rows opened from the tables below (Sam, 7 Oct 2026), by id so what is
  // shown is the saved version after an edit.
  const [moveId, setMoveId] = useState<string | null>(null)
  const [loadId, setLoadId] = useState<string | null>(null)
  const [testId, setTestId] = useState<string | null>(null)
  // The bin as saved now, so an edit shows without reopening the pop-up.
  const current = (allBins ?? []).find((b) => b.id === bin.id) ?? bin
  const sites = [...new Set((allBins ?? []).map((b) => b.site).filter((s): s is string => !!s))].sort()

  const cropName = (id: string | null | undefined) => (crops ?? []).find((c) => c.id === id)?.name ?? '—'
  const fieldName = (id: string | null | undefined) => (fields ?? []).find((f) => f.id === id)?.name ?? '—'

  const held = (onHand ?? []).filter((o) => o.bin_id === bin.id && o.onhand_bu > 0)
  const heldTotal = held.reduce((s, o) => s + o.onhand_bu, 0)
  const content = (contents ?? []).find((c) => c.bin_id === bin.id) ?? null
  const cap = Number(bin.capacity_bu) || 0
  const fullPct = cap > 0 ? Math.min(100, (heldTotal / cap) * 100) : 0
  const alloc = (allocations ?? []).find((a) => a.bin_id === bin.id) ?? null
  // The crop in the bin decides the moisture conversion: what is in it, else
  // what was recorded by hand, else what it was assigned this year.
  const monitorCrop = (crops ?? []).find((c) => c.id === (held[0]?.crop_id ?? content?.crop_id ?? alloc?.crop_id)) ?? null
  const finished = (loads ?? []).filter((l) => !isOpenLoad(l))
  const waiting = (loads ?? []).filter(isOpenLoad)

  // The ledger with a running balance, shown newest first.
  const ledger = useMemo(() => {
    const rows = (history?.moves ?? []).map((m) => {
      const t = GRAIN_MOVEMENT_TYPES.find((x) => x.value === m.movement_type)
      const signed = m.movement_type === 'adjustment' ? Number(m.bushels) : (t?.inflow ? 1 : -1) * Number(m.bushels)
      return { m, label: t?.label ?? m.movement_type, signed }
    })
    const balances = rows.reduce<number[]>((acc, r) => [...acc, (acc[acc.length - 1] ?? 0) + r.signed], [])
    return rows.map((r, i) => ({ ...r, balance: balances[i] })).reverse()
  }, [history])

  return (
    <Modal title={current.name} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {/* How full, with what */}
        <div className="flex flex-wrap items-center gap-4">
          <BinDrawing
            capacityBu={cap}
            fillBu={heldTotal}
            colour={held[0] ? cropColour((crops ?? []).find((c) => c.id === held[0].crop_id)) : '#cbd5e1'}
            label={heldTotal > 0 ? cropName(held[0]?.crop_id) : null}
            // The yard description is the only record of which bins are hoppers.
            hopper={/hopper/i.test(bin.notes_md ?? '')}
            className="h-36 w-24 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {heldTotal > 0 ? bu(heldTotal) : content ? contentLabel(content) : 'Empty'}
            </p>
            <p className="text-xs text-gray-500">
              of {bu(cap)} · {cap > 0 && heldTotal > 0 ? `${Math.round(fullPct)}% full, room for ${bu(Math.max(0, cap - heldTotal))}` : 'capacity'}
              {bin.site ? ` · ${bin.site}` : ''}
              {bin.usual_contents === 'fertilizer' ? ' · fertilizer bin' : ''}
            </p>
            {held.length > 1 && (
              <p className="mt-0.5 text-xs text-gray-600">{held.map((h) => `${cropName(h.crop_id)} ${bu(h.onhand_bu)}`).join(' · ')}</p>
            )}
            {heldTotal <= 0 && content && isCarryOver(content, cropYear) && (
              <p className="mt-0.5 text-xs text-amber-800">Carry-over from {content.crop_year}, recorded by hand.</p>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={onWeighIn} className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">
                <Scale className="h-3.5 w-3.5" /> Weigh in
              </button>
              <button type="button" onClick={onAdd} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
              {heldTotal > 0 && (
                <button type="button" onClick={onMove} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Move
                </button>
              )}
              {heldTotal <= 0 && !content && (
                <button type="button" onClick={onRecord} className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 hover:bg-amber-100">
                  <PenLine className="h-3.5 w-3.5" /> Record
                </button>
              )}
            </div>
          )}
          {extra && <div className="flex w-full flex-wrap gap-1.5">{extra}</div>}
          <div className="flex w-full flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setPanel(panel === 'export' ? null : 'export')}
              className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            {isManager && (
              <button
                type="button"
                onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Settings2 className="h-3.5 w-3.5" /> Edit bin
              </button>
            )}
          </div>
        </div>

        {panel === 'export' && <BinExportPanel bin={current} onDone={() => setPanel(null)} />}
        {panel === 'edit' && isManager && <BinEditForm bin={current} sites={sites} onDone={() => setPanel(null)} />}

        {/* Needs air */}
        {(history?.alerts ?? []).length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            {(history?.alerts ?? []).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Went in {a.grade ?? ''} at {Number(a.moisture_pct).toFixed(1)}% on{' '}
                {a.raised_at.slice(0, 10)} — needs air.
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: a.id, note: 'Air put on' })}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] hover:bg-red-100"
                  >
                    Air is on it
                  </button>
                  <button
                    type="button"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: a.id, note: 'Dismissed without air' })}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] hover:bg-red-100"
                  >
                    Dismiss — no air needed
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* This year */}
        <Section title={`${cropYear} assignment`}>
          {alloc?.field_id ? (
            <p className="flex items-center gap-1.5">
              {alloc.crop_id && (
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: cropColour((crops ?? []).find((c) => c.id === alloc.crop_id)) }} />
              )}
              <Link to={`/fields/${alloc.field_id}/history`} onClick={onClose} className="font-medium text-brand-700 hover:underline">
                {fieldName(alloc.field_id)}
              </Link>
              <span className="text-gray-600">· {cropName(alloc.crop_id)}</span>
            </p>
          ) : (
            <p className="text-gray-400">Not assigned to a field this year.</p>
          )}
        </Section>

        {/* Sensor cable readings, and BASF's canola report. "Latest
            readings" was a section of its own above this, a second sensor
            heading over the one below; the last reading entered on the
            Integrations page (bin_readings) is one line now instead. */}
        {(history?.readings ?? []).length > 0 && (
          <p className="-mb-2 flex items-center gap-1.5 text-xs text-gray-600">
            <Thermometer className="h-3.5 w-3.5 text-gray-400" />
            {(() => {
              const r = history!.readings[0]
              return `Last sensor reading: ${r.temp_c != null ? `${Number(r.temp_c).toFixed(1)} °C` : ''}${r.moisture_pct != null ? ` · ${Number(r.moisture_pct).toFixed(1)}% moisture` : ''} · ${new Date(r.reading_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}`
            })()}
          </p>
        )}
        <BinMonitoring
          binId={bin.id}
          binName={bin.name}
          cropYear={cropYear}
          crop={monitorCrop}
          lldDefault={(fields ?? []).find((f) => f.id === alloc?.field_id)?.legal_land_description ?? null}
          canEdit={canEdit}
        />

        {/* Moisture of what went in */}
        {(history?.tests ?? []).length > 0 && (
          <Section title="Moisture tests">
            <Table head={['When', 'Field', 'Moisture', 'Grade', 'Sample / note']}>
              {history!.tests.map((t) => (
                <tr key={t.id} onClick={rowClick(() => setTestId(t.id))} className="cursor-pointer hover:bg-gray-50">
                  <Td>{t.tested_at.slice(0, 10)}</Td>
                  <Td>{fieldName(t.field_id)}</Td>
                  <Td num>{t.moisture_pct != null ? `${Number(t.moisture_pct).toFixed(1)}%` : '—'}</Td>
                  <Td>{t.grade ?? '—'}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <MoistureTestNote test={t} />
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>
        )}

        {/* Loads */}
        <Section title={`Loads weighed in (${finished.length})`}>
          {waiting.length > 0 && (
            <p className="mb-1 text-xs text-amber-800">
              {waiting.length} load{waiting.length === 1 ? '' : 's'} waiting for a second weight.
            </p>
          )}
          {finished.length === 0 ? (
            <p className="text-gray-400">No loads weighed into this bin.</p>
          ) : (
            <Table head={canEdit ? ['Date', 'From', 'Net', 'Bushels', 'Driver', ''] : ['Date', 'From', 'Net', 'Bushels', 'Driver']}>
              {finished.map((l) => (
                <tr
                  key={l.id}
                  onClick={canEdit ? rowClick(() => setLoadId(l.id)) : undefined}
                  className={cn(canEdit && 'cursor-pointer hover:bg-gray-50')}
                  title={canEdit ? 'Open the load to see or correct it' : undefined}
                >
                  <Td>{l.loaded_on}</Td>
                  <Td>
                    {fieldName(l.field_id)}
                    {l.last_from_field && <Flag className="ml-1 inline h-3 w-3 text-green-700" fill="currentColor" aria-label="Last load from the field" />}
                  </Td>
                  <Td num>{kg(l.net_kg)}</Td>
                  <Td num strong>
                    {bu(l.bushels)}
                  </Td>
                  <Td>{[l.driver, l.truck, l.trailer].filter(Boolean).join(' · ') || '—'}</Td>
                  {canEdit && (
                    <td className="px-1 py-1 text-right">
                      <DeleteLoadButton load={l} />
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
          {finished.length > 0 && (
            <p className="mt-1 text-right text-xs text-gray-500">
              {bu(finished.reduce((s, l) => s + Number(l.bushels ?? 0), 0))} ·{' '}
              {kg(finished.reduce((s, l) => s + Number(l.net_kg ?? 0), 0))}
            </p>
          )}
        </Section>

        {/* The ledger. Folded: the loads above and the on-hand figure say
            what it adds up to, and this is for when they do not agree. */}
        <Fold
          title="Every movement"
          summary={
            isLoading
              ? undefined
              : ledger.length === 0
                ? 'none yet'
                : // Newest first, so the first row's balance is where it stands.
                  `${ledger.length} · balance ${Math.round(ledger[0].balance).toLocaleString('en-CA')} bu`
          }
          storageKey="bin-detail-movements"
          className="text-sm"
        >
          {isLoading ? (
            <p className="text-gray-400">Loading…</p>
          ) : ledger.length === 0 ? (
            <p className="text-gray-400">Nothing has moved in or out of this bin yet.</p>
          ) : (
            <Table head={['Date', 'What', 'Crop', 'Bushels', 'Balance']}>
              {ledger.map(({ m, label, signed, balance }) => (
                <tr key={m.id} title={m.notes ?? undefined} onClick={rowClick(() => setMoveId(m.id))} className="cursor-pointer hover:bg-gray-50">
                  <Td>{m.moved_at}</Td>
                  <Td>
                    {label}
                    {m.field_id && <span className="block text-[10px] text-gray-400">{fieldName(m.field_id)}</span>}
                  </Td>
                  <Td>{cropName(m.crop_id)}</Td>
                  <Td num className={signed >= 0 ? 'text-green-800' : 'text-red-700'}>
                    {signed >= 0 ? '+' : '−'}
                    {Math.round(Math.abs(signed)).toLocaleString('en-CA')}
                  </Td>
                  <Td num strong>
                    {Math.round(balance).toLocaleString('en-CA')}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Fold>

        {bin.notes_md && (
          <Section title="Notes">
            <p className="whitespace-pre-wrap text-gray-700">{bin.notes_md}</p>
          </Section>
        )}
      </div>

      {(() => {
        const row = ledger.find((r) => r.m.id === moveId)
        return row ? (
          <MovementDetail
            m={row.m}
            label={row.label}
            signed={row.signed}
            balance={row.balance}
            isManager={isManager}
            onOpenLoad={(id) => {
              if (!(loads ?? []).some((l) => l.id === id)) return
              setMoveId(null)
              setLoadId(id)
            }}
            onClose={() => setMoveId(null)}
          />
        ) : null
      })()}
      {(() => {
        const l = (loads ?? []).find((x) => x.id === loadId)
        return l ? <EditLoadDialog load={l} onClose={() => setLoadId(null)} /> : null
      })()}
      {(() => {
        const t = (history?.tests ?? []).find((x) => x.id === testId)
        return t ? <MoistureTestDetail test={t} onClose={() => setTestId(null)} /> : null
      })()}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-gray-200">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn('px-2 py-1 font-medium', i >= 2 && (h === 'Net' || h === 'Bushels' || h === 'Balance' || h === 'Moisture') && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, num, strong, className }: { children: React.ReactNode; num?: boolean; strong?: boolean; className?: string }) {
  return (
    <td className={cn('px-2 py-1 text-gray-700', num && 'text-right tabular-nums', strong && 'font-semibold text-gray-900', className)}>{children}</td>
  )
}
