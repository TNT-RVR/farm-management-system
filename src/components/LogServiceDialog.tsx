import { useState } from 'react'
import { Camera, Check } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'

/**
 * Logging a service from the cab.
 *
 * The number that matters is the engine hours at the time, and the number in
 * the app is whatever Deere last reported — which for a machine without a
 * modem is nothing, and for one with is up to two hours old. A photo of the
 * hour meter is the truth, and reading it off the photo beats typing it from
 * memory in the shop a week later.
 *
 * The reading is put in the box, not saved: the eye that took the photo checks
 * it before Save.
 */
export function LogServiceDialog({
  planName,
  machineName,
  hoursNow,
  onClose,
  onSave,
  saving,
}: {
  planName: string
  machineName: string
  /** What the app believes the machine reads, as a starting point. */
  hoursNow: number | null
  onClose: () => void
  onSave: (v: { done_on: string; engine_hours: number | null; notes: string | null }) => void
  saving?: boolean
}) {
  const [doneOn, setDoneOn] = useState(new Date().toLocaleDateString('en-CA'))
  const [hours, setHours] = useState(hoursNow != null ? String(Math.round(hoursNow)) : '')
  const [notes, setNotes] = useState('')
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<string | null>(null)

  const readPhoto = async (file: File) => {
    setReading(true)
    setReadNote(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/read-meter', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'content-type': file.type || 'image/jpeg',
          'x-media-type': file.type || 'image/jpeg',
          'x-reading': 'engine hour meter',
        },
        body: file,
      })
      const body = (await res.json().catch(() => ({}))) as {
        value?: number | null
        confidence?: string
        note?: string
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? `Could not read the photo (${res.status})`)
      if (body.value == null) {
        setReadNote(body.note || 'Could not make out a number. Type it in.')
      } else {
        setHours(String(body.value))
        setReadNote(
          body.confidence === 'high'
            ? `Read ${body.value} off the photo — check it.`
            : `Read ${body.value} off the photo, but not confidently${body.note ? ` (${body.note})` : ''} — check it.`,
        )
      }
    } catch (e) {
      setReadNote((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  return (
    <Modal title={`${planName} — done`} onClose={onClose}>
      <p className="text-xs text-gray-500">{machineName}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-500">
          Done on
          <input
            type="date"
            value={doneOn}
            onChange={(e) => setDoneOn(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Engine hours
          <input
            type="number"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="off the meter"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      </div>
      {/* capture=environment opens the back camera straight away on a phone;
          on a desktop it is a file picker, which is fine. */}
      <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
        <Camera className="h-4 w-4 text-brand-700" />
        {reading ? 'Reading the meter…' : 'Photograph the hour meter and it fills the box'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={reading}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void readPhoto(f)
            e.target.value = ''
          }}
        />
      </label>
      {readNote && <p className="mt-1 text-xs text-amber-800">{readNote}</p>}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="What was done, parts used (optional)"
        className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            onSave({
              done_on: doneOn,
              engine_hours: hours.trim() === '' ? null : Number(hours),
              notes: notes.trim() || null,
            })
          }
          disabled={saving || !doneOn}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
