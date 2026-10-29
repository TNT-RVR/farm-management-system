import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ClipboardPaste, ImageUp, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { aboveGrain, differentBin, emcKind, flagsFor, moistureFor, type Level } from '@/lib/bin-monitor'
import {
  readCableScreenshot,
  useBinMonitorReadings,
  useDeleteBinMonitor,
  useSaveBinMonitor,
  type MonitorRow,
} from '@/lib/bin-monitor-data'
import { levelsToForm } from '@/lib/record-edits'
import { rowClick } from '@/components/RecordEditor'
import { cn } from '@/lib/utils'
import { askConfirm } from '@/components/askConfirm'
import { TABLE_HEAD } from '@/lib/table-style'

type Crop = { id: string; name: string; moisture_dry_max: number | string | null }

/**
 * Whoever took the reading, by name. It was their initials; a report that
 * says "DG" is no use to anybody reading it later (Sam, 27 Oct 2026). The
 * column still holds whatever is typed, so old initials stay as they are.
 */
const readerName = (name: string | null | undefined) => (name ?? '').trim()

const num = (s: string) => {
  const t = s.trim()
  if (!t) return null
  const v = Number(t.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

type RowIn = { temp: string; pct: string; air: boolean }
const blankRows = (n: number, air: boolean[] = []): RowIn[] => Array.from({ length: n }, (_, i) => ({ temp: '', pct: '', air: air[i] ?? false }))

/**
 * Bin monitoring for the bin view: readings down the sensor cable, what they
 * say about the grain, and a seed company's report where the farm has one
 * (behind its own switch; the readings stay either way).
 *
 * Readings come in two ways, both ending at the same form the person checks
 * before saving: typed from the Bin-Sense screen, or a screenshot of it pasted
 * or picked, which the model reads into the boxes.
 */
export function BinMonitoring({
  binId,
  binName,
  cropYear,
  crop,
  heldBu,
  capacityBu,
  lldDefault,
  canEdit,
}: {
  binId: string
  binName: string
  cropYear: number
  crop: Crop | null
  /** What is in the bin and what it holds, which say where the grain line is. */
  heldBu: number
  capacityBu: number
  lldDefault: string | null
  canEdit: boolean
}) {
  const { data: readings } = useBinMonitorReadings(binId)
  const del = useDeleteBinMonitor()
  const [adding, setAdding] = useState(false)
  // A saved reading opened to correct it (Sam, 7 Oct 2026).
  const [editing, setEditing] = useState<MonitorRow | null>(null)
  const dryMax = crop?.moisture_dry_max != null ? Number(crop.moisture_dry_max) : null
  const canola = emcKind(crop?.name) === 'canola'

  const latest = readings?.[0] ?? null
  const flags = latest ? flagsFor(crop?.name, latest.levels, readings?.[1]?.levels ?? null, dryMax) : []


  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bin monitoring</h3>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {canEdit && !adding && !editing && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 rounded-md bg-brand-700 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add reading
            </button>
          )}
        </div>
      </div>

      {adding && (
        <ReadingForm
          binId={binId}
          binName={binName}
          cropYear={cropYear}
          crop={crop}
          lldDefault={readings?.find((r) => r.lld)?.lld ?? lldDefault}
          lotDefault={readings?.find((r) => r.lot_number)?.lot_number ?? null}
          levelsDefault={Math.max(latest?.levels.length ?? 0, canola ? 6 : 5)}
          heldBu={heldBu}
          capacityBu={capacityBu}
          onDone={() => setAdding(false)}
        />
      )}
      {editing && (
        <ReadingForm
          key={editing.id}
          existing={editing}
          binId={binId}
          binName={binName}
          cropYear={editing.crop_year}
          crop={crop}
          lldDefault={editing.lld}
          lotDefault={editing.lot_number}
          levelsDefault={editing.levels.length}
          heldBu={heldBu}
          capacityBu={capacityBu}
          onDone={() => setEditing(null)}
        />
      )}

      {flags.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {flags.map((f, i) => (
            <p key={i} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0" /> Level {f.level}: {f.text}
            </p>
          ))}
        </div>
      )}

      {!readings?.length ? (
        !adding && <p className="text-xs text-gray-400">No readings yet.</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-md border border-gray-200">
          <table className="w-full text-xs">
            <thead className={cn(TABLE_HEAD, 'sticky top-0')}>
              <tr>
                <th className="px-2 py-1 font-medium">Date</th>
                {Array.from({ length: Math.max(...readings.map((r) => r.levels.length), 1) }, (_, i) => (
                  <th key={i} className="px-2 py-1 text-right font-medium">
                    {i === 0 ? '1 top' : i + 1}
                  </th>
                ))}
                <th className="px-2 py-1 font-medium">By</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {readings.map((r) => (
                <tr
                  key={r.id}
                  onClick={
                    canEdit
                      ? rowClick(() => {
                          setAdding(false)
                          setEditing(r)
                        })
                      : undefined
                  }
                  title={canEdit ? 'Open the reading to correct it' : (r.notes ?? undefined)}
                  className={cn('align-top', canEdit && 'cursor-pointer hover:bg-gray-50', editing?.id === r.id && 'bg-brand-50')}
                >
                  <td className="whitespace-nowrap px-2 py-1 text-gray-700">
                    {r.read_on}
                    {r.source === 'screenshot' && <span className="block text-[10px] text-gray-400">from screenshot</span>}
                  </td>
                  {Array.from({ length: Math.max(...readings.map((x) => x.levels.length), 1) }, (_, i) => {
                    const l = r.levels.find((x) => x.level === i + 1)
                    return (
                      <td key={i} className={cn('px-2 py-1 text-right tabular-nums', l?.air && 'text-gray-400')}>
                        {!l ? (
                          '—'
                        ) : (
                          <>
                            <span className="block text-gray-900">{l.moisture_pct != null ? `${l.moisture_pct}%` : '—'}</span>
                            <span className="block text-[10px] text-gray-500">
                              {l.temp_c != null ? `${l.temp_c}°` : ''}
                              {l.rh_pct != null ? ` · ${l.rh_pct}% RH` : ''}
                              {l.air ? ' · air' : ''}
                            </span>
                          </>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-gray-600">{r.initials ?? '—'}</td>{/* who read it */}
                  {canEdit && (
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        aria-label="Delete this reading"
                        onClick={async () => {
                          if (!(await askConfirm(`Delete the ${r.read_on} reading?`))) return
                          if (editing?.id === r.id) setEditing(null)
                          del.mutate(r.id)
                        }}
                        className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ReadingForm({
  existing,
  binId,
  binName,
  cropYear,
  crop,
  lldDefault,
  lotDefault,
  levelsDefault,
  heldBu,
  capacityBu,
  onDone,
}: {
  /** A saved reading to correct; saved over the same row. */
  existing?: MonitorRow
  binId: string
  binName: string
  cropYear: number
  crop: Crop | null
  lldDefault: string | null
  lotDefault: string | null
  levelsDefault: number
  heldBu: number
  capacityBu: number
  onDone: () => void
}) {
  const { profile } = useAuth()
  const save = useSaveBinMonitor()
  const del = useDeleteBinMonitor()
  const saved = existing ? levelsToForm(existing.levels) : null
  const [readOn, setReadOn] = useState(existing?.read_on ?? new Date().toLocaleDateString('en-CA'))
  const [initials, setInitials] = useState(existing ? (existing.initials ?? '') : readerName(profile?.full_name))
  const [lot, setLot] = useState(lotDefault ?? '')
  const [lld, setLld] = useState(lldDefault ?? '')
  const [mode, setMode] = useState<'rh' | 'moisture'>(saved?.mode ?? 'rh')
  // Where the grain line is, from what the app already knows is in the bin.
  const fillShare = capacityBu > 0 ? heldBu / capacityBu : null
  const fromBushels = (n: number) => aboveGrain(n, fillShare)
  const [rows, setRows] = useState<RowIn[]>(saved?.rows ?? blankRows(levelsDefault, fromBushels(levelsDefault)))
  /** Set when the app ticked the headspace sensors itself, so it can say so. */
  const [airFrom, setAirFrom] = useState<'bushels' | 'screenshot' | null>(existing ? null : fromBushels(levelsDefault).some(Boolean) ? 'bushels' : null)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  // One fan on the bottom blows the whole bin, so this is one switch for the
  // reading, not one a level (Sam, 27 Oct 2026).
  const [aeration, setAeration] = useState(existing?.aeration_on ?? false)
  const [source, setSource] = useState<'manual' | 'screenshot'>((existing?.source as 'manual' | 'screenshot' | undefined) ?? 'manual')
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<string | null>(null)
  /** The bin named on the screenshot, when it is not this one. */
  const [wrongBin, setWrongBin] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const levels: Level[] = useMemo(
    () =>
      rows.map((r, i) => {
        const temp = num(r.temp)
        const pct = num(r.pct)
        if (mode === 'moisture') {
          return { level: i + 1, temp_c: temp, rh_pct: null, moisture_pct: pct, moisture_from: pct != null ? 'sensor' : null, air: r.air }
        }
        const m = moistureFor(crop?.name, pct, temp)
        return { level: i + 1, temp_c: temp, rh_pct: pct, moisture_pct: m?.value ?? null, moisture_from: m?.from ?? null, air: r.air }
      }),
    [rows, mode, crop],
  )
  // Only the sensors in the grain are saved (Sam, 27 Oct 2026: "I dont want
  // it submitting the temp and moisture for the cable levels above the grain").
  // Numbered afresh, so level 1 is the top of the GRAIN, not the top of the cable.
  const inGrain: Level[] = useMemo(() => levels.filter((l) => !l.air).map((l, i) => ({ ...l, level: i + 1 })), [levels])
  const skipped = levels.length - inGrain.length
  const filled = inGrain.some((l) => l.temp_c != null || l.rh_pct != null || l.moisture_pct != null)

  const readImage = async (file: Blob) => {
    setReading(true)
    setReadNote(null)
    setWrongBin(null)
    try {
      const r = await readCableScreenshot(file)
      if (!r.levels.length) {
        setReadNote(r.note || 'No sensors could be read off that screenshot. Type them in.')
        return
      }
      // Sensors in the headspace are ticked off, so they are not saved as a
      // reading of the grain (Sam, 27 Oct 2026). The screenshot wins where it
      // found the grain line itself — it can see where the colour stops; the
      // bushels answer only where it could not tell.
      const sawLine = r.levels.some((l) => l.above_grain)
      const guess = sawLine ? r.levels.map((l) => !!l.above_grain) : fromBushels(r.levels.length)
      setAirFrom(guess.some(Boolean) ? (sawLine ? 'screenshot' : 'bushels') : null)
      setRows(r.levels.map((l, i) => ({ temp: l.temp_c != null ? String(l.temp_c) : '', pct: l.pct != null ? String(l.pct) : '', air: guess[i] })))
      if (r.percent_kind !== 'unknown') setMode(r.percent_kind)
      setSource('screenshot')
      const parts = [
        `Read ${r.levels.length} sensor${r.levels.length === 1 ? '' : 's'}`,
        r.bin_name ? `from ${r.bin_name}` : null,
        r.percent_kind === 'moisture'
          ? '— the % looks like grain moisture Bin-Sense worked out, so it is used as moisture'
          : r.percent_kind === 'rh'
            ? '— the % looks like relative humidity'
            : '— could not tell whether the % is humidity or moisture; set it below',
      ].filter(Boolean)
      if (differentBin(r.bin_name, binName)) setWrongBin(r.bin_name)
      const warn = [
        r.confidence !== 'high' ? 'not a confident read' : null,
        r.note ? r.note.trim().replace(/[.\s]+$/, '') : null,
      ].filter(Boolean)
      setReadNote(`${parts.join(' ')}. Check every number before saving.${warn.length ? ` Note: ${warn.join('; ')}.` : ''}`)
    } catch (e) {
      setReadNote((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  // Paste a screenshot anywhere while the form is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) {
        e.preventDefault()
        void readImage(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (i: number, patch: Partial<RowIn>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const inputCls = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm'

  return (
    <div
      ref={boxRef}
      className="mb-3 space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'))
        if (f) void readImage(f)
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">
          {existing ? `Reading of ${existing.read_on}` : 'New reading'} — {binName}
        </p>
        <button type="button" onClick={onDone} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gray-300 bg-white px-3 py-2 text-xs text-gray-600">
        {reading ? <Loader2 className="h-4 w-4 animate-spin text-brand-700" /> : <ClipboardPaste className="h-4 w-4 text-gray-400" />}
        <span>{reading ? 'Reading the screenshot…' : 'Paste a sensor-cable screenshot (Ctrl+V), drop it here, or'}</span>
        <button
          type="button"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <ImageUp className="h-3.5 w-3.5" /> pick one
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void readImage(f)
            e.target.value = ''
          }}
        />
      </div>
      {wrongBin && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="min-w-0 flex-1 basis-48">
            <b>That screenshot says {wrongBin}, and this is {binName}.</b> Check you picked the right bin in Bin-Sense before you save, or close this and add
            the reading to the other bin.
          </p>
          <button type="button" onClick={() => setWrongBin(null)} className="rounded-md border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100">
            It is the right bin
          </button>
        </div>
      )}
      {readNote && <p className="rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900">{readNote}</p>}

      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs text-gray-600">
          Date
          <input type="date" value={readOn} onChange={(e) => setReadOn(e.target.value)} className={cn(inputCls, 'mt-1')} />
        </label>
        <label className="text-xs text-gray-600">
          Read by
          <input value={initials} onChange={(e) => setInitials(e.target.value)} placeholder="Who took the reading" className={cn(inputCls, 'mt-1')} />
        </label>
        <label className="text-xs text-gray-600">
          Lot #
          <input value={lot} onChange={(e) => setLot(e.target.value)} className={cn(inputCls, 'mt-1')} />
        </label>
        <label className="text-xs text-gray-600">
          LLD
          <input value={lld} onChange={(e) => setLld(e.target.value)} placeholder="NE 12-40-27 W4" className={cn(inputCls, 'mt-1')} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700">
        <span className="text-gray-500">The % on the cable is</span>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'rh'} onChange={() => setMode('rh')} /> relative humidity
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'moisture'} onChange={() => setMode('moisture')} /> grain moisture
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-1 py-1 font-medium">Level</th>
              <th className="px-1 py-1 font-medium">Temp °C</th>
              <th className="px-1 py-1 font-medium">{mode === 'rh' ? 'RH %' : 'Moisture %'}</th>
              <th className="px-1 py-1 text-right font-medium">Moisture</th>
              <th className="px-1 py-1 font-medium" title="The sensor is in the headspace, not buried in the grain. Left out of the reading.">Above grain</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const l = levels[i]
              const outside = mode === 'rh' && l.temp_c != null && l.rh_pct != null && l.moisture_pct == null
              return (
                <tr key={i}>
                  <td className="px-1 py-0.5 text-gray-600">{i === 0 ? '1 (top)' : i === rows.length - 1 ? `${i + 1} (bottom)` : i + 1}</td>
                  <td className="px-1 py-0.5">
                    <input inputMode="decimal" value={r.temp} onChange={(e) => set(i, { temp: e.target.value })} className={cn(inputCls, 'w-20 text-right')} />
                  </td>
                  <td className="px-1 py-0.5">
                    <input inputMode="decimal" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} className={cn(inputCls, 'w-20 text-right')} />
                  </td>
                  <td className="px-1 py-0.5 text-right tabular-nums">
                    {l.moisture_pct != null ? (
                      <span className="font-semibold text-gray-900">
                        {l.moisture_pct}%
                        {mode === 'rh' && moistureFor(crop?.name, l.rh_pct, l.temp_c)?.outside && (
                          <span className="block text-[10px] font-normal text-amber-700" title="Outside the temperatures this crop's equation was fitted over">
                            estimate
                          </span>
                        )}
                      </span>
                    ) : outside ? (
                      <span className="text-[10px] text-amber-700">outside the table</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-1 py-0.5 text-center">
                    <input type="checkbox" checked={r.air} onChange={(e) => set(i, { air: e.target.checked })} aria-label={`Level ${i + 1} is above the grain, leave it out`} />
                  </td>
                  <td className="px-1 py-0.5 text-right">
                    {rows.length > 1 && (
                      <button type="button" aria-label="Remove level" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-0.5 text-gray-300 hover:text-red-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length < 16 && (
          <button type="button" onClick={() => setRows((rs) => [...rs, { temp: '', pct: '', air: false }])} className="mt-1 text-xs text-brand-700 hover:underline">
            + add a level
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={aeration} onChange={(e) => setAeration(e.target.checked)} className="h-4 w-4" />
        The fan has been running since the last reading
      </label>
      {skipped > 0 && (
        <p className="text-xs text-gray-500">
          {skipped} sensor{skipped === 1 ? '' : 's'} above the grain {skipped === 1 ? 'is' : 'are'} left out: {skipped === 1 ? 'it is' : 'they are'} reading the air, not the
          grain. Untick one to keep it.
          {airFrom === 'bushels' && fillShare != null && (
            <>
              {' '}
              Ticked from the bushels: {Math.round(heldBu).toLocaleString('en-CA')} bu in a {Math.round(capacityBu).toLocaleString('en-CA')} bu bin fills it about{' '}
              {Math.round(fillShare * 100)}% of the way up.
            </>
          )}
          {airFrom === 'screenshot' && ' Ticked from the grain line on the screenshot.'}
        </p>
      )}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (smell, crusting…)" className={inputCls} />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!filled || save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: existing?.id,
                bin_id: binId,
                crop_year: cropYear,
                // A correction keeps the crop it was taken against, unless there was none.
                crop_id: existing?.crop_id ?? crop?.id ?? null,
                read_on: readOn,
                lot_number: lot.trim() || null,
                lld: lld.trim() || null,
                initials: initials.trim() || null,
                levels: inGrain,
                source,
                aeration_on: aeration,
                notes: notes.trim() || null,
              },
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Save reading'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-sm text-gray-600">
          Cancel
        </button>
        {existing && (
          <button
            type="button"
            disabled={del.isPending}
            onClick={async () => {
              if (await askConfirm(`Delete the ${existing.read_on} reading?`)) del.mutate(existing.id, { onSuccess: onDone })
            }}
            className="ml-auto flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
      </div>
      {save.error && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
      {del.error && <p className="text-xs text-red-700">{(del.error as Error).message}</p>}
    </div>
  )
}
