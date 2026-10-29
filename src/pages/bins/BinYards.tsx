import { useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Home, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/Modal'
import { useAddBinYard, useBinYards, useDeleteBinYard, useMoveBinYard, useSetHomeYard, useUpdateBinYard, type BinYard } from '@/lib/bin-yards'
import { cn } from '@/lib/utils'

/**
 * The farm's bin yards (Sam, 22 Oct 2026): add one, rename it, put the
 * list in order, show or hide it, delete an empty one. A hidden yard's bins
 * are left out of the totals, the estimator and the weigh-in.
 */
export function BinYardsCard({ binsIn }: { binsIn: (yard: string) => number }) {
  const { data: yards } = useBinYards()
  const add = useAddBinYard()
  const update = useUpdateBinYard()
  const move = useMoveBinYard()
  const del = useDeleteBinYard()
  const setHome = useSetHomeYard()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<BinYard | null>(null)
  const list = yards ?? []
  const error = [add, update, move, setHome].map((m) => (m.error as Error | null)?.message).find(Boolean)

  return (
    <div className="border-b border-gray-100 p-3 text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Bin yards</p>
      <ul className="space-y-1">
        {list.map((y, i) => {
          const n = binsIn(y.name)
          return (
            <li key={y.id} className={cn('flex flex-wrap items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5', !y.shown && 'bg-gray-50')}>
              {renaming?.id === y.id ? (
                <form
                  className="flex flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (renaming.name.trim()) update.mutate({ id: y.id, name: renaming.name }, { onSuccess: () => setRenaming(null) })
                  }}
                >
                  <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: y.id, name: e.target.value })} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
                  <button type="submit" className="rounded bg-brand-700 px-2 py-1 text-xs font-semibold text-white">
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="px-1 text-xs text-gray-500 underline">
                    Cancel
                  </button>
                </form>
              ) : (
                <button type="button" onClick={() => setRenaming({ id: y.id, name: y.name })} title="Rename" className={cn('min-w-0 flex-1 basis-40 text-left font-medium', y.shown ? 'text-gray-900' : 'text-gray-500')}>
                  {y.name}
                  <span className="ml-1.5 text-xs font-normal text-gray-500">
                    {n} bin{n === 1 ? '' : 's'}
                    {!y.shown && ' · hidden'}
                  </span>
                </button>
              )}
              {/* Distances to the fields are measured from the home yard's bins. */}
              <button
                type="button"
                disabled={y.home || setHome.isPending}
                onClick={() => setHome.mutate(y.id)}
                title={y.home ? 'Distances to the fields are measured from here' : 'Measure distances to the fields from this yard'}
                className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-xs', y.home ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-500 hover:bg-gray-50')}
              >
                <Home className="h-3.5 w-3.5" /> {y.home ? 'Home' : 'Make home'}
              </button>
              <button
                type="button"
                onClick={() => update.mutate({ id: y.id, shown: !y.shown })}
                className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-xs', y.shown ? 'border-brand-300 text-brand-800' : 'border-gray-300 text-gray-500')}
                aria-label={y.shown ? `Hide ${y.name}` : `Show ${y.name}`}
              >
                {y.shown ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {y.shown ? 'Shown' : 'Hidden'}
              </button>
              <button type="button" disabled={i === 0 || move.isPending} onClick={() => move.mutate({ a: y, b: list[i - 1] })} aria-label={`Move ${y.name} up`} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" disabled={i === list.length - 1 || move.isPending} onClick={() => move.mutate({ a: y, b: list[i + 1] })} aria-label={`Move ${y.name} down`} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={n > 0}
                title={n > 0 ? 'Move its bins to another yard first' : 'Delete'}
                onClick={() => setDeleting(y)}
                aria-label={`Delete ${y.name}`}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          )
        })}
      </ul>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) add.mutate(name, { onSuccess: () => setName('') })
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New yard name" className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
        <button type="submit" disabled={!name.trim() || add.isPending} className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Add yard
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="The yard comes off the list. It has no bins in it."
          busy={del.isPending}
          error={del.error ? (del.error as Error).message : null}
          onClose={() => setDeleting(null)}
          onConfirm={() => del.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        />
      )}
    </div>
  )
}
