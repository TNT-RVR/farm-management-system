import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus, TriangleAlert, Wheat } from 'lucide-react'
import { DeleteButton, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { HelpNote } from '@/components/HelpNote'
import { DateField } from '@/components/DateField'
import { Select } from '@/components/Select'
import {
  KIND_LABEL,
  KIND_SIGN,
  daysOfFeedLeft,
  inNaturalUnits,
  signedQuantity,
  useDeleteFeedInventory,
  useFeedInventory,
  useFeedOnHand,
  useSaveFeedInventory,
  useUpdateFeedInventory,
  useBaleWeightDefaults,
  useSaveBaleWeightDefault,
  type BaleWeightDefaultRow,
  type FeedInventoryKind,
  type FeedInventoryRow,
} from '@/lib/feed-inventory'
import { useFields } from '@/lib/queries'
import { useFeedTests } from '@/lib/winter-feeding'
import { BALE_TYPES, isWeightEstimate, lotLbPerBale, ordinal } from '@/lib/baling'
import { Num } from '@/pages/cattle/feed/bits'
import { cn } from '@/lib/utils'
import { CARD_HEAD, TABLE_HEAD } from '@/lib/table-style'

const KINDS: FeedInventoryKind[] = [
  'harvested',
  'purchased',
  'opening',
  'sold',
  'shrink',
  'adjustment',
]

const UNIT_WORD: Record<string, string> = { lb: 'lb', round: 'rounds', big_square: 'big squares' }

/** The fields one put-up / bought / sold entry is corrected through. */
const ENTRY_FIELDS: EditField[] = [
  { key: 'moved_on', label: 'When', kind: 'date', required: true },
  { key: 'kind', label: 'What happened', kind: 'select', required: true, options: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) },
  { key: 'quantity', label: 'How much', kind: 'number', required: true, hint: 'Typed as a plain amount; a sale or spoilage is taken off the pile. Only a correction keeps a minus sign.' },
  {
    key: 'unit',
    label: 'Counted in',
    kind: 'select',
    options: [
      { value: 'lb', label: 'Pounds' },
      { value: 'round', label: 'Rounds' },
      { value: 'big_square', label: 'Big squares' },
    ],
  },
  { key: 'lb_per_bale', label: 'lb per bale', kind: 'number', hint: 'Blank uses the feed’s own bale weight.' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]

/**
 * A baling record's entry: the count, feed and size come from the record and
 * change there. What is corrected here is what the field does not know: the
 * weight once bales are weighed, a feed test, where the stack is.
 */
const baledFields = (tests: { value: string; label: string }[]): EditField[] => [
  { key: 'lb_per_bale', label: 'Weighed: lb per bale', kind: 'number', hint: 'Blank keeps the estimate from the bale weights below.' },
  { key: 'feed_test_id', label: 'Feed test', kind: 'select', options: [{ value: '', label: 'None' }, ...tests] },
  { key: 'storage_place', label: 'Stacked at', kind: 'text' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]

/**
 * What is left of each feed.
 *
 * Put up, minus what the feed sheets say went in the bunk. Both halves are
 * needed: the sheets alone say what has been eaten, and the question anybody
 * actually asks in January is what remains.
 *
 * A feed that has been fed but never recorded as put up shows a NEGATIVE
 * remainder, and it is left showing rather than clamped to zero — it is a real
 * statement that the inventory is missing, and hiding it behind a tidy zero is
 * how somebody comes to trust a number that was never entered.
 *
 * Only Left and Lasts are columns: whether the feed lasts to turnout has one
 * home, the Feed tab's "Will the feed last?". Put up and fed are behind the
 * Left figure, and the 30-day-rate method behind the Lasts header.
 */
export function FeedOnHandPanel({
  ranchId,
  ranchName,
  types,
  canEdit,
  rates,
  rateWindow,
  daysToTurnout,
}: {
  ranchId: string | null
  ranchName?: string
  types: { id: string; name: string; default_unit: string; default_lb_per_bale: number | null }[]
  canEdit: boolean
  /** Lb a day each feed has gone out at over the last 30 days of sheets. */
  rates: Map<string, number>
  rateWindow: { from: string | null; to: string | null }
  /** Days from today to turnout, when feeding; null outside the feeding period. */
  daysToTurnout: number | null
}) {
  const { data: onHand, isLoading } = useFeedOnHand(ranchId)
  const save = useSaveFeedInventory()
  // What was put up, bought and sold, entry by entry, under each feed's row —
  // so a mistyped count can be put right (Sam, 7 Oct 2026).
  const { data: entries } = useFeedInventory(ranchId)
  /** The feed whose put-up and fed totals are showing under its Left figure. */
  const [openFeed, setOpenFeed] = useState<string | null>(null)
  const updateEntry = useUpdateFeedInventory()
  const deleteEntry = useDeleteFeedInventory()
  const [editEntry, setEditEntry] = useState<FeedInventoryRow | null>(null)
  const { data: fields } = useFields()
  const { data: tests } = useFeedTests()
  const { data: baleDefaults } = useBaleWeightDefaults()
  // A link from a baling record names its entry (?lot=<id>): open its feed and mark it.
  const [params] = useSearchParams()
  const askedLot = params.get('lot')
  const [seenLot, setSeenLot] = useState<string | null>(null)
  const lotRow = askedLot ? (entries ?? []).find((e) => e.id === askedLot) : undefined
  if (lotRow && askedLot !== seenLot) {
    setSeenLot(askedLot)
    setOpenFeed(lotRow.feed_type_id)
  }
  useEffect(() => {
    if (!seenLot) return
    document.getElementById(`feed-entry-${seenLot}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [seenLot, openFeed])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    feed_type_id: '',
    kind: 'harvested' as FeedInventoryKind,
    quantity: '',
    unit: 'lb',
    lb_per_bale: '',
    moved_on: new Date().toISOString().slice(0, 10),
    note: '',
  })

  const rows = useMemo(() => (onHand ?? []).filter((f) => !f.is_bedding), [onHand])
  const bedding = useMemo(() => (onHand ?? []).filter((f) => f.is_bedding), [onHand])
  const nothingPutUp = rows.length > 0 && rows.every((f) => f.put_up_lb === 0)

  const chosen = types.find((t) => t.id === form.feed_type_id)

  const submit = () => {
    if (!ranchId || !form.feed_type_id || !form.quantity.trim()) return
    const magnitude = Math.abs(Number(form.quantity))
    if (!Number.isFinite(magnitude)) return
    save.mutate(
      {
        ranch_id: ranchId,
        feed_type_id: form.feed_type_id,
        kind: form.kind,
        // The sign follows the kind rather than being typed. Nobody should have
        // to remember to put a minus on a sale, and a missing one would add to
        // the pile instead of taking from it.
        quantity: signedQuantity(form.kind, Number(form.quantity)),
        unit: form.unit as 'lb' | 'big_square' | 'round',
        lb_per_bale:
          form.unit === 'lb' || !form.lb_per_bale.trim() ? null : Number(form.lb_per_bale),
        moved_on: form.moved_on,
        note: form.note.trim() || null,
      },
      {
        onSuccess: () => {
          setAdding(false)
          setForm((f) => ({ ...f, quantity: '', note: '' }))
        },
      },
    )
  }

  if (isLoading) return <p className="text-sm text-gray-400">Loading feed…</p>

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={cn('flex flex-wrap items-center justify-between gap-2', CARD_HEAD)}>
        <h3 className="flex items-center gap-1.5 font-medium">
          <Wheat className="h-4 w-4 text-brand-100" /> Feed left
          {ranchName && <span className="font-normal text-brand-100">· {ranchName}</span>}
        </h3>
        {canEdit && ranchId && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" /> Feed put up
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs text-gray-500">
              Feed
              <Select
                value={form.feed_type_id}
                ariaLabel="Feed"
                className="mt-1"
                onChange={(v) => {
                  const t = types.find((x) => x.id === v)
                  setForm((f) => ({
                    ...f,
                    feed_type_id: v,
                    unit: t?.default_unit ?? 'lb',
                    lb_per_bale: t?.default_lb_per_bale ? String(t.default_lb_per_bale) : '',
                  }))
                }}
                options={[
                  { value: '', label: 'Choose…' },
                  ...types.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </label>
            <label className="text-xs text-gray-500">
              What happened
              <Select
                value={form.kind}
                ariaLabel="What happened"
                className="mt-1"
                onChange={(v) => setForm((f) => ({ ...f, kind: v as FeedInventoryKind }))}
                options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            </label>
            <label className="text-xs text-gray-500">
              How much
              <input
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Counted in
              <Select
                value={form.unit}
                ariaLabel="Unit"
                className="mt-1"
                onChange={(v) => setForm((f) => ({ ...f, unit: v }))}
                options={[
                  { value: 'lb', label: 'Pounds' },
                  { value: 'round', label: 'Rounds' },
                  { value: 'big_square', label: 'Big squares' },
                ]}
              />
            </label>
            {form.unit !== 'lb' && (
              <label className="text-xs text-gray-500">
                lb per bale
                <input
                  inputMode="decimal"
                  value={form.lb_per_bale}
                  onChange={(e) => setForm((f) => ({ ...f, lb_per_bale: e.target.value }))}
                  placeholder={chosen?.default_lb_per_bale ? String(chosen.default_lb_per_bale) : '—'}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900"
                />
              </label>
            )}
            <label className="text-xs text-gray-500">
              When
              <DateField
                value={form.moved_on}
                onChange={(v) => setForm((f) => ({ ...f, moved_on: v }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
          </div>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Which field it came off, who it was bought from…"
            className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!form.feed_type_id || !form.quantity.trim() || save.isPending}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
            >
              Cancel
            </button>
            {save.isError && (
              <span className="text-xs text-red-600">{(save.error as Error).message}</span>
            )}
          </div>
        </div>
      )}

      {nothingPutUp && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Nothing is recorded as put up yet, so every remainder below is negative — it is showing
          what has been <em>fed</em>. Record what went into the pile and these become what is left.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-gray-400">
          No feed recorded for this ranch yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-3 py-1.5 font-medium">Feed</th>
              <th className="px-3 py-1.5 text-right font-medium" title="Put up, minus what the feed sheets say was fed.">
                Left (lb)
              </th>
              <th
                className="px-3 py-1.5 text-right font-medium"
                title={`At the rate this feed actually went out over the last 30 days of sheets${rateWindow.from ? ` (${rateWindow.from} to ${rateWindow.to})` : ''}. The Feed tab plans it against each group's need to turnout instead.`}
              >
                Lasts
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...rows, ...bedding].map((f) => {
              const short = f.remaining_lb < 0
              const natural = inNaturalUnits(f, f.remaining_lb)
              const rate = rates.get(f.feed_type_id) ?? 0
              const days = daysOfFeedLeft(f.remaining_lb, rate * 30, 30)
              const shortOfTurnout = days != null && daysToTurnout != null && days < daysToTurnout
              return (
                <Fragment key={f.feed_type_id}>
                <tr
                  onClick={rowClick(() => setOpenFeed((o) => (o === f.feed_type_id ? null : f.feed_type_id)))}
                  className={cn('cursor-pointer hover:bg-gray-50', f.is_bedding && 'text-gray-500')}
                >
                  <td className="px-3 py-1.5">
                    <ChevronRight className={cn('mr-1 inline h-3.5 w-3.5 text-gray-400 transition-transform', openFeed === f.feed_type_id && 'rotate-90')} />
                    {f.feed_name}
                    {f.is_bedding && (
                      <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] text-gray-500">
                        bedding
                      </span>
                    )}
                    {f.unweighed_lines > 0 && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-amber-700"
                        title={`${f.unweighed_lines} entries are in bales with no weight recorded, so they are not in these pounds`}
                      >
                        <TriangleAlert className="h-3 w-3" />
                        {f.unweighed_lines} unweighed
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right tabular-nums font-medium',
                      short ? 'text-amber-800' : 'text-gray-900',
                    )}
                    title={`Put up ${Math.round(f.put_up_lb).toLocaleString('en-CA')} lb − fed ${Math.round(f.fed_lb).toLocaleString('en-CA')} lb`}
                  >
                    {/* A tap, not only a hover: the tooltip does not exist on a tablet. */}
                    <button
                      type="button"
                      onClick={() => setOpenFeed((o) => (o === f.feed_type_id ? null : f.feed_type_id))}
                      className="tabular-nums underline decoration-dotted decoration-gray-300 underline-offset-2"
                      aria-expanded={openFeed === f.feed_type_id}
                    >
                      {Math.round(f.remaining_lb).toLocaleString('en-CA')}
                    </button>
                    {openFeed === f.feed_type_id && (
                      <span className="block text-[10px] font-normal text-gray-500">
                        put up {Math.round(f.put_up_lb).toLocaleString('en-CA')} · fed{' '}
                        {Math.round(f.fed_lb).toLocaleString('en-CA')}
                      </span>
                    )}
                    {natural && (
                      <span className="block text-[10px] font-normal text-gray-400">{natural}</span>
                    )}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', shortOfTurnout ? 'font-semibold text-red-700' : 'text-gray-600')}>
                    {days == null ? <span className="text-gray-300">—</span> : `${days} days`}
                    {shortOfTurnout && <span className="block text-[10px] font-normal">turnout is in {daysToTurnout}</span>}
                  </td>
                </tr>
                {openFeed === f.feed_type_id && (
                  <tr className="bg-gray-50">
                    <td colSpan={3} className="px-3 py-2">
                      <FeedEntries
                        rows={(entries ?? []).filter((e) => e.feed_type_id === f.feed_type_id && (!ranchId || e.ranch_id === ranchId))}
                        feed={types.find((t) => t.id === f.feed_type_id) ?? null}
                        baleDefaults={baleDefaults ?? []}
                        fieldName={(id) => fields?.find((x) => x.id === id)?.name ?? 'a field'}
                        testLabel={(id) => {
                          const t = tests?.find((x) => x.id === id)
                          return t ? `tested ${t.sampled_on}${t.lab ? `, ${t.lab}` : ''}` : null
                        }}
                        marked={seenLot}
                        canEdit={canEdit}
                        onEdit={setEditEntry}
                        onDelete={(id) => deleteEntry.mutate(id)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {deleteEntry.isError && <p className="px-3 py-1 text-xs text-red-600">{(deleteEntry.error as Error).message}</p>}
      {editEntry && editEntry.field_work_record_id && (
        <RecordEditModal
          title={`Edit ${types.find((t) => t.id === editEntry.feed_type_id)?.name ?? 'feed'} bales`}
          fields={baledFields(
            (tests ?? [])
              .filter((t) => t.feed_type_id === editEntry.feed_type_id)
              .map((t) => ({ value: t.id, label: `${t.sampled_on}${t.lab ? ` · ${t.lab}` : ''}` })),
          )}
          row={{ ...editEntry, lb_per_bale: editEntry.weight_basis === 'weighed' ? editEntry.lb_per_bale : null }}
          saving={updateEntry.isPending}
          error={updateEntry.error ? (updateEntry.error as Error).message : null}
          onClose={() => setEditEntry(null)}
          onDelete={() => deleteEntry.mutateAsync(editEntry.id)}
          deleteConfirm="Take these bales off the feed supply? The baling record stays on the field; it just stops adding them."
          onSave={(p) => {
            const lb = p.lb_per_bale as number | null
            return updateEntry.mutateAsync({
              id: editEntry.id,
              patch: {
                lb_per_bale: lb != null && lb > 0 ? lb : null,
                weight_basis: lb != null && lb > 0 ? 'weighed' : 'estimate',
                feed_test_id: (p.feed_test_id as string | null) || null,
                storage_place: (p.storage_place as string | null)?.trim() || null,
                note: p.note as string | null,
              },
            })
          }}
        >
          <p className="text-xs text-gray-500">
            The count, the feed and the bale size come from the baling record.{' '}
            {editEntry.field_id && (
              <Link to={`/fields/${editEntry.field_id}/work`} className="font-medium text-brand-700 hover:underline">
                Change them there
              </Link>
            )}
          </p>
        </RecordEditModal>
      )}
      {editEntry && !editEntry.field_work_record_id && (
        <RecordEditModal
          title={`Edit ${types.find((t) => t.id === editEntry.feed_type_id)?.name ?? 'feed'} entry`}
          fields={ENTRY_FIELDS}
          row={{ ...editEntry, quantity: KIND_SIGN[editEntry.kind] === 0 ? Number(editEntry.quantity) : Math.abs(Number(editEntry.quantity)) }}
          saving={updateEntry.isPending}
          error={updateEntry.error ? (updateEntry.error as Error).message : null}
          onClose={() => setEditEntry(null)}
          onDelete={() => deleteEntry.mutateAsync(editEntry.id)}
          deleteConfirm="Delete this entry? The feed left is worked out again without it."
          onSave={(p) => {
            const kind = p.kind as FeedInventoryKind
            const unit = (p.unit as 'lb' | 'round' | 'big_square' | null) ?? 'lb'
            return updateEntry.mutateAsync({
              id: editEntry.id,
              patch: {
                moved_on: p.moved_on as string,
                kind,
                quantity: signedQuantity(kind, Number(p.quantity ?? 0)),
                unit,
                lb_per_bale: unit === 'lb' ? null : (p.lb_per_bale as number | null),
                note: p.note as string | null,
              },
            })
          }}
        />
      )}
      <BaleWeights rows={baleDefaults ?? []} canEdit={canEdit} />
      <HelpNote
        className="border-t border-gray-100 px-3 py-2"
        summary={
          <>
            Will it last to turnout?{' '}
            <Link to="/feed?tab=plan" className="font-medium text-brand-700 hover:underline">
              See the Feed tab
            </Link>
          </>
        }
        title="How Left and Lasts are worked out"
      >
        <p>
          Everything in pounds, because a pile counted in rounds and fed out in pounds cannot be
          subtracted otherwise. &ldquo;Lasts&rdquo; uses the rate this feed actually went out at over
          the last 30 days of sheets{rateWindow.from ? ` (${rateWindow.from} to ${rateWindow.to})` : ''}. The Feed
          tab plans it against each group&apos;s need to turnout instead.
        </p>
      </HelpNote>
    </div>
  )
}

/**
 * The farm's usual weight of a round and a big square. A baled entry with no
 * weight of its own, of a size its feed has no bale weight for, is estimated
 * from these; blank leaves those bales unweighed.
 */
function BaleWeights({ rows, canEdit }: { rows: BaleWeightDefaultRow[]; canEdit: boolean }) {
  const save = useSaveBaleWeightDefault()
  if (!rows.length) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
      <span title="Used for baled bales until they are weighed, when the feed has no bale weight of its own for that size.">Bale weights for baling estimates:</span>
      {BALE_TYPES.map((b) => {
        const r = rows.find((x) => x.bale_type === b.value)
        return (
          <label key={b.value} className="inline-flex items-center gap-1">
            {b.label}
            <Num
              value={r?.lb_per_bale == null ? null : Number(r.lb_per_bale)}
              step="25"
              min={50}
              max={3000}
              suffix="lb"
              allowEmpty
              disabled={!canEdit || save.isPending}
              placeholder="—"
              onCommit={(v) => save.mutate({ bale_type: b.value, lb_per_bale: v })}
              className="w-20"
            />
          </label>
        )
      })}
      {save.isError && <span className="text-red-600">{(save.error as Error).message}</span>}
    </div>
  )
}

/** One feed's put-up, bought, sold and corrected entries, newest first. */
function FeedEntries({
  rows,
  feed,
  baleDefaults,
  fieldName,
  testLabel,
  marked,
  canEdit,
  onEdit,
  onDelete,
}: {
  rows: FeedInventoryRow[]
  feed: { default_unit: string; default_lb_per_bale: number | null } | null
  baleDefaults: BaleWeightDefaultRow[]
  fieldName: (id: string) => string
  testLabel: (id: string) => string | null
  /** An entry a link pointed at, shown marked. */
  marked: string | null
  canEdit: boolean
  onEdit: (row: FeedInventoryRow) => void
  onDelete: (id: string) => void
}) {
  if (!rows.length) return <p className="text-xs text-gray-400">Nothing recorded as put up, bought or sold for this feed — only what the feed sheets say was fed.</p>
  return (
    <ul className="divide-y divide-gray-200 text-xs">
      {rows.map((e) => {
        const baled = e.field_id != null && e.weight_basis != null
        const w = baled ? lotLbPerBale(e, feed, baleDefaults) : null
        const test = e.feed_test_id ? testLabel(e.feed_test_id) : null
        return (
          <li key={e.id} id={`feed-entry-${e.id}`} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-1', marked === e.id && 'rounded bg-amber-50 ring-1 ring-amber-200')}>
            <span className="w-20 tabular-nums text-gray-500">{e.moved_on}</span>
            <span className="w-28 text-gray-700">{KIND_LABEL[e.kind]}</span>
            <span className="tabular-nums font-medium text-gray-900">
              {Number(e.quantity).toLocaleString('en-CA')} {UNIT_WORD[e.unit] ?? e.unit}
              {!baled && e.unit !== 'lb' && e.lb_per_bale != null && <span className="font-normal text-gray-500"> at {Number(e.lb_per_bale).toLocaleString('en-CA')} lb</span>}
              {w && (
                <span className="font-normal text-gray-500">
                  {w.lb != null ? ` at ${isWeightEstimate(e) ? '~' : ''}${w.lb.toLocaleString('en-CA')} lb` : ''}
                  {w.lb == null ? <span className="text-amber-700"> · unweighed</span> : isWeightEstimate(e) ? ' (estimate)' : ''}
                </span>
              )}
            </span>
            {baled && (
              <span className="text-gray-500">
                <Link to={`/fields/${e.field_id}/work`} className="text-brand-700 hover:underline">
                  From baling on {fieldName(e.field_id!)}, {e.moved_on}
                </Link>
                {e.hay_cut ? ` · ${ordinal(e.hay_cut)} cut` : ''}
                {e.storage_place ? ` · ${e.storage_place}` : ''}
                {test ? ` · ${test}` : ''}
                {!e.field_work_record_id && ' · record deleted'}
              </span>
            )}
            {e.note && <span className="min-w-0 flex-1 truncate text-gray-500">{e.note}</span>}
            {canEdit && (
              <span className="ml-auto flex items-center gap-1">
                <EditButton onClick={() => onEdit(e)} />
                <DeleteButton
                  confirm={
                    e.field_work_record_id
                      ? `Take these ${Number(e.quantity).toLocaleString('en-CA')} bales off the feed supply? The baling record stays on the field; it just stops adding them.`
                      : `Delete this ${KIND_LABEL[e.kind].toLowerCase()} entry of ${e.moved_on}?`
                  }
                  onDelete={() => onDelete(e.id)}
                />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
