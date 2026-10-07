import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  CloudRain,
  Droplets,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sprout,
  Trash2,
  Tractor,
} from 'lucide-react'
import {
  labelUrl,
  useChemicalLabel,
  useDeleteLabelCrop,
  useExtractLabel,
  useSaveChemicalLabel,
  useSaveLabelCrop,
  type Chemical,
  type ChemicalLabelCrop,
} from '@/lib/chemicals'
import { farmCropFor, perAcre, readable } from '@/lib/chemical-display'
import { localDate } from '@/lib/date-range'
import { cn } from '@/lib/utils'
import { cropGrazingSummary, type GrazingRule } from '@/lib/grazing-restrictions'
import { useLabelGrazingRules } from '@/lib/grazing-restrictions-hooks'

const METHOD_LABEL: Record<string, string> = {
  ground: 'Ground rig only',
  aerial: 'Aerial only',
  both: 'Ground or aerial',
}

const hours = (h: number | null) =>
  h == null ? null : h % 24 === 0 && h >= 24 ? `${h / 24} day${h > 24 ? 's' : ''}` : `${h} h`

/**
 * One fact from the label: a small label and its value.
 *
 * The label sentence each figure was read from is still stored (evidence) but
 * no longer drawn under it — the value and the sentence said the same thing
 * twice. The full label text, one tap away, is where to check a figure.
 */
function Fact({
  icon: Icon,
  label,
  value,
  edited,
  read,
}: {
  icon: typeof Droplets
  label: string
  value: string | null
  edited?: boolean
  /** Whether the label has actually been read yet. */
  read?: boolean
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] text-gray-500">
        <Icon className="h-3 w-3" /> {label}
        {edited && <span className="text-[10px] text-brand-700">edited</span>}
      </dt>
      {/* "not stated" claims the label was read and is silent on this. Until it
          has been read, the honest answer is that we do not know. */}
      <dd className={cn('text-sm', value ? 'text-gray-900' : 'text-gray-400')}>
        {value ?? (read ? 'not stated on the label' : 'not read yet')}
      </dd>
    </div>
  )
}

const inputCls = 'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm'

function CropRow({
  row,
  reg,
  canEdit,
  onDone,
  grazing,
}: {
  row: Partial<ChemicalLabelCrop>
  reg: string
  canEdit: boolean
  onDone?: () => void
  /** The label's grazing and feeding rules, for this crop's column. */
  grazing?: GrazingRule[]
}) {
  const [editing, setEditing] = useState(!row.id)
  const [d, setD] = useState({
    crop: row.crop ?? '',
    pest: row.pest ?? '',
    rate: row.rate ?? '',
    preharvest_interval_days: row.preharvest_interval_days?.toString() ?? '',
    replant_interval_days: row.replant_interval_days?.toString() ?? '',
    rotation_restriction: row.rotation_restriction ?? '',
  })
  const save = useSaveLabelCrop()
  const del = useDeleteLabelCrop()

  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  if (editing) {
    return (
      <tr className="bg-brand-50/40">
        <td colSpan={7} className="px-2 py-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="text-[11px] text-gray-500">
              Crop *
              <input
                className={inputCls}
                value={d.crop}
                onChange={(e) => setD({ ...d, crop: e.target.value })}
              />
            </label>
            <label className="text-[11px] text-gray-500">
              Pest
              <input
                className={inputCls}
                value={d.pest}
                onChange={(e) => setD({ ...d, pest: e.target.value })}
              />
            </label>
            <label className="text-[11px] text-gray-500">
              Rate
              <input
                className={inputCls}
                placeholder="0.67 L/ac"
                value={d.rate}
                onChange={(e) => setD({ ...d, rate: e.target.value })}
              />
            </label>
            <label className="text-[11px] text-gray-500">
              Days to harvest
              <input
                type="number"
                min="0"
                className={inputCls}
                value={d.preharvest_interval_days}
                onChange={(e) => setD({ ...d, preharvest_interval_days: e.target.value })}
              />
            </label>
            <label className="text-[11px] text-gray-500">
              Days before replanting
              <input
                type="number"
                min="0"
                className={inputCls}
                value={d.replant_interval_days}
                onChange={(e) => setD({ ...d, replant_interval_days: e.target.value })}
              />
            </label>
            <label className="text-[11px] text-gray-500 sm:col-span-3">
              Crops that must not follow
              <input
                className={inputCls}
                placeholder="No cereals for 10 months"
                value={d.rotation_restriction}
                onChange={(e) => setD({ ...d, rotation_restriction: e.target.value })}
              />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              disabled={!d.crop.trim() || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: row.id,
                    registration_number: reg,
                    crop: d.crop.trim(),
                    pest: d.pest.trim() || null,
                    rate: d.rate.trim() || null,
                    preharvest_interval_days: num(d.preharvest_interval_days),
                    replant_interval_days: num(d.replant_interval_days),
                    rotation_restriction: d.rotation_restriction.trim() || null,
                  },
                  {
                    onSuccess: () => {
                      setEditing(false)
                      onDone?.()
                    },
                  },
                )
              }
              className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false)
                onDone?.()
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600"
            >
              Cancel
            </button>
            {save.isError && (
              <span className="self-center text-xs text-red-600">
                {(save.error as Error).message}
              </span>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="align-top">
      <td className="px-2 py-1.5 font-medium text-gray-900">{readable(row.crop)}</td>
      {/* Per acre for reading; the label's own per-hectare wording on hover. */}
      <td
        className="px-2 py-1.5 tabular-nums text-gray-900"
        title={row.rate && perAcre(row.rate) !== row.rate ? `On the label: ${row.rate}` : undefined}
      >
        {row.rate ? perAcre(row.rate) : '—'}
      </td>
      <td className="px-2 py-1.5 text-gray-600">{row.pest ? readable(row.pest) : '—'}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
        {row.preharvest_interval_days != null ? `${row.preharvest_interval_days} d` : '—'}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
        {row.replant_interval_days != null ? `${row.replant_interval_days} d` : '—'}
      </td>
      <td className="px-2 py-1.5 text-gray-600">{row.rotation_restriction ? readable(row.rotation_restriction) : '—'}</td>
      <GrazingCell rules={grazing} reg={reg} crop={row.crop ?? ''} />
      <td className="px-2 py-1.5 text-gray-600">
        {canEdit && (
          <span className="ml-2 inline-flex gap-1 align-middle">
            <button
              onClick={() => setEditing(true)}
              className="text-gray-300 hover:text-brand-700"
              aria-label="Edit this crop"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => del.mutate({ id: row.id!, registration_number: reg })}
              className="text-gray-300 hover:text-red-600"
              aria-label="Delete this crop"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * What the label lets livestock do on this crop after a spray: the same rule
 * the grazing alerts use (the crop's own line, else the label's general one).
 * Red when it rules grazing or feeding out altogether.
 */
function GrazingCell({ rules, reg, crop }: { rules?: GrazingRule[]; reg: string; crop: string }) {
  if (!rules) return <td className="px-2 py-1.5 text-gray-300">…</td>
  const s = crop ? cropGrazingSummary(rules, reg, crop) : null
  if (!s) return <td className="px-2 py-1.5 text-gray-400">{rules.length ? 'none for this crop' : '—'}</td>
  return (
    <td className={cn('px-2 py-1.5', /not at all/.test(s.text) ? 'font-medium text-red-700' : 'text-amber-800')} title={s.quote ?? undefined}>
      {s.text}
      {s.assumed && <span className="text-gray-400"> *</span>}
    </td>
  )
}

/** The per-crop rows as a table. Headings in plain case, not capitals. */
function CropTable({
  rows,
  reg,
  canEdit,
  adding,
  onAdded,
}: {
  rows: ChemicalLabelCrop[]
  reg: string
  canEdit: boolean
  adding?: boolean
  onAdded?: () => void
}) {
  const { data: grazing } = useLabelGrazingRules(reg)
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[11px] text-gray-500">
            <th className="px-2 pb-1 font-medium">Crop</th>
            <th className="px-2 pb-1 font-medium">Rate</th>
            <th className="px-2 pb-1 font-medium">Pests</th>
            <th className="px-2 pb-1 text-right font-medium">Days to harvest</th>
            <th className="px-2 pb-1 text-right font-medium">Days to replant</th>
            <th className="px-2 pb-1 font-medium">Cannot follow</th>
            <th className="px-2 pb-1 font-medium" title="After a spray, from the label: how long before livestock may graze the crop or be fed it. * = the label does not name this crop; its general line is used.">
              Grazing / feeding
            </th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((c) => (
            <CropRow key={c.id} row={c} reg={reg} canEdit={canEdit} grazing={grazing} />
          ))}
          {adding && <CropRow row={{}} reg={reg} canEdit={canEdit} onDone={onAdded} />}
        </tbody>
      </table>
    </div>
  )
}

/**
 * What the label says, in two levels.
 *
 * The first is what someone standing at the sprayer needs: the rate and
 * intervals for the crops this farm is growing, and the handful of label facts
 * that decide whether and how to spray. Everything else — the label's other
 * crops, the registry record, editing, the full text — is one more tap.
 *
 * None of the label facts come from Health Canada's registry feed, which stops
 * at name, ingredient, pests and sites. They are read from the label PDF (or
 * entered by hand). A blank means nobody has recorded it — never that the label
 * imposes no restriction.
 */
export function ChemicalLabelDetail({
  chemical,
  canEdit,
  farmCrops,
}: {
  chemical: Chemical
  canEdit: boolean
  /** The crops being grown this year, by name. */
  farmCrops: string[]
}) {
  const reg = chemical.registration_number
  const { data, isLoading } = useChemicalLabel(reg)
  const saveLabel = useSaveChemicalLabel()
  const extract = useExtractLabel()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showText, setShowText] = useState(false)

  const label = data?.label
  const crops = data?.crops ?? []

  // Read the label the first time anyone opens a product nobody has opened yet,
  // so it fills itself in while you are looking at it. Guarded on `data` having
  // loaded, so it fires once rather than on every render.
  // Only auto-read a product nobody has tried yet. A previous failure must not
  // retry on every open — that would hammer a broken key on every page view.
  const neverRead = Boolean(data) && !label?.extracted_at && !label?.extraction_status
  useEffect(() => {
    if (neverRead && canEdit && extract.isIdle) extract.mutate({ registration_number: reg })
  }, [neverRead, canEdit, reg, extract])

  const manual = new Set(label?.manual_fields ?? [])
  // The row is the source of truth for progress. The mutation only reports that
  // the background job was accepted, which says nothing about whether it worked.
  // A function that dies mid-run leaves the row saying 'reading' forever, and
  // the page would poll against it indefinitely. A read takes well under a
  // minute, so anything older than five is abandoned rather than in progress.
  // `now` is ticked from an effect rather than read during render, which would
  // make the render impure and the result unstable between paints.
  const startedAt = label?.extraction_started_at ? Date.parse(label.extraction_started_at) : 0
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    // The tick is the subscription; the first reading arrives with it rather
    // than from a synchronous set, which would cascade a render.
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [startedAt])
  // Until the first tick lands, an in-flight read is treated as in progress —
  // the safe direction, since the alternative is calling a live read abandoned.
  const stale = now > 0 && startedAt > 0 && now - startedAt > 5 * 60_000
  const reading = extract.isPending || (label?.extraction_status === 'reading' && !stale)
  // Queued is a real state: the background worker will get to it. Saying
  // "not read yet" here would suggest nothing is happening.
  const queued = label?.extraction_status === 'queued'
  const failed =
    label?.extraction_status === 'error'
      ? label.extraction_error
      : label?.extraction_status === 'reading' && stale
        ? 'The read did not finish. It may have timed out.'
        : null
  // Only a completed read licenses saying "the label does not state this".
  const hasBeenRead = Boolean(label?.extracted_at)
  const [d, setD] = useState({
    water_volume: '',
    application_method: '',
    rainfast_hours: '',
    irrigation_hours: '',
    reentry_hours: '',
    reentry_note: '',
    grazing_restriction: '',
  })

  if (isLoading) return <p className="text-xs text-gray-400">Loading the label…</p>

  // The label's crops split into the ones growing here and the rest. Nothing is
  // dropped: the rest are under "Show everything".
  const mine = crops.filter((c) => farmCropFor(c.crop, farmCrops) != null)
  const others = crops.filter((c) => farmCropFor(c.crop, farmCrops) == null)

  const startEdit = () => {
    setD({
      water_volume: label?.water_volume ?? '',
      application_method: label?.application_method ?? '',
      rainfast_hours: label?.rainfast_hours?.toString() ?? '',
      irrigation_hours: label?.irrigation_hours?.toString() ?? '',
      reentry_hours: label?.reentry_hours?.toString() ?? '',
      reentry_note: label?.reentry_note ?? '',
      grazing_restriction: label?.grazing_restriction ?? '',
    })
    setEditing(true)
    setShowAll(true)
  }

  const expiry = chemical.expiry_date ? localDate(chemical.expiry_date).toLocaleDateString('en-CA') : null

  return (
    <div className="space-y-3">
      {/* Where the read is up to: one line, only while it matters. */}
      {reading && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading the label — the page fills in on its own in about a minute.
        </p>
      )}
      {queued && !reading && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock className="h-3.5 w-3.5" />
          Queued to be read.
          {canEdit && (
            <button
              onClick={() => extract.mutate({ registration_number: reg, force: true })}
              className="underline"
            >
              Read it now
            </button>
          )}
        </p>
      )}
      {extract.isError && <p className="text-xs text-red-600">{(extract.error as Error).message}</p>}
      {failed && !reading && (
        <p className="flex items-start gap-1.5 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Could not read the label: {failed}
            {canEdit && (
              <button
                onClick={() => extract.mutate({ registration_number: reg, force: true })}
                className="ml-1.5 underline"
              >
                Try again
              </button>
            )}
          </span>
        </p>
      )}

      {/* Level one: your crops. */}
      <section>
        <h4 className="flex items-center gap-1 text-xs font-semibold text-gray-700">
          <Sprout className="h-3.5 w-3.5 text-brand-700" /> For your crops
        </h4>
        {mine.length > 0 ? (
          <CropTable rows={mine} reg={reg} canEdit={canEdit} />
        ) : (
          <p className="mt-1 text-xs text-gray-500">
            {reading
              ? 'Reading the label…'
              : farmCrops.length === 0
                ? 'No crops are planned this year, so there is nothing to narrow to.'
                : crops.length > 0
                  ? `The label doesn’t name any of your crops. It lists ${crops.length} other${crops.length === 1 ? '' : 's'} — see everything below.`
                  : hasBeenRead
                    ? 'No per-crop rates could be read from the label — check the official label.'
                    : 'No crop rates recorded yet.'}
          </p>
        )}
      </section>

      {/* Level one: the facts that decide whether and how to spray. */}
      {!editing && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Fact
            icon={ShieldAlert}
            label="Re-entry"
            value={hours(label?.reentry_hours ?? null)}
            edited={manual.has('reentry_hours')}
            read={hasBeenRead}
          />
          <Fact
            icon={CloudRain}
            label="Rainfast"
            value={hours(label?.rainfast_hours ?? null)}
            edited={manual.has('rainfast_hours')}
            read={hasBeenRead}
          />
          <Fact
            icon={Droplets}
            label="Water volume"
            value={label?.water_volume ? perAcre(label.water_volume) : null}
            edited={manual.has('water_volume')}
            read={hasBeenRead}
          />
          <Fact
            icon={label?.application_method === 'aerial' ? Plane : Tractor}
            label="Application"
            value={label?.application_method ? METHOD_LABEL[label.application_method] : null}
            edited={manual.has('application_method')}
            read={hasBeenRead}
          />
        </dl>
      )}
      {!editing && label?.reentry_note && (
        <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
          <span className="text-[11px] text-amber-700">Re-entry depends on the task: </span>
          {label.reentry_note}
        </p>
      )}
      {!editing && label?.grazing_restriction && (
        <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
          <span className="text-[11px] text-amber-700">Grazing / feeding: </span>
          {readable(label.grazing_restriction)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={labelUrl(reg)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
        >
          Official label (Health Canada) <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')} />
          {showAll ? 'Show less' : 'Show everything'}
        </button>
      </div>

      {/* Level two: the rest of the label and the registry record. */}
      {showAll && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          {editing ? (
            <div className="rounded-lg bg-brand-50/40 p-2.5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="text-[11px] text-gray-500">
                  Water volume
                  <input
                    className={inputCls}
                    placeholder="10 gal/ac"
                    value={d.water_volume}
                    onChange={(e) => setD({ ...d, water_volume: e.target.value })}
                  />
                </label>
                <label className="text-[11px] text-gray-500">
                  How it may be applied
                  <select
                    className={inputCls}
                    value={d.application_method}
                    onChange={(e) => setD({ ...d, application_method: e.target.value })}
                  >
                    <option value="">not recorded</option>
                    <option value="ground">Ground rig only</option>
                    <option value="aerial">Aerial only</option>
                    <option value="both">Ground or aerial</option>
                  </select>
                </label>
                <label className="text-[11px] text-gray-500">
                  Rainfast (hours)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className={inputCls}
                    value={d.rainfast_hours}
                    onChange={(e) => setD({ ...d, rainfast_hours: e.target.value })}
                  />
                </label>
                <label className="text-[11px] text-gray-500">
                  Before irrigation (hours)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className={inputCls}
                    value={d.irrigation_hours}
                    onChange={(e) => setD({ ...d, irrigation_hours: e.target.value })}
                  />
                </label>
                <label className="text-[11px] text-gray-500">
                  Re-entry (hours)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className={inputCls}
                    value={d.reentry_hours}
                    onChange={(e) => setD({ ...d, reentry_hours: e.target.value })}
                  />
                </label>
                <label className="text-[11px] text-gray-500 sm:col-span-2">
                  Re-entry qualification (if the label gives one)
                  <input
                    className={inputCls}
                    placeholder="48 h for hand-harvesting, 12 h otherwise"
                    value={d.reentry_note}
                    onChange={(e) => setD({ ...d, reentry_note: e.target.value })}
                  />
                </label>
                <label className="text-[11px] text-gray-500 sm:col-span-2">
                  Grazing / feeding restriction
                  <input
                    className={inputCls}
                    value={d.grazing_restriction}
                    onChange={(e) => setD({ ...d, grazing_restriction: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={saveLabel.isPending}
                  onClick={() =>
                    saveLabel.mutate(
                      {
                        registration_number: reg,
                        water_volume: d.water_volume.trim() || null,
                        application_method:
                          (d.application_method as 'ground' | 'aerial' | 'both') || null,
                        rainfast_hours: d.rainfast_hours.trim() === '' ? null : Number(d.rainfast_hours),
                        irrigation_hours:
                          d.irrigation_hours.trim() === '' ? null : Number(d.irrigation_hours),
                        reentry_hours: d.reentry_hours.trim() === '' ? null : Number(d.reentry_hours),
                        reentry_note: d.reentry_note.trim() || null,
                        grazing_restriction: d.grazing_restriction.trim() || null,
                      },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                  className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Fact
                icon={Droplets}
                label="Before irrigation"
                value={hours(label?.irrigation_hours ?? null)}
                edited={manual.has('irrigation_hours')}
                read={hasBeenRead}
              />
            </dl>
          )}

          <section>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-gray-700">
                {mine.length > 0 ? 'Other crops on the label' : 'Crops on the label'}
              </h4>
              {canEdit && !adding && (
                <button
                  onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add crop
                </button>
              )}
            </div>
            {others.length > 0 || adding ? (
              <CropTable
                rows={others}
                reg={reg}
                canEdit={canEdit}
                adding={adding}
                onAdded={() => setAdding(false)}
              />
            ) : (
              <p className="mt-1 text-xs text-gray-500">None.</p>
            )}
          </section>

          {label?.extraction_notes && (
            <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{label.extraction_notes}</p>
          )}

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] text-gray-500">Registrant</dt>
              <dd className="text-gray-900">{readable(chemical.registrant) || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-gray-500">Registration</dt>
              <dd className="text-gray-900">
                {chemical.registration_number}
                {chemical.registration_status && ` · ${readable(chemical.registration_status).toLowerCase()}`}
                {expiry && <span className="text-gray-500"> · expires {expiry}</span>}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] text-gray-500">Registered sites of use</dt>
              <dd className="text-gray-700">{readable(chemical.sites_of_use) || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] text-gray-500">Pests on the registration</dt>
              <dd className="text-gray-700">{readable(chemical.pests) || '—'}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {canEdit && !editing && (
              <button onClick={startEdit} className="font-medium text-brand-700 hover:underline">
                {label ? 'Edit label facts' : 'Add label facts'}
              </button>
            )}
            {canEdit && !editing && label?.extracted_at && (
              <button
                onClick={() => extract.mutate({ registration_number: reg, force: true })}
                disabled={extract.isPending}
                className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-700 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3 w-3', extract.isPending && 'animate-spin')} /> Read again
              </button>
            )}
            {label?.extracted_at && (
              <span className="text-gray-400">
                Label read {new Date(label.extracted_at).toLocaleDateString('en-CA')}
              </span>
            )}
          </div>

          {/* The whole label, kept alongside the extracted fields. Anything that
              could not be turned into a value is still here to read, and every
              figure above can be checked against its source without leaving
              the app. */}
          {label?.label_text && (
            <div>
              <button
                onClick={() => setShowText((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                {showText ? 'Hide' : 'Show'} full label text
                <span className="font-normal text-gray-400">({label.label_pages ?? '?'} pages)</span>
              </button>
              {showText && (
                <pre className="mt-1.5 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-700">
                  {label.label_text}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
