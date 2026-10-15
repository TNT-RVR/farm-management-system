import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useWaterQualitySummary, type WqStation } from '@/lib/water-quality'
import { SEASON_MM, USE_LABEL, bandsFor, concernsFrom, fmtWq, testedClear, type Concern, type Guideline } from '@/lib/water-concerns'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { farmTz } from '@/lib/farm-context'
import { useFarmSettings } from '@/lib/farm-setup'

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz(), dateStyle: 'medium' }) : '—'

const sourceLabel = (source: string, district: string): string => ({ smrid: `${district} canal`, oldman: 'Oldman River' })[source] ?? source

/**
 * Anything in the water worth knowing about, per body of water: over a
 * guideline for irrigation or livestock, and every pesticide the province
 * found at all. Judged on the last five seasons of the province's samples.
 */
export function WaterConcerns({ stations }: { stations: WqStation[] }) {
  const { data: rows, isLoading } = useWaterQualitySummary()
  const { districtName } = useFarmSettings()
  const name = useMemo(() => new Map(stations.map((s) => [s.station_id, s.name])), [stations])
  const sources = useMemo(() => {
    const by = new Map<string, Set<string>>()
    for (const s of stations) if (s.water_source) (by.get(s.water_source) ?? by.set(s.water_source, new Set()).get(s.water_source)!).add(s.station_id)
    return [...by.entries()].map(([source, ids]) => {
      const rs = (rows ?? []).filter((r) => ids.has(r.station_id))
      const concerns = concernsFrom(rs, (id) => name.get(id) ?? id)
      return { source, concerns, clear: testedClear(rs, concerns), tested: new Set(rs.map((r) => r.parameter)).size }
    })
  }, [rows, stations, name])

  if (isLoading) return <p className="mb-3 text-xs text-gray-500">Checking the water against the guidelines…</p>
  if (!sources.some((s) => s.tested)) return null

  return (
    <div className="mb-3 space-y-3">
      {sources.map((s) => (
        <SourceConcerns key={s.source} label={sourceLabel(s.source, districtName)} {...s} />
      ))}
      <HelpNote summary="Over a guideline is a reason to look, not proof of harm." title="About the guidelines">
        <p>
          Guidelines are Canada&apos;s and Alberta&apos;s for irrigation and livestock water, set to protect the most sensitive crop or animal with a
          wide margin — over one is a reason to look, not proof of harm. The g/ha figure is what a {SEASON_MM} mm (12 in) season of water at the
          highest level found would carry, to set against a label rate.
        </p>
      </HelpNote>
    </div>
  )
}

function SourceConcerns({ label, concerns, clear, tested }: { label: string; concerns: Concern[]; clear: number; tested: number }) {
  const [showFound, setShowFound] = useState(false)
  const overs = concerns.filter((c) => c.level === 'over')
  const found = concerns.filter((c) => c.level === 'found')
  if (!tested) return null
  return (
    <div className="rounded-md border border-gray-200 p-2.5">
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-gray-900">
        {overs.length ? <ShieldAlert className="h-4 w-4 text-amber-600" /> : <ShieldCheck className="h-4 w-4 text-emerald-600" />}
        Things in the water — {label}
        <span className="font-normal text-gray-500">
          {tested} things tested · {overs.length ? `${overs.length} over a guideline` : 'nothing over a guideline'}
          {found.length ? ` · ${found.length} more pesticide${found.length === 1 ? '' : 's'} found under or without one` : ''} · {clear} clear
        </span>
      </p>
      {overs.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100">
          {overs.map((c) => (
            <ConcernRow key={c.analyte.key} c={c} />
          ))}
        </ul>
      )}
      {found.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowFound((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-900"
          >
            {showFound ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Pesticides found, under or without a guideline ({found.length})
          </button>
          {showFound && (
            <ul className="mt-1 divide-y divide-gray-100">
              {found.map((c) => (
                <ConcernRow key={c.analyte.key} c={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** For a guideline that differs by crop: which crop groups the worst level is over, and which it is under. */
function BandLine({ g, value, unit }: { g: Guideline; value: number; unit: string }) {
  const { over, under } = bandsFor(g, value)
  return (
    <p className="text-[11px] text-gray-600">
      {over.length > 0 && <>Over for {over.join('; ')}. </>}
      {under.length > 0 && <>Under for {under.map((b) => `${b.crops} (${fmtWq(b.max)} ${unit})`).join('; ')}.</>}
    </p>
  )
}

function ConcernRow({ c }: { c: Concern }) {
  const g = c.guideline
  const unit = c.analyte.unit
  return (
    <li className="py-1.5 text-xs">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-gray-900">{c.analyte.label}</span>
        {g && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px]', g.use === 'irrigation' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800')}>
            over the {USE_LABEL[g.use].toLowerCase()} guideline
          </span>
        )}
        <span className="text-gray-500">
          found in {c.detected} of {c.tested} samples
        </span>
      </p>
      <p className="text-gray-700">
        {g?.basis === 'season-geomean' ? 'Worst season average' : 'Highest'} {fmtWq(c.worst.value)} {unit}
        {g?.basis !== 'season-geomean' && <> on {day(c.worst.at)}</>} at {c.worst.station}
        {g ? (
          <>
            {' '}
            — guideline {g.max != null ? fmtWq(g.max) : `at least ${fmtWq(g.min!)}`} {unit}
            {g.basis === 'season-geomean' ? ' (season geometric mean)' : ''}
          </>
        ) : c.guidelines.length ? (
          <> — under the {c.guidelines.map((x) => `${USE_LABEL[x.use].toLowerCase()} ${fmtWq(x.max ?? x.min!)}`).join(', ')} {unit} guideline</>
        ) : (
          <> — no Canadian guideline</>
        )}
        {c.seasonGPerHa != null && <> · about {fmtWq(c.seasonGPerHa)} g/ha a season</>}.
      </p>
      {g?.bands && <BandLine g={g} value={c.worst.value} unit={unit} />}
      {g && (
        <p className="text-[11px] text-gray-500">
          {g.why ? `${g.why} ` : ''}
          {g.interim ? 'Interim guideline. ' : ''}Source: {g.source}.
        </p>
      )}
      {c.dlAboveGuideline && (
        <p className="text-[11px] text-gray-500">
          Some samples were reported as &ldquo;not detected&rdquo; at a lab limit above the guideline, so those cannot say it was under.
        </p>
      )}
    </li>
  )
}
