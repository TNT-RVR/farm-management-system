import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useTab } from '@/lib/useTab'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Droplet, Eye, Trash2 } from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useFields } from '@/lib/queries'
import { useLossFieldDefaults } from '@/lib/combine-field'
import { LossTrend } from '@/pages/combine/LossTrend'
import { MonitorFilesTab } from '@/pages/combine/MonitorFilesTab'
import { MonitorSetupGuide } from '@/pages/combine/MonitorSetupGuide'
import { PUBLIC_COPY } from '@/config/edition'
import { StartFieldCard } from '@/pages/combine/StartFieldCard'
import { LossSnapshotCard } from '@/pages/combine/LossSnapshotCard'
import { WhatWorked } from '@/pages/combine/WhatWorked'
import { FieldFinishedForm } from '@/components/FieldFinishedForm'
import { useLossSnapshot } from '@/lib/combine-loss-snapshot'
import { settingsLine, settingText, settingValue } from '@/lib/combine-setting-text'
import { weatherLine, type WorkWeather } from '@/lib/field-work'
import { useEquipment } from '@/lib/equipment'
import { ConditionsAdvice } from '@/pages/combine/ConditionsAdvice'
import { cn } from '@/lib/utils'
import {
  CROP_BASELINES,
  SEED_DEFAULTS,
  SETTINGS,
  SYMPTOMS,
  judgeLoss,
  lossFromPan,
  lossValue,
  recomputeLossCheck,
  type CombineCropKey,
  type SettingKey,
  DROP_PAN,
  DISCHARGE,
  LOSS_HEADER,
  type DischargeMode,
  seedsFromGrams,
  lossCheckMode,
} from '@/lib/combine'
import {
  useCombineSettings,
  useDeleteLossCheck,
  useLossChecks,
  usePreviousCombineSettings,
  useSaveCombineSettings,
  useSaveLossCheck,
  useUpdateLossCheck,
  type LossCheckRow,
} from '@/lib/combine-queries'
import { Modal } from '@/components/Modal'
import { DeleteButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import {
  CORN_CONVERSION,
  HAND_EXAMPLE,
  INDICATORS,
  LOSS_FORMULAS,
  LOSS_SITES,
  MANUAL_NOTES,
  NH_MANUAL,
  ROTOR_IN,
  inchFraction,
  inchText,
  parseInches,
  manualCaveat,
  manualFor,
  startingPoints,
  type ManualRow,
} from '@/lib/combine-manual'
import { askConfirm } from '@/components/askConfirm'
import { CARD_HEAD, TABLE_HEAD } from '@/lib/table-style'

type Tab = 'setup' | 'fix' | 'loss' | 'book' | 'monitor'
const TAB_KEYS: Tab[] = ['setup', 'fix', 'loss', 'book', 'monitor']

/** Settings the monitor shows in inches, so the fraction is worth printing. */
const IN_INCHES: SettingKey[] = ['concave_mm', 'presieve_mm', 'chaffer_mm', 'sieve_mm']

const SOURCES = [
  { value: 'unknown', label: 'Not worked out yet' },
  { value: 'rotor', label: 'Rotor / separator' },
  { value: 'shoe', label: 'Shoe / sieves' },
  { value: 'header', label: 'Header' },
]

/**
 * Setting the farm's combines (its model on Farm setup, CR9090 by default),
 * and finding out what they are throwing over the back.
 *
 * Four tabs in the order the day goes: start the crop, fix what you see, count
 * what it costs, look something up.
 *
 * "What each setting does" was a fifth tab; every word of it is the ⓘ beside
 * each setting on Starting settings, so old links to it land there. The
 * Moisture tab was the 919 tester, which lives on Harvest › Moisture; an old
 * ?tab=moisture link (the Moisture Test tile) goes there.
 */
export function CombinePage() {
  const { search } = useLocation()
  if (new URLSearchParams(search).get('tab') === 'moisture') {
    return <Navigate to="/harvest?tab=moisture" replace />
  }
  return <CombineView />
}

function CombineView() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const canEdit = hasManagerAccess(profile?.role)
  // ?tab= lands on one, so a tile or a link can open straight on it, and the
  // tab is remembered so a refresh lands on it too.
  const [asked, setTab] = useTab<Tab>('combine', TAB_KEYS, 'setup', (asked) =>
    asked === 'reference' ? 'setup' : undefined,
  )
  const [crop, setCrop] = useState<CombineCropKey>('canola')
  const [finishing, setFinishing] = useState(false)
  // The farm's combines are whatever Equipment lists as one; a farm runs more
  // than one, so the title names each model once (Sam, 29 Oct 2026).
  const { data: fleet } = useEquipment()
  const combineModels = [
    ...new Set((fleet ?? []).filter((e) => /combine/i.test(e.equipment_type ?? '') && e.model).map((e) => e.model!.trim())),
  ]
  const combineModel = combineModels.join(', ')
  // The manual typed in is New Holland's CR book, so its tab only means
  // something on a CR; any other machine lands on Starting settings instead.
  const isCR = combineModels.some(isCRSeries)
  const tab = asked === 'book' && !isCR ? 'setup' : asked

  const baseline = CROP_BASELINES.find((c) => c.key === crop)!

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Combine{combineModel ? ` · ${combineModel}` : ''}</h1>
      <HelpNote
        className="mb-3"
        summary={
          <>
            Twin rotor, {ROTOR_IN} in. <BookBadge /> = the operator’s manual.
          </>
        }
        title="Where the starting points come from"
      >
        Twin rotor, {ROTOR_IN} in. Starting points marked <BookBadge /> are the operator’s manual’s
        for this rotor; the rest are our estimate. Either way, save what the machine actually ran
        at.
      </HelpNote>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PillTabs
          tabs={[
            { key: 'setup', label: 'Starting settings' },
            { key: 'fix', label: 'What do I change?' },
            { key: 'loss', label: 'Loss check' },
            ...(isCR ? [{ key: 'book' as const, label: 'From the manual' }] : []),
            { key: 'monitor', label: 'Monitor files' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab !== 'monitor' && (
          <Select
            value={crop}
            ariaLabel="Crop"
            className="w-40"
            onChange={(v) => setCrop(v as CombineCropKey)}
            options={CROP_BASELINES.map((c) => ({ value: c.key, label: c.label }))}
          />
        )}
        {/* The 919 is on Harvest; the reading gets taken at the combine, so
            the way there is one tap from here. */}
        <Link
          to="/harvest?tab=moisture"
          className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-700"
        >
          <Droplet className="h-3.5 w-3.5" /> Moisture test
        </Link>
        {profile?.active && (
          <button
            type="button"
            onClick={() => setFinishing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
          >
            <CheckCircle2 className="h-4 w-4" /> Field finished
          </button>
        )}
      </div>
      {finishing && <FieldFinishedForm onClose={() => setFinishing(false)} />}

      {tab === 'setup' && (
        <div className="space-y-4">
          {/* Cards for the field at hand, side by side on a wide screen: Start a
              field, and room for one more (e.g. weather / crop advice). */}
          <div className="grid gap-4 lg:grid-cols-2">
            <StartFieldCard cropYear={cropYear} canEdit={canEdit} onCrop={setCrop} />
            <ConditionsAdvice cropYear={cropYear} onCropChange={setCrop} />
          </div>
          <WhatWorked crop={crop} />
          <SetupTab crop={crop} cropYear={cropYear} canEdit={canEdit} showBook={isCR} />
        </div>
      )}
      {tab === 'fix' && <FixTab crop={crop} />}
      {/* Anyone active may record, correct or delete a loss check — the
          table's own rule (write_all) — not only a manager. */}
      {tab === 'loss' && <LossTab crop={crop} cropYear={cropYear} canEdit={Boolean(profile?.active)} onCropChange={setCrop} />}
      {tab === 'book' && <BookTab crop={crop} />}
      {/* The combine display's files: boundaries, names, what each combine has.
          Built for one make of display, so the public copy asks for the
          farm's combine and hands their AI assistant the job instead. */}
      {tab === 'monitor' && (PUBLIC_COPY ? <MonitorSetupGuide /> : <MonitorFilesTab cropYear={cropYear} canEdit={canEdit} />)}

      {tab !== 'monitor' && (
        <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <strong>{baseline.label}:</strong> {baseline.note}
        </p>
      )}
    </div>
  )
}

/** Starting numbers, last year's numbers, and this year's saved numbers. */
function SetupTab({
  crop,
  cropYear,
  canEdit,
  showBook,
}: {
  crop: CombineCropKey
  cropYear: number
  canEdit: boolean
  showBook: boolean
}) {
  const baseline = CROP_BASELINES.find((c) => c.key === crop)!
  const starts = startingPoints(crop)
  const caveat = manualCaveat(crop)
  const { data: saved } = useCombineSettings(cropYear)
  const { data: previous } = usePreviousCombineSettings(cropYear)
  const save = useSaveCombineSettings(cropYear)

  const mine = saved?.find((r) => r.crop_key === crop) ?? null
  const last = previous?.find((r) => r.crop_key === crop) ?? null
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string>>>({})
  const [notes, setNotes] = useState<string | null>(null)

  // Whatever is on screen: what has been typed, else what is saved, else the
  // starting point. Typing does not commit until Save, so a half-entered
  // number never becomes this year's record.
  // The four openings are kept in mm but shown and typed in inches, as the
  // monitor shows them — fractions, to the sixteenth.
  const asText = (k: SettingKey, v: number | null | undefined): string => (v == null ? '' : IN_INCHES.includes(k) ? inchText(Number(v)) : String(v))
  const toValue = (k: SettingKey, raw: string): number | null => (raw.trim() === '' ? null : IN_INCHES.includes(k) ? parseInches(raw) : Number(raw))
  const shown = (k: SettingKey): string => {
    if (draft[k] !== undefined) return draft[k]!
    return asText(k, mine?.[k])
  }

  const dirty = Object.keys(draft).length > 0 || notes !== null

  const commit = () => {
    const values: Partial<Record<SettingKey, number | null>> = {}
    for (const s of SETTINGS) {
      values[s.key] = toValue(s.key, shown(s.key))
    }
    save.mutate(
      { crop_key: crop, values, notes: notes ?? mine?.notes ?? null },
      {
        onSuccess: () => {
          setDraft({})
          setNotes(null)
        },
      },
    )
  }

  const fillFrom = (src: 'baseline' | 'last') => {
    const next: Partial<Record<SettingKey, string>> = {}
    for (const s of SETTINGS) {
      const v = src === 'baseline' ? baseline.start[s.key] : last?.[s.key]
      next[s.key] = asText(s.key, v)
    }
    setDraft(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => fillFrom('baseline')}
          disabled={!canEdit}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Fill with starting points
        </button>
        {last && (
          <button
            onClick={() => fillFrom('last')}
            disabled={!canEdit}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Fill with {last.crop_year}
          </button>
        )}
        {dirty && canEdit && (
          <button
            onClick={commit}
            disabled={save.isPending}
            className="ml-auto rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : `Save ${cropYear} settings`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-3 py-2 font-medium">Setting</th>
              <th className="px-3 py-2 text-right font-medium">Start here</th>
              <th className="px-3 py-2 text-right font-medium">
                {last ? last.crop_year : 'Last year'}
              </th>
              <th className="px-3 py-2 text-right font-medium">{cropYear} — what we ran</th>
              <th className="px-3 py-2 font-medium">Usual range</th>
            </tr>
          </thead>
          <tbody>
            {SETTINGS.map((s) => {
              const [lo, hi] = baseline.range[s.key]
              const val = shown(s.key)
              const n = toValue(s.key, val)
              const outside = n != null && Number.isFinite(n) && (n < lo || n > hi)
              return (
                <tr key={s.key} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 font-medium text-gray-900">
                      {s.label}
                      <InfoPopover title={`${s.label} (${s.unit})`}>
                        <p className="mb-2">{s.does}</p>
                        <p className="mb-1">
                          <strong>Too much:</strong> {s.tooHigh}
                        </p>
                        <p>
                          <strong>Too little:</strong> {s.tooLow}
                        </p>
                      </InfoPopover>
                    </span>
                    <span className="block text-xs text-gray-400">{s.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {asText(s.key, starts[s.key].value)}
                    {starts[s.key].source === 'manual' && <BookBadge />}
                    {IN_INCHES.includes(s.key) && <span className="block text-[11px] text-gray-400">{starts[s.key].value} mm</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {last?.[s.key] != null ? asText(s.key, Number(last[s.key])) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type={IN_INCHES.includes(s.key) ? 'text' : 'number'}
                      inputMode="decimal"
                      disabled={!canEdit}
                      value={val}
                      placeholder={asText(s.key, starts[s.key].value)}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      className={cn(
                        'w-24 rounded-md border px-2 py-1 text-right text-sm tabular-nums',
                        // Flagged, not blocked. Outside the usual range is
                        // where a machine sometimes has to run.
                        outside ? 'border-amber-500 bg-white' : 'border-gray-200 bg-white',
                      )}
                    />
                    {/* Typed as a fraction ("15/16", "1 1/8"); the mm under it is what is kept. */}
                    {IN_INCHES.includes(s.key) && n != null && Number.isFinite(n) && (
                      <span className="block text-[11px] text-gray-400">{n} mm</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 tabular-nums">
                    {IN_INCHES.includes(s.key) ? `${inchText(lo)}–${inchText(hi)}` : `${lo}–${hi}`}
                    {outside && (
                      <span className="ml-1 text-amber-700" title="Outside the usual range">
                        ⚠
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* The caveat is about this crop's numbers, so it stays in view. */}
      {caveat && <p className="text-[11px] text-amber-800">{caveat}</p>}
      <HelpNote
        summary={
          showBook
            ? 'Feeder drum, DSP speed and concave type are under From the manual.'
            : 'Where the starting numbers come from.'
        }
        title="About these settings"
      >
        <p>
          <BookBadge /> = the operator’s manual, {ROTOR_IN} in rotor column.
          {caveat ? ` ${caveat}` : ''} Setting names on the monitor: concave opening, sieve upper,
          sieve lower.
          {showBook &&
            ' Feeder drum, DSP speed, concave type and returns cover are on the “From the manual” tab.'}
        </p>
      </HelpNote>

      <label className="block text-xs text-gray-500">
        Notes on {cropYear} {CROP_BASELINES.find((c) => c.key === crop)!.label.toLowerCase()}
        <textarea
          disabled={!canEdit}
          rows={2}
          value={notes ?? mine?.notes ?? ''}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Tough straw until 11, dropped the fan 50 in the afternoon…"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>
      {save.error && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
    </div>
  )
}

/** Symptom in, ordered changes out. */
function FixTab({ crop }: { crop: CombineCropKey }) {
  const [open, setOpen] = useState<string | null>(null)
  // Crop-specific warnings first — the sainfoin plugging entry is worth more to
  // somebody in sainfoin than the generic list order suggests.
  const ordered = useMemo(
    () =>
      [...SYMPTOMS].sort(
        (a, b) =>
          Number(b.crops?.includes(crop) ?? false) - Number(a.crops?.includes(crop) ?? false),
      ),
    [crop],
  )

  return (
    <div className="space-y-2">
      <HelpNote summary="One change at a time, then look again." title="Why one at a time">
        One change at a time, then look again. Four settings changed at once teaches you nothing
        about which one mattered, and two of them were probably pulling against each other.
      </HelpNote>
      {ordered.map((sym) => {
        const isOpen = open === sym.key
        return (
          <div key={sym.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <button
              onClick={() => setOpen(isOpen ? null : sym.key)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              {sym.label}
              {sym.crops?.includes(crop) && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                  watch in {crop}
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400">{isOpen ? 'Hide' : 'Fix it'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-3 py-3">
                <p className="mb-3 flex gap-2 rounded-md bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
                  <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Make sure first: </strong>
                    {sym.confirm}
                  </span>
                </p>
                <ol className="space-y-2">
                  {sym.fixes.map((f, i) => {
                    const setting = SETTINGS.find((s) => s.key === f.setting)
                    return (
                      <li key={i} className="flex gap-2.5 text-sm">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                          {i + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium text-gray-900">
                            {f.direction === 'up' && (
                              <ArrowUp className="mr-1 inline h-3.5 w-3.5 text-red-600" />
                            )}
                            {f.direction === 'down' && (
                              <ArrowDown className="mr-1 inline h-3.5 w-3.5 text-blue-600" />
                            )}
                            {f.direction === 'check' && (
                              <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
                            )}
                            {setting?.label ?? (f.setting === 'header' ? 'Header' : 'Check')}
                            {f.direction !== 'check' && (
                              <>
                                {' '}
                                {f.direction} by {f.step}
                              </>
                            )}
                            {f.direction === 'check' && <> — {f.step}</>}
                          </span>
                          <span className="block text-xs text-gray-600">{f.why}</span>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Drop a pan, count what is in it, find out what it costs.
 *
 * The one loss check. The Calculator view showed this same component as a tab
 * of its own; it links here now, because this copy also carries the crop's
 * note and sits beside the settings the check is meant to judge.
 */
function LossTab({
  crop,
  cropYear,
  canEdit,
  onCropChange,
}: {
  crop: CombineCropKey
  cropYear: number
  canEdit: boolean
  /** Picking a field switches the page to its crop. */
  onCropChange: (c: CombineCropKey) => void
}) {
  const baseline = CROP_BASELINES.find((c) => c.key === crop)!
  const spec = SEED_DEFAULTS[crop]
  const { data: fields } = useFields()
  const { data: checks } = useLossChecks(cropYear)
  const saveCheck = useSaveLossCheck(cropYear)
  const del = useDeleteLossCheck()
  const [openCheck, setOpenCheck] = useState<string | null>(null)
  const opened = checks?.find((c) => c.id === openCheck) ?? null

  // Blank means "use what the field and crop give": yield, price, acres,
  // seed weight and lb/bu only hold what someone typed over the default.
  const [form, setForm] = useState({
    grams: '',
    pan: String(DROP_PAN.sqFt),
    header: String(LOSS_HEADER.ft),
    discharge: String(DISCHARGE.spreader.ft),
    tkw: '',
    lbBu: '',
    yieldBu: '',
    price: '',
    acres: '',
    fieldId: '',
    zoneId: '',
    source: 'unknown',
    notes: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const fieldDefaults = useLossFieldDefaults(form.fieldId, cropYear, form.zoneId || null)
  // The combine, operator, settings and moisture at the time, kept with the check.
  const snap = useLossSnapshot({ fieldId: form.fieldId, cropKey: crop, cropYear, checks: checks ?? [] })
  const { data: equipment } = useEquipment(false)
  const machineName = (id: string | null) => (id ? (equipment?.find((e) => e.id === id)?.name ?? 'a combine') : null)
  const chooseField = (id: string) => {
    // A new field (or crop area) brings its own yield, price and acres.
    setForm((f) => ({ ...f, fieldId: id, zoneId: '', yieldBu: '', price: '', acres: '', tkw: '', lbBu: '' }))
  }
  const chooseArea = (id: string) => setForm((f) => ({ ...f, zoneId: id, yieldBu: '', price: '', acres: '', tkw: '', lbBu: '' }))
  const fieldCrop = fieldDefaults?.cropKey ?? null
  useEffect(() => {
    if (fieldCrop && fieldCrop !== crop) onCropChange(fieldCrop)
  }, [fieldCrop, crop, onCropChange])
  const [panKind, setPanKind] = useState<'bushel' | 'hand' | 'other'>('bushel')
  const choosePan = (k: 'bushel' | 'hand' | 'other') => {
    setPanKind(k)
    if (k === 'bushel') set('pan', String(DROP_PAN.sqFt))
    if (k === 'hand') set('pan', String(HAND_EXAMPLE.handSqFt))
  }
  // What the sum uses: what was typed, else the field's or the crop's figure.
  const fmt = (v: number | null | undefined, d: number) => (v == null ? '' : String(Math.round(v * 10 ** d) / 10 ** d))
  const eff = {
    tkw: form.tkw || String(spec.gramsPer1000),
    lbBu: form.lbBu || String(spec.lbPerBushel),
    yieldBu: form.yieldBu || fmt(fieldDefaults?.yieldBu, 1),
    price: form.price || fmt(fieldDefaults?.priceBu, 2),
    acres: form.acres || fmt(fieldDefaults?.acres, 1),
  }
  // Spreader or dropped: sets the spread the pan's count is averaged over.
  const [mode, setMode] = useState<DischargeMode>('spreader')
  const chooseMode = (m: DischargeMode) => {
    setMode(m)
    set('discharge', String(DISCHARGE[m].ft))
  }
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v))

  // Weighed, not counted: the seed count is only the route through the sum.
  const seeds = seedsFromGrams(num(form.grams), num(eff.tkw))
  const gramsPerSqFt = num(form.pan) > 0 ? num(form.grams) / num(form.pan) : 0
  const result = lossFromPan({
    seeds,
    panAreaSqFt: num(form.pan),
    headerFt: num(form.header),
    dischargeFt: num(form.discharge),
    spec: { lbPerBushel: num(eff.lbBu), gramsPer1000: num(eff.tkw) },
    yieldBuPerAcre: eff.yieldBu ? num(eff.yieldBu) : null,
  })
  const money = lossValue(
    result.buPerAcre,
    eff.price ? num(eff.price) : null,
    eff.acres ? num(eff.acres) : null,
  )
  const verdict = judgeLoss(result.pctOfYield, baseline.targetLossPct)
  const fieldName = (id: string | null) => fields?.find((f) => f.id === id)?.name ?? '—'

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h3 className={cn('font-medium', CARD_HEAD)}>How to take the sample</h3>
          <div className="p-3">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-gray-600">
            <li>Combine at working speed in a steady part of the field, then stop.</li>
            <li>
              Slide the pan under the machine behind the shoe and rotors, back up over it, or drop
              it while moving — whatever the pan is built for.
            </li>
            <li>Clean the chaff off what is in it and weigh the grain, in grams.</li>
            <li>
              To separate rotor from shoe loss, run with the chopper off: grain under the straw row
              is the rotor, grain out in the chaff is the shoe.
            </li>
          </ol>

          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
          <label className="block text-xs font-medium text-gray-700">
            1. Field
            <Select
              value={form.fieldId}
              ariaLabel="Field"
              className="mt-1"
              placeholder="Choose the field"
              onChange={chooseField}
              options={(fields ?? []).map((f) => ({ value: f.id, label: f.name }))}
            />
          </label>
          {fieldDefaults && fieldDefaults.areas.length > 1 && (
            <label className="block text-xs font-medium text-gray-700">
              Which crop area?
              <Select
                value={fieldDefaults.areaId ?? ''}
                ariaLabel="Crop area"
                className="mt-1"
                onChange={chooseArea}
                options={fieldDefaults.areas.map((a) => ({ value: a.id, label: `${a.cropName}${a.acres != null ? ` · ${a.acres} ac` : ''}` }))}
              />
            </label>
          )}
          {fieldDefaults && (
            <p className="-mt-1 text-[11px] text-gray-500">
              {fieldDefaults.cropName ?? `No ${cropYear} crop planned`}
              {eff.yieldBu && ` · ${eff.yieldBu} bu/ac`}
              {eff.price && ` · $${eff.price}/bu`}
              {eff.acres && ` · ${eff.acres} ac`}
              {fieldDefaults.yieldFrom && !form.yieldBu && <span className="block text-gray-400">Yield from {fieldDefaults.yieldFrom}.</span>}
            </p>
          )}
          <label className="block text-xs font-medium text-gray-700">
            2. Pan
            <Select
              value={panKind}
              ariaLabel="Pan"
              className="mt-1"
              onChange={(v) => choosePan(v as 'bushel' | 'hand' | 'other')}
              options={[
                { value: 'bushel', label: `${DROP_PAN.name} (${DROP_PAN.sqFt} sq ft)` },
                { value: 'hand', label: `No pan, under a spread hand (${HAND_EXAMPLE.handSqFt} sq ft)` },
                { value: 'other', label: 'Another pan…' },
              ]}
            />
          </label>
          {panKind === 'other' && <Field label="Pan area (sq ft)" value={form.pan} onChange={(v) => set('pan', v)} />}
          <div>
            <p className="text-xs font-medium text-gray-700">3. Swath: dropped or spread?</p>
            <div role="radiogroup" aria-label="Chaff out the back" className="mt-1 flex rounded-md border border-gray-200 bg-white p-0.5 text-xs">
              {(Object.keys(DISCHARGE) as DischargeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => chooseMode(m)}
                  className={cn('flex-1 rounded px-2 py-1 font-semibold', mode === m ? 'bg-brand-700 text-white' : 'text-gray-500 hover:bg-gray-50')}
                >
                  {DISCHARGE[m].label} · {DISCHARGE[m].ft} ft
                </button>
              ))}
            </div>
          </div>
          <Field
            label="4. Grain in the pan (g)"
            value={form.grams}
            onChange={(v) => set('grams', v)}
            hint="Clean the chaff off and weigh just the grain."
          />
        </div>

        {form.fieldId && canEdit && <LossSnapshotCard s={snap} />}

        {/* The machine and the crop's seed — set once and left. Folded with
            the values in the title, so what the sum is using is still in view. */}
        <Fold
          title="Adjust defaults"
          summary={`${form.header || '?'} ft header · ${form.discharge || '?'} ft spread · ${eff.lbBu} lb/bu · ${eff.tkw} g/1000`}
          storageKey="combine-loss-defaults"
          bodyClassName="space-y-2"
        >
          <Field
            label="Header width (ft)"
            value={form.header}
            onChange={(v) => set('header', v)}
            hint={Number(form.header) === LOSS_HEADER.ft ? LOSS_HEADER.label : undefined}
          />
          <Field
            label="Discharge spread (ft)"
            value={form.discharge}
            onChange={(v) => set('discharge', v)}
            hint={`How wide the straw and chaff land — not the header. ${DISCHARGE.spreader.ft} ft through the spreader, ${DISCHARGE.windrow.ft} ft dropped.`}
          />
          <Field label="Yield (bu/ac)" value={form.yieldBu} placeholder={eff.yieldBu} onChange={(v) => set('yieldBu', v)} hint="From the field; type to change it for this check." />
          <Field label="Price ($/bu)" value={form.price} placeholder={eff.price} onChange={(v) => set('price', v)} />
          <Field label="Field acres" value={form.acres} placeholder={eff.acres} onChange={(v) => set('acres', v)} />
          <Field
            label="Seed weight (g/1000)"
            value={form.tkw}
            placeholder={String(spec.gramsPer1000)}
            onChange={(v) => set('tkw', v)}
            hint={`Default for ${baseline.label.toLowerCase()}. The loss comes from the weight, so this only matters for a counted check.`}
          />
          <Field label="lb per bushel" value={form.lbBu} placeholder={String(spec.lbPerBushel)} onChange={(v) => set('lbBu', v)} />
        </Fold>
      </div>

      <div className="space-y-3">
        <div
          className={cn(
            'rounded-lg border p-4',
            verdict === 'high'
              ? 'border-red-300 bg-red-50'
              : verdict === 'watch'
                ? 'border-amber-300 bg-amber-50'
                : 'border-green-300 bg-green-50',
          )}
        >
          <p className="text-3xl font-bold tabular-nums text-gray-900">
            {result.buPerAcre.toFixed(2)}{' '}
            <span className="text-base font-medium text-gray-600">bu/ac lost</span>
          </p>
          <p className="mt-1 text-sm text-gray-700">
            {result.pctOfYield != null ? (
              <>
                <strong>{result.pctOfYield.toFixed(1)}%</strong> of the crop — target for{' '}
                {baseline.label.toLowerCase()} is {baseline.targetLossPct}%.{' '}
                {verdict === 'good'
                  ? 'Below where it pays to chase it. A combine set for no loss at all is a combine going too slowly.'
                  : verdict === 'watch'
                    ? 'Worth a look, not worth stopping the day for.'
                    : 'Worth stopping for.'}
              </>
            ) : (
              'Enter a yield to see this as a share of the crop.'
            )}
          </p>
          <p className="mt-2 text-xs text-gray-600">
            {gramsPerSqFt.toFixed(2)} g/sq ft in the pan ·{' '}
            {num(form.header) > 0 ? (gramsPerSqFt * (num(form.discharge) / num(form.header))).toFixed(2) : '0.00'} g/sq ft averaged over the {form.header || '?'} ft cut
            {money.perAcre != null && (
              <>
                {' · '}${money.perAcre.toFixed(2)}/ac
                {money.total != null && (
                  <> · ${Math.round(money.total).toLocaleString()} over the field</>
                )}
              </>
            )}
          </p>
        </div>

        {canEdit && (
          <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-gray-500">
                Coming from
                <Select
                  value={form.source}
                  ariaLabel="Where the loss is coming from"
                  className="mt-1"
                  onChange={(v) => set('source', v)}
                  options={SOURCES}
                />
              </label>
              <label className="text-xs text-gray-500">
                Note
                <input
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="after dropping fan to 600"
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              disabled={!form.grams || !form.fieldId || saveCheck.isPending}
              onClick={() =>
                saveCheck.mutate(
                  {
                    crop_key: crop,
                    field_id: form.fieldId || null,
                    grain_grams: num(form.grams),
                    discharge_mode: mode,
                    zone_id: fieldDefaults?.areaId ?? null,
                    seeds: Number(seeds.toFixed(1)),
                    pan_area_sqft: num(form.pan),
                    header_ft: num(form.header),
                    discharge_ft: num(form.discharge),
                    grams_per_1000: num(eff.tkw),
                    lb_per_bushel: num(eff.lbBu),
                    yield_bu_per_acre: eff.yieldBu ? num(eff.yieldBu) : null,
                    loss_bu_per_acre: Number(result.buPerAcre.toFixed(4)),
                    loss_pct: result.pctOfYield,
                    source: form.source as 'rotor' | 'shoe' | 'header' | 'unknown',
                    notes: form.notes || null,
                    ...snap.snapshot,
                  },
                  { onSuccess: () => set('grams', '') },
                )
              }
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {saveCheck.isPending ? 'Saving…' : 'Save this check'}
            </button>
            {saveCheck.error && (
              <p className="text-xs text-red-700">{(saveCheck.error as Error).message}</p>
            )}
          </div>
        )}

        <LossTrend checks={checks ?? []} crop={crop} fieldId={form.fieldId} fieldName={fieldName} />

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h3 className={cn('font-medium', CARD_HEAD)}>
            {cropYear} checks
          </h3>
          {!checks?.length ? (
            <p className="px-3 py-3 text-xs text-gray-500">
              Nothing recorded yet. The comparison is the useful part — the same crop before and
              after a change.
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto text-sm">
              {checks.map((c) => (
                <li
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50"
                  onClick={rowClick(() => setOpenCheck(c.id))}
                >
                  <span className="w-20 shrink-0 text-xs text-gray-500">
                    {new Date(c.checked_at).toLocaleDateString('en-CA', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <strong className="tabular-nums">
                        {Number(c.loss_bu_per_acre).toFixed(2)}
                      </strong>{' '}
                      bu/ac
                      {c.loss_pct != null && (
                        <span className="text-gray-500"> · {Number(c.loss_pct).toFixed(1)}%</span>
                      )}
                      <span className="text-gray-500">
                        {' '}
                        · {c.crop_key}
                        {c.field_id ? ` · ${fieldName(c.field_id)}` : ''}
                        {` · ${lossCheckMode(c) === 'windrow' ? 'dropped' : 'spread'}`}
                      </span>
                    </span>
                    {settingsLine(c, ['rotor_rpm', 'concave_mm', 'fan_rpm', 'chaffer_mm', 'sieve_mm', 'ground_speed_mph']) && (
                      <span className="block truncate text-[11px] text-gray-400">{settingsLine(c, ['rotor_rpm', 'concave_mm', 'fan_rpm', 'chaffer_mm', 'sieve_mm', 'ground_speed_mph'])}</span>
                    )}
                    {(c.notes || (c.source && c.source !== 'unknown')) && (
                      <span className="block truncate text-xs text-gray-400">
                        {c.source && c.source !== 'unknown' ? `${c.source} · ` : ''}
                        {c.notes}
                      </span>
                    )}
                  </span>
                  {canEdit && (
                    <button
                      onClick={async () => {
                        if (await askConfirm(`Delete the ${Number(c.loss_bu_per_acre).toFixed(2)} bu/ac check of ${checkDate(c.checked_at)}?`)) del.mutate(c.id)
                      }}
                      className="shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete this check"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {opened && <LossCheckDetail check={opened} fieldName={fieldName} machineName={machineName} fields={fields ?? []} canEdit={canEdit} onClose={() => setOpenCheck(null)} />}
    </div>
  )
}

const checkDate = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * One saved loss check in full — what was counted and over what, as well as
 * the answer — with Edit and Delete (Sam, 7 Oct 2026). Correcting a count
 * works the answer out again from the check's own seed weight, so the stored
 * figure stays the one the inputs give.
 */
function LossCheckDetail({
  check: c,
  fieldName,
  machineName,
  fields,
  canEdit,
  onClose,
}: {
  check: LossCheckRow
  fieldName: (id: string | null) => string
  machineName: (id: string | null) => string | null
  fields: { id: string; name: string }[]
  canEdit: boolean
  onClose: () => void
}) {
  const update = useUpdateLossCheck()
  const del = useDeleteLossCheck()
  const [editing, setEditing] = useState(false)
  const n = (v: number | null, d = 1) => (v == null ? null : Number(v).toLocaleString('en-CA', { maximumFractionDigits: d }))
  const editFields: EditField[] = [
    { key: 'checked_on', label: 'Date', kind: 'date', required: true },
    { key: 'field_id', label: 'Field', kind: 'select', options: [{ value: '', label: '—' }, ...fields.map((f) => ({ value: f.id, label: f.name }))] },
    { key: 'source', label: 'Coming from', kind: 'select', options: SOURCES },
    c.grain_grams != null
      ? { key: 'grain_grams', label: 'Grain in the pan (g)', kind: 'number', step: 'any', required: true }
      : { key: 'seeds', label: 'Seeds counted', kind: 'number', required: true },
    { key: 'pan_area_sqft', label: 'Pan area (sq ft)', kind: 'number', step: 'any', required: true },
    { key: 'header_ft', label: 'Header width (ft)', kind: 'number', required: true },
    { key: 'discharge_ft', label: 'Discharge spread (ft)', kind: 'number', required: true },
    { key: 'grams_per_1000', label: 'Seed weight (g/1000)', kind: 'number', step: 'any' },
    { key: 'lb_per_bushel', label: 'lb per bushel', kind: 'number', step: 'any' },
    { key: 'yield_bu_per_acre', label: 'Yield (bu/ac)', kind: 'number', step: 'any' },
    // The settings snapshot, correctable; openings typed in inches as on the display.
    { key: 'operator', label: 'Operator', kind: 'text' },
    ...SETTINGS.map((s): EditField => ({ key: `set_${s.key}`, label: `${s.label} (${s.unit})`, kind: 'text', placeholder: IN_INCHES.includes(s.key) ? 'e.g. 1 1/8' : undefined })),
    { key: 'moisture_pct', label: 'Grain moisture (%)', kind: 'number', step: 'any' },
    { key: 'notes', label: 'Note', kind: 'textarea' },
  ]
  const wx = c.weather as unknown as WorkWeather | null
  const ranLine = settingsLine(c)
  return (
    <Modal title={`Loss check — ${checkDate(c.checked_at)}`} onClose={onClose} wide>
      <DetailList
        rows={[
          ['Lost', `${Number(c.loss_bu_per_acre).toFixed(2)} bu/ac${c.loss_pct != null ? ` · ${Number(c.loss_pct).toFixed(1)}% of the crop` : ''}`],
          ['Crop', CROP_BASELINES.find((b) => b.key === c.crop_key)?.label ?? c.crop_key],
          ['Field', c.field_id ? fieldName(c.field_id) : null],
          ['Coming from', c.source && c.source !== 'unknown' ? (SOURCES.find((s) => s.value === c.source)?.label ?? c.source) : null],
          ['Combine', machineName(c.equipment_id) ?? c.machine],
          ['Operator', c.operator],
          ['Settings', ranLine || null],
          ['Settings from', c.settings_from],
          ['Header type', c.header_type],
          ['Grain moisture', c.moisture_pct != null ? `${Number(c.moisture_pct).toFixed(1)}%${c.moisture_from ? ` (${c.moisture_from})` : ''}` : null],
          ['Weather', weatherLine(wx)],
          ['Weather from', c.weather_source],
          c.grain_grams != null ? ['Grain in the pan', `${n(c.grain_grams, 2)} g`] : ['Seeds counted', n(c.seeds, 0)],
          ['Pan area', `${n(c.pan_area_sqft, 3)} sq ft`],
          ['Header', `${n(c.header_ft)} ft`],
          ['Discharge spread', `${n(c.discharge_ft)} ft · ${lossCheckMode(c) === 'windrow' ? 'dropped' : 'through the spreader'}`],
          ['Seed weight', c.grams_per_1000 != null ? `${n(c.grams_per_1000, 2)} g/1000` : null],
          ['lb per bushel', n(c.lb_per_bushel)],
          ['Yield', c.yield_bu_per_acre != null ? `${n(c.yield_bu_per_acre)} bu/ac` : null],
          ['Checked', new Date(c.checked_at).toLocaleString('en-CA')],
          ['Note', c.notes],
        ]}
      />
      {canEdit && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <DeleteButton
            disabled={del.isPending}
            onDelete={() => del.mutate(c.id, { onSuccess: onClose })}
            confirm={`Delete the ${Number(c.loss_bu_per_acre).toFixed(2)} bu/ac check of ${checkDate(c.checked_at)}?`}
          />
          <EditButton
            onClick={() => {
              update.reset()
              setEditing(true)
            }}
          />
        </div>
      )}
      {del.isError && <p className="mt-2 text-xs text-red-700">{(del.error as Error).message}</p>}
      {editing && (
        <RecordEditModal
          title={`Loss check — ${checkDate(c.checked_at)}`}
          fields={editFields}
          row={
            {
              ...c,
              checked_on: new Date(c.checked_at).toLocaleDateString('en-CA'),
              ...Object.fromEntries(SETTINGS.map((s) => [`set_${s.key}`, settingText(s.key, c[s.key] == null ? null : Number(c[s.key]))])),
            } as unknown as Record<string, unknown>
          }
          onClose={() => setEditing(false)}
          onSave={(p) => {
            const num = (k: string) => (p[k] as number | null) ?? null
            // A weighed check keeps its weight; its seed count follows it.
            const grams = c.grain_grams != null ? (num('grain_grams') ?? 0) : null
            const tkw = num('grams_per_1000') ?? SEED_DEFAULTS[c.crop_key as CombineCropKey]?.gramsPer1000 ?? 0
            const counted = {
              grain_grams: grams,
              seeds: grams != null ? Number(seedsFromGrams(grams, tkw).toFixed(1)) : (num('seeds') ?? 0),
              pan_area_sqft: num('pan_area_sqft') ?? 0,
              header_ft: num('header_ft') ?? 0,
              discharge_ft: num('discharge_ft') ?? 0,
              grams_per_1000: num('grams_per_1000'),
              lb_per_bushel: num('lb_per_bushel'),
              yield_bu_per_acre: num('yield_bu_per_acre'),
            }
            // A moved date keeps the time of day the check was taken.
            const day = String(p.checked_on)
            const was = new Date(c.checked_at)
            const checkedAt = day === was.toLocaleDateString('en-CA') ? c.checked_at : new Date(`${day}T${was.toTimeString().slice(0, 8)}`).toISOString()
            return update.mutateAsync({
              id: c.id,
              patch: {
                ...counted,
                ...recomputeLossCheck({ crop_key: c.crop_key, ...counted }),
                checked_at: checkedAt,
                field_id: (p.field_id as string | null) ?? null,
                source: ((p.source as string | null) ?? 'unknown') as LossCheckRow['source'],
                notes: (p.notes as string | null) ?? null,
                operator: ((p.operator as string | null) ?? '').trim().slice(0, 80) || null,
                moisture_pct: num('moisture_pct'),
                ...(num('moisture_pct') !== (c.moisture_pct == null ? null : Number(c.moisture_pct)) ? { moisture_from: num('moisture_pct') == null ? null : 'corrected by hand' } : {}),
                ...Object.fromEntries(SETTINGS.map((s) => [s.key, settingValue(s.key, String(p[`set_${s.key}`] ?? ''))])),
              },
            })
          }}
          saving={update.isPending}
          error={update.error ? (update.error as Error).message : null}
        />
      )}
    </Modal>
  )
}

/** The New Holland CR manual applies: the farm's combine is a CR-series model. */
const isCRSeries = (model: string) => /^CR/i.test(model.trim())

/** Marks a number as the operator's manual's rather than ours. */
function BookBadge() {
  return (
    <span
      title={`New Holland CR operator’s manual, ${ROTOR_IN} in rotor`}
      className="ml-1 inline-block rounded bg-brand-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-brand-700 align-middle"
    >
      book
    </span>
  )
}

const MM = (mm: number) => (
  <>
    {inchFraction(mm)} <span className="text-gray-400">({mm} mm)</span>
  </>
)

/** One manual row laid out as the book lays it out, in words. */
function ManualRowCard({ row, caveat }: { row: ManualRow; caveat: string | null }) {
  const rotor = ROTOR_IN === 22 ? row.rotor22 : row.rotor17
  const other = ROTOR_IN === 22 ? row.rotor17 : row.rotor22
  const cells: [string, ReactNode][] = [
    ['Feeder front drum', String(row.feederDrum)],
    ['DSP speed (if equipped)', `${row.dspRpm} rpm`],
    [`Rotor speed, ${ROTOR_IN} in`, <>{rotor} rpm <span className="text-gray-400">({other} on the {ROTOR_IN === 22 ? 17 : 22} in)</span></>],
    ['Configuration', row.configuration],
    ['Concave clearance', MM(row.concaveMm)],
    ['Concave type', <>{row.concaveType}{row.halfWires ? <span className="text-gray-500"> — intermediate wires out, half needed</span> : null}</>],
    ['Concave extension', row.extension],
    ['Cleaning fan', `${row.fanRpm} rpm`],
    ['Returns cover', row.returnsCover],
    ['Rotor cover vanes', row.vanesFront ? `front ${row.vanesFront.toLowerCase()}, rear ${row.vanesRear?.toLowerCase()}` : '—'],
    ['Pre-sieve', MM(row.presieveMm)],
    ['Upper sieve extension', row.upperExtMm == null ? 'Graepel extension' : MM(row.upperExtMm)],
    ['Upper sieve', MM(row.upperMm)],
    ['Lower sieve', MM(row.lowerMm)],
  ]
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h3 className={cn('font-medium', CARD_HEAD)}>
        Book row: {row.name} <BookBadge />
      </h3>
      <div className="p-3">
      {caveat && <p className="mt-0.5 text-xs text-amber-800">{caveat}</p>}
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {cells.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-gray-100 py-1">
            <dt className="text-gray-500">{k}</dt>
            <dd className="text-right tabular-nums text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      </div>
    </div>
  )
}

/** The pages of the operator's manual that matter, for the crop on screen. */
function BookTab({ crop }: { crop: CombineCropKey }) {
  const row = manualFor(crop)
  const caveat = manualCaveat(crop)
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<'corn' | 'loss' | 'read' | null>(null)
  const toggle = (k: 'corn' | 'loss' | 'read') => setOpen(open === k ? null : k)

  return (
    <div className="space-y-3">
      <HelpNote summary="New Holland CR operator’s manual, section 6." title="Where this comes from">
        New Holland CR operator’s manual, section 6 “Working operations”, typed in from the printed
        pages. Ours have {ROTOR_IN} in rotors, so that rotor column is the one shown first.
      </HelpNote>

      {row ? (
        <ManualRowCard row={row} caveat={caveat} />
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {caveat ?? 'The book has no row for this crop.'}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <h3 className={cn('font-medium', CARD_HEAD)}>Configurations and footnotes</h3>
        <div className="p-3">
        <ul className="mt-1 space-y-1.5 text-xs text-gray-700">
          {MANUAL_NOTES.map((n) => (
            <li key={n.title}>
              <strong>{n.title}.</strong> {n.body}
            </li>
          ))}
        </ul>

        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex w-full items-center px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Every crop in the book
          <span className="ml-auto text-xs text-gray-400">{showAll ? 'Hide' : 'Show'}</span>
        </button>
        {showAll && (
          <div className="overflow-x-auto border-t border-gray-100">
            <table className="w-full text-xs">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="px-2 py-1.5 font-medium">Crop</th>
                  <th className="px-2 py-1.5 text-right font-medium">Drum</th>
                  <th className="px-2 py-1.5 text-right font-medium">DSP</th>
                  <th className="px-2 py-1.5 text-right font-medium">Rotor {ROTOR_IN} in</th>
                  <th className="px-2 py-1.5 text-right font-medium">Concave</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Ext</th>
                  <th className="px-2 py-1.5 text-right font-medium">Fan</th>
                  <th className="px-2 py-1.5 font-medium">Returns</th>
                  <th className="px-2 py-1.5 text-right font-medium">Pre</th>
                  <th className="px-2 py-1.5 text-right font-medium">Upper ext</th>
                  <th className="px-2 py-1.5 text-right font-medium">Upper</th>
                  <th className="px-2 py-1.5 text-right font-medium">Lower</th>
                </tr>
              </thead>
              <tbody>
                {NH_MANUAL.map((r) => (
                  <tr
                    key={r.name}
                    className={cn(
                      'border-t border-gray-100 tabular-nums',
                      r.app === crop && 'bg-brand-50 font-medium',
                    )}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.name}</td>
                    <td className="px-2 py-1.5 text-right">{r.feederDrum}</td>
                    <td className="px-2 py-1.5 text-right">{r.dspRpm}</td>
                    <td className="px-2 py-1.5 text-right">{ROTOR_IN === 22 ? r.rotor22 : r.rotor17}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{inchText(r.concaveMm)}</td>
                    <td className="px-2 py-1.5">{r.concaveType}{r.halfWires ? '¹' : ''}</td>
                    <td className="px-2 py-1.5">{r.extension}</td>
                    <td className="px-2 py-1.5 text-right">{r.fanRpm}</td>
                    <td className="px-2 py-1.5">{r.returnsCover}</td>
                    <td className="px-2 py-1.5 text-right">{inchText(r.presieveMm)}</td>
                    <td className="px-2 py-1.5 text-right">{r.upperExtMm == null ? 'Graepel' : inchText(r.upperExtMm)}</td>
                    <td className="px-2 py-1.5 text-right">{inchText(r.upperMm)}</td>
                    <td className="px-2 py-1.5 text-right">{inchText(r.lowerMm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-2 py-1.5 text-[11px] text-gray-500">
              Concave and sieves in inches (the manual gives mm). ¹ intermediate concave wires out, only half needed.
            </p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          onClick={() => toggle('loss')}
          className="flex w-full items-center px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Where the loss is coming from
          <span className="ml-auto text-xs text-gray-400">{open === 'loss' ? 'Hide' : 'Show'}</span>
        </button>
        {open === 'loss' && (
          <div className="space-y-2 border-t border-gray-100 px-3 py-3 text-sm">
            <ol className="space-y-1.5">
              {LOSS_SITES.map((l) => (
                <li key={l.n} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                    {l.n}
                  </span>
                  <span>
                    <span className="font-medium text-gray-900">{l.where}.</span>{' '}
                    <span className="text-xs text-gray-600">{l.means}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="rounded-md bg-gray-50 px-2.5 py-2 text-xs text-gray-800">
              <strong>{LOSS_FORMULAS.total}</strong>
              <br />
              {LOSS_FORMULAS.functional}
            </p>
            <p className="text-xs text-gray-600">
              <strong>The book’s hand rule.</strong> A {Math.round(HAND_EXAMPLE.headerFt)} ft header
              in {HAND_EXAMPLE.yieldKgHa.toLocaleString()} kg/ha wheat, straw laid in a 1 m swath: 1 %
              loss is 50 kg/ha, which is {HAND_EXAMPLE.grainsPerSqM} grains in a square metre of
              swath, or about {HAND_EXAMPLE.grainsUnderHand} under a spread hand (
              {HAND_EXAMPLE.handSqM} m²). The Loss check tab does the same sum with our own header
              and swath widths — press “count under a spread hand” there.
            </p>
            <p className="text-xs text-amber-800">
              Chopper and spreader drives off before checking behind the machine. Flying objects.
            </p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          onClick={() => toggle('read')}
          className="flex w-full items-center px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Reading the machine: tank sample, sieves, returns
          <span className="ml-auto text-xs text-gray-400">{open === 'read' ? 'Hide' : 'Show'}</span>
        </button>
        {open === 'read' && (
          <div className="space-y-3 border-t border-gray-100 px-3 py-3">
            {INDICATORS.map((g) => (
              <div key={g.title}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {g.title}
                </h4>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">
                  {g.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          onClick={() => toggle('corn')}
          className="flex w-full items-center px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Changing from grain to corn
          {crop === 'corn' && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
              this crop
            </span>
          )}
          <span className="ml-auto text-xs text-gray-400">{open === 'corn' ? 'Hide' : 'Show'}</span>
        </button>
        {open === 'corn' && (
          <div className="space-y-2 border-t border-gray-100 px-3 py-3">
            {CORN_CONVERSION.map((g) => (
              <div key={g.group}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {g.group}
                </h4>
                <ul className="mt-0.5 space-y-0.5 text-xs text-gray-700">
                  {g.items.map((it) => (
                    <li key={it.action} className="flex justify-between gap-2">
                      <span>{it.action}</span>
                      <span className="shrink-0 text-gray-400">{it.ref}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-[11px] text-gray-500">
              Page numbers are the manual’s. Going back to grain is the same list in reverse, plus
              the humped grain pan insert back in.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  hint,
  autoFocus,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  autoFocus?: boolean
  /** The default that applies while the box is blank. */
  placeholder?: string
}) {
  return (
    <label className="block text-xs text-gray-500">
      <span className="flex items-baseline justify-between gap-2">
        {label}
        <input
          type="number"
          inputMode="decimal"
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums text-gray-900"
        />
      </span>
      {hint && <span className="mt-0.5 block text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
}
