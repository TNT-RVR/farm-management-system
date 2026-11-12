import { useMemo, useState } from 'react'
import { Download, FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { AfscMdiDialog } from '@/components/AfscMdiDialog'
import { askConfirm } from '@/components/askConfirm'
import { useCropYear } from '@/lib/crop-year'
import { cn } from '@/lib/utils'
import { n0 } from '@/lib/format'
import {
  MDI_FORMS,
  filledByApp,
  formatLegalLand,
  mergeKnown,
  missingAnswers,
  missingForForm,
  suggestLandRows,
  useDeleteMdiLand,
  useMdiFacts,
  useMdiLand,
  useMdiYear,
  usePastures,
  useSaveMdiLand,
  type MdiFormId,
  type MdiLand,
} from '@/lib/afsc-mdi'
import type { Ranch } from '@/lib/ranches'
import { CARD_HEAD } from '@/lib/table-style'

/**
 * AFSC's pasture insurance, filled in.
 *
 * Moisture Deficiency Insurance covers fenced dryland pasture against a dry
 * year, and the application is four forms due 28 February. They are real
 * fillable PDFs, so this page sets the fields on AFSC's own files and hands
 * back the forms themselves — see docs/afsc-mdi-forms.md.
 *
 * Everything the app already knows goes in by itself. The handful it cannot
 * know is one dialog a year, which opens on last year's answers.
 *
 * One subscription per ranch: AFSC allows a second when two pastures are more
 * than fifteen miles apart, and Home Ranch and East Ranch are. Each ranch
 * therefore has its own stations, its own election and its own land, and the
 * page follows the Ranch picker in the tab bar rather than carrying a second
 * control of its own.
 */
export function PastureInsurance({ isManager, ranch }: { isManager: boolean; ranch: Ranch }) {
  const { cropYear } = useCropYear()
  const { data: saved } = useMdiYear(cropYear, ranch.id)
  const { data: land } = useMdiLand(ranch.id)
  const { data: pastures } = usePastures(ranch.id)
  const facts = useMdiFacts(ranch.id)
  const saveLand = useSaveMdiLand()
  const delLand = useDeleteMdiLand()
  const [asking, setAsking] = useState(false)
  const [making, setMaking] = useState<MdiFormId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => land ?? [], [land])
  // What the app knows, under anything that has been answered. This is what
  // the forms are filled from, so a farm name that farm setup already holds
  // reaches the PDF without anyone retyping it into a dialog.
  const year = useMemo(() => mergeKnown(saved ?? null, facts, cropYear, ranch.id), [saved, facts, cropYear, ranch.id])
  const fromApp = useMemo(() => filledByApp(year, saved ?? null), [year, saved])
  const missing = useMemo(() => missingAnswers(year, rows), [year, rows])
  const toAdd = useMemo(() => suggestLandRows(pastures ?? [], rows, ranch.id), [pastures, rows, ranch.id])
  const acres = rows.reduce((s, l) => s + (l.acres ?? 0), 0)
  const byPasture = useMemo(() => new Map((pastures ?? []).map((p) => [p.id, p.name])), [pastures])

  const make = async (id: MdiFormId) => {
    setError(null)
    setMaking(id)
    try {
      const [{ fillMdiForm }, form] = [await import('@/lib/afsc-mdi-pdf'), MDI_FORMS.find((f) => f.id === id)!]
      const { bytes } = await fillMdiForm(id, {
        year,
        land: rows,
        sharesWork: false,
        sharesWorkDetails: '',
        wantsRepresentative: false,
      })
      const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const url = URL.createObjectURL(new Blob([part], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      // Two subscriptions means two of every form: the ranch is in the name
      // so the pair never turn into "(1)" in a downloads folder.
      a.download = `${form.name} - ${ranch.name} ${cropYear}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMaking(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              Moisture Deficiency Insurance · {ranch.name} · {cropYear}
              <InfoPopover title="What MDI covers">
                <p>
                  Fenced dryland pasture. AFSC pays when the rain at the weather stations you pick falls below their normal for
                  the months your coverage option weights — not on what the grass actually did, and the station may not match
                  the field.
                </p>
                <p>Applications are due 28 February.</p>
                <p>
                  Each ranch applies on its own: AFSC allows a second subscription when the closest points of two pastures are
                  more than 15 miles apart, and picks its own weather stations for each.
                </p>
              </InfoPopover>
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {rows.length} {rows.length === 1 ? 'parcel' : 'parcels'} · {n0(acres)} acres
              {year.coverage_option && ` · option ${year.coverage_option}`}
              {year.price_per_lb != null && ` · $${year.price_per_lb.toFixed(2)}/lb`}
            </p>
          </div>
          {isManager && (
            <button
              onClick={() => setAsking(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
            >
              {/* `year` is never null now that the app's own facts are merged
                  into it, so the label asks the saved row instead. */}
              <Pencil className="h-3.5 w-3.5" /> {saved ? 'This year’s answers' : 'Answer this year’s questions'}
            </button>
          )}
        </div>

        {fromApp.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">Filled in from the farm’s own records: {fromApp.join(', ')}.</p>
        )}
        {missing.length > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Still needed before these are worth sending: {missing.join(', ')}. Left blank on the forms rather than guessed.
          </p>
        )}
        {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className={cn('', CARD_HEAD)}>
          <h2 className="font-medium">The forms</h2>
          <HelpNote className="mt-1 text-xs" summary="AFSC’s own PDFs, filled in with what the app knows." title="What you get">
            The app sets the fields on the file AFSC sent, so what downloads is the form itself. Sign it, and fill in anything
            left blank — a SIN or a date of birth is never filled from here.
          </HelpNote>
        </div>
        <ul className="divide-y divide-gray-100">
          {MDI_FORMS.map((f) => {
            // Each form waits on its own answers. One count across all four
            // told the Contract of Insurance it was missing seven when the
            // only two it asks for are the name and the identification number.
            const want = f.fills ? missingForForm(f.id, year, rows) : []
            return (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-auto">
                <p className="text-sm font-medium text-gray-900">{f.name}</p>
                <p className="text-xs text-gray-500">{f.what}</p>
                {want.length > 0 && (
                  <p className="mt-0.5 text-xs text-amber-800">Left blank until you give it: {want.join(', ')}.</p>
                )}
              </div>
              {f.fills ? (
                <>
                  {/* Honest status: the button used to read "Filled in" with 0 parcels on the page. */}
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      want.length > 0 ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800',
                    )}
                  >
                    {want.length > 0 ? `Draft — ${want.length} ${want.length === 1 ? 'answer' : 'answers'} missing` : 'Ready'}
                  </span>
                  <button
                    onClick={() => make(f.id)}
                    disabled={making !== null}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {making === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    {want.length > 0 ? 'Download draft' : 'Download'}
                  </button>
                </>
              ) : (
                <a
                  href={f.file}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <FileText className="h-3.5 w-3.5" /> Read
                </a>
              )}
            </li>
            )
          })}
        </ul>
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className={cn('flex flex-wrap items-center justify-between gap-2', CARD_HEAD)}>
          <h2 className="font-medium">The land</h2>
          {isManager && toAdd.length > 0 && (
            <button
              onClick={() => saveLand.mutate(toAdd)}
              disabled={saveLand.isPending}
              className="flex items-center gap-1.5 rounded-md border border-brand-200 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add the {toAdd.length} {toAdd.length === 1 ? 'pasture' : 'pastures'} not listed
            </button>
          )}
        </div>
        <HelpNote className="px-3 pt-2 text-xs" summary="A quarter per line, the way AFSC asks for it." title="Why this is typed in">
          The pastures already carry their acres and their type, but their description is a ranch area — “{ranch.name}” — not a
          quarter. AFSC wants Part, Section, Township, Range and Meridian, so that part is yours to fill in once. The app does
          not work one out from the map: a wrong quarter on an insurance form is worse than an empty box.
        </HelpNote>
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-400">
            No land listed for {ranch.name} yet{toAdd.length > 0 ? ' — add its pastures above.' : '.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((l) => (
              <LandRow
                key={l.id}
                land={l}
                name={l.pasture_id ? byPasture.get(l.pasture_id) : undefined}
                isManager={isManager}
                onSave={(patch) => saveLand.mutate([{ ...l, ...patch, ranch_id: l.ranch_id ?? ranch.id }])}
                onDelete={async () => {
                  if (await askConfirm('Take this parcel off the insurance forms?')) delLand.mutate(l.id)
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {asking && (
        <AfscMdiDialog
          cropYear={cropYear}
          ranch={ranch}
          current={saved ?? null}
          known={year}
          suggested={rows}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  )
}

const BOXES = [
  ['part', 'Part'],
  ['section', 'Sec'],
  ['township', 'Twp'],
  ['range', 'Rge'],
  ['meridian', 'Mer'],
] as const

/** One parcel: its five legal-land boxes, its acres and how it is held. */
function LandRow({
  land,
  name,
  isManager,
  onSave,
  onDelete,
}: {
  land: MdiLand
  name: string | undefined
  isManager: boolean
  onSave: (patch: Partial<MdiLand>) => void
  onDelete: () => void
}) {
  const box = 'w-full rounded border border-gray-300 px-1.5 py-1 text-xs tabular-nums focus:border-brand-600 focus:outline-none disabled:bg-gray-50'
  const legal = formatLegalLand(land)
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">{name ?? (legal || 'A parcel')}</p>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-gray-500">{land.acres == null ? '—' : `${n0(land.acres)} ac`}</span>
          {isManager && (
            <button onClick={onDelete} aria-label="Take this parcel off" className="-m-1.5 rounded p-2 text-gray-300 hover:bg-gray-100 hover:text-red-600 sm:m-0 sm:p-1">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        {BOXES.map(([key, label]) => (
          <input
            key={key}
            defaultValue={land[key] ?? ''}
            disabled={!isManager}
            placeholder={label}
            aria-label={`${label} for ${name ?? 'this parcel'}`}
            onBlur={(e) => {
              const v = e.target.value.trim().toUpperCase() || null
              if (v !== (land[key] ?? null)) onSave({ [key]: v })
            }}
            className={box}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <label className="text-gray-500">
          Acres
          <input
            type="number"
            min="0"
            step="0.1"
            inputMode="decimal"
            defaultValue={land.acres ?? ''}
            disabled={!isManager}
            aria-label={`Acres for ${name ?? 'this parcel'}`}
            onBlur={(e) => {
              const v = e.target.value.trim() === '' ? null : Number(e.target.value)
              if (v !== land.acres) onSave({ acres: v })
            }}
            className={cn(box, 'ml-1 inline-block w-20')}
          />
        </label>
        <select
          value={land.tenure ?? ''}
          disabled={!isManager}
          aria-label={`How ${name ?? 'this parcel'} is held`}
          onChange={(e) => onSave({ tenure: (e.target.value || null) as MdiLand['tenure'] })}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs disabled:bg-gray-50"
        >
          <option value="">how it is held</option>
          <option value="owned">owned</option>
          <option value="cash">cash rented</option>
          <option value="crop_share">crop share</option>
        </select>
        {land.tenure && land.tenure !== 'owned' && (
          <input
            defaultValue={land.title_name ?? ''}
            disabled={!isManager}
            placeholder="name on title"
            aria-label={`Name on title for ${name ?? 'this parcel'}`}
            onBlur={(e) => {
              const v = e.target.value.trim() || null
              if (v !== (land.title_name ?? null)) onSave({ title_name: v })
            }}
            className="min-w-0 flex-1 basis-40 rounded border border-gray-300 px-1.5 py-1 text-xs disabled:bg-gray-50"
          />
        )}
      </div>
    </li>
  )
}
