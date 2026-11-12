import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flower2, Trash2 } from 'lucide-react'
import { Card } from '@/components/Card'
import { InfoPopover } from '@/components/InfoPopover'
import { bloomChip } from '@/lib/canola-bloom'
import {
  useAddBloomScouting,
  useBloomPictures,
  useBloomScouting,
  useBloomSettings,
  useCanolaBloom,
  useDeleteBloomScouting,
} from '@/lib/canola-bloom-data'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const day = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const share = (v: number | string | null) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)

const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900'

/**
 * A canola field's flowering, as the satellite saw it: the stage it is at and
 * how sure the call is, the summer's pictures with the yellow painted gold so
 * anyone can see for themselves, and an "I saw it" box for what a person saw
 * in the field — the ground truth the settings are tuned against.
 */
export function CanolaBloomCard({ fieldId, cropYear }: { fieldId: string; cropYear: number }) {
  const { data: bloom } = useCanolaBloom(fieldId, cropYear)
  const { data: set } = useBloomSettings()
  const { data: pictures = [], isLoading } = useBloomPictures(fieldId, cropYear, !!bloom)
  const [picked, setPicked] = useState<string | null>(null)
  const [showFlowers, setShowFlowers] = useState(true)

  if (!bloom) return null
  // Until a day is picked, the day flowering peaked, else the newest look.
  const shown =
    pictures.find((p) => p.sensedOn === picked) ??
    pictures.find((p) => p.sensedOn === bloom.peak_on) ??
    pictures[pictures.length - 1] ??
    null
  const chip = bloomChip(bloom)
  const startPct = Math.round((set?.startFraction ?? 0.1) * 100)

  return (
    <Card
      title={`Canola flowering ${cropYear}`}
      icon={Flower2}
      className="mt-3"
      right={<span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', chip.style)}>{chip.label}</span>}
    >
      <div className="p-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            {/* Once flowering is over, late-August yellow is ripening pods, not flowers. */}
            <dt className="text-xs text-gray-500">{bloom.status === 'over' ? 'Last look' : 'Yellow now'}</dt>
            <dd className="font-medium">
              {share(bloom.yellow_now)} <span className="text-xs text-gray-500">{day(bloom.last_clear_on)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">{bloom.started_on ? 'Started' : 'Expected'}</dt>
            <dd className="font-medium">{bloom.started_on ? day(bloom.started_on) : bloom.forecast_start_on ? `~${day(bloom.forecast_start_on)}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Peak</dt>
            <dd className="font-medium">
              {share(bloom.peak_fraction)} <span className="text-xs text-gray-500">{day(bloom.peak_on)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Over</dt>
            <dd className="font-medium">{day(bloom.ended_on)}</dd>
          </div>
        </dl>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {bloom.confidence && <span>Confidence: {bloom.confidence}</span>}
          {bloom.seeded_on ? <span>{Math.round(Number(bloom.gdd ?? 0))} degree days since seeding</span> : <span>No seeding date</span>}
          {bloom.blind_since && <span className="font-medium text-amber-700">No clear look since {day(bloom.blind_since)}</span>}
          {bloom.task_id && (
            <Link to={`/tasks/${bloom.task_id}`} className="font-medium text-brand-700 hover:underline">
              Fungicide task
            </Link>
          )}
          <InfoPopover title="How flowering is called" width={360}>
            <p>
              Every clear satellite look counts the share of the crop that passes the flower test: a plant, red high next to green, blue low. Starting at{' '}
              {startPct}%, fungicide window at {Math.round((set?.windowFraction ?? 0.25) * 100)}%, full bloom at {Math.round((set?.fullFraction ?? 0.5) * 100)}%.
            </p>
            <p className="mt-2">
              Nothing is called before {set?.gateGdd ?? 450} degree days from seeding, or on a hazy look. Confidence weighs how clear the look was, how far past the line it is, and a
              second opinion from the field's colours.
            </p>
          </InfoPopover>
        </div>

        {shown && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {day(shown.sensedOn)} · {share(shown.yellow)} yellow
              </span>
              {shown.flowers && (
                <label className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={showFlowers} onChange={(e) => setShowFlowers(e.target.checked)} />
                  Paint the yellow gold
                </label>
              )}
            </div>
            <div className="relative mt-1.5 w-full max-w-md overflow-hidden rounded-md bg-gray-100" style={{ aspectRatio: shown.aspect }}>
              <img src={shown.photo!} alt={`Satellite photo ${shown.sensedOn}`} className="absolute inset-0 h-full w-full" />
              {showFlowers && shown.flowers && (
                <img
                  src={shown.flowers}
                  alt=""
                  className="absolute inset-0 h-full w-full opacity-60"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">Sentinel-2, 10 m squares. Gold is every square that passes the flower test.</p>
          </div>
        )}

        {pictures.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {pictures.map((p) => (
              <button
                key={p.sensedOn}
                type="button"
                onClick={() => setPicked(p.sensedOn)}
                className={cn(
                  'shrink-0 rounded border-2 text-center',
                  p.sensedOn === shown?.sensedOn ? 'border-brand-600' : 'border-transparent',
                )}
              >
                <img src={p.photo!} alt="" className="h-16 w-16 rounded-sm object-cover" />
                <div className="text-[11px] leading-tight text-gray-700">{day(p.sensedOn)}</div>
                <div className="text-[11px] font-medium leading-tight">{share(p.yellow)}</div>
              </button>
            ))}
          </div>
        )}
        {!isLoading && !pictures.length && (
          <p className="mt-3 text-sm text-gray-500">No clear pictures of this field between June and August yet.</p>
        )}

        <SawIt fieldId={fieldId} cropYear={cropYear} />
      </div>
    </Card>
  )
}

/** "I saw it": what a person saw in the field. Counted at the next satellite run, and used to tune the settings. */
function SawIt({ fieldId, cropYear }: { fieldId: string; cropYear: number }) {
  const { profile } = useAuth()
  const { data: reports = [] } = useBloomScouting(fieldId, cropYear)
  const add = useAddBloomScouting()
  const del = useDeleteBloomScouting()
  const [open, setOpen] = useState(false)
  const [seenOn, setSeenOn] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [pct, setPct] = useState('')
  const [note, setNote] = useState('')
  const pctNum = Number(pct)
  const valid = pct !== '' && Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100 && seenOn.startsWith(String(cropYear))

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">I saw it{reports.length ? ` (${reports.length})` : ''}</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50">
            Add what I saw
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            add.mutate(
              { field_id: fieldId, crop_year: cropYear, seen_on: seenOn, bloom_pct: Math.round(pctNum), note: note.trim() || null },
              {
                onSuccess: () => {
                  setOpen(false)
                  setPct('')
                  setNote('')
                },
              },
            )
          }}
        >
          <label className="text-xs text-gray-600">
            Day
            <input type="date" className={input} value={seenOn} onChange={(e) => setSeenOn(e.target.value)} />
          </label>
          <label className="text-xs text-gray-600">
            % in bloom
            <input className={input} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 15" />
          </label>
          <label className="col-span-2 text-xs text-gray-600">
            Note
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
            <button type="submit" disabled={!valid || add.isPending} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              Cancel
            </button>
            {add.error && <span className="text-xs text-red-600">{(add.error as Error).message}</span>}
          </div>
        </form>
      )}
      {reports.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-sm">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="w-14 text-gray-500">{day(r.seen_on)}</span>
              <span className="font-medium">{r.bloom_pct}%</span>
              {r.note && <span className="min-w-0 truncate text-gray-600">{r.note}</span>}
              {(r.created_by === profile?.id || hasManagerAccess(profile?.role)) && (
                <button type="button" onClick={() => del.mutate(r.id)} className="ml-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove report">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
