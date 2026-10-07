import { useState } from 'react'
import { AddButton, DeleteButton, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { Modal } from '@/components/Modal'
import { useAllRainGauges, useDeleteRainGauge, useDeleteRainReading, useSaveRainGauge, useUpdateRainReading } from '@/lib/irrigation'
import { keepOpenOnError } from '@/lib/record-actions'
import { conv, depthToMm, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'

const md = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

type Reading = { id: string; date: string; mm: number; note: string | null }

/**
 * A gauge's readings this season as a list, each one editable and deletable
 * (Sam, 7 Oct 2026; it was a line of text). Any active user may write
 * readings (rain_readings_write), so anyone can correct one.
 */
export function RainReadingsList({ readings, gaugeName, u }: { readings: Reading[]; gaugeName: string; u: UnitSystem }) {
  const update = useUpdateRainReading()
  const del = useDeleteRainReading()
  const [editing, setEditing] = useState<Reading | null>(null)
  const [all, setAll] = useState(false)
  const unit = conv.depthUnit(u)
  const dp = u === 'metric' ? 1 : 2
  const shown = all ? readings : readings.slice(0, 8)
  const fields: EditField[] = [
    { key: 'date', label: 'Date', kind: 'date', required: true },
    { key: 'amount', label: `Rain (${unit})`, kind: 'number', step: 'any', required: true },
    { key: 'note', label: 'Note', kind: 'textarea' },
  ]
  if (!readings.length) return <p className="text-gray-400">No readings on {gaugeName} this season.</p>
  return (
    <div>
      <table className="w-full max-w-md">
        <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="py-0.5 font-medium">Date</th>
            <th className="py-0.5 text-right font-medium">Rain ({unit})</th>
            <th className="py-0.5 pl-3 font-medium">Note</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {shown.map((r) => (
            <tr key={r.id}>
              <td className="py-0.5 text-gray-700">{md(r.date)}</td>
              <td className="py-0.5 text-right tabular-nums">{conv.depth(r.mm, u, dp)}</td>
              <td className="py-0.5 pl-3 text-gray-500">{r.note ?? ''}</td>
              <td className="py-0.5 pl-2">
                <span className="flex justify-end gap-1">
                  <EditButton
                    onClick={() => {
                      update.reset()
                      setEditing(r)
                    }}
                  />
                  <DeleteButton
                    disabled={del.isPending}
                    onDelete={() => del.mutate(r.id)}
                    confirm={`Delete the ${conv.depth(r.mm, u, dp)} ${unit} reading on ${gaugeName} for ${md(r.date)}? Fields on this gauge go back to radar for that day at the next Sync.`}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {readings.length > 8 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-[11px] text-brand-700 underline">
          {all ? 'show fewer' : `show all ${readings.length}`}
        </button>
      )}
      {del.isError && <p className="text-red-700">{(del.error as Error).message}</p>}
      {editing && (
        <RecordEditModal
          title={`Rain reading — ${gaugeName}`}
          fields={fields}
          row={{ date: editing.date, amount: conv.depth(editing.mm, u, dp), note: editing.note }}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            const amount = p.amount as number | null
            if (amount == null || amount < 0) return Promise.reject(new Error('Enter the rain.'))
            return update.mutateAsync({ id: editing.id, patch: { date: String(p.date), mm: Math.round(depthToMm(amount, u) * 10) / 10, note: (p.note as string | null) ?? null } })
          }}
          onDelete={() => keepOpenOnError(del.mutateAsync(editing.id))}
          deleteConfirm={`Delete this reading on ${gaugeName}?`}
          saving={update.isPending || del.isPending}
          // A second reading on the same day breaks unique (gauge_id, date).
          error={update.error ? (/duplicate|unique/i.test((update.error as Error).message) ? 'There is already a reading on that day for this gauge.' : (update.error as Error).message) : null}
        />
      )}
    </div>
  )
}

type Gauge = { id: string; name: string; active: boolean }

/**
 * The farm's rain gauges in one list: add, rename, retire and delete
 * (managers; rain_gauges is manager-write). Fields are put on a gauge from
 * each field's Rain card.
 */
export function RainGaugeManager({ onClose }: { onClose: () => void }) {
  const { data } = useAllRainGauges()
  const save = useSaveRainGauge()
  const del = useDeleteRainGauge()
  const [editing, setEditing] = useState<Gauge | 'new' | null>(null)
  const fieldsOn = (id: string) => (data?.fields ?? []).filter((f) => f.rain_gauge_id === id).map((f) => f.name)
  const fields: EditField[] = [
    { key: 'name', label: 'Name', kind: 'text', required: true },
    {
      key: 'active',
      label: 'In use',
      kind: 'select',
      hint: 'A retired gauge keeps its readings but is no longer offered for a field.',
      options: [
        { value: 'true', label: 'In use' },
        { value: 'false', label: 'Retired' },
      ],
    },
  ]
  const err = save.error ?? del.error
  return (
    <Modal title="Rain gauges" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="flex justify-end">
          <AddButton
            label="Add gauge"
            onClick={() => {
              save.reset()
              setEditing('new')
            }}
          />
        </div>
        {!data ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : !data.gauges.length ? (
          <p className="text-xs text-gray-500">No gauges yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {data.gauges.map((g) => {
              const on = fieldsOn(g.id)
              return (
                <li key={g.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2', !g.active && 'opacity-60')}>
                  <span className="font-medium text-gray-900">{g.name}</span>
                  {!g.active && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">retired</span>}
                  <span className="text-xs text-gray-500">{on.length ? on.join(', ') : 'no field on it'}</span>
                  <span className="ml-auto flex gap-1">
                    <EditButton
                      label="Rename"
                      onClick={() => {
                        save.reset()
                        setEditing(g)
                      }}
                    />
                    <DeleteButton
                      disabled={del.isPending}
                      onDelete={() => del.mutate(g.id)}
                      confirm={`Delete ${g.name} and every reading on it?${on.length ? ` ${on.join(', ')} will go back to radar rain.` : ''} To keep the readings, retire it instead.`}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {del.isError && <p className="text-xs text-red-700">{(del.error as Error).message}</p>}
      </div>
      {editing && (
        <RecordEditModal
          title={editing === 'new' ? 'Add rain gauge' : `Rain gauge — ${editing.name}`}
          fields={fields}
          row={editing === 'new' ? { active: 'true' } : { name: editing.name, active: String(editing.active) }}
          onClose={() => setEditing(null)}
          onSave={(p) =>
            save.mutateAsync({
              id: editing === 'new' ? undefined : editing.id,
              name: String(p.name ?? ''),
              active: p.active !== 'false',
            })
          }
          saving={save.isPending}
          error={err ? (err as Error).message : null}
        />
      )}
    </Modal>
  )
}
