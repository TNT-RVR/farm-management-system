import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flower2, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { Card } from '@/components/Card'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { CardList, RowCard } from '@/components/RowCards'
import { useTab } from '@/lib/useTab'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { STAGE_LABEL, bloomChip, stageOnDay, suggestSettings, type BloomSettings } from '@/lib/canola-bloom'
import { useBloomSettings, useFarmBloom, useSaveBloomSettings, type FarmBloomRow } from '@/lib/canola-bloom-data'
import { PollinatorsTab } from '@/pages/canola/PollinatorsTab'
import { SclerotiniaTab } from '@/pages/canola/SclerotiniaTab'
import { cn } from '@/lib/utils'

const TABS = ['season', 'sclerotinia', 'pollinators', 'report', 'tuning'] as const
type Tab = (typeof TABS)[number]

const day = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const share = (v: number | string | null) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const th = 'px-3 py-2 text-left text-xs font-medium text-gray-500'
const td = 'px-3 py-2 text-sm text-gray-800'

/**
 * Canola bloom, farm-wide (Sam, 2 Nov 2026): which canola is flowering now,
 * how each season went, and how well the satellite's calls matched what
 * really happened — with settings the farm's own seasons suggest.
 */
export function CanolaBloomPage() {
  const [tab, setTab] = useTab<Tab>('canola-bloom', TABS)
  const { data: rows = [], isLoading } = useFarmBloom()
  const { data: set } = useBloomSettings()
  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
      <PageHeader title="Canola bloom" icon={<Flower2 className="h-5 w-5 text-brand-700" />} subtitle="Which canola is flowering, from the satellite" />
      <PillTabs
        tabs={[
          { key: 'season', label: 'This season' },
          { key: 'sclerotinia', label: 'Sclerotinia' },
          { key: 'pollinators', label: 'Pollinators' },
          { key: 'report', label: 'Season report' },
          { key: 'tuning', label: 'How it did' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {isLoading || !set ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : tab === 'season' ? (
        <SeasonTab rows={rows} />
      ) : tab === 'sclerotinia' ? (
        // Alberta's own checklist, here because this is the page that knows
        // which fields have started flowering and so when it must be filled in.
        <SclerotiniaTab rows={rows} />
      ) : tab === 'pollinators' ? (
        // Stocking is a bloom-share decision -- leafcutters at five per cent,
        // honey bees at ten -- so the bees belong on the page that holds the
        // share. The year is the newest on file, as the other tabs take it.
        <PollinatorsTab cropYear={rows.length ? Math.max(...rows.map((r) => r.crop_year)) : new Date().getFullYear()} />
      ) : tab === 'report' ? (
        <ReportTab rows={rows} set={set} />
      ) : (
        <TuningTab rows={rows} set={set} />
      )}
    </div>
  )
}

function Chip({ r }: { r: FarmBloomRow }) {
  const c = bloomChip(r)
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', c.style)}>{c.label}</span>
}

function SeasonTab({ rows }: { rows: FarmBloomRow[] }) {
  const year = rows.length ? Math.max(...rows.map((r) => r.crop_year)) : new Date().getFullYear()
  const now = rows.filter((r) => r.crop_year === year)
  if (!now.length) return <p className="text-sm text-gray-500">No canola in the crop plan yet.</p>
  const started = (r: FarmBloomRow) => (r.started_on ? day(r.started_on) : r.forecast_start_on ? `~${day(r.forecast_start_on)}` : '—')
  return (
    <Card title={`Canola ${year}`} icon={Flower2}>
      <table className="hidden w-full sm:table">
        <thead className="border-b border-gray-100">
          <tr>
            <th className={th}>Field</th>
            <th className={th}>Stage</th>
            <th className={th}>Yellow now</th>
            <th className={th}>Started</th>
            <th className={th}>Peak</th>
            <th className={th}>Over</th>
            <th className={th}>Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {now.map((r) => (
            <tr key={r.field_id}>
              <td className={td}>
                <Link to={`/fields/${r.field_id}`} className="font-medium text-brand-700 hover:underline">
                  {r.fieldName}
                </Link>
              </td>
              <td className={td}>
                <Chip r={r} />
                {r.blind_since && <div className="mt-0.5 text-xs text-amber-700">No clear look since {day(r.blind_since)}</div>}
              </td>
              <td className={td}>
                {share(r.yellow_now)} <span className="text-xs text-gray-500">{day(r.last_clear_on)}</span>
              </td>
              <td className={td}>{started(r)}</td>
              <td className={td}>
                {share(r.peak_fraction)} <span className="text-xs text-gray-500">{day(r.peak_on)}</span>
              </td>
              <td className={td}>{day(r.ended_on)}</td>
              <td className={td}>{r.confidence ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CardList>
        {now.map((r) => (
          <RowCard
            key={r.field_id}
            heading={<Link to={`/fields/${r.field_id}`} className="text-brand-700">{r.fieldName}</Link>}
            actions={<Chip r={r} />}
            facts={[
              { label: 'Yellow now', node: r.yellow_now == null ? null : `${share(r.yellow_now)} ${day(r.last_clear_on)}` },
              { label: 'Started', node: started(r) },
              { label: 'Peak', node: r.peak_fraction == null ? null : `${share(r.peak_fraction)} ${day(r.peak_on)}` },
              { label: 'Over', node: r.ended_on ? day(r.ended_on) : null },
              { label: 'Confidence', node: r.confidence },
              { label: 'No clear look since', node: r.blind_since ? day(r.blind_since) : null },
            ]}
          />
        ))}
      </CardList>
    </Card>
  )
}

function ReportTab({ rows, set }: { rows: FarmBloomRow[]; set: BloomSettings }) {
  if (!rows.length) return <p className="text-sm text-gray-500">No canola seasons on file yet.</p>
  const length = (r: FarmBloomRow) => (r.started_on && r.ended_on ? `${daysBetween(r.started_on, r.ended_on)} days` : '—')
  const atSpray = (r: FarmBloomRow) => {
    if (!r.first_fungicide_on) return '—'
    const st = stageOnDay((r.looks ?? []).filter((l) => l.ok), r.first_fungicide_on, set)
    return `${day(r.first_fungicide_on)}${st ? ` · ${STAGE_LABEL[st].toLowerCase()}` : ''}`
  }
  const yld = (r: FarmBloomRow) => (r.yieldPerAcre == null ? '—' : `${r.yieldPerAcre.toFixed(1)} ${r.yieldUnit ?? 'bu'}/ac`)
  return (
    <Card title="Every season" icon={Flower2}>
      <table className="hidden w-full sm:table">
        <thead className="border-b border-gray-100">
          <tr>
            <th className={th}>Year</th>
            <th className={th}>Field</th>
            <th className={th}>Started</th>
            <th className={th}>Peak</th>
            <th className={th}>Over</th>
            <th className={th}>Length</th>
            <th className={th}>First fungicide</th>
            <th className={th}>Yield</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={`${r.field_id}-${r.crop_year}`}>
              <td className={td}>{r.crop_year}</td>
              <td className={td}>
                <Link to={`/fields/${r.field_id}`} className="text-brand-700 hover:underline">
                  {r.fieldName}
                </Link>
              </td>
              <td className={td}>{day(r.started_on)}</td>
              <td className={td}>
                {share(r.peak_fraction)} <span className="text-xs text-gray-500">{day(r.peak_on)}</span>
              </td>
              <td className={td}>{day(r.ended_on)}</td>
              <td className={td}>{length(r)}</td>
              <td className={td}>{atSpray(r)}</td>
              <td className={td}>{yld(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CardList>
        {rows.map((r) => (
          <RowCard
            key={`${r.field_id}-${r.crop_year}`}
            heading={`${r.crop_year} · ${r.fieldName}`}
            facts={[
              { label: 'Started', node: day(r.started_on) },
              { label: 'Peak', node: r.peak_fraction == null ? null : `${share(r.peak_fraction)} ${day(r.peak_on)}` },
              { label: 'Over', node: day(r.ended_on) },
              { label: 'Length', node: length(r) },
              { label: 'First fungicide', node: atSpray(r) },
              { label: 'Yield', node: yld(r) },
            ]}
          />
        ))}
      </CardList>
    </Card>
  )
}

function TuningTab({ rows, set }: { rows: FarmBloomRow[]; set: BloomSettings }) {
  const { profile } = useAuth()
  const manager = hasManagerAccess(profile?.role)
  const save = useSaveBloomSettings()
  const withTruth = rows.filter((r) => r.truth_on)
  const suggestion = suggestSettings(
    withTruth.map((r) => ({
      truthOn: r.truth_on!,
      gddAtTruth: r.gdd_at_truth == null ? null : Number(r.gdd_at_truth),
      source: r.truth_source === 'scouting' ? ('scouting' as const) : ('fungicide' as const),
      looks: (r.looks ?? []).filter((l) => l.ok && l.src !== 'scout').map((l) => ({ sensedOn: l.d, share: l.s })),
    })),
  )
  const off = (r: FarmBloomRow) => (r.started_on && r.truth_on ? daysBetween(r.truth_on, r.started_on) : null)
  const offs = withTruth.map(off).filter((d): d is number => d != null)
  const within = offs.filter((d) => Math.abs(d) <= 4).length
  const changes =
    suggestion &&
    [
      suggestion.startFraction != null && suggestion.startFraction !== set.startFraction && { start_fraction: suggestion.startFraction },
      suggestion.typicalStartGdd != null && suggestion.typicalStartGdd !== set.typicalStartGdd && { typical_start_gdd: suggestion.typicalStartGdd },
      suggestion.gateGdd != null && suggestion.gateGdd !== set.gateGdd && { gate_gdd: suggestion.gateGdd },
    ].filter(Boolean)

  return (
    <div className="space-y-3">
      <Card title="Satellite calls against what happened" icon={Flower2}>
        <div className="p-3">
          <HelpNote summary="What really happened is a scouting report of 10 % or more, else five days before the first fungicide.">
            Fungicide goes on at 20-50 % bloom, so five days before it stands in for the first flowers when nobody scouted. Add &ldquo;I saw it&rdquo; reports on a
            field's page to give the satellite a truer mark.
          </HelpNote>
          {!withTruth.length ? (
            <p className="mt-2 text-sm text-gray-500">No season has a scouting report or a fungicide on record yet.</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-gray-800">
                {offs.length ? `${within} of ${offs.length} starts called within 4 days.` : 'No start called yet on a season with a mark.'}
              </p>
              <table className="mt-2 w-full">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className={th}>Season</th>
                    <th className={th}>Really began</th>
                    <th className={th}>Satellite said</th>
                    <th className={th}>Off by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {withTruth.map((r) => {
                    const d = off(r)
                    return (
                      <tr key={`${r.field_id}-${r.crop_year}`}>
                        <td className={td}>
                          {r.crop_year} {r.fieldName}
                        </td>
                        <td className={td}>
                          {day(r.truth_on)} <span className="text-xs text-gray-500">{r.truth_source === 'scouting' ? 'scouted' : 'from spray'}</span>
                        </td>
                        <td className={td}>{day(r.started_on)}</td>
                        <td className={cn(td, d != null && Math.abs(d) > 4 && 'font-medium text-amber-700')}>
                          {d == null ? '—' : d === 0 ? 'same day' : `${Math.abs(d)} days ${d < 0 ? 'early' : 'late'}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          {suggestion && changes && changes.length > 0 && (
            <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm">
              <div className="font-medium text-gray-900">The farm's {suggestion.seasons} seasons suggest:</div>
              <ul className="mt-1 list-disc pl-5 text-gray-800">
                {suggestion.startFraction != null && suggestion.startFraction !== set.startFraction && (
                  <li>
                    Call &ldquo;starting&rdquo; at {Math.round(suggestion.startFraction * 100)}% (now {Math.round(set.startFraction * 100)}%)
                  </li>
                )}
                {suggestion.typicalStartGdd != null && suggestion.typicalStartGdd !== set.typicalStartGdd && (
                  <li>
                    First flowers at {suggestion.typicalStartGdd} degree days (now {set.typicalStartGdd}), gate {suggestion.gateGdd}
                  </li>
                )}
              </ul>
              {manager && (
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate(Object.assign({ updated_by: profile?.id ?? null }, ...(changes as object[])))}
                  className="mt-2 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  Use these
                </button>
              )}
            </div>
          )}
        </div>
      </Card>
      <Fold title="Settings" summary={`Starting at ${Math.round(set.startFraction * 100)}%, gate ${set.gateGdd} degree days`}>
        <SettingsForm key={JSON.stringify(set)} set={set} manager={manager} />
      </Fold>
    </div>
  )
}

const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50'

function SettingsForm({ set, manager }: { set: BloomSettings; manager: boolean }) {
  const { profile } = useAuth()
  const save = useSaveBloomSettings()
  const pct = (v: number) => String(Math.round(v * 100))
  const [f, setF] = useState(() => ({
    start: pct(set.startFraction),
    window: pct(set.windowFraction),
    full: pct(set.fullFraction),
    end: pct(set.endFraction),
    gate: String(set.gateGdd),
    latest: String(set.latestGdd),
    typical: String(set.typicalStartGdd),
    blind: String(set.blindDays),
  }))
  const [varieties, setVarieties] = useState(() => Object.entries(set.varietyGate).map(([name, gdd]) => ({ name, gdd: String(gdd) })))
  const field = (key: keyof typeof f, label: string, unit: string) => (
    <label className="text-xs text-gray-600">
      {label}
      <div className="flex items-center gap-1">
        <input className={input} inputMode="numeric" disabled={!manager} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
        <span className="text-xs text-gray-500">{unit}</span>
      </div>
    </label>
  )
  const num = (v: string) => Number(v)
  const ok = Object.values(f).every((v) => v !== '' && Number.isFinite(Number(v))) && varieties.every((v) => v.name.trim() && Number.isFinite(Number(v.gdd)))

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        save.mutate({
          start_fraction: num(f.start) / 100,
          window_fraction: num(f.window) / 100,
          full_fraction: num(f.full) / 100,
          end_fraction: num(f.end) / 100,
          gate_gdd: num(f.gate),
          latest_gdd: num(f.latest),
          typical_start_gdd: num(f.typical),
          blind_days: Math.round(num(f.blind)),
          variety_gate: Object.fromEntries(varieties.map((v) => [v.name.trim(), Number(v.gdd)])),
          updated_by: profile?.id ?? null,
        })
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('start', 'Starting at', '%')}
        {field('window', 'Fungicide window at', '%')}
        {field('full', 'Full bloom at', '%')}
        {field('end', 'Over below', '%')}
        {field('gate', 'Nothing called before', 'dd')}
        {field('typical', 'First flowers, typical', 'dd')}
        {field('latest', 'No new start after', 'dd')}
        {field('blind', 'Warn after no look for', 'days')}
      </div>
      <div>
        <div className="text-xs font-medium text-gray-700">Varieties that flower earlier or later (their gate, in degree days)</div>
        {varieties.map((v, i) => (
          <div key={i} className="mt-1 flex items-center gap-2">
            <input
              className={input}
              disabled={!manager}
              placeholder="Variety, as in the crop plan"
              value={v.name}
              onChange={(e) => setVarieties(varieties.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className={cn(input, 'w-24')}
              disabled={!manager}
              inputMode="numeric"
              value={v.gdd}
              onChange={(e) => setVarieties(varieties.map((x, j) => (j === i ? { ...x, gdd: e.target.value } : x)))}
            />
            {manager && (
              <button type="button" onClick={() => setVarieties(varieties.filter((_, j) => j !== i))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove variety">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {manager && (
          <button type="button" onClick={() => setVarieties([...varieties, { name: '', gdd: String(set.gateGdd) }])} className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add a variety
          </button>
        )}
      </div>
      {manager && (
        <div className="flex items-center gap-2">
          <button type="submit" disabled={!ok || save.isPending} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
            Save settings
          </button>
          {save.isSuccess && <span className="text-xs text-green-700">Saved. The next satellite run uses them.</span>}
          {save.error && <span className="text-xs text-red-600">{(save.error as Error).message}</span>}
        </div>
      )}
    </form>
  )
}
