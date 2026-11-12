import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { useHerdCounts } from '@/lib/cattle'
import { useRanches } from '@/lib/ranches'
import { guessHerdClass, takeOff } from '@/lib/herd-take-off'

export type TakeOffItem = {
  head: number
  /** A sale's class, a manifest line's class or an animal's sex: what picks the head-count class. */
  hint: string | null
}

export type TakeOffRequest = {
  /** Either names the ranch; with neither, the dialog asks. */
  ranchId?: string | null
  ranchName?: string | null
  items: TakeOffItem[]
  /** What was just saved, for the dialog's one line: "this sale", "this manifest". */
  source: string
}

/**
 * One herd number that keeps itself right: after a sale, a manifest or an
 * animal's death is saved, offer to take the same head off the Herd tab's
 * count. Only offered — the count changes when the person taps "Take off".
 *
 *   const takeOff = useHerdTakeOff()
 *   …after saving: takeOff.offer({ ranchName, items: [{ head: 42, hint: 'steers' }], source: 'this sale' })
 *   …in the JSX: {takeOff.node}
 */
export function useHerdTakeOff() {
  const [req, setReq] = useState<TakeOffRequest | null>(null)
  const offer = useCallback((r: TakeOffRequest) => {
    const items = r.items.filter((i) => Number.isFinite(i.head) && i.head > 0)
    if (items.length) setReq({ ...r, items })
  }, [])
  const node = req ? <HerdTakeOffDialog request={req} onClose={() => setReq(null)} /> : null
  return { offer, node }
}

function HerdTakeOffDialog({ request, onClose }: { request: TakeOffRequest; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: ranches } = useRanches()
  const named =
    request.ranchId ??
    ranches?.find((r) => r.name.toLowerCase() === (request.ranchName ?? '').toLowerCase())?.id ??
    (ranches?.length === 1 ? ranches[0].id : null)
  const [pickedRanch, setPickedRanch] = useState<string | null>(null)
  const ranchId = pickedRanch ?? named ?? ''
  const { data: counts, isLoading } = useHerdCounts(ranchId || undefined)

  // What the person changed; everything else is the guess.
  const [classOf, setClassOf] = useState<Record<number, string>>({})
  const [headOf, setHeadOf] = useState<Record<number, string>>({})
  const [skip, setSkip] = useState<Record<number, boolean>>({})

  const rows = request.items.map((it, i) => {
    const guess = guessHerdClass(it.hint, counts ?? [])
    const classId = classOf[i] ?? guess?.id ?? ''
    const head = Number(headOf[i] ?? it.head)
    return { i, hint: it.hint, classId, head, on: !skip[i] }
  })
  const todo = rows.filter((r) => r.on && r.classId && Number.isFinite(r.head) && r.head > 0)

  const apply = useMutation({
    mutationFn: async () => {
      // Summed per class, then read fresh: another phone may have changed it since the page loaded.
      const byClass = new Map<string, number>()
      for (const r of todo) byClass.set(r.classId, (byClass.get(r.classId) ?? 0) + r.head)
      for (const [id, head] of byClass) {
        const { data, error } = await supabase.from('herd_counts').select('head_count').eq('id', id).single()
        if (error) throw error
        const { error: e } = await supabase
          .from('herd_counts')
          .update({ head_count: takeOff(data.head_count, head), updated_at: new Date().toISOString() })
          .eq('id', id)
        if (e) throw e
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['herd_counts'] })
      onClose()
    },
  })

  const className = (id: string) => counts?.find((c) => c.id === id)?.class_name ?? ''
  const only = rows.length === 1 ? rows[0] : null
  const title =
    only && only.classId ? `Take ${only.head.toLocaleString('en-CA')} off ${className(only.classId)}?` : 'Take these off the head count?'
  const classOptions = [{ value: '', label: 'Choose a group…' }, ...(counts ?? []).map((c) => ({ value: c.id, label: `${c.class_name} (${c.head_count.toLocaleString('en-CA')})` }))]

  return (
    <Modal title={title} onClose={onClose} layer="confirm">
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">Saved. Take the same head off the Herd tab&rsquo;s count, so the herd stays right?</p>

        {(ranches?.length ?? 0) > 1 && (
          <label className="block text-xs text-gray-500">
            Ranch
            <Select
              value={ranchId}
              ariaLabel="Ranch"
              size="sm"
              className="mt-0.5"
              onChange={(v) => {
                setPickedRanch(v)
                setClassOf({})
              }}
              options={[{ value: '', label: 'Choose…' }, ...(ranches ?? []).map((r) => ({ value: r.id, label: r.name }))]}
            />
          </label>
        )}

        {!ranchId ? null : isLoading ? (
          <p className="text-xs text-gray-400">Loading the head count…</p>
        ) : !counts?.length ? (
          <p className="text-xs text-gray-500">This ranch has no head count to take them off.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.i} className="flex flex-wrap items-end gap-2">
                {rows.length > 1 && (
                  <input
                    type="checkbox"
                    checked={r.on}
                    onChange={(e) => setSkip((s) => ({ ...s, [r.i]: !e.target.checked }))}
                    aria-label={`Take off ${r.hint ?? 'this line'}`}
                    className="mb-2"
                  />
                )}
                <label className="w-20 text-xs text-gray-500">
                  Head
                  <input
                    inputMode="numeric"
                    value={headOf[r.i] ?? String(request.items[r.i].head)}
                    onChange={(e) => setHeadOf((h) => ({ ...h, [r.i]: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
                  />
                </label>
                <label className="min-w-0 flex-1 text-xs text-gray-500">
                  {r.hint ? <span className="capitalize">{r.hint}</span> : 'Off'} — from
                  <Select
                    value={r.classId}
                    ariaLabel="Head-count group"
                    size="sm"
                    className="mt-0.5"
                    onChange={(v) => setClassOf((c) => ({ ...c, [r.i]: v }))}
                    options={classOptions}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}

        {apply.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(apply.error as Error).message}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Not now
          </button>
          <button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || todo.length === 0}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {apply.isPending ? 'Saving…' : 'Take off'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
