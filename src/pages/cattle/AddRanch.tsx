import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAddRanch } from '@/lib/ranches'

/**
 * Name (and optionally place) a new ranch.
 *
 * Latitude and longitude are optional because a ranch is usable without them —
 * they only feed the weather lookups, and can be filled in later. A blank or
 * unparseable box is stored as no value rather than blocking the add.
 */
export function AddRanchForm({ onDone }: { onDone?: () => void }) {
  const add = useAddRanch()
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const num = (s: string) => {
    const n = Number(s.trim())
    return s.trim() === '' || !Number.isFinite(n) ? null : n
  }
  const submit = () => {
    const n = name.trim()
    if (!n) return
    add.mutate(
      { name: n, latitude: num(lat), longitude: num(lon) },
      {
        onSuccess: () => {
          setName('')
          setLat('')
          setLon('')
          onDone?.()
        },
      },
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-2"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] font-medium text-gray-500">
          Ranch name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Home place"
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          Latitude (optional)
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            placeholder="49.7"
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          Longitude (optional)
          <input
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            inputMode="decimal"
            placeholder="-112.1"
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={!name.trim() || add.isPending}
        className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        {add.isPending ? 'Adding…' : 'Add'}
      </button>
      {add.error && <p className="text-xs text-red-700">{(add.error as Error).message}</p>}
    </form>
  )
}

/**
 * Shown in place of the whole Cattle section when the farm has no ranches.
 *
 * Every cattle tab is scoped by ranch, so without one the page used to sit on
 * "Loading ranches…" forever. Only managers can add one; anyone else is told
 * who can, rather than being shown a form the database would refuse.
 */
export function FirstRanchCard({ isManager }: { isManager: boolean }) {
  return (
    <div className="p-4 md:p-6">
      <div className="max-w-xl rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Add your first ranch</h2>
        {isManager ? (
          <AddRanchForm />
        ) : (
          <p className="text-sm text-gray-500">A manager needs to add a ranch first.</p>
        )}
      </div>
    </div>
  )
}

/** "Add ranch" in Cattle settings, for a farm's second (or later) ranch. */
export function AddRanchButton() {
  const [open, setOpen] = useState(false)
  return open ? (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">New ranch</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
      <AddRanchForm onDone={() => setOpen(false)} />
    </div>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
    >
      <Plus className="h-3.5 w-3.5" />
      Add ranch
    </button>
  )
}
