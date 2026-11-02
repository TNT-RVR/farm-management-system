import { useState } from 'react'
import { Flower2 } from 'lucide-react'
import { Card } from '@/components/Card'
import { BLOOM_LABEL, BLOOM_START_FRACTION } from '@/lib/canola-bloom'
import { useBloomPictures, useCanolaBloom } from '@/lib/canola-bloom-data'
import { cn } from '@/lib/utils'

const day = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const share = (v: number | string | null) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)

const STATUS_STYLE = {
  waiting: 'bg-gray-100 text-gray-700',
  watching: 'bg-sky-100 text-sky-800',
  flowering: 'bg-yellow-200 text-yellow-900',
  over: 'bg-green-100 text-green-800',
} as const

/**
 * A canola field's flowering, as the satellite saw it: where it stands, and the
 * summer's pictures with the yellow painted gold, so anyone can see for
 * themselves how yellow it is. Shown only for a field that is canola that year.
 */
export function CanolaBloomCard({ fieldId, cropYear }: { fieldId: string; cropYear: number }) {
  const { data: bloom } = useCanolaBloom(fieldId, cropYear)
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

  return (
    <Card
      title={`Canola flowering ${cropYear}`}
      icon={Flower2}
      className="mt-3"
      right={
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[bloom.status])}>
          {BLOOM_LABEL[bloom.status]}
        </span>
      }
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
            <dt className="text-xs text-gray-500">Started</dt>
            <dd className="font-medium">{day(bloom.started_on)}</dd>
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
        <p className="mt-1 text-xs text-gray-500">
          {bloom.seeded_on ? `Seeded ${day(bloom.seeded_on)}, ${Math.round(Number(bloom.gdd ?? 0))} degree days since. ` : 'No seeding date, so no degree-day check. '}
          Flowering is called at {Math.round(BLOOM_START_FRACTION * 100)}% of the field yellow on a clear look.
        </p>

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
            <p className="mt-1 text-xs text-gray-500">
              Sentinel-2, 10 m squares. Gold is every square that passes the flower test: a plant, red high next to green, blue low.
            </p>
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
      </div>
    </Card>
  )
}
