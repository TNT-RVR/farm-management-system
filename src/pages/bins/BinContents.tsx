import { binCropOptions } from '@/lib/bin-contents'
import { useState } from 'react'
import { Archive, Check, Plus, X } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import {
  contentLabel,
  isCarryOver,
  useDeleteBinContent,
  useEmptyBin,
  useSaveBinContent,
  type BinContent,
} from '@/lib/bin-contents'
import type { BinRow } from '@/lib/bins'
import type { CropRow } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'

/**
 * What is in the bins, and which of it is left over from a previous year.
 *
 * The case this exists for: #2 still has durum in it from last season. Until
 * somebody writes that down, the estimator counts #2 as empty and available,
 * and the storage plan is wrong by a bin in the direction that does not look
 * like a problem.
 *
 * Carry-over is not a tick somebody sets — a row records the season its grain
 * was GROWN in, and anything older than the year being planned is carry-over by
 * arithmetic. Nothing to clear each spring, nothing to forget.
 */
export function BinContentsPanel({
  bins,
  crops,
  contents,
  cropYear,
  canEdit,
}: {
  bins: BinRow[]
  crops: CropRow[]
  contents: BinContent[]
  cropYear: number
  canEdit: boolean
}) {
  const save = useSaveBinContent()
  const empty = useEmptyBin()
  const remove = useDeleteBinContent()
  const [adding, setAdding] = useState(false)
  // A row opened to correct it (Sam, 7 Oct 2026).
  const [editing, setEditing] = useState<BinContent | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState<string | null>(null)
  const [form, setForm] = useState({
    bin_id: '',
    crop_id: '',
    crop_year: String(cropYear - 1),
    bushels: '',
    note: '',
    filled_on: '',
  })

  const occupied = new Set(contents.map((c) => c.bin_id))
  const free = bins.filter((b) => b.active && !occupied.has(b.id))
  const carry = contents.filter((c) => isCarryOver(c, cropYear))

  const submit = () => {
    if (!form.bin_id) return
    save.mutate(
      {
        bin_id: form.bin_id,
        crop_id: form.crop_id || null,
        variety: null,
        crop_year: Number(form.crop_year),
        bushels: form.bushels ? Number(form.bushels) : null,
        note: form.note.trim() || null,
        filled_on: form.filled_on || null,
      },
      {
        onSuccess: () => {
          setAdding(false)
          setForm((f) => ({ ...f, bin_id: '', crop_id: '', bushels: '', note: '', filled_on: '' }))
        },
      },
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Archive className="h-4 w-4 text-gray-400" /> What is in the bins
          {carry.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
              {carry.length} carried over · not counted as {cropYear} storage
            </span>
          )}
        </h2>
        {canEdit && !adding && (
          <button
            onClick={() => setAdding(true)}
            disabled={free.length === 0}
            title={free.length === 0 ? 'Every bin already has something recorded in it' : undefined}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Record contents
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <label className="text-xs text-gray-500">
              Bin
              <Select
                value={form.bin_id}
                ariaLabel="Bin"
                className="mt-1"
                onChange={(v) => setForm((f) => ({ ...f, bin_id: v }))}
                options={[
                  { value: '', label: 'Choose…' },
                  ...free.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            </label>
            <label className="text-xs text-gray-500">
              Crop
              <Select
                value={form.crop_id}
                ariaLabel="Crop in the bin"
                className="mt-1"
                onChange={(v) => setForm((f) => ({ ...f, crop_id: v }))}
                options={[
                  { value: '', label: 'Not recorded' },
                  ...binCropOptions(crops),
                ]}
              />
            </label>
            {/* The year it was GROWN, not the year it went in the bin. It is
                what makes this carry-over rather than this season's crop, so
                the field says so rather than assuming. */}
            <label className="text-xs text-gray-500">
              Grown in
              <input
                inputMode="numeric"
                value={form.crop_year}
                onChange={(e) => setForm((f) => ({ ...f, crop_year: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Bushels (rough)
              <input
                inputMode="decimal"
                value={form.bushels}
                onChange={(e) => setForm((f) => ({ ...f, bushels: e.target.value }))}
                placeholder="—"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Filled
              <DateField
                value={form.filled_on}
                onChange={(v) => setForm((f) => ({ ...f, filled_on: v }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
          </div>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Anything worth knowing — contracted, needs moving, tough…"
            className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!form.bin_id || save.isPending}
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

      {contents.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-gray-400">
          Nothing recorded. Every bin is treated as empty and available.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {contents.map((c) => {
            const old = isCarryOver(c, cropYear)
            return (
              <li
                key={c.id}
                onClick={canEdit ? rowClick(() => setEditing(c)) : undefined}
                title={canEdit ? 'Open to correct it' : undefined}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm',
                  old && 'bg-amber-50/60',
                  canEdit && 'cursor-pointer hover:bg-gray-50',
                )}
              >
                <span className="font-medium text-gray-900">{c.bin_name}</span>
                <span className="text-gray-700">{contentLabel(c)}</span>
                {old && (
                  <span
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
                    title={`Grown in ${c.crop_year}, still in the bin for ${cropYear}`}
                  >
                    carry-over
                  </span>
                )}
                {c.variety && <span className="text-xs text-gray-500">{c.variety}</span>}
                {c.filled_on && <span className="text-xs text-gray-400">filled {c.filled_on}</span>}
                {c.note && <span className="text-xs text-gray-500">{c.note}</span>}
                {canEdit &&
                  (confirmEmpty === c.id ? (
                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={() => empty.mutate({ id: c.id })}
                        disabled={empty.isPending}
                        className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" /> It is empty
                      </button>
                      <button
                        onClick={() => setConfirmEmpty(null)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100"
                        aria-label="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmEmpty(c.id)}
                      className="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Mark emptied
                    </button>
                  ))}
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <RecordEditModal
          title={`What is in ${editing.bin_name}`}
          fields={CONTENT_FIELDS(crops)}
          row={editing}
          saving={save.isPending || remove.isPending}
          error={editError}
          onClose={() => {
            setEditing(null)
            setEditError(null)
          }}
          onSave={async (p) => {
            setEditError(null)
            const year = Number(p.crop_year)
            if (!Number.isInteger(year) || year < 1990 || year > cropYear + 1) {
              setEditError('Grown in needs a year, like 2025.')
              throw new Error('bad year')
            }
            try {
              await save.mutateAsync({
                id: editing.id,
                bin_id: editing.bin_id,
                crop_id: (p.crop_id as string | null) ?? null,
                variety: (p.variety as string | null) ?? null,
                crop_year: year,
                bushels: (p.bushels as number | null) ?? null,
                note: (p.note as string | null) ?? null,
                filled_on: (p.filled_on as string | null) ?? null,
              })
            } catch (e) {
              setEditError((e as Error).message)
              throw e
            }
          }}
          deleteConfirm={`Delete this record of ${editing.bin_name}? Use "Mark emptied" instead when the bin was emptied — that keeps it as history.`}
          onDelete={async () => {
            try {
              await remove.mutateAsync(editing.id)
            } catch (e) {
              setEditError((e as Error).message)
              throw e
            }
          }}
        />
      )}
    </div>
  )
}

/** The fields of a contents record, for the editor. */
const CONTENT_FIELDS = (crops: CropRow[]): EditField[] => [
  { key: 'crop_id', label: 'Crop', kind: 'select', options: [{ value: '', label: 'Not recorded' }, ...binCropOptions(crops)] },
  { key: 'variety', label: 'Variety', kind: 'text' },
  { key: 'crop_year', label: 'Grown in', kind: 'number', int: true, required: true, hint: 'The year it was grown; before this season it counts as carry-over.' },
  { key: 'bushels', label: 'Bushels (rough)', kind: 'number' },
  { key: 'filled_on', label: 'Filled', kind: 'date' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]

/**
 * The same record, opened from the bin's own row.
 *
 * "Record contents" at the top of a panel nobody scrolls to is how last
 * year's durum in #2 went unrecorded for a season. From the row, the bin is
 * already chosen and the year defaults to last year's crop.
 */
export function RecordContentsDialog({
  bin,
  crops,
  cropYear,
  onClose,
}: {
  bin: BinRow
  crops: CropRow[]
  cropYear: number
  onClose: () => void
}) {
  const save = useSaveBinContent()
  const [form, setForm] = useState({
    crop_id: '',
    variety: '',
    crop_year: String(cropYear - 1),
    bushels: '',
    note: '',
    filled_on: '',
  })
  return (
    <Modal title={`What is in ${bin.name}?`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs text-gray-500">
          Crop
          <Select
            value={form.crop_id}
            ariaLabel="Crop in the bin"
            className="mt-1"
            onChange={(v) => setForm((f) => ({ ...f, crop_id: v }))}
            options={[
              { value: '', label: 'Not recorded' },
              ...binCropOptions(crops),
            ]}
          />
        </label>
        <label className="text-xs text-gray-500">
          Variety (optional)
          <input
            value={form.variety}
            onChange={(e) => setForm((f) => ({ ...f, variety: e.target.value }))}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Grown in
          <input
            inputMode="numeric"
            value={form.crop_year}
            onChange={(e) => setForm((f) => ({ ...f, crop_year: e.target.value }))}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Bushels (rough)
          <input
            inputMode="decimal"
            value={form.bushels}
            onChange={(e) => setForm((f) => ({ ...f, bushels: e.target.value }))}
            placeholder="—"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Filled
          <DateField
            value={form.filled_on}
            onChange={(v) => setForm((f) => ({ ...f, filled_on: v }))}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
      </div>
      <input
        value={form.note}
        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        placeholder="Anything worth knowing — contracted, needs moving, tough…"
        className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
      />
      <p className="mt-2 text-[11px] text-gray-500">
        Grown in {form.crop_year || '…'}: anything before {cropYear} shows as carry-over, and the
        estimator stops counting this bin as empty.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() =>
            save.mutate(
              {
                bin_id: bin.id,
                crop_id: form.crop_id || null,
                variety: form.variety.trim() || null,
                crop_year: Number(form.crop_year),
                bushels: form.bushels ? Number(form.bushels) : null,
                note: form.note.trim() || null,
                filled_on: form.filled_on || null,
              },
              { onSuccess: onClose },
            )
          }
          disabled={save.isPending || !/^\d{4}$/.test(form.crop_year)}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700">
          Cancel
        </button>
        {save.isError && <span className="text-xs text-red-600">{(save.error as Error).message}</span>}
      </div>
    </Modal>
  )
}
