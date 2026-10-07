import { useState, type MouseEvent, type ReactNode } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { ConfirmDialog } from '@/components/Modal'
import { cn } from '@/lib/utils'

/**
 * The shared pieces for "click a row to see it, and add, edit or delete it"
 * (Sam, 7 Oct 2026: "anywhere there is a row of information allow the user
 * to click on that row and expand to a detailed view … make sure there is
 * editing, deleting or adding"). Started as the pump/pivot editor on
 * Irrigation → Pivots & pumps; use these rather than writing another.
 *
 *   RecordEditModal  a form from a list of fields; Save, Cancel, and Delete
 *                    (confirmed) when onDelete is given. Add uses it too:
 *                    pass an empty row. A save or delete that fails (its
 *                    promise rejects) keeps the form open with the reason.
 *   DetailList       the record's fields as label / value lines, for the
 *                    detail view a row opens to.
 *   AddButton, EditButton, DeleteButton
 *   rowClick         a row's onClick that ignores clicks on its own buttons,
 *                    links, inputs and selects.
 */

export type EditField = {
  key: string
  label: string
  /**
   * bool: a yes / no / not known dropdown, saved as true / false / null.
   * textarea: a long note across the whole form.
   */
  kind: 'text' | 'number' | 'select' | 'bool' | 'textarea' | 'date'
  step?: string
  /** display = stored × scale (e.g. an efficiency kept as 0.85, shown as 85). */
  scale?: number
  int?: boolean
  options?: { value: string; label: string }[]
  /** Shown when the label is hovered. */
  hint?: string
  /** Save refuses while this is empty. */
  required?: boolean
  placeholder?: string
}

/** A form for one record, driven by its fields. */
export function RecordEditModal({
  title,
  fields,
  row,
  onClose,
  onSave,
  onDelete,
  deleteConfirm = 'Delete this record? This cannot be undone from here.',
  saving = false,
  error,
  children,
}: {
  title: string
  fields: EditField[]
  row: Record<string, unknown>
  onClose: () => void
  /** The changed values, typed: numbers as numbers, blanks as null. Close is left to the caller when it returns a promise. */
  onSave: (patch: Record<string, unknown>) => void | Promise<unknown>
  onDelete?: () => void | Promise<unknown>
  deleteConfirm?: string
  saving?: boolean
  error?: string | null
  /** Anything else the form needs, under the fields. */
  children?: ReactNode
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const f of fields) {
      const raw = row[f.key]
      // A scaled number (litres shown as gallons) is rounded for the box, not left at 26.417205235…
      m[f.key] = raw == null ? '' : f.scale ? String(Number((Number(raw) * f.scale).toFixed(4))) : String(raw)
    }
    return m
  })
  const missing = fields.filter((f) => f.required && !vals[f.key]?.trim()).map((f) => f.label)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

  /** Run a save or delete; close when it worked, keep the form and say why when it did not. */
  const attempt = async (run: () => void | Promise<unknown>) => {
    setFailed(null)
    setWorking(true)
    try {
      const r = run()
      if (r && typeof (r as Promise<unknown>).then === 'function') await r
      onClose()
    } catch (e) {
      setFailed(reason(e))
    } finally {
      setWorking(false)
    }
  }

  const save = async () => {
    const patch: Record<string, unknown> = {}
    for (const f of fields) {
      const s = vals[f.key]
      if (f.kind === 'number') {
        let v: number | null = s.trim() === '' ? null : Number(s)
        if (v != null && !Number.isFinite(v)) v = null
        if (v != null && f.scale) v = v / f.scale
        if (v != null && f.int) v = Math.round(v)
        patch[f.key] = v
      } else if (f.kind === 'bool') {
        patch[f.key] = s === '' ? null : s === 'true'
      } else {
        patch[f.key] = s.trim() === '' ? null : s
      }
    }
    await attempt(() => onSave(patch))
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {fields.map((f) => (
            <label key={f.key} className={cn('block text-sm', f.kind === 'textarea' && 'col-span-2')}>
              <span className="mb-0.5 block text-xs text-gray-500" title={f.hint}>
                {f.label}
                {f.required && <span className="text-red-600"> *</span>}
              </span>
              {f.kind === 'select' || f.kind === 'bool' ? (
                <Select
                  value={vals[f.key]}
                  size="sm"
                  ariaLabel={f.label}
                  className="w-full"
                  onChange={(v) => setVals((m) => ({ ...m, [f.key]: v }))}
                  options={
                    f.kind === 'bool'
                      ? [
                          { value: '', label: '— not known —' },
                          { value: 'true', label: 'Yes' },
                          { value: 'false', label: 'No' },
                        ]
                      : (f.options ?? [])
                  }
                />
              ) : f.kind === 'textarea' ? (
                <textarea
                  rows={3}
                  value={vals[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setVals((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              ) : (
                <input
                  type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                  step={f.step ?? (f.kind === 'number' ? 'any' : undefined)}
                  value={vals[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setVals((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              )}
            </label>
          ))}
        </div>
        {children}
        {(error || failed) && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error ?? failed}</p>}
        <div className="mt-5 flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              disabled={saving || working}
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {missing.length > 0 && <span className="text-[11px] text-gray-400">Needs {missing.join(', ')}</span>}
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || working || missing.length > 0}
              onClick={() => void save()}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {saving || working ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      {confirming && onDelete && (
        <ConfirmDialog
          title={`Delete — ${title}`}
          message={deleteConfirm}
          busy={working}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void attempt(onDelete)
          }}
        />
      )}
    </div>
  )
}

/** A record's fields as label / value lines; empty values are left out. */
export function DetailList({ rows, className }: { rows: [string, ReactNode][]; className?: string }) {
  const shown = rows.filter(([, v]) => v != null && v !== '' && v !== false)
  if (!shown.length) return <p className={cn('text-xs text-gray-400', className)}>Nothing else recorded.</p>
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm', className)}>
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-gray-500">{k}</dt>
          <dd className="min-w-0 whitespace-pre-line break-words text-gray-900">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

export function EditButton({ onClick, label = 'Edit' }: { onClick: (e: MouseEvent) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
    >
      <Pencil className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

/** Delete with the app's confirm dialog, for a row or a detail view. */
export function DeleteButton({ onDelete, confirm = 'Delete this record?', label = 'Delete', disabled }: { onDelete: () => void; confirm?: string; label?: string; disabled?: boolean }) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setAsking(true)
        }}
        className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" /> {label}
      </button>
      {asking && (
        <ConfirmDialog
          title={label}
          message={confirm}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            onDelete()
          }}
        />
      )}
    </>
  )
}

/** A row's onClick that leaves the row's own controls alone. */
export function rowClick(open: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"], [role="combobox"], [role="checkbox"], [role="option"], [role="listbox"], [role="dialog"]')) return
    open()
  }
}
