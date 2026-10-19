import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Minus, ShieldAlert, Wand2 } from 'lucide-react'
import { Select, type SelectOption } from '@/components/Select'
import { Fold } from '@/components/Fold'
import { useFields } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { SETTINGS, type CombineCropKey } from '@/lib/combine'
import { inchText, startingPoints } from '@/lib/combine-manual'
import { useCombineSettings, usePreviousCombineSettings } from '@/lib/combine-queries'
import { useDryDown } from '@/lib/dry-down-data'
import { useRanchWeather, windDirLabel } from '@/lib/ranchWeather'
import { NDVI_RAMP } from '@/lib/pastures'
import { GRADE_STYLE, gradeFor, gradeLabel, hasBands, type MoistureBands } from '@/lib/moisture'
import {
  RULES,
  SOURCE_LABELS,
  THRESHOLDS,
  conditionsCropOf,
  dewPointC,
  dewSpread,
  directionWords,
  hourLabel,
  moistureAtHour,
  nextMoistureHours,
  settingsCropFor,
  suggest,
  thicknessOf,
  type Advice,
  type AdviceSetting,
  type MoistureHour,
  type MoistureNow,
  type Suggestion,
  type Thickness,
  type WxHour,
} from '@/lib/combine-conditions'
import { useConditionsFields, useFieldConditions, useNdviPicture } from '@/lib/combine-conditions-data'
import { useCropLossHistory } from '@/lib/combine-queries'
import { lowestLossInSimilar, SIMILAR, type LowestLoss } from '@/lib/combine-what-worked'
import { settingsLine } from '@/lib/combine-setting-text'

const TZ = 'America/Edmonton'
const MM_SETTINGS: AdviceSetting[] = ['concave_mm', 'chaffer_mm', 'sieve_mm']

/** The farm's date and whole hour now. */
function farmNow(d = new Date()): { date: string; hour: number } {
  const date = d.toLocaleDateString('en-CA', { timeZone: TZ })
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d))
  return { date, hour: Number.isFinite(hour) ? hour % 24 : 12 }
}

const pct = (v: number) => `${v.toFixed(1)}%`
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * Conditions & suggested adjustments (Sam, 17 Oct 2026): for one field, how
 * thick the crop is from the satellite, the grain moisture now and through
 * the next twelve hours, the weather at the field, and the rules engine's
 * starting adjustments (combine-conditions.ts) against the crop's saved
 * settings. Directions only; nothing goes to the combine.
 */
export function ConditionsAdvice({
  cropYear,
  fieldId: initialField,
  onCropChange,
}: {
  cropYear: number
  fieldId?: string
  /** A picked field switches the page to its crop, as the loss check does. */
  onCropChange?: (c: CombineCropKey) => void
}) {
  const { data: fields } = useFields()
  const { data: lists } = useConditionsFields(cropYear)
  const [picked, setPicked] = useState<string>(initialField ?? '')
  const fieldId = picked || lists?.harvesting[0] || lists?.tested[0] || ''

  const options = useMemo((): SelectOption[] => {
    const name = (id: string) => fields?.find((f) => f.id === id)?.name
    const first = [...(lists?.harvesting ?? []), ...(lists?.tested ?? [])]
    const out: SelectOption[] = []
    for (const id of lists?.harvesting ?? []) if (name(id)) out.push({ value: id, label: name(id)!, group: 'Being combined' })
    for (const id of lists?.tested ?? []) if (name(id)) out.push({ value: id, label: name(id)!, group: 'Tested, not started' })
    for (const f of fields ?? []) if (!first.includes(f.id)) out.push({ value: f.id, label: f.name, group: 'Other fields' })
    return out
  }, [fields, lists])

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Conditions &amp; suggested adjustments</h2>
        <Select value={fieldId} ariaLabel="Field" placeholder="Choose the field" className="ml-auto w-full sm:w-56" onChange={setPicked} options={options} />
      </div>
      {fieldId ? (
        <FieldConditionsBody key={fieldId} fieldId={fieldId} cropYear={cropYear} onCropChange={onCropChange} />
      ) : (
        <p className="mt-2 text-xs text-gray-500">Choose a field.</p>
      )}
    </section>
  )
}

function FieldConditionsBody({ fieldId, cropYear, onCropChange }: { fieldId: string; cropYear: number; onCropChange?: (c: CombineCropKey) => void }) {
  const { data: fc, isLoading } = useFieldConditions(fieldId, cropYear)
  const { data: fields } = useFields()
  const { data: dd } = useDryDown(fieldId, cropYear)
  const { data: wx } = useRanchWeather(fc?.centre?.lat, fc?.centre?.lon, undefined, 2, true)
  const { data: saved } = useCombineSettings(cropYear)
  const { data: previous } = usePreviousCombineSettings(cropYear)
  const now = farmNow()

  const crop = conditionsCropOf(fc?.cropName ?? dd?.cropName)
  const settingsCrop = crop ? settingsCropFor(crop) : null
  useEffect(() => {
    if (settingsCrop && onCropChange) onCropChange(settingsCrop)
  }, [settingsCrop, onCropChange])

  const swathed = Boolean(fc?.swathed || dd?.method === 'swathed')
  const thickness = useMemo(
    () => (fc ? thicknessOf({ looks: fc.looks, reference: fc.reference, today: now.date, swathed }) : null),
    [fc, now.date, swathed],
  )

  // The grain: a test in the last hour and a half is "now"; otherwise the model's hour.
  const moisture = useMemo((): { now: MoistureNow | null; next: MoistureHour[]; lastTest: { date: string; hour: number; pct: number } | null } => {
    const last = dd?.tests.at(-1) ?? null
    const hourly = dd?.forecast?.hourly ?? []
    const at = (d: string, h: number) => Date.parse(`${d}T00:00:00Z`) + h * 3_600_000
    const fresh = last && at(now.date, now.hour + new Date().getMinutes() / 60) - at(last.date, last.hour) <= 1.5 * 3_600_000
    const model = moistureAtHour(hourly, now)
    const nowM: MoistureNow | null = fresh ? { pct: last!.pct, source: 'test' } : model != null ? { pct: model, source: 'model' } : null
    return { now: nowM, next: nextMoistureHours(hourly, now), lastTest: last }
  }, [dd, now.date, now.hour]) // eslint-disable-line react-hooks/exhaustive-deps

  const weather = useMemo((): { now: WxHour | null; next: WxHour[] } => {
    const c = wx?.current
    const nowH: WxHour | null = c
      ? { time: c.time ?? '', tempC: c.temp, rh: c.humidity, dewC: c.temp != null && c.humidity != null ? dewPointC(c.temp, c.humidity) : null, windKmh: c.wind, gustKmh: c.gusts, windDir: c.windDir }
      : null
    const after = c?.time ?? ''
    const next = (wx?.hourly ?? [])
      .filter((h) => h.time > after)
      .slice(0, 12)
      .map((h) => ({ time: h.time, tempC: h.temp, rh: h.rh, dewC: h.dew, windKmh: h.wind, gustKmh: h.gust, windDir: h.windDir }))
    return { now: nowH, next }
  }, [wx])

  const bands = fc?.bands && hasBands(fc.bands) ? fc.bands : null
  const advice = useMemo(
    () => (crop ? suggest({ crop, swathed, thickness, moisture: { now: moisture.now, next: moisture.next, bands }, weather }) : null),
    [crop, swathed, thickness, moisture, bands, weather],
  )

  // The farm's own history beside the rules: the loss check that lost least in
  // conditions like these (lib/combine-what-worked.ts). A labelled history
  // line, not a rule. The AI recommendations are to use this same history.
  // TODO: send `history` in AskClaude's payload once /api/combine-advice's
  // prompt allows quoting past settings (it forbids setting numbers today).
  const { data: lossHistory } = useCropLossHistory(settingsCrop)
  const history = useMemo(
    () =>
      settingsCrop
        ? lowestLossInSimilar(lossHistory ?? [], {
            cropKey: settingsCrop,
            now: { moisturePct: moisture.now?.pct ?? null, rh: weather.now?.rh ?? null, tempC: weather.now?.tempC ?? null, windKmh: weather.now?.windKmh ?? null },
            bands,
          })
        : null,
    [lossHistory, settingsCrop, moisture.now, weather.now, bands],
  )

  // What each suggestion is measured from: this year's saved settings, else the last year's, else the book's.
  const baseOf = (s: AdviceSetting): { value: number | null; from: string } => {
    if (!settingsCrop) return { value: null, from: '' }
    const mine = saved?.find((r) => r.crop_key === settingsCrop)?.[s]
    if (mine != null) return { value: Number(mine), from: `${cropYear} saved` }
    const last = previous?.find((r) => r.crop_key === settingsCrop)
    if (last?.[s] != null) return { value: Number(last[s]), from: String(last.crop_year) }
    const sp = startingPoints(settingsCrop)[s]
    return { value: sp.value, from: sp.source === 'manual' ? 'book' : 'our start' }
  }

  if (isLoading) return <p className="mt-2 text-xs text-gray-500">Loading the field…</p>
  if (!crop) {
    return <p className="mt-2 text-xs text-gray-500">{fc?.cropName ?? dd?.cropName ?? 'No crop planned'} — no combine rules for this crop.</p>
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-[11px] text-gray-500">
        {fc?.cropName ?? dd?.cropName}
        {swathed ? ` · swathed${fc?.swathedOn ? ` ${shortDate(fc.swathedOn)}` : ''}` : dd?.methodSet ? ' · straight cut' : ''}
      </p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
        <ThicknessTile t={thickness} fieldId={fieldId} cropName={fc?.cropName ?? null} swathed={swathed} />
        <MoistureTile m={moisture} bands={bands} reason={dd?.reason ?? null} />
        <WeatherTile w={weather} />
      </div>
      {advice && <Suggestions advice={advice} baseOf={baseOf} />}
      {history && <HistoryLine h={history} fieldName={(id) => fields?.find((f) => f.id === id)?.name ?? null} />}
      {advice && (
        <AskClaude
          advice={advice}
          payload={{
            crop: fc?.cropName ?? dd?.cropName,
            harvest: swathed ? 'swathed' : 'standing / straight cut',
            thickness: thickness && thicknessSummary(thickness),
            grain_moisture: moisture.now ? { pct: +moisture.now.pct.toFixed(1), from: moisture.now.source === 'test' ? 'meter test' : 'dry-down model', dry_up_to: bands?.dry_max ?? null, tough_up_to: bands?.tough_max ?? null } : null,
            weather_now: weather.now && { temp_c: weather.now.tempC, rh_pct: weather.now.rh, wind_kmh: weather.now.windKmh, gust_kmh: weather.now.gustKmh, wind_from: windDirLabel(weather.now.windDir) },
            suggestions: advice.suggestions.map((s) => ({
              setting: SETTINGS.find((x) => x.key === s.setting)?.label,
              currently: settingText(s.setting, baseOf(s.setting)),
              suggestion: directionWords(s.setting, s.direction),
              because: s.reasons.map((r) => r.text),
            })),
            later_today: advice.later.map((l) => l.text),
            notes: advice.notes.map((n) => n.text),
          }}
        />
      )}
      <p className="flex gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Starting suggestions for the operator to try on the monitor, one at a time, and check with a kill-stop and a loss check. Nothing is sent to the combine — the app does not talk to it.
        </span>
      </p>
      <HowWorkedOut />
    </div>
  )
}

const thicknessSummary = (t: Thickness) => ({
  peak_ndvi: +t.peak.mean.toFixed(2),
  peak_date: t.peak.date,
  heavy_share_pct: Math.round(t.heavyShare * 100),
  thin_share_pct: Math.round(t.thinShare * 100),
  measured_against: t.against === 'farm' ? `this crop's median on ${t.reference!.fields} fields` : "the field's own average",
  overall: t.overall,
  still_green: t.green,
})

const settingText = (s: AdviceSetting, b: { value: number | null; from: string }) => {
  if (b.value == null) return null
  const unit = SETTINGS.find((x) => x.key === s)?.unit ?? ''
  return MM_SETTINGS.includes(s) ? `${inchText(b.value)} in (${b.from})` : `${b.value} ${unit} (${b.from})`
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 p-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="mt-1 space-y-1 text-xs text-gray-700">{children}</div>
    </div>
  )
}

function ThicknessTile({ t, fieldId, cropName, swathed }: { t: Thickness | null; fieldId: string; cropName: string | null; swathed: boolean }) {
  const { data: pic } = useNdviPicture(fieldId, t?.peak.date ?? null)
  if (!t) return <Tile title="Crop thickness">No clear satellite look at this field this season.</Tile>
  const clear = t.peak.validFraction ?? 1
  const word = { heavy: 'Heavy', thin: 'Thin', average: 'Average', uneven: 'Uneven' }[t.overall]
  return (
    <Tile title="Crop thickness">
      <p className="text-sm font-semibold text-gray-900">{word}</p>
      {/* Heavy, average and thin as one bar: the share of the field in each. */}
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-100" aria-label="Share of the field thin, average and heavy">
        <span style={{ width: `${t.thinShare * 100}%`, background: NDVI_RAMP[1][1] }} />
        <span style={{ width: `${t.averageShare * 100}%`, background: NDVI_RAMP[3][1] }} />
        <span style={{ width: `${t.heavyShare * 100}%`, background: NDVI_RAMP[6][1] }} />
      </div>
      <p className="tabular-nums">
        {Math.round(t.thinShare * 100)}% thin · {Math.round(t.averageShare * 100)}% average · {Math.round(t.heavyShare * 100)}% heavy
      </p>
      <p className="text-[11px] text-gray-500">
        Peak NDVI {t.peak.mean.toFixed(2)} on {shortDate(t.peak.date)}
        {t.against === 'farm' ? `, against ${cropName ?? 'this crop'}’s median ${t.reference!.median.toFixed(2)} on ${t.reference!.fields} fields` : ', against its own average (too few fields of this crop to compare)'}
        {clear < 0.95 ? ` · ${Math.round(clear * 100)}% of the field clear of cloud` : ''}
      </p>
      {t.latest && t.latest.date !== t.peak.date && (
        <p className="text-[11px] text-gray-500">
          Latest {shortDate(t.latest.date)} ({t.latestAgeDays} d old): {t.latest.mean.toFixed(2)}
          {t.green === 'green' ? ' — still green' : t.green === 'some' ? ' — some green left' : t.green === 'ripe' ? ' — ripe' : swathed ? ' — swathed, not read' : ''}
          {(t.latest.validFraction ?? 1) < 0.95 ? ` · ${Math.round((t.latest.validFraction ?? 1) * 100)}% clear` : ''}
        </p>
      )}
      {pic && (
        <div className="flex items-end gap-2 pt-1">
          <img src={pic.url} alt={`NDVI of the field on ${pic.date}`} className="h-24 w-auto max-w-[60%] rounded border border-gray-200 bg-gray-50 object-contain" style={{ imageRendering: 'pixelated' }} />
          <span className="text-[10px] leading-tight text-gray-500">
            {shortDate(pic.date)}, this field’s own range: brown {pic.lo.toFixed(2)} → green {pic.hi.toFixed(2)}
          </span>
        </div>
      )}
    </Tile>
  )
}

const gradeCell = (bands: MoistureBands | null, v: number) => {
  const g = bands ? gradeFor(bands, v) : null
  return g ? GRADE_STYLE[g] : 'bg-gray-50 text-gray-700'
}

function MoistureTile({ m, bands, reason }: { m: { now: MoistureNow | null; next: MoistureHour[]; lastTest: { date: string; hour: number; pct: number } | null }; bands: MoistureBands | null; reason: string | null }) {
  const g = m.now && bands ? gradeFor(bands, m.now.pct) : null
  const lastAt = m.lastTest ? `${shortDate(m.lastTest.date)} ${hourLabel(`${m.lastTest.date}T${String(Math.floor(m.lastTest.hour)).padStart(2, '0')}:00`)}` : null
  return (
    <Tile title="Grain moisture">
      {m.now ? (
        <p className="text-sm font-semibold text-gray-900">
          {pct(m.now.pct)} <span className="text-xs font-normal text-gray-500">{m.now.source === 'test' ? 'tested' : 'model now'}</span>
          {g && <span className={cn('ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', GRADE_STYLE[g])}>{gradeLabel(g)}</span>}
        </p>
      ) : (
        <p>{reason ?? 'No reading yet.'}</p>
      )}
      {m.lastTest && m.now?.source !== 'test' && <p className="text-[11px] text-gray-500">Last test {pct(m.lastTest.pct)}, {lastAt}</p>}
      {bands && (
        <p className="text-[11px] text-gray-500">
          Dry ≤ {bands.dry_max}%{bands.tough_max != null && bands.tough_max > (bands.dry_max ?? 0) ? ` · tough ≤ ${bands.tough_max}%` : ''}
          {bands.dry_min != null ? ` · too dry < ${bands.dry_min}%` : ''}
        </p>
      )}
      {m.next.length > 0 && (
        <HourStrip
          cells={m.next.map((h) => ({ time: h.time, text: h.pct.toFixed(1), cls: gradeCell(bands, h.pct) }))}
          label="Next 12 hours, dry-down model"
        />
      )}
    </Tile>
  )
}

function WeatherTile({ w }: { w: { now: WxHour | null; next: WxHour[] } }) {
  const n = w.now
  if (!n) return <Tile title="Weather at the field">Forecast unavailable.</Tile>
  const spread = dewSpread(n)
  const firstDew = w.next.find((h) => (dewSpread(h) ?? 99) <= THRESHOLDS.dewSpreadC)
  return (
    <Tile title="Weather at the field">
      <p className="text-sm font-semibold text-gray-900 tabular-nums">
        {n.tempC != null ? `${Math.round(n.tempC)} °C` : '—'} · RH {n.rh != null ? `${Math.round(n.rh)}%` : '—'}
      </p>
      <p className="tabular-nums">
        Wind {n.windKmh != null ? Math.round(n.windKmh) : '—'} km/h {windDirLabel(n.windDir)}
        {n.gustKmh != null ? `, gusts ${Math.round(n.gustKmh)}` : ''} · dew pt {n.dewC != null ? `${Math.round(n.dewC)} °C` : '—'}
      </p>
      <p className="text-[11px] text-gray-500">
        {spread != null && spread <= THRESHOLDS.dewSpreadC ? 'Dew forming now.' : firstDew ? `Dew likely from about ${hourLabel(firstDew.time)}.` : 'No dew in the next 12 hours.'}
      </p>
      {w.next.length > 0 && (
        <HourStrip
          cells={w.next.map((h) => ({
            time: h.time,
            text: h.rh != null ? String(Math.round(h.rh)) : '—',
            cls:
              (dewSpread(h) ?? 99) <= THRESHOLDS.dewSpreadC
                ? 'bg-sky-100 text-sky-900'
                : (h.rh ?? 0) >= THRESHOLDS.rhDamp
                  ? 'bg-amber-100 text-amber-900'
                  : (h.rh ?? 100) < THRESHOLDS.rhDry
                    ? 'bg-orange-50 text-orange-900'
                    : 'bg-gray-50 text-gray-700',
          }))}
          label={`RH % by hour · amber ≥ ${THRESHOLDS.rhDamp}, blue dew, orange < ${THRESHOLDS.rhDry}`}
        />
      )}
    </Tile>
  )
}

/** Twelve hours in a row, each a small coloured cell, the hour under every third. */
function HourStrip({ cells, label }: { cells: { time: string; text: string; cls: string }[]; label: string }) {
  return (
    <div className="pt-1">
      <div className="grid grid-cols-12 gap-px text-center text-[9px] tabular-nums">
        {cells.map((c) => (
          <span key={c.time} title={`${hourLabel(c.time)}: ${c.text}`} className={cn('rounded-sm py-0.5', c.cls)}>
            {c.text}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-px text-center text-[9px] text-gray-400">
        {cells.map((c, i) => (
          <span key={c.time}>{i % 3 === 0 ? hourLabel(c.time).replace(' ', '') : ''}</span>
        ))}
      </div>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  )
}

function DirIcon({ d }: { d: Suggestion['direction'] }) {
  if (d === 'up') return <ArrowUp className="h-3.5 w-3.5 text-red-600" />
  if (d === 'down') return <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
  return <Minus className="h-3.5 w-3.5 text-gray-400" />
}

function Suggestions({ advice, baseOf }: { advice: Advice; baseOf: (s: AdviceSetting) => { value: number | null; from: string } }) {
  const any = advice.suggestions.some((s) => s.direction !== 'none')
  return (
    <div className="rounded-md border border-gray-200">
      <h3 className="border-b border-gray-100 px-2.5 py-1.5 text-xs font-semibold text-gray-900">
        Suggested starting adjustments
        <span className="ml-1 font-normal text-gray-500">— from the settings shown, one change at a time</span>
      </h3>
      <ul className="divide-y divide-gray-100">
        {advice.suggestions.map((s) => {
          const label = SETTINGS.find((x) => x.key === s.setting)?.label ?? s.setting
          const from = settingText(s.setting, baseOf(s.setting))
          return (
            <li key={s.setting} className="px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-sm">
                <DirIcon d={s.direction} />
                <span className="font-medium text-gray-900">{label}</span>
                <span className={cn('text-xs', s.direction === 'none' ? 'text-gray-400' : 'font-semibold text-gray-900')}>{directionWords(s.setting, s.direction)}</span>
                {from && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-400">{from}</span>}
              </div>
              {s.reasons.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 pl-5 text-[11px] text-gray-600">
                  {[...new Set(s.reasons.map((r) => r.text))].map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {!any && <p className="px-2.5 pb-2 text-[11px] text-gray-500">Nothing in the conditions asks for a change: start from the settings shown.</p>}
      {(advice.notes.length > 0 || advice.later.length > 0) && (
        <ul className="space-y-0.5 border-t border-gray-100 px-2.5 py-1.5 text-[11px] text-gray-700">
          {advice.notes.map((n) => (
            <li key={n.rule}>{n.text}</li>
          ))}
          {advice.later.map((l) => (
            <li key={l.rule}>
              <span className="font-semibold text-gray-500">Later: </span>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Claude's read of the same data: it may explain and order the rules' suggestions, never add settings. */
function AskClaude({ advice, payload }: { advice: Advice; payload: Record<string, unknown> }) {
  const [text, setText] = useState<string | null>(null)
  const ask = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/combine-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify(payload),
      })
      const j = (await res.json().catch(() => ({}))) as { advice?: string; error?: string }
      if (!res.ok || !j.advice) throw new Error(j.error ?? (res.ok ? 'No answer came back' : `No answer from the advice service (${res.status})`))
      return j.advice
    },
    onSuccess: setText,
  })
  if (!advice.fired.length) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => ask.mutate()}
        disabled={ask.isPending}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <Wand2 className="h-3.5 w-3.5" /> {ask.isPending ? 'Thinking…' : text ? 'Ask again' : 'Ask Claude what to try first'}
      </button>
      {ask.error && <p className="mt-1 text-xs text-red-700">{(ask.error as Error).message}</p>}
      {text && (
        <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-gray-800">
          {text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l, i) => (
              <li key={i} className={cn(/^[-•*]\s/.test(l) && 'ml-4 list-disc')}>
                {l
                  .replace(/^[-•*]\s+/, '')
                  .split(/(\*\*[^*]+\*\*)/g)
                  .map((part, k) => (part.startsWith('**') && part.endsWith('**') ? <b key={k}>{part.slice(2, -2)}</b> : <span key={k}>{part}</span>))}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

/** "Lowest loss in similar conditions: <settings> (<date>, <field>)": the farm's own checks, not a rule. */
function HistoryLine({ h, fieldName }: { h: LowestLoss; fieldName: (id: string | null) => string | null }) {
  const pct = h.best.loss_pct != null ? Number(h.best.loss_pct) : null
  const where = [new Date(h.best.checked_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }), fieldName(h.best.field_id)].filter(Boolean).join(', ')
  return (
    <p className="rounded-md border border-green-200 bg-green-50 px-2.5 py-2 text-xs text-green-900">
      <span className="font-semibold">Lowest loss in similar conditions: </span>
      {settingsLine(h.settings)} ({where}) — {pct != null ? `${pct.toFixed(1)}%` : `${Number(h.best.loss_bu_per_acre).toFixed(2)} bu/ac`} lost
      <span className="block text-[11px] text-green-800">
        From {h.similar} past check{h.similar === 1 ? "" : "s"} of this crop at similar grain moisture (the same band) and RH within {SIMILAR.rhPts} points. History, not a rule.
      </span>
    </p>
  )
}

function HowWorkedOut() {
  return (
    <Fold title="How these are worked out" storageKey="combine-conditions-how">
      <div className="space-y-2 text-[11px] text-gray-700">
        <p>
          Thickness is the season’s peak NDVI (a ripe crop reads low at harvest whatever it carried), split into thin, average and heavy by {THRESHOLDS.ndviMargin} either side of the crop’s median on
          the farm’s other fields, from the look’s p10, mean and p90. The latest look says how green it still is. Moisture is the meter test if it is under 1½ hours old, else the dry-down model.
          Weather is the forecast model at the field. Suggestions are directions from the saved settings: this year’s, else last year’s, else the book’s. Two rules pulling one setting both ways
          means hold it.
        </p>
        <ul className="space-y-1">
          {RULES.map((r) => (
            <li key={r.id}>
              <strong>{r.when}</strong> → {r.then}. <span className="text-gray-500">{r.sources.map((s) => SOURCE_LABELS[s]).join('; ')}.</span>
            </li>
          ))}
        </ul>
      </div>
    </Fold>
  )
}
