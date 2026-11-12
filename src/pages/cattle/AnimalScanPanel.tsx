import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Radio, ScanLine } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { Fold } from '@/components/Fold'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import { useCattleMutations, type CattleRow } from '@/lib/cattle'
import { useRecentScans, useRecordScan } from '@/lib/cattle-animals'
import { PREGNANCY_STATUSES } from '@/lib/eshepherd-animals'

/**
 * Scan an animal in the yard, and write down what you find.
 *
 * Every handheld EID wand worth having — Gallagher, Tru-Test, Allflex — can
 * pair over Bluetooth as a keyboard and type the tag it reads, followed by
 * Enter. That is what this listens for, which means it works with a reader
 * Sam has not bought yet, on a phone or on the laptop in the yard, with no
 * driver, no pairing code in the app and no hardware decision made now.
 *
 * The box keeps itself focused while scanning is on, because a wand types
 * wherever the cursor happens to be. When a scan matches an animal it opens
 * right here with its weight, pregnancy and note ready to write — the whole
 * point being that you do not go looking for the animal, it comes to you.
 *
 * Every read is recorded, matched or not: an EID in the yard that the app has
 * never seen is worth knowing about, not worth dropping.
 */
export function AnimalScanPanel({ ranchId, isManager }: { ranchId: string; isManager: boolean }) {
  const [on, setOn] = useState(false)
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<CattleRow | null>(null)
  const [missed, setMissed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scan = useRecordScan()
  const { data: recent } = useRecentScans(10)
  const boxRef = useRef<HTMLInputElement>(null)

  // A wand types wherever the cursor is, so the box takes it back whenever
  // scanning is on and nothing else is being typed into.
  useEffect(() => {
    if (!on) return
    const keep = () => {
      const el = document.activeElement
      const typingElsewhere =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      if (!typingElsewhere) boxRef.current?.focus()
    }
    keep()
    const t = window.setInterval(keep, 1200)
    return () => window.clearInterval(t)
  }, [on])

  const submit = async (raw: string) => {
    const eid = raw.trim()
    if (!eid) return
    setTyped('')
    setError(null)
    setMissed(null)
    try {
      const hit = await scan.mutateAsync({ eid, ranchId: ranchId || null })
      if (hit) {
        setFound(hit as unknown as CattleRow)
      } else {
        setFound(null)
        setMissed(eid)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={cn('flex flex-wrap items-center justify-between gap-2', CARD_HEAD)}>
        <h2 className="font-medium">
          Scan an animal
          <InfoPopover title="Using a tag reader">
            <p>
              Pair the wand to this phone or laptop as a <strong>Bluetooth keyboard</strong> (every Gallagher, Tru-Test and
              Allflex handheld can do this — it is usually called HID or keyboard mode). Turn scanning on here, then read a
              tag: the reader types the number and the animal opens.
            </p>
            <p>No app on the reader, no cable, and it works the same on a phone in the yard as on the laptop.</p>
            <p>Typing a number in by hand does the same thing, for a tag that will not read.</p>
          </InfoPopover>
        </h2>
        <button
          onClick={() => {
            setOn((v) => !v)
            setTimeout(() => boxRef.current?.focus(), 0)
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold',
            on ? 'bg-white text-brand-800' : 'bg-white/15 text-white hover:bg-white/25',
          )}
        >
          <Radio className={cn('h-3.5 w-3.5', on && 'animate-pulse')} /> {on ? 'Scanning' : 'Start scanning'}
        </button>
      </div>

      <div className="px-3 py-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit(typed)
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <ScanLine className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={boxRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={on ? 'Read a tag, or type a number…' : 'Type an EID and press enter'}
            aria-label="Tag number"
            inputMode="numeric"
            autoComplete="off"
            className="min-w-0 flex-1 basis-48 rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm tabular-nums focus:border-brand-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={scan.isPending || !typed.trim()}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {scan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Look up'}
          </button>
        </form>

        {!on && (
          <HelpNote className="mt-1.5 text-xs" summary="A Bluetooth wand types the tag straight in." title="Using a tag reader">
            Pair the reader as a Bluetooth keyboard (HID mode), turn scanning on, and read a tag — the animal opens by itself.
            Any handheld that can type works; nothing has to be installed on it.
          </HelpNote>
        )}

        {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        {missed && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No animal here carries <span className="font-mono">{missed}</span>. The read was recorded anyway — it may be a tag
            that has not been uploaded from eShepherd yet.
          </p>
        )}
      </div>

      {found && <ScannedAnimal animal={found} isManager={isManager} onDone={() => setFound(null)} />}

      {(recent ?? []).length > 0 && (
        <Fold title={`Last ${(recent ?? []).length} reads`} storageKey="cattle-recent-scans" className="border-0 border-t border-gray-100">
          <ul className="space-y-0.5 px-3 py-2 text-xs text-gray-600">
            {(recent ?? []).map((s) => (
              <li key={s.id}>
                <span className="font-mono">{s.eid}</span> · {new Date(s.scanned_at).toLocaleString('en-CA')}
                {!s.cattle_id && ' · no animal matched'}
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </section>
  )
}

/**
 * The animal a scan pulled up, with the handful of things worth writing down
 * while it is standing in front of you.
 */
function ScannedAnimal({ animal, isManager, onDone }: { animal: CattleRow; isManager: boolean; onDone: () => void }) {
  const { update } = useCattleMutations()
  const r = animal as unknown as Record<string, unknown>
  const [weight, setWeight] = useState('')
  const [preg, setPreg] = useState('')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const facts = useMemo(
    () =>
      [
        ['Mob', r.mob as string],
        ['Class', r.stock_class as string],
        ['Breed', r.breed as string],
        ['Born', r.birth_date as string],
        ['Collar', r.neckband as string],
        ['Brand', r.brand as string],
        ['Last weight', r.weight_kg == null ? '' : `${r.weight_kg} kg${r.weighed_on ? ` on ${r.weighed_on}` : ''}`],
        ['Pregnancy', r.pregnancy_status as string],
      ].filter(([, v]) => v) as [string, string][],
    [r],
  )

  const save = async () => {
    setError(null)
    const patch: Record<string, unknown> = {}
    if (weight.trim()) {
      patch.weight_kg = Number(weight)
      patch.weighed_on = new Date().toISOString().slice(0, 10)
    }
    if (preg) patch.pregnancy_status = preg
    if (note.trim()) {
      const was = (r.notes_md as string | null)?.trim()
      const stamp = new Date().toISOString().slice(0, 10)
      patch.notes_md = `${was ? `${was}\n\n` : ''}${stamp}: ${note.trim()}`
    }
    if (!Object.keys(patch).length) return
    try {
      await update.mutateAsync({ id: animal.id, patch: patch as never })
      setSaved(true)
      setWeight('')
      setPreg('')
      setNote('')
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="border-t border-gray-100 bg-brand-50/40 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">
          {(r.vid as string) || (r.eid as string) || 'This animal'}
          {r.mob ? <span className="ml-2 text-sm font-normal text-gray-500">{r.mob as string}</span> : null}
        </h3>
        <button onClick={onDone} className="text-xs text-gray-500 hover:underline">
          Done
        </button>
      </div>
      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt className="text-gray-500">{k}</dt>
            <dd className="font-medium text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      {isManager && (
        <div className="mt-2.5 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">
            Weight (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="mt-0.5 block w-24 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
            />
          </label>
          <label className="text-xs text-gray-500">
            Pregnancy
            <select
              value={preg}
              onChange={(e) => setPreg(e.target.value)}
              className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">leave as it is</option>
              {PREGNANCY_STATUSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 basis-48 text-xs text-gray-500">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="what you saw"
              className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            onClick={() => void save()}
            disabled={update.isPending || (!weight.trim() && !preg && !note.trim())}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? 'Written down' : 'Write it down'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
