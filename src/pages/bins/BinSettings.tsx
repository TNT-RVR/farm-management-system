import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useBinMutations, useBins } from '@/lib/bins'
import { hiddenYardNames, inHiddenYard, useBinYards } from '@/lib/bin-yards'
import { BinYardsCard } from './BinYards'
import { CropBinRules } from './CropBinRules'

/**
 * Bin settings (Sam, 22 Oct 2026), from the ⚙ beside the calculator on
 * Harvest: how many bins are in use and what they hold, and the farm's bin
 * yards. Hidden yards' bins are not counted, as on the Bins page.
 */
export function BinSettingsDialog({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: bins } = useBins()
  const { data: yards } = useBinYards()
  const hidden = hiddenYardNames(yards)
  const inUse = (bins ?? []).filter((b) => b.active && !inHiddenYard(b, hidden))
  const capacity = inUse.reduce((s, b) => s + (Number(b.capacity_bu) || 0), 0)
  const stat = 'rounded-lg border border-gray-200 bg-white p-3'
  return (
    <Modal title="Bin settings" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className={stat}>
            <p className="text-xs text-gray-500">Active bins</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{inUse.length}</p>
          </div>
          <div className={stat}>
            <p className="text-xs text-gray-500">Total capacity</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{Math.round(capacity).toLocaleString('en-CA')} bu</p>
          </div>
        </div>
        {hidden.size > 0 && <p className="text-xs text-gray-500">Not counting the bins in hidden yards ({[...hidden].join(', ')}).</p>}
        {/* Which crops need a bin, how they are kept apart and how much of each
            to store — the three settings that used to sit as columns in the
            middle of the estimator (Sam, 27 Oct 2026). */}
        <CropBinRules />
        {isManager ? (
          <>
            <AddBinCard yards={(yards ?? []).map((y) => ({ name: y.name, shown: y.shown }))} />
            <div className="rounded-lg border border-gray-200 bg-white">
              <BinYardsCard binsIn={(y) => (bins ?? []).filter((b) => b.site === y).length} />
            </div>
          </>
        ) : (
          <ul className="space-y-1 rounded-lg border border-gray-200 bg-white p-3">
            {(yards ?? []).map((y) => (
              <li key={y.id} className="flex justify-between text-gray-700">
                <span>{y.name}</span>
                <span className="text-xs text-gray-500">{y.shown ? 'shown' : 'hidden'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** Add a bin (Sam, 23 Oct 2026: here rather than over the bin list). */
function AddBinCard({ yards }: { yards: { name: string; shown: boolean }[] }) {
  const { create } = useBinMutations()
  const [bin, setBin] = useState({ name: '', capacity: '', site: '' })
  const box = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!bin.name.trim()) return
        create.mutate(
          { name: bin.name.trim(), capacity_bu: Number(bin.capacity || 0), site: bin.site || null },
          { onSuccess: () => setBin({ name: '', capacity: '', site: '' }) },
        )
      }}
      className="space-y-2 rounded-lg border border-gray-200 bg-white p-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Add a bin</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_8rem_10rem_auto]">
        <input placeholder="Bin name" value={bin.name} onChange={(e) => setBin((b) => ({ ...b, name: e.target.value }))} className={`col-span-2 sm:col-span-1 ${box}`} />
        <input type="number" inputMode="decimal" placeholder="Capacity (bu)" value={bin.capacity} onChange={(e) => setBin((b) => ({ ...b, capacity: e.target.value }))} className={box} />
        <Select
          value={bin.site}
          ariaLabel="Yard"
          size="sm"
          onChange={(v) => setBin((b) => ({ ...b, site: v }))}
          options={[{ value: '', label: 'No yard' }, ...yards.map((y) => ({ value: y.name, label: y.shown ? y.name : `${y.name} (hidden)` }))]}
        />
        <button type="submit" disabled={!bin.name.trim() || create.isPending} className="col-span-2 flex items-center justify-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 sm:col-span-1">
          <Plus className="h-4 w-4" /> Add bin
        </button>
      </div>
      {create.error && <p className="text-xs text-red-700">{/duplicate|unique/i.test((create.error as Error).message) ? 'Another bin already has that name.' : (create.error as Error).message}</p>}
    </form>
  )
}
