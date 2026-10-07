import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Mic, MicOff, Send, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { useEquipment } from '@/lib/equipment'
import { useFieldMutations, useFields, useUsers } from '@/lib/queries'
import { useTaskMutations } from '@/lib/tasks'
import { useHere } from '@/lib/useHere'
import { cn } from '@/lib/utils'

/**
 * Say it, see it, save it.
 *
 * Three things a phone can do in a cab that a keyboard cannot: listen, know
 * where it is, and be held in one hand. This is the first. Press the button,
 * say "get Kyle to change the drill's openers before Friday", and what comes
 * back is a task with Kyle on it, the drill on it, and Friday's date — shown
 * before it is saved, because the model sorting the words is right most of
 * the time and a task on the wrong person is worse than no task.
 *
 * The listening is the browser's own (Web Speech). Where a phone does not
 * have it, the words can be typed into the same box and everything after
 * that is the same.
 */
type Captured = {
  kind: 'task' | 'note'
  title: string
  detail: string
  field_id: string | null
  equipment_id: string | null
  assignee_ids: string[]
  due_on: string | null
  unsure: string[]
}

type Recognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

function makeRecognizer(): Recognizer | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'en-CA'
  r.continuous = true
  r.interimResults = true
  return r
}

export function VoiceCapture({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: users } = useUsers()
  const { data: equipment } = useEquipment()
  const here = useHere()
  const tasks = useTaskMutations()
  const fieldMut = useFieldMutations()

  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [got, setGot] = useState<Captured | null>(null)
  const [saved, setSaved] = useState(false)
  const rec = useRef<Recognizer | null>(null)
  // Whether this browser can listen at all, worked out once at mount.
  const [canListen] = useState(() => makeRecognizer() != null)

  useEffect(() => () => rec.current?.stop(), [])

  const start = () => {
    const r = makeRecognizer()
    if (!r) return
    let finalText = text ? text + ' ' : ''
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i]
        const t = chunk[0]?.transcript ?? ''
        if (chunk.isFinal) finalText += t + ' '
        else interim += t
      }
      setText((finalText + interim).trim())
    }
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'The microphone was refused.' : `Listening stopped: ${e.error}`)
      setListening(false)
    }
    r.onend = () => setListening(false)
    rec.current = r
    setError(null)
    r.start()
    setListening(true)
  }
  const stop = () => {
    rec.current?.stop()
    setListening(false)
  }

  const sortIt = async () => {
    stop()
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/voice-capture', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript: text,
          today: new Date().toLocaleDateString('en-CA'),
          fields: (fields ?? []).map((f) => ({ id: f.id, name: f.name })),
          users: (users ?? []).map((u) => ({ id: u.id, name: u.full_name ?? u.email ?? '' })),
          equipment: (equipment ?? []).map((e) => ({
            id: e.id,
            name: e.name || [e.make, e.model].filter(Boolean).join(' ') || 'machine',
          })),
          hereFieldId: here.fieldId,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as Partial<Captured> & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `Could not sort that out (${res.status})`)
      setGot(body as Captured)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!got) return
    setBusy(true)
    setError(null)
    try {
      if (got.kind === 'task') {
        await tasks.create.mutateAsync({
          title: got.title,
          description_md: got.detail || null,
          field_id: got.field_id,
          equipment_id: got.equipment_id,
          due_at: got.due_on ? new Date(`${got.due_on}T17:00:00`).toISOString() : null,
          crop_year: cropYear,
          source: 'voice',
          assignees: got.assignee_ids,
        })
      } else {
        // A note with no field to hang on becomes a task instead, so nothing
        // said is lost — it just needs a home picked.
        const field = fields?.find((f) => f.id === got.field_id)
        if (!field) {
          await tasks.create.mutateAsync({
            title: got.title,
            description_md: got.detail || null,
            crop_year: cropYear,
            source: 'voice',
          })
        } else {
          const stamp = new Date().toLocaleDateString('en-CA')
          const line = `**${stamp}** — ${got.title}${got.detail ? `. ${got.detail}` : ''}`
          await fieldMut.update.mutateAsync({
            id: field.id,
            patch: { notes_md: field.notes_md ? `${field.notes_md.trimEnd()}\n\n${line}` : line },
          })
        }
      }
      setSaved(true)
      onSaved?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const nameOf = (xs: { id: string; name?: string | null; full_name?: string | null }[] | undefined, id: string | null) =>
    id ? (xs?.find((x) => x.id === id) as { name?: string | null; full_name?: string | null } | undefined) : undefined
  const fieldName = nameOf(fields, got?.field_id ?? null)?.name
  const machineName = (() => {
    const e = equipment?.find((x) => x.id === got?.equipment_id)
    return e ? e.name || [e.make, e.model].filter(Boolean).join(' ') : null
  })()
  const people = (got?.assignee_ids ?? []).map((id) => users?.find((u) => u.id === id)?.full_name ?? '?')

  return (
    <div className="rounded-lg border border-brand-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Mic className="h-4 w-4 text-brand-700" /> Say it
        </h2>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {saved ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-green-800">
          <Check className="h-4 w-4" />
          {got?.kind === 'task' ? (
            <span>
              Task saved. <Link to="/tasks" className="underline">See it</Link>, or say another.
            </span>
          ) : (
            <span>
              Note saved on {fieldName}.{' '}
              {got?.field_id && (
                <Link to={`/fields/${got.field_id}/notes`} className="underline">
                  See it
                </Link>
              )}
            </span>
          )}
          <button
            onClick={() => {
              setSaved(false)
              setGot(null)
              setText('')
            }}
            className="ml-auto text-xs text-brand-700 hover:underline"
          >
            another
          </button>
        </div>
      ) : !got ? (
        <>
          <p className="mt-1 text-xs text-gray-500">
            A job for somebody, or something you noticed in a field.{' '}
            {here.fieldName && <>The phone thinks you are at <b>{here.fieldName}</b>.</>}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              canListen
                ? 'Press the microphone and talk, or type here.'
                : 'This browser cannot listen — type it here instead.'
            }
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex items-center gap-2">
            {canListen && (
              <button
                onClick={listening ? stop : start}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold',
                  listening ? 'bg-red-600 text-white' : 'bg-brand-700 text-white hover:bg-brand-800',
                )}
              >
                {listening ? (
                  <>
                    <MicOff className="h-4 w-4" /> Stop
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" /> Listen
                  </>
                )}
              </button>
            )}
            <button
              onClick={sortIt}
              disabled={busy || !text.trim()}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {busy ? 'Sorting it out…' : 'Sort it out'}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {got.kind === 'task' ? 'A task' : 'A field note'}
          </p>
          <p className="mt-0.5 font-semibold text-gray-900">{got.title}</p>
          {got.detail && <p className="mt-1 text-gray-700">{got.detail}</p>}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-gray-500">Field</dt>
            <dd>{fieldName ?? <span className="text-gray-400">—</span>}</dd>
            {got.kind === 'task' && (
              <>
                <dt className="text-gray-500">Machine</dt>
                <dd>{machineName ?? <span className="text-gray-400">—</span>}</dd>
                <dt className="text-gray-500">For</dt>
                <dd>{people.length ? people.join(', ') : <span className="text-gray-400">whoever picks it up</span>}</dd>
                <dt className="text-gray-500">By</dt>
                <dd>{got.due_on ?? <span className="text-gray-400">no date</span>}</dd>
              </>
            )}
          </dl>
          {got.unsure.length > 0 && (
            <ul className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {got.unsure.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setGot(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Change the words
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
