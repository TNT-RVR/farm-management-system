import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, RefreshCw, Upload, Usb } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { Modal } from '@/components/Modal'
import { DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { useBrand } from '@/lib/farm-setup'
import { farmDay } from '@/lib/harvest-date'
import { downloadCsv } from '@/hooks/useExport'
import { downloadBlob, tableReportToPdf } from '@/lib/table-report'
import { fileOf, reportCsv, reportTable } from '@/lib/reports/framework'
import { fieldNameReport, fieldsFor, makeBoundaryFiles, makeBoundaryZip, type Which } from '@/lib/reports/combine-monitor'
import { canSaveToFolder, pickFolder, writeFilesToFolder } from '@/lib/save-to-folder'
import {
  CHANGE_LABELS,
  COPY_STEPS,
  LOAD_STEPS,
  MONITOR_INFO_KEYS,
  MONITOR_NAME_MAX,
  changeSummary,
  lineTypeNote,
  loadableChanges,
  monitorHeadline,
  monitorInfoOf,
  type FieldChange,
  type MonitorInfo,
  type SnapshotField,
} from '@/lib/combine-monitor'
import type { CombineState } from '@/lib/combine-monitor-state'
import {
  useCombineCrops,
  useCombineStates,
  useMarkLoaded,
  useMonitorFields,
  useRefreshGuidanceLines,
  useSaveMonitorInfo,
  useSaveMonitorOverride,
  useSaveMonitorSettings,
  useSetCropOnCombines,
  type MonitorField,
  type MonitorFieldList,
} from '@/lib/combine-monitor-data'
import { useCropYear } from '@/lib/crop-year'
import { cn } from '@/lib/utils'

/**
 * Combine → Monitor files: the files the combine display reads off a stick,
 * and what each combine was last loaded with. Boundaries as shapefiles for
 * Import2, the names to create on the display, each combine's display record,
 * and a badge when a combine is behind the app. The steps live in the two
 * folds and in the ZIP's README.
 */

/** The last ZIP made on this device, so "Mark loaded" is one tap. */
type LastDownload = { at: string; fields: SnapshotField[] }
const LAST_KEY = 'combine-monitor:last-download'

function readLast(): LastDownload | null {
  try {
    const v = localStorage.getItem(LAST_KEY)
    const p = v ? (JSON.parse(v) as LastDownload) : null
    return p && Array.isArray(p.fields) ? p : null
  } catch {
    return null
  }
}
function writeLast(d: LastDownload) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(d))
  } catch {
    // Private window: marking falls back to "every field as it is now".
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
const shortTime = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const INFO_FIELDS: EditField[] = [
  { key: 'display', label: 'Display', kind: 'text', placeholder: 'e.g. IntelliView IV' },
  { key: 'software', label: 'Display software', kind: 'text', placeholder: 'e.g. V30.26' },
  { key: 'framework', label: 'Framework', kind: 'text' },
  { key: 'precision_farming', label: 'Precision Farming', kind: 'text' },
  { key: 'yield_monitor', label: 'Yield Monitor', kind: 'text' },
  { key: 'combine_controller', label: 'Combine CX/CR', kind: 'text' },
  { key: 'vehicle_name', label: 'Vehicle name on the display', kind: 'text', hint: 'The name the other combine picks under Import → Vehicle Name.' },
  {
    key: 'interface_level',
    label: 'Interface Level',
    kind: 'select',
    options: [
      { value: '', label: '—' },
      { value: 'Advanced', label: 'Advanced' },
      { value: 'Basic', label: 'Basic (USB locked)' },
    ],
  },
  { key: 'checked_on', label: 'Read off the display on', kind: 'date' },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
]

const INFO_LABELS: Record<(typeof MONITOR_INFO_KEYS)[number], string> = Object.fromEntries(INFO_FIELDS.map((f) => [f.key, f.label])) as Record<(typeof MONITOR_INFO_KEYS)[number], string>

export function MonitorFilesTab({ cropYear, canEdit }: { cropYear: number; canEdit: boolean }) {
  const fieldsQ = useMonitorFields(cropYear)
  const statesQ = useCombineStates(cropYear)
  const brand = useBrand()
  const [last, setLast] = useState<LastDownload | null>(readLast)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [usb] = useState(canSaveToFolder)

  const list = fieldsQ.data
  // "Mark loaded" with no download to hand: every field on the combines (or not planned yet), as it is now.
  const everyField = useMemo(() => (list?.fields ?? []).filter((f) => f.hasBoundary && f.snapshot.status !== 'off').map((f) => f.snapshot), [list])
  const states = statesQ.data ?? []

  /**
   * Put these fields' files on the stick (the person picks it in the folder
   * chooser) or download them as a ZIP, and remember them for "Mark loaded".
   */
  const download = async (fields: MonitorField[], to: 'usb' | 'zip' = usb ? 'usb' : 'zip') => {
    setError(null)
    setSaved(null)
    try {
      const opts = { cropYear, today: farmDay(new Date().toISOString()), appName: brand.appName }
      let loaded: SnapshotField[]
      if (to === 'usb') {
        // The chooser must open straight from the tap, before any waiting.
        const dir = await pickFolder('combine-usb')
        if (!dir) return
        if (dir.name.toLowerCase() === 'shapefile') throw new Error('That’s the Shapefile folder. Pick the USB stick itself: the files go at its top level.')
        setBusy(true)
        const made = await makeBoundaryFiles(fields, opts)
        await writeFilesToFolder(dir, made.files)
        loaded = made.loaded
        setSaved(`Saved ${loaded.length} field${loaded.length === 1 ? '' : 's'} to ${dir.name}: the Shapefile folder and README.txt. Eject the stick before you pull it out.`)
      } else {
        setBusy(true)
        const zip = await makeBoundaryZip(fields, opts)
        const f = fileOf(zip.data, zip.filename, 'application/zip')
        downloadBlob(f.blob, f.filename)
        loaded = zip.loaded
      }
      const d = { at: new Date().toISOString(), fields: loaded }
      writeLast(d)
      setLast(d)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const downloadChanges = (changes: FieldChange[]) => {
    const ids = new Set(loadableChanges(changes).map((c) => c.fieldId))
    void download((list?.fields ?? []).filter((f) => ids.has(f.id)))
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && (
        <p className="flex items-start gap-1.5 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {saved}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">Combines</h2>
        {statesQ.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {statesQ.error && <p className="text-sm text-red-700">{messageOf(statesQ.error)}</p>}
        {!statesQ.isLoading && !states.length && !statesQ.error && (
          <p className="text-sm text-gray-500">No combine in the fleet. Machines come from Equipment.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {states.map((s) => (
            <CombineCard key={s.machine.id} state={s} canEdit={canEdit} last={last} everyField={everyField} busy={busy || !list} usb={usb} onDownloadChanges={downloadChanges} />
          ))}
        </div>
      </section>

      {fieldsQ.error && <p className="text-sm text-red-700">{messageOf(fieldsQ.error)}</p>}
      {list && (
        <BoundariesCard
          key={cropYear}
          list={list}
          fields={list.fields}
          cropYear={cropYear}
          canEdit={canEdit}
          busy={busy}
          usb={usb}
          onDownload={(f, to) => void download(f, to)}
          onNames={async (format, which) => {
            setError(null)
            try {
              const r = fieldNameReport(list, cropYear, which)
              if (format === 'CSV') downloadCsv(reportCsv(r), r.filename)
              else downloadBlob(await tableReportToPdf(reportTable(r)), `${r.filename}.pdf`)
            } catch (e) {
              setError(messageOf(e))
            }
          }}
          after={canEdit && last && states.length ? <MarkAfterDownload last={last} states={states} /> : null}
        />
      )}

      <CombineCropsFold canEdit={canEdit} />
      <Fold title="How to load boundaries into the combine" storageKey="combine-monitor-load">
        <Steps steps={LOAD_STEPS} />
      </Fold>
      <Fold title="How to copy setup from one combine to the other" storageKey="combine-monitor-copy">
        <Steps steps={COPY_STEPS} />
      </Fold>
    </div>
  )
}

/** "Crops on the combines": the same per-crop switch as the Crops page. */
function CombineCropsFold({ canEdit }: { canEdit: boolean }) {
  const crops = useCombineCrops()
  const set = useSetCropOnCombines()
  const active = (crops.data ?? []).filter((c) => c.active)
  const on = active.filter((c) => c.on_combines).length
  return (
    <Fold title="Crops on the combines" summary={crops.data ? `${on} of ${active.length}` : undefined} storageKey="combine-monitor-crops">
      {crops.error && <p className="text-sm text-red-700">{messageOf(crops.error)}</p>}
      <div className="flex flex-wrap gap-1.5">
        {active.map((c) => (
          <label
            key={c.id}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
              c.on_combines ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-500',
              canEdit && 'cursor-pointer',
            )}
          >
            <input type="checkbox" checked={c.on_combines} disabled={!canEdit || set.isPending} onChange={(e) => set.mutate({ id: c.id, on: e.target.checked })} />
            {c.name}
          </label>
        ))}
      </div>
      {set.error && <p className="mt-2 text-xs text-red-700">{messageOf(set.error)}</p>}
    </Fold>
  )
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  )
}

function StatusBadge({ state }: { state: CombineState }) {
  if (!state.load) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Not marked loaded yet</span>
  if (state.changes.length)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" /> {changeSummary(state.changes)}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
    </span>
  )
}

function changeText(c: FieldChange): string {
  return c.kinds
    .map((k) =>
      k === 'name' && c.wasName
        ? `${CHANGE_LABELS.name} (was ${c.wasFarm ?? c.monitorFarm ?? ''}${c.wasFarm || c.monitorFarm ? ' / ' : ''}${c.wasName})`
        : k === 'take_off'
          ? `${CHANGE_LABELS.take_off}: not on a combine crop this year, or no longer farmed. Delete it on the display (Data Management → Delete) if you want it gone`
          : CHANGE_LABELS[k],
    )
    .join(', ')
}

function CombineCard({
  state,
  canEdit,
  last,
  everyField,
  busy,
  onDownloadChanges,
  usb,
}: {
  state: CombineState
  canEdit: boolean
  last: LastDownload | null
  everyField: SnapshotField[]
  busy: boolean
  onDownloadChanges: (changes: FieldChange[]) => void
  usb: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [marking, setMarking] = useState(false)
  const save = useSaveMonitorInfo()
  const info = monitorInfoOf(state.machine.monitor)
  const headline = monitorHeadline(info)
  const loadable = loadableChanges(state.changes)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-gray-900">{state.machine.name ?? 'Combine'}</div>
          <div className="text-xs text-gray-500">{headline ?? 'Display not recorded'}</div>
        </div>
        <StatusBadge state={state} />
      </div>

      <DetailList
        className="mt-2"
        rows={MONITOR_INFO_KEYS.filter((k) => k !== 'display' && k !== 'software').map((k): [string, ReactNode] => [INFO_LABELS[k], k === 'checked_on' && info[k] ? shortDate(`${info[k]}T12:00:00`) : (info[k] ?? null)])}
      />
      {state.load && (
        <p className="mt-2 text-xs text-gray-500">
          Last loaded {shortTime(state.load.loaded_at)} · {state.load.loaded_count} field{state.load.loaded_count === 1 ? '' : 's'} that time
        </p>
      )}

      {state.changes.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {state.changes.map((c) => (
            <li key={c.fieldId}>
              <span className="font-medium">
                {c.monitorFarm ? `${c.monitorFarm} / ` : ''}
                {c.monitorName}
              </span>
              {c.monitorName !== c.appName && <span className="text-amber-700"> ({c.appName})</span>} — {changeText(c)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {loadable.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDownloadChanges(state.changes)}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
          >
            {usb ? <Usb className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} {usb ? 'Save just these to the stick' : 'Download just these'}
          </button>
        )}
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setMarking(true)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Upload className="h-3.5 w-3.5" /> Mark loaded on this combine
            </button>
            <EditButton label="Edit display" onClick={() => setEditing(true)} />
          </>
        )}
      </div>

      {editing && (
        <RecordEditModal
          title={`Display — ${state.machine.name ?? 'combine'}`}
          fields={INFO_FIELDS}
          row={info as Record<string, unknown>}
          onClose={() => setEditing(false)}
          onSave={(patch) => {
            const next: MonitorInfo = {}
            for (const k of MONITOR_INFO_KEYS) {
              const v = patch[k]
              if (typeof v === 'string' && v.trim()) next[k] = v.trim()
            }
            return save.mutateAsync({ equipmentId: state.machine.id, info: next })
          }}
          onDelete={headline || Object.keys(info).length ? () => save.mutateAsync({ equipmentId: state.machine.id, info: null }) : undefined}
          deleteConfirm="Clear this combine’s display record?"
        />
      )}
      {marking && <MarkLoadedModal state={state} last={last} everyField={everyField} onClose={() => setMarking(false)} />}
    </div>
  )
}

/** "Mark loaded": the last download, or every field as it stands now. */
function MarkLoadedModal({ state, last, everyField, onClose }: { state: CombineState; last: LastDownload | null; everyField: SnapshotField[]; onClose: () => void }) {
  const mark = useMarkLoaded()
  const { cropYear } = useCropYear()
  const [choice, setChoice] = useState<'last' | 'all'>(last ? 'last' : 'all')
  const loaded = choice === 'last' && last ? last.fields : everyField
  return (
    <Modal title={`Mark loaded — ${state.machine.name ?? 'combine'}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {last && (
          <label className="flex items-start gap-2">
            <input type="radio" checked={choice === 'last'} onChange={() => setChoice('last')} className="mt-1" />
            <span>
              The last download: {last.fields.length} field{last.fields.length === 1 ? '' : 's'}, made {shortTime(last.at)}
            </span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" checked={choice === 'all'} onChange={() => setChoice('all')} className="mt-1" />
          <span>Every field with a boundary, as it is now ({everyField.length})</span>
        </label>
        {mark.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{messageOf(mark.error)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={mark.isPending || !loaded.length}
            onClick={() => mark.mutate({ equipmentId: state.machine.id, loaded, cropYear }, { onSuccess: onClose })}
            className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {mark.isPending ? 'Saving…' : 'Mark loaded'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Under the download: one tap to say which combine it went on. */
function MarkAfterDownload({ last, states }: { last: LastDownload; states: CombineState[] }) {
  const mark = useMarkLoaded()
  const { cropYear } = useCropYear()
  const [done, setDone] = useState<string[]>([])
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <span>
        Last download {shortTime(last.at)} ({last.fields.length}). Loaded it? Mark loaded on:
      </span>
      {states.map((s) => (
        <button
          key={s.machine.id}
          type="button"
          disabled={mark.isPending || done.includes(s.machine.id)}
          onClick={() => mark.mutate({ equipmentId: s.machine.id, loaded: last.fields, cropYear }, { onSuccess: () => setDone((d) => [...d, s.machine.id]) })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
        >
          {done.includes(s.machine.id) ? `✓ ${s.machine.name}` : s.machine.name}
        </button>
      ))}
      {mark.error && <span className="text-red-700">{messageOf(mark.error)}</span>}
    </div>
  )
}

const NAME_HINT = `Up to ${MONITOR_NAME_MAX} characters. The display shows it in capitals.`

/** Grower and own-land Farm, farm-wide (managers). */
function MonitorSettingsModal({ list, onClose }: { list: MonitorFieldList; onClose: () => void }) {
  const save = useSaveMonitorSettings()
  return (
    <RecordEditModal
      title="Grower and own-land farm"
      fields={[
        { key: 'grower', label: 'Grower on the display', kind: 'text', placeholder: list.grower, hint: NAME_HINT },
        { key: 'ownedFarm', label: 'Farm for own land', kind: 'text', placeholder: list.ownedFarm, hint: `Rented and crop-share land goes under the landowner’s farm. ${NAME_HINT}` },
      ]}
      row={list.saved}
      onClose={onClose}
      onSave={(p) => save.mutateAsync({ grower: (p.grower as string | null) ?? null, ownedFarm: (p.ownedFarm as string | null) ?? null })}
    />
  )
}

/** One field's Farm and Field on the display (managers). Blank = automatic; delete goes back to automatic. */
function MonitorNameModal({ field, fields, onClose }: { field: MonitorField; fields: MonitorField[]; onClose: () => void }) {
  const save = useSaveMonitorOverride()
  return (
    <RecordEditModal
      title={`On the display — ${field.name}`}
      fields={[
        { key: 'farm', label: 'Farm', kind: 'text', placeholder: field.monitor.auto.farm || '—', hint: `Blank: ${field.landowner ? 'the landowner’s farm' : 'the own-land farm'}. ${NAME_HINT}` },
        { key: 'field', label: 'Field', kind: 'text', placeholder: field.monitor.auto.name, hint: `Blank: ${field.landowner ? 'from the legal land' : 'the app’s name'}. ${NAME_HINT}` },
      ]}
      row={{ farm: field.override?.farm ?? null, field: field.override?.field ?? null }}
      onClose={onClose}
      onSave={(p) => {
        const farm = (p.farm as string | null)?.trim() || field.monitor.auto.farm
        const name = (p.field as string | null)?.trim() || field.monitor.auto.name
        const clash = fields.find((o) => o.id !== field.id && o.monitor.farm.toLowerCase() === farm.toLowerCase() && o.monitor.name.toLowerCase() === name.toLowerCase())
        if (clash) throw new Error(`${clash.name} already has that name under ${farm}.`)
        return save.mutateAsync({ fieldId: field.id, farm: (p.farm as string | null) ?? null, field: (p.field as string | null) ?? null })
      }}
      onDelete={field.override ? () => save.mutateAsync({ fieldId: field.id, farm: null, field: null }) : undefined}
      deleteConfirm="Go back to the automatic farm and field names?"
    />
  )
}

function BoundariesCard({
  list,
  fields,
  cropYear,
  canEdit,
  busy,
  usb,
  onDownload,
  onNames,
  after,
}: {
  list: MonitorFieldList
  fields: MonitorField[]
  cropYear: number
  canEdit: boolean
  busy: boolean
  usb: boolean
  onDownload: (fields: MonitorField[], to: 'usb' | 'zip') => void
  onNames: (format: 'PDF' | 'CSV', which: Which) => void
  after: ReactNode
}) {
  const [which, setWhich] = useState<Which>('harvest')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const preset = useMemo(() => new Set(fieldsFor(fields, which).map((f) => f.id)), [fields, which])
  const chosen = picked ?? preset
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p ?? preset)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selected = fields.filter((f) => chosen.has(f.id) && f.hasBoundary)
  const shortened = fields.filter((f) => f.monitor.shortened).length
  const lineCount = fields.reduce((n, f) => n + f.lines.length, 0)
  const refresh = useRefreshGuidanceLines()
  const [editingSettings, setEditingSettings] = useState(false)
  const [naming, setNaming] = useState<MonitorField | null>(null)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Boundaries, guidance lines and field names</h2>
        <div className="flex gap-1 text-xs">
          {(
            [
              ['harvest', `On the combines in ${cropYear}`],
              ['all', 'All active fields'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                // A new preset starts the ticks over.
                setWhich(k)
                setPicked(null)
              }}
              className={cn('rounded-full border px-2.5 py-1', which === k ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        <span>
          Grower <span className="font-medium text-gray-900">{list.grower}</span>
        </span>
        <span>
          Own land under <span className="font-medium text-gray-900">{list.ownedFarm}</span>
        </span>
        {canEdit && <EditButton label="Edit grower and farm" onClick={() => setEditingSettings(true)} />}
      </div>

      <div className="mt-2 max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-left text-xs text-gray-500">
            <tr>
              <th className="w-6 py-1" />
              <th className="py-1 pr-2 font-medium">Farm</th>
              <th className="py-1 pr-2 font-medium">Field on the display</th>
              <th className="py-1 pr-2 font-medium">In the app</th>
              <th className="py-1 pr-2 text-right font-medium">Acres</th>
              <th className="hidden py-1 font-medium sm:table-cell">Crop</th>
              {canEdit && <th className="w-8 py-1" />}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className={cn('border-t border-gray-100', !f.hasBoundary && 'text-gray-400')}>
                <td className="py-1">
                  <input
                    type="checkbox"
                    aria-label={`Include ${f.name}`}
                    disabled={!f.hasBoundary}
                    checked={f.hasBoundary && chosen.has(f.id)}
                    onChange={() => toggle(f.id)}
                  />
                </td>
                <td className="py-1 pr-2 text-gray-700">
                  {f.monitor.farm}
                  {f.monitor.farmSet && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-600">set</span>}
                </td>
                <td className="py-1 pr-2">
                  <span className="font-medium">{f.monitor.name}</span>
                  {f.monitor.source === 'override' && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-600">set</span>}
                  {f.monitor.shortened && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">shortened</span>}
                  {f.monitor.quarterDropped && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">quarter dropped</span>}
                  {f.monitor.fileName !== f.monitor.name && <div className="text-[11px] text-gray-500">file: {f.monitor.fileName}</div>}
                  {f.lines.map((l) => (
                    <div key={l.id} className="text-[11px] text-gray-500">
                      ↳ {l.name} · {lineTypeNote(l.lineType)}
                      {l.fileName !== l.name && ` · file: ${l.fileName}`}
                    </div>
                  ))}
                </td>
                <td className="py-1 pr-2 text-gray-600">{f.monitor.name !== f.name ? f.name : <span className="text-gray-300">same</span>}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{f.acres != null ? f.acres.toFixed(1) : 'No boundary'}</td>
                <td className="hidden py-1 text-gray-600 sm:table-cell">{f.crops.join(' / ')}</td>
                {canEdit && (
                  <td className="py-1 text-right">
                    <EditButton label="Edit" onClick={() => setNaming(f)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editingSettings && <MonitorSettingsModal list={list} onClose={() => setEditingSettings(false)} />}
      {naming && <MonitorNameModal field={naming} fields={fields} onClose={() => setNaming(null)} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {usb && (
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={() => onDownload(selected, 'usb')}
            title="Pick the USB stick and the files go straight onto it"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Usb className="h-4 w-4" /> {busy ? 'Saving…' : `Save to USB stick (${selected.length})`}
          </button>
        )}
        <button
          type="button"
          disabled={busy || !selected.length}
          onClick={() => onDownload(selected, 'zip')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:opacity-50',
            usb ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-brand-700 font-semibold text-white hover:bg-brand-800',
          )}
        >
          <Download className="h-4 w-4" /> {busy && !usb ? 'Making…' : usb ? 'ZIP instead' : `Boundaries ZIP (${selected.length})`}
        </button>
        <button type="button" onClick={() => onNames('PDF', which)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          <FileText className="h-4 w-4" /> Field names PDF
        </button>
        <button type="button" onClick={() => onNames('CSV', which)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          CSV
        </button>
        {shortened > 0 && <span className="text-xs text-gray-500">{shortened} shortened to {MONITOR_NAME_MAX} characters</span>}
        <span className="text-xs text-gray-500">
          {lineCount} Deere line{lineCount === 1 ? '' : 's'} with “Combine” in the name
        </span>
        {canEdit && (
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {refresh.isSuccess ? 'Refreshing — back in a minute' : 'Refresh lines from Deere'}
          </button>
        )}
        {refresh.error && <span className="text-xs text-red-700">{messageOf(refresh.error)}</span>}
      </div>
      {after}
    </section>
  )
}
