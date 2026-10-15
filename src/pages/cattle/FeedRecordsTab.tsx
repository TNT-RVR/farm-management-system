import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CalendarPlus, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { FeedOnHandPanel } from '@/pages/cattle/FeedOnHand'
import { Select } from '@/components/Select'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { DetailList, rowClick } from '@/components/RecordEditor'
import { HelpNote } from '@/components/HelpNote'
import { supabase } from '@/lib/supabase'
import {
  PURPOSE_LABEL,
  UNIT_LABEL,
  describeQuantity,
  poundsFor,
  summarise,
  type FeedLine,
  type FeedPurpose,
  type FeedUnit,
} from '@/lib/feedRecords'
import { useHerdCounts } from '@/lib/cattle'
import { useMainRanch, useRanches } from '@/lib/ranches'
import { useFeedPlan } from '@/lib/feed'
import { useFeedOnHand } from '@/lib/feed-inventory'
import { checkFeeding, recentRates, type FedLine } from '@/lib/feed-check'
import { coldUplift, effectiveTemp, type Warning } from '@/lib/cattle-nutrition'
import {
  feedValues,
  feedingWindow,
  groupInput,
  useColdForecast,
  useFeedTests,
  useFeedTypesFull,
  useGroupRations,
  type ColdDay,
} from '@/lib/winter-feeding'
import { WarningList } from '@/pages/cattle/feed/bits'

/**
 * The cattle manager's feed sheets, typed in.
 *
 * He keeps them by hand — a month, a group, a list of feeds, a head count, and
 * his own average in the margin. The form is shaped like that sheet on purpose:
 * somebody copying one in should not have to translate it first.
 *
 * The average is computed rather than entered. His arithmetic has been checked
 * against three months and agrees, so recomputing it costs nothing and means a
 * corrected line updates the figure instead of leaving it stale.
 */

type FeedTypeRow = {
  id: string
  name: string
  default_unit: FeedUnit
  default_lb_per_bale: number | null
  is_bedding: boolean
}

type LineRow = {
  id: string
  feed_type_id: string | null
  feed_type_name: string
  quantity: number
  unit: FeedUnit
  lb_per_bale: number | null
  purpose: FeedPurpose
  sort_order: number
}

type RecordRow = {
  id: string
  ranch_id: string
  herd_group: string
  herd_count_id: string | null
  period_start: string
  period_end: string
  head_count: number | null
  notes: string | null
  feed_record_lines: LineRow[]
}

function useFeedTypes() {
  return useQuery({
    queryKey: ['feed_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feed_types')
        .select('id, name, default_unit, default_lb_per_bale, is_bedding')
        .eq('archived', false)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as FeedTypeRow[]
    },
    staleTime: 30 * 60_000,
  })
}

/**
 * How many records each ranch has, for the empty state.
 *
 * Landing on a ranch with nothing on it and being told "no feed records yet" is
 * how somebody concludes the history was never saved — which is exactly what
 * happened here: eleven records on East Ranch, and the saved ranch was Grassy
 * Lake. The empty state can now say where they are instead.
 */
function useRecordCountsByRanch() {
  return useQuery({
    queryKey: ['feed_records', 'counts'],
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.from('feed_records').select('ranch_id')
      if (error) throw error
      const counts = new Map<string, number>()
      for (const r of (data ?? []) as { ranch_id: string }[]) {
        counts.set(r.ranch_id, (counts.get(r.ranch_id) ?? 0) + 1)
      }
      return counts
    },
  })
}

function useFeedRecords(ranchId: string | null) {
  return useQuery({
    queryKey: ['feed_records', ranchId],
    queryFn: async () => {
      let q = supabase
        .from('feed_records')
        .select(
          'id, ranch_id, herd_group, herd_count_id, period_start, period_end, head_count, notes, ' +
            'feed_record_lines(id, feed_type_id, feed_type_name, quantity, unit, lb_per_bale, purpose, sort_order)',
        )
        .order('period_start', { ascending: false })
      if (ranchId) q = q.eq('ranch_id', ranchId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as RecordRow[]
    },
  })
}

const lbs = (n: number) => n.toLocaleString('en-CA', { maximumFractionDigits: 0 })

const monthName = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })

/** "February 2025", or the dates when the period is not a whole month. */
function describePeriod(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const wholeMonth =
    s.getDate() === 1 &&
    e.getMonth() === s.getMonth() &&
    e.getDate() === new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate()
  if (wholeMonth) return monthName(start)
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  return `${fmt(s)} - ${fmt(e)}, ${e.getFullYear()}`
}

type DraftLine = {
  key: string
  feedTypeId: string
  /** The name the line was saved under, kept for a line whose feed is archived. */
  name?: string
  quantity: string
  unit: FeedUnit
  lbPerBale: string
  purpose: FeedPurpose
}

const blankLine = (): DraftLine => ({
  key: Math.random().toString(36).slice(2),
  feedTypeId: '',
  quantity: '',
  unit: 'lb',
  lbPerBale: '',
  purpose: 'feed',
})

/** Today, as the date inputs want it. */
const today = () => new Date().toISOString().slice(0, 10)

export function FeedRecordsTab({
  ranchId,
  ranches,
  canEdit,
}: {
  ranchId: string | null
  ranches: { id: string; name: string }[]
  canEdit: boolean
}) {
  const { data: types } = useFeedTypes()
  const { data: records, isLoading } = useFeedRecords(ranchId)
  const { data: countsByRanch } = useRecordCountsByRanch()
  const qc = useQueryClient()
  // ?new=1 opens straight on today's entry, so the home-screen tile lands on
  // the form rather than on a list with an instruction to press Add. Read once
  // in the initialiser rather than applied by an effect: an effect that sets
  // state on mount is a second render before anything is on screen, and the
  // answer is known before the first one.
  const [params] = useSearchParams()
  const openToday = params.get('new') === '1'
  const [adding, setAdding] = useState(openToday)
  // A day rather than a period. The sheets are kept by the month, but feeding
  // is done every morning, and somebody writing down what they just fed should
  // not have to work out what the period is first.
  const [day, setDay] = useState<string | null>(openToday ? today() : null)
  const [confirmDelete, setConfirmDelete] = useState<RecordRow | null>(null)
  // A card opens its record; Edit opens the same form the record was entered
  // on, filled in (Sam, 7 Oct 2026).
  const [viewing, setViewing] = useState<RecordRow | null>(null)
  const [editing, setEditing] = useState<RecordRow | null>(null)

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('feed_records').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed_records'] })
      void qc.invalidateQueries({ queryKey: ['feed_on_hand'] })
    },
  })

  const ranchName = (id: string) => ranches.find((r) => r.id === id)?.name ?? 'Unknown ranch'

  // What each feed has gone out at lately, for how long the pile lasts. A bale
  // line with no weight falls back to the feed's own bale weight, the same way
  // the feed-left view counts it.
  const typeById = useMemo(() => new Map((types ?? []).map((t) => [t.id, t])), [types])
  const recent = useMemo(
    () =>
      recentRates(
        (records ?? []).map((r) => ({
          period_start: r.period_start,
          period_end: r.period_end,
          lines: r.feed_record_lines
            .filter((l) => l.purpose !== 'bedding')
            .map((l) => ({
              feedTypeId: l.feed_type_id,
              bedding: false,
              lb: poundsFor({ quantity: Number(l.quantity), unit: l.unit, lbPerBale: l.lb_per_bale ?? (l.feed_type_id ? typeById.get(l.feed_type_id)?.default_lb_per_bale : null) ?? null }),
            })),
        })),
      ),
    [records, typeById],
  )
  const { data: plan } = useFeedPlan(ranchId)
  const [now] = useState(() => new Date())
  const turnout = plan ? feedingWindow(plan, now) : null
  const daysToTurnout = turnout && turnout.feeding ? Math.round((turnout.to.getTime() - now.getTime()) / 86_400_000) : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Feed records</h2>
          <HelpNote className="text-xs" summary="What was fed, to which group, over which days." title="About feed records">
            <p>
              What was fed, to which group, over which days. Bedding is recorded but kept out of the
              per-head average, the same way the paper sheets do it.
            </p>
          </HelpNote>
        </div>
        {canEdit && !adding && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => {
                setDay(today())
                setAdding(true)
              }}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              <CalendarPlus className="h-4 w-4" /> Feed today
            </button>
            <button
              onClick={() => {
                setDay(null)
                setAdding(true)
              }}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" /> A period
            </button>
          </div>
        )}
      </div>

      {adding && (
        <FeedRecordForm
          ranchId={ranchId}
          ranches={ranches}
          types={types ?? []}
          defaultDay={day}
          rates={recent.rates}
          onDone={() => {
            setAdding(false)
            void qc.invalidateQueries({ queryKey: ['feed_records'] })
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <FeedOnHandPanel
        ranchId={ranchId}
        ranchName={ranchId ? ranchName(ranchId) : undefined}
        types={types ?? []}
        canEdit={canEdit}
        rates={recent.rates}
        rateWindow={{ from: recent.from, to: recent.to }}
        daysToTurnout={daysToTurnout}
      />

      {ranchId && <LastWeekCheck ranchId={ranchId} records={records ?? []} />}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : !records?.length ? (
        <p className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          No feed records for {ranchId ? ranchName(ranchId) : 'any ranch'} yet.
          {(() => {
            // Where they actually are. Silence here reads as "the history was
            // never saved", which is the wrong conclusion and the one somebody
            // already drew.
            const elsewhere = [...(countsByRanch ?? new Map())].filter(
              ([id, n]) => id !== ranchId && n > 0,
            )
            if (!elsewhere.length) return null
            return (
              <span className="mt-1 block text-gray-600">
                {elsewhere
                  .map(([id, n]) => `${n} on ${ranchName(id)}`)
                  .join(', ')}{' '}
                — switch ranch above to see {elsewhere.length === 1 ? 'them' : 'those'}.
              </span>
            )
          })()}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {records.map((r) => {
            const lines: FeedLine[] = r.feed_record_lines.map((l) => ({
              feedTypeName: l.feed_type_name,
              quantity: Number(l.quantity),
              unit: l.unit,
              lbPerBale: l.lb_per_bale != null ? Number(l.lb_per_bale) : l.feed_type_id ? (typeById.get(l.feed_type_id)?.default_lb_per_bale ?? null) : null,
              purpose: l.purpose,
            }))
            const s = summarise(
              { periodStart: r.period_start, periodEnd: r.period_end, headCount: r.head_count },
              lines,
            )
            return (
              <div
                key={r.id}
                onClick={rowClick(() => setViewing(r))}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 hover:border-brand-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {r.herd_group} · {describePeriod(r.period_start, r.period_end)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {ranchName(r.ranch_id)} · {r.head_count ?? '-'} head · {s.days} days
                    </p>
                  </div>
                  {canEdit && (
                    <span className="flex shrink-0 items-center">
                      <button
                        onClick={() => setEditing(r)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Edit record"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(r)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Delete record"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </div>

                <p className="mt-2 text-lg font-semibold tabular-nums text-gray-900">
                  {s.lbPerHeadPerDay == null ? '-' : s.lbPerHeadPerDay.toFixed(1)}
                  <span className="ml-1 text-xs font-normal text-gray-500">
                    lb per head per day
                  </span>
                </p>

                {s.incompleteLines > 0 && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {s.incompleteLines} line{s.incompleteLines === 1 ? '' : 's'} counted in bales
                    with no bale weight, so this total is a floor, not the whole of it.
                  </p>
                )}

                <ul className="mt-2 space-y-0.5 text-xs">
                  {r.feed_record_lines
                    .slice()
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((l) => (
                      <li key={l.id} className="flex justify-between gap-2 text-gray-600">
                        <span className="truncate">
                          {l.feed_type_name}
                          {l.purpose !== 'feed' && (
                            <span className="ml-1 text-gray-400">({PURPOSE_LABEL[l.purpose]})</span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {describeQuantity({ quantity: Number(l.quantity), unit: l.unit })}
                        </span>
                      </li>
                    ))}
                </ul>

                <p className="mt-2 border-t border-gray-100 pt-1.5 text-xs text-gray-500">
                  {lbs(s.feedLb)} lb fed
                  {s.beddingLb > 0 && ` · ${lbs(s.beddingLb)} lb bedding`}
                </p>
                {r.notes && <p className="mt-1 text-xs italic text-gray-500">{r.notes}</p>}
              </div>
            )
          })}
        </div>
      )}

      {viewing && (
        <FeedRecordDetail
          record={viewing}
          ranchName={ranchName(viewing.ranch_id)}
          lbPerBaleFor={(id) => (id ? (typeById.get(id)?.default_lb_per_bale ?? null) : null)}
          canEdit={canEdit}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onDelete={() => {
            setConfirmDelete(viewing)
            setViewing(null)
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <Modal title={`Edit ${editing.herd_group} · ${describePeriod(editing.period_start, editing.period_end)}`} onClose={() => setEditing(null)} wide>
          <FeedRecordForm
            ranchId={editing.ranch_id}
            ranches={ranches}
            types={types ?? []}
            existing={editing}
            rates={recent.rates}
            onDone={() => {
              setEditing(null)
              void qc.invalidateQueries({ queryKey: ['feed_records'] })
            }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this feed record?"
          message={`${confirmDelete.herd_group}, ${describePeriod(
            confirmDelete.period_start,
            confirmDelete.period_end,
          )} - and its ${confirmDelete.feed_record_lines.length} line(s). This cannot be undone from here.`}
          confirmLabel="Delete"
          busy={remove.isPending}
          error={remove.error ? (remove.error as Error).message : null}
          onConfirm={() => {
            remove.mutate(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

type LineInsert = {
  feed_type_id: string | null
  feed_type_name: string
  quantity: number
  unit: FeedUnit
  lb_per_bale: number | null
  purpose: FeedPurpose
  sort_order: number
}

/**
 * Correct a saved record: the header in place, then the new lines in before
 * the old ones out, so a failure part-way leaves the old lines rather than
 * none. save_feed_record only inserts, hence three calls rather than one.
 */
async function updateFeedRecord(
  existing: RecordRow,
  header: Pick<RecordRow, 'ranch_id' | 'herd_group' | 'herd_count_id' | 'period_start' | 'period_end' | 'head_count' | 'notes'>,
  lines: LineInsert[],
) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // updated_at is a real column the generated types leave out of Update.
  const { error: e1 } = await (supabase as unknown as SupabaseClient)
    .from('feed_records')
    .update({ ...header, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
    .eq('id', existing.id)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('feed_record_lines').insert(lines.map((l) => ({ ...l, record_id: existing.id })))
  if (e2) throw e2
  const old = existing.feed_record_lines.map((l) => l.id)
  if (old.length) {
    const { error: e3 } = await supabase.from('feed_record_lines').delete().in('id', old)
    if (e3) throw e3
  }
}

/** One record, opened from its card: every line with its bale weight, and Edit / Delete. */
function FeedRecordDetail({
  record: r,
  ranchName,
  lbPerBaleFor,
  canEdit,
  onEdit,
  onDelete,
  onClose,
}: {
  record: RecordRow
  ranchName: string
  lbPerBaleFor: (feedTypeId: string | null) => number | null
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const lines: FeedLine[] = r.feed_record_lines.map((l) => ({
    feedTypeName: l.feed_type_name,
    quantity: Number(l.quantity),
    unit: l.unit,
    lbPerBale: l.lb_per_bale != null ? Number(l.lb_per_bale) : lbPerBaleFor(l.feed_type_id),
    purpose: l.purpose,
  }))
  const s = summarise({ periodStart: r.period_start, periodEnd: r.period_end, headCount: r.head_count }, lines)
  return (
    <Modal title={`${r.herd_group} · ${describePeriod(r.period_start, r.period_end)}`} onClose={onClose} wide>
      <DetailList
        rows={[
          ['Ranch', ranchName],
          ['Group', r.herd_group],
          ['Days', r.period_start === r.period_end ? r.period_start : `${r.period_start} to ${r.period_end} (${s.days} days)`],
          ['Head fed', r.head_count != null ? String(r.head_count) : null],
          ['Per head a day', s.lbPerHeadPerDay != null ? `${s.lbPerHeadPerDay.toFixed(1)} lb` : null],
          ['Fed', `${lbs(s.feedLb)} lb`],
          ['Bedding', s.beddingLb > 0 ? `${lbs(s.beddingLb)} lb` : null],
          ['Notes', r.notes],
        ]}
      />
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="py-1 font-medium">Feed</th>
            <th className="py-1 text-right font-medium">Amount</th>
            <th className="py-1 text-right font-medium">lb / bale</th>
            <th className="py-1 text-right font-medium">Pounds</th>
            <th className="py-1 pl-2 font-medium">Use</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {r.feed_record_lines
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((l) => {
              const lb = poundsFor({ quantity: Number(l.quantity), unit: l.unit, lbPerBale: l.lb_per_bale != null ? Number(l.lb_per_bale) : lbPerBaleFor(l.feed_type_id) })
              return (
                <tr key={l.id}>
                  <td className="py-1">{l.feed_type_name}</td>
                  <td className="py-1 text-right tabular-nums">{describeQuantity({ quantity: Number(l.quantity), unit: l.unit })}</td>
                  <td className="py-1 text-right tabular-nums text-gray-500">{l.unit === 'lb' ? '' : (l.lb_per_bale ?? lbPerBaleFor(l.feed_type_id) ?? '—')}</td>
                  <td className="py-1 text-right tabular-nums">{lb == null ? '—' : lbs(lb)}</td>
                  <td className="py-1 pl-2 text-gray-500">{PURPOSE_LABEL[l.purpose]}</td>
                </tr>
              )
            })}
        </tbody>
      </table>
      {canEdit && (
        <div className="mt-4 flex justify-between gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            <Pencil className="h-4 w-4" /> Edit
          </button>
        </div>
      )}
    </Modal>
  )
}

/** The forecast day for a date, or the average of the week's days when it is outside it. */
function coldFor(days: ColdDay[] | undefined, date: string): ColdDay | undefined {
  return days?.find((d) => d.date === date)
}

function FeedRecordForm({
  ranchId,
  ranches,
  types,
  defaultDay,
  existing,
  rates,
  onDone,
  onCancel,
}: {
  ranchId: string | null
  ranches: { id: string; name: string }[]
  types: FeedTypeRow[]
  /** A single day to pre-fill both ends with — today's feeding. */
  defaultDay?: string | null
  /** The record being corrected; the form opens filled with it. */
  existing?: RecordRow
  /** Lb a day each feed has gone out at lately, for "how long will it last". */
  rates: Map<string, number>
  onDone: () => void
  onCancel: () => void
}) {
  const mainRanch = useMainRanch()
  const [ranch, setRanch] = useState(
    existing?.ranch_id || ranchId || (ranches.find((r) => r.id === mainRanch?.id) ?? ranches[0])?.id || '',
  )
  const { data: groups } = useHerdCounts(ranch || undefined)
  const [groupId, setGroupId] = useState<string>(existing?.herd_count_id ?? '')
  const [group, setGroup] = useState(existing?.herd_group ?? 'Cows')
  // One day is a period of one day. The schema already carries both ends, so a
  // daily entry needs no second shape — and a month of daily entries still
  // averages correctly, because the summary works off the dates rather than
  // off how the record was created.
  const [start, setStart] = useState(existing?.period_start ?? defaultDay ?? '')
  const [end, setEnd] = useState(existing?.period_end ?? defaultDay ?? '')
  const [head, setHead] = useState(existing?.head_count != null ? String(existing.head_count) : '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(() =>
    existing?.feed_record_lines.length
      ? existing.feed_record_lines
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((l) => ({
            key: l.id,
            feedTypeId: l.feed_type_id ?? '',
            name: l.feed_type_name,
            quantity: String(Number(l.quantity)),
            unit: l.unit,
            lbPerBale: l.lb_per_bale != null ? String(Number(l.lb_per_bale)) : '',
            purpose: l.purpose,
          }))
      : [blankLine()],
  )
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])

  // For the check: feed values, the group's ration (its waste per feed), the
  // weather that day, the ranch's calving date and turnout, and what is left.
  const { data: fullTypes } = useFeedTypesFull()
  const { data: tests } = useFeedTests()
  const values = useMemo(() => feedValues(fullTypes ?? [], tests ?? []), [fullTypes, tests])
  const { data: rations } = useGroupRations(ranch || null)
  const { data: plan } = useFeedPlan(ranch || null)
  const { data: allRanches } = useRanches()
  const r = allRanches?.find((x) => x.id === ranch)
  const { data: forecast } = useColdForecast(r?.latitude == null ? null : Number(r.latitude), r?.longitude == null ? null : Number(r.longitude))
  const { data: onHand } = useFeedOnHand(ranch || null)
  const herd = groups?.find((g) => g.id === groupId)
  const notUsedHere = useMemo(() => new Set(plan?.feeds_not_used ?? []), [plan])

  // Group names from the Herd tab; the head count comes with the group.
  const pickGroup = (id: string) => {
    const g = groups?.find((x) => x.id === id)
    setGroupId(id)
    if (g) {
      setGroup(g.class_name)
      if (!head.trim() && g.head_count > 0) setHead(String(g.head_count))
    }
  }

  // The running total, shown while typing, because a transposed digit in a
  // six-figure silage number is invisible until it lands next to an average
  // somebody recognises as wrong.
  const preview = useMemo(() => {
    const parsed: FeedLine[] = lines
      .filter((l) => l.feedTypeId && l.quantity.trim() !== '')
      .map((l) => ({
        feedTypeName: typeById.get(l.feedTypeId)?.name ?? '',
        quantity: Number(l.quantity),
        unit: l.unit,
        lbPerBale: l.lbPerBale.trim() === '' ? null : Number(l.lbPerBale),
        purpose: l.purpose,
      }))
      .filter((l) => Number.isFinite(l.quantity))
    if (!start || !end) return null
    return summarise({ periodStart: start, periodEnd: end, headCount: Number(head) || null }, parsed)
  }, [lines, start, end, head, typeById])

  // Enough, too much, and will it last.
  const check = useMemo(() => {
    if (!herd || !plan || !start || !end || !preview || !(Number(head) > 0)) return null
    const fed: FedLine[] = lines
      .filter((l) => l.feedTypeId && l.quantity.trim() !== '' && l.purpose !== 'bedding')
      .flatMap((l) => {
        const feed = values.get(l.feedTypeId)
        const lb = poundsFor({ quantity: Number(l.quantity), unit: l.unit, lbPerBale: l.lbPerBale.trim() === '' ? null : Number(l.lbPerBale) })
        if (!feed || lb == null) return []
        const inRation = rations?.find((x) => x.herd_count_id === herd.id && x.feed_type_id === l.feedTypeId)
        return [{ feed, lbAsFed: lb, wastePct: inRation ? Number(inRation.waste_pct) : null }]
      })
    if (!fed.length) return null
    const wx = coldFor(forecast?.days, start)
    const cold = wx?.t != null && wx.w != null ? coldUplift(wx.t, wx.w, plan.coat, plan.sheltered) : 0
    const win = feedingWindow(plan, new Date(start + 'T12:00:00'))
    const c = checkFeeding({
      group: groupInput(herd),
      head: Number(head),
      days: preview.days,
      lines: fed,
      cond: {
        onDate: new Date(start + 'T12:00:00'),
        calvingMonth: plan.calving_month,
        calvingDay: plan.calving_day,
        daysToTurnout: Math.max(1, Math.round((win.to.getTime() - Date.parse(start + 'T12:00:00')) / 86_400_000)),
        cold,
        muddy: plan.muddy,
      },
    })
    if (!c) return null
    const warnings: Warning[] = [...c.warnings]
    // The yard: what this entry leaves, and whether it lasts to turnout at the recent rate.
    const daysLeft = win.feeding ? Math.round((win.to.getTime() - Date.parse(start + 'T12:00:00')) / 86_400_000) : null
    for (const l of fed) {
      const f = onHand?.find((x) => x.feed_type_id === l.feed.id)
      if (!f || f.put_up_lb <= 0) continue
      const after = f.remaining_lb - l.lbAsFed
      if (after < 0) {
        warnings.push({ code: 'W16', level: 'red', text: `${l.feed.name}: this is ${Math.round(-after).toLocaleString('en-CA')} lb more than is recorded in the yard — count what is left, or record what was put up.` })
        continue
      }
      const rate = Math.max(rates.get(l.feed.id) ?? 0, l.lbAsFed / preview.days)
      const lasts = rate > 0 ? after / rate : null
      if (lasts != null && daysLeft != null && lasts < daysLeft) {
        warnings.push({ code: 'W16', level: lasts < daysLeft * 0.8 ? 'red' : 'amber', text: `${l.feed.name}: about ${Math.round(lasts)} days left at this rate — turnout is in ${daysLeft}.` })
      }
    }
    return { ...c, warnings, cold, wx }
  }, [herd, plan, start, end, preview, head, lines, values, rations, forecast, onHand, rates])

  const save = useMutation({
    mutationFn: async () => {
      const usable = lines.filter((l) => (l.feedTypeId || (existing && l.name)) && l.quantity.trim() !== '')
      if (!ranch) throw new Error('Pick a ranch.')
      if (!group.trim()) throw new Error('Say which group was fed.')
      if (!start || !end) throw new Error('Give the first and last day of the period.')
      if (end < start) throw new Error('The period ends before it starts.')
      if (!usable.length) throw new Error('Add at least one feed line.')

      if (existing) {
        if (usable.some((l) => !Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0)) throw new Error('An amount is not a number.')
        await updateFeedRecord(
          existing,
          {
            ranch_id: ranch,
            herd_group: group.trim(),
            herd_count_id: groupId || null,
            period_start: start,
            period_end: end,
            head_count: Number(head) > 0 ? Math.round(Number(head)) : null,
            notes: notes.trim() || null,
          },
          usable.map((l, i) => ({
            feed_type_id: l.feedTypeId || null,
            feed_type_name: typeById.get(l.feedTypeId)?.name ?? l.name ?? '',
            quantity: Number(l.quantity),
            unit: l.unit,
            lb_per_bale: l.unit === 'lb' || l.lbPerBale.trim() === '' ? null : Number(l.lbPerBale),
            purpose: l.purpose,
            sort_order: (i + 1) * 10,
          })),
        ).catch((e: unknown) => {
          if ((e as { code?: string }).code === '23505') {
            throw new Error(`There is already a record for ${group.trim()} over these days. Change the dates, or delete the other one.`)
          }
          throw e
        })
        return
      }

      // Header and lines together, so a failure leaves nothing half-saved.
      const { error: e } = await supabase.rpc('save_feed_record', {
        p_record: {
          ranch_id: ranch,
          herd_group: group.trim(),
          herd_count_id: groupId || '',
          period_start: start,
          period_end: end,
          head_count: Number(head) > 0 ? String(Number(head)) : '',
          notes: notes.trim(),
        },
        p_lines: usable.map((l, i) => ({
          feed_type_id: l.feedTypeId,
          feed_type_name: typeById.get(l.feedTypeId)?.name ?? '',
          quantity: Number(l.quantity),
          unit: l.unit,
          lb_per_bale: l.unit === 'lb' || l.lbPerBale.trim() === '' ? '' : String(Number(l.lbPerBale)),
          purpose: l.purpose,
          sort_order: (i + 1) * 10,
        })),
      })
      if (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new Error(`There is already a record for ${group.trim()} over these days. Delete that one first, or change the dates.`)
        }
        throw e
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed_on_hand'] })
      onDone()
    },
    onError: (e) => setError((e as Error).message),
  })

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const groupOptions = (groups ?? []).map((g) => ({ value: g.id, label: `${g.class_name} (${g.head_count})` }))

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-gray-600">
          Ranch
          <Select
            value={ranch}
            onChange={(v) => {
              setRanch(v)
              setGroupId('')
            }}
            options={ranches.map((r2) => ({ value: r2.id, label: r2.name }))}
            className="mt-0.5 w-full"
          />
        </label>
        <label className="text-xs text-gray-600">
          Group
          {groupOptions.length > 0 ? (
            <Select
              value={groupId}
              placeholder={existing && !groupId ? group : 'Which group…'}
              ariaLabel="Group"
              onChange={pickGroup}
              options={groupOptions}
              className="mt-0.5 w-full"
            />
          ) : (
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="Cows"
              className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          )}
        </label>
        <label className="text-xs text-gray-600">
          Head fed
          <input
            type="number"
            inputMode="numeric"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            placeholder={herd ? String(herd.head_count) : '167'}
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-600">
          First day
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-600">
          Last day
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <HelpNote className="mt-1" summary="Split the month when the head count changes partway." title="Why split the month">
        <p>
          Split the month when the head count changes partway - that is what the paper sheets do when
          cattle are sold, because an average across a count that changed is an average of nothing.
        </p>
      </HelpNote>

      <div className="mt-3 space-y-1.5">
        {lines.map((l) => {
          const t = typeById.get(l.feedTypeId)
          return (
            <div key={l.key} className="grid grid-cols-2 gap-1.5 sm:grid-cols-12">
              <Select
                value={l.feedTypeId}
                placeholder="Feed type…"
                ariaLabel="Feed type"
                onChange={(value) => {
                  const picked = typeById.get(value)
                  setLine(l.key, {
                    feedTypeId: value,
                    unit: picked?.default_unit ?? 'lb',
                    lbPerBale: picked?.default_lb_per_bale ? String(picked.default_lb_per_bale) : '',
                    purpose: picked?.is_bedding ? 'bedding' : 'feed',
                  })
                }}
                options={[
                  ...types.filter((t2) => !notUsedHere.has(t2.id)),
                  ...types.filter((t2) => notUsedHere.has(t2.id)),
                ].map((t2) => ({ value: t2.id, label: notUsedHere.has(t2.id) ? `${t2.name} (not usually fed here)` : t2.name }))}
                className="col-span-2 sm:col-span-4"
              />
              <input
                type="number"
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                placeholder="Amount"
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2"
              />
              <Select
                value={l.unit}
                ariaLabel="Counted in"
                onChange={(value) => setLine(l.key, { unit: value as FeedUnit })}
                options={(Object.keys(UNIT_LABEL) as FeedUnit[]).map((u) => ({
                  value: u,
                  label: UNIT_LABEL[u],
                }))}
                className="sm:col-span-2"
              />
              <input
                type="number"
                inputMode="decimal"
                value={l.unit === 'lb' ? '' : l.lbPerBale}
                disabled={l.unit === 'lb'}
                onChange={(e) => setLine(l.key, { lbPerBale: e.target.value })}
                placeholder={l.unit === 'lb' ? '-' : 'lb / bale'}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 sm:col-span-2"
              />
              <Select
                value={l.purpose}
                ariaLabel="Fed or bedding"
                onChange={(value) => setLine(l.key, { purpose: value as FeedPurpose })}
                options={(Object.keys(PURPOSE_LABEL) as FeedPurpose[]).map((pp) => ({
                  value: pp,
                  label: PURPOSE_LABEL[pp],
                }))}
                className="sm:col-span-2"
              />
              <button
                onClick={() =>
                  setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))
                }
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 sm:col-span-1"
                aria-label="Remove line"
              >
                <Trash2 className="mx-auto h-4 w-4" />
              </button>
              {t && l.unit !== 'lb' && l.lbPerBale.trim() === '' && (
                <p className="col-span-2 text-[11px] text-amber-700 sm:col-span-12">
                  No bale weight for {t.name}, so this line cannot be counted in the total.
                </p>
              )}
            </div>
          )
        })}
        <button
          onClick={() => setLines((ls) => [...ls, blankLine()])}
          className="flex items-center gap-1 text-xs text-brand-700 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add feed line
        </button>
      </div>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes - e.g. sold 78 heifers on the 14th"
        className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />

      {preview && (
        <p className="mt-2 text-xs text-gray-600">
          {lbs(preview.feedLb)} lb fed over {preview.days} days
          {preview.beddingLb > 0 && ` · ${lbs(preview.beddingLb)} lb bedding`}
          {preview.lbPerHeadPerDay != null && (
            <span className="ml-1 font-semibold text-gray-900">
              = {preview.lbPerHeadPerDay.toFixed(1)} lb per head per day
            </span>
          )}
        </p>
      )}

      {check && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-gray-600">
            {check.dmPerHead.toFixed(1)} lb dry matter eaten a head a day (after waste) · {check.cowTdnPerHead.toFixed(1)} lb energy{check.cowTdnPerHead < check.tdnPerHead - 0.05 ? ' (after the calves’ share)' : ''} against a need of{' '}
            {check.needTdn.toFixed(1)}
            {check.wx?.t != null && check.wx.w != null && (
              <> — {check.wx.t.toFixed(0)} °C, {check.wx.w.toFixed(0)} km/h wind, feels {effectiveTemp(check.wx.t, check.wx.w, plan?.sheltered).toFixed(0)} °C{check.cold > 0 ? ` (+${Math.round(check.cold * 100)}% for cold)` : ''}</>
            )}
            {preview && preview.days > 1 && ' · averaged over the period'}
          </p>
          <WarningList warnings={check.warnings} />
        </div>
      )}
      {!check && !groupId && groupOptions.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-500">Pick the group to check this against what it needs today.</p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => {
            setError(null)
            save.mutate()
          }}
          disabled={save.isPending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving...' : existing ? 'Save changes' : 'Save record'}
        </button>
        <button onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The last seven days of daily sheets for each group, against the need over
 * the same days — one day is noisy (a bale put out for two days), a week is not.
 */
function LastWeekCheck({ ranchId, records }: { ranchId: string; records: RecordRow[] }) {
  const { data: groups } = useHerdCounts(ranchId)
  const { data: plan } = useFeedPlan(ranchId)
  const { data: fullTypes } = useFeedTypesFull()
  const { data: tests } = useFeedTests()
  const { data: rations } = useGroupRations(ranchId)
  const { data: allRanches } = useRanches()
  const r = allRanches?.find((x) => x.id === ranchId)
  const { data: forecast } = useColdForecast(r?.latitude == null ? null : Number(r.latitude), r?.longitude == null ? null : Number(r.longitude))
  const values = useMemo(() => feedValues(fullTypes ?? [], tests ?? []), [fullTypes, tests])
  const [now] = useState(() => new Date())

  const rows = useMemo(() => {
    if (!groups || !plan) return []
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString().slice(0, 10)
    const out: { name: string; days: number; warnings: Warning[]; ratio: number }[] = []
    for (const g of groups) {
      const recs = records.filter((x) => x.herd_count_id === g.id && x.period_start >= from && x.period_start === x.period_end)
      if (recs.length < 3) continue
      const lines: FedLine[] = []
      for (const rec of recs) {
        for (const l of rec.feed_record_lines) {
          if (l.purpose === 'bedding' || !l.feed_type_id) continue
          const feed = values.get(l.feed_type_id)
          const lb = poundsFor({ quantity: Number(l.quantity), unit: l.unit, lbPerBale: l.lb_per_bale ?? feed?.lbPerBale ?? null })
          if (!feed || lb == null) continue
          const inRation = rations?.find((x) => x.herd_count_id === g.id && x.feed_type_id === l.feed_type_id)
          lines.push({ feed, lbAsFed: lb, wastePct: inRation ? Number(inRation.waste_pct) : null })
        }
      }
      const days = recs.length
      const head = recs.reduce((s, x) => s + (x.head_count ?? g.head_count), 0) / days
      // Cold over the same days, from the past-week weather.
      const colds = recs.map((x) => {
        const wx = forecast?.days.find((d) => d.date === x.period_start)
        return wx?.t != null && wx.w != null ? coldUplift(wx.t, wx.w, plan.coat, plan.sheltered) : 0
      })
      const mid = recs[Math.floor(recs.length / 2)].period_start
      const win = feedingWindow(plan, new Date(mid + 'T12:00:00'))
      const c = checkFeeding({
        group: groupInput(g),
        head,
        days,
        lines,
        cond: {
          onDate: new Date(mid + 'T12:00:00'),
          calvingMonth: plan.calving_month,
          calvingDay: plan.calving_day,
          daysToTurnout: Math.max(1, Math.round((win.to.getTime() - Date.parse(mid + 'T12:00:00')) / 86_400_000)),
          cold: colds.reduce((s, x) => s + x, 0) / colds.length,
          muddy: plan.muddy,
        },
      })
      if (!c) continue
      const warnings = c.warnings.map((w) =>
        w.code === 'W3' || (w.code === 'W2' && days >= 7)
          ? { ...w, level: 'red' as const, text: `Last ${days} days: ${w.text.replace("today's need", 'the need')}` }
          : w.code === 'W4' && days >= 7
            ? { ...w, text: `Last ${days} days: ${w.text.replace("today's need", 'the need')}` }
            : { ...w, text: `Last ${days} days: ${w.text.replace("today's need", 'the need')}` },
      )
      out.push({ name: g.class_name, days, warnings, ratio: c.ratio })
    }
    return out
  }, [groups, plan, records, values, rations, forecast, now])

  if (!rows.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-sm font-semibold text-gray-900">The last week, group by group</p>
      <div className="mt-2 space-y-2">
        {rows.map((x) => (
          <div key={x.name}>
            <p className="text-xs font-medium text-gray-700">{x.name}</p>
            <WarningList warnings={x.warnings} />
          </div>
        ))}
      </div>
      <HelpNote className="mt-2" summary="From daily sheets linked to a group — check against body condition monthly." title="Reading the weekly check">
        <p>
          From daily sheets linked to a group. Check it against body condition every month — if the log says enough and the cows are losing condition, a bale or bucket
          weight is wrong.
        </p>
      </HelpNote>
    </div>
  )
}
