import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, FlaskConical, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/Card'
import { CardList, RowCard } from '@/components/RowCards'
import { HelpNote } from '@/components/HelpNote'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { askConfirm } from '@/components/askConfirm'
import { isTrough, useWaterMutations, type WaterSource } from '@/lib/cattle-water'
import { FED_BY, fedByLabel, readingFor, useDistrictWater, type FedBy, type Reading } from '@/lib/district-water'
import { latestByWater, useWaterTestMutations, useWaterTests, type WaterTestRow } from '@/lib/cattle-papers-data'
import {
  bloomLean,
  judgeWater,
  LIVESTOCK_WATER_SOURCES,
  MICROCYSTIN_DRINKING,
  MICROCYSTIN_RECREATIONAL,
  TRACE_MAXIMA,
  VERDICT_LABEL,
  WATER_CLASSES,
  WATER_PARAMS,
  worst,
  type Verdict,
} from '@/lib/livestock-water'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * The water report for one source, opened off its pin on the pasture map
 * (Sam, 11 Nov 2026: "when clicking on the water source I need there to be
 * a button that gives a pop up window that shows the detailed report").
 *
 * This used to be a list of every source under the map. The map answers the
 * question better — you are already looking at the dugout you mean — so the
 * list is gone and everything it could do lives here: every parameter against
 * Alberta's chart, the combinations, the bloom lean, where the water comes
 * from, and typing in a new lab sheet.
 *
 * Nothing here is a model. Every verdict is a band out of Agdex 400/716-2 and
 * carries the sentence the publication wrote beside that band - see
 * src/lib/livestock-water.ts.
 */

const VERDICT_STYLE: Record<Verdict, string> = {
  acceptable: 'bg-green-100 text-green-900',
  limits: 'bg-amber-100 text-amber-900',
  do_not_use: 'bg-red-100 text-red-900',
  untested: 'bg-gray-100 text-gray-500',
}

/** The pill a verdict is written in, the same shape in the table and in a card. */
const CHIP = 'rounded-full px-2 py-0.5 text-[11px] font-medium'

const day = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

/**
 * A reading, at the precision a lab sheet prints it — except that a number
 * which rounds to zero is not zero. Nitrate-N is shown to one place because
 * that is how a sheet reports it, and the canal's own nitrate is 0.01, which
 * would print as "0 mg/L" and read as nothing found. A small non-zero value
 * keeps enough places to show itself.
 */
const num = (v: number | null | undefined, digits: number) => {
  if (v == null) return '—'
  const n = Number(v)
  const hidden = n !== 0 && Math.abs(n) < 0.5 / 10 ** digits
  const places = hidden ? Math.max(digits, Math.ceil(-Math.log10(Math.abs(n)))) : digits
  return n.toLocaleString('en-CA', { maximumFractionDigits: places })
}

/** The kinds of water the bloom lean applies to: standing water, not a pipe. */
const STANDING = new Set(['dugout', 'pond'])


/**
 * The pop-up itself: what is in this water, and the one place a lab sheet is
 * typed in or thrown away.
 */
export function WaterReportDialog({
  source,
  canEdit,
  onClose,
}: {
  source: WaterSource
  canEdit: boolean
  onClose: () => void
}) {
  const { data: tests } = useWaterTests()
  const { data: district } = useDistrictWater()
  const { update } = useWaterMutations()
  const [adding, setAdding] = useState(false)
  const latest = useMemo(() => latestByWater(tests).get(source.id) ?? null, [tests, source.id])
  const reading = useMemo(
    () => readingFor({ fedBy: source.fed_by, test: latest, district, sampledOn: latest?.sampled_on ?? null }),
    [source.fed_by, latest, district],
  )
  const judged = useMemo(() => (reading ? judgeWater(reading.values) : null), [reading])
  const name = source.name || (isTrough(source.kind) ? 'Trough' : 'Water')

  return (
    <Modal title={name} onClose={onClose} wide="xl">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          {source.kind}
          {source.pasture_name ? ` · ${source.pasture_name}` : ' · outside every paddock'}
          {!source.drinkable && ' · not for drinking'}
        </p>

        {judged && (
          <div className="flex flex-wrap gap-1">
            {(() => {
              const agreed = worst(WATER_CLASSES.map((c) => judged.byClass[c.key]))
              // Four identical pills say no more than one does, and the chart
              // only splits the classes now and then.
              return WATER_CLASSES.every((c) => judged.byClass[c.key] === agreed) ? (
                <span className={cn(CHIP, VERDICT_STYLE[agreed])}>{VERDICT_LABEL[agreed]} for every class</span>
              ) : (
                WATER_CLASSES.map((c) => (
                  <span key={c.key} className={cn(CHIP, VERDICT_STYLE[judged.byClass[c.key]])}>
                    {c.short} · {VERDICT_LABEL[judged.byClass[c.key]]}
                  </span>
                ))
              )
            })()}
          </div>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="text-gray-500">Fed by</span>
            <FedBySelect value={source.fed_by} onChange={(v) => update.mutate({ id: source.id, fed_by: v })} />
            <span className="text-gray-400">
              Set it to the river or the canal and the verdicts come from their monitoring, not a lab sheet.
            </span>
          </div>
        )}

        {adding ? (
          <TestForm waterId={source.id} name={name} onDone={() => setAdding(false)} />
        ) : (
          <>
            {reading ? (
              <TestDetail name={name} kind={source.kind} reading={reading} canEdit={canEdit} test={latest} />
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Nothing is known about this water yet. Type in a lab sheet, or say it is fed by the river or
                the canal and it is read from their own monitoring — either way against Alberta’s
                livestock chart, per class of cattle.
              </p>
            )}
            {canEdit && (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-3.5 w-3.5" /> {latest ? 'Another lab sheet' : 'Add a lab sheet'}
              </button>
            )}
          </>
        )}

    <HelpNote
      summary="Alberta's own livestock chart, read band by band and class by class."
      title="Where every verdict on this screen comes from"
      width={460}
    >
      <p>
        <b>A source fed by the river or the canal is not judged off a lab sheet.</b> It is judged off
        the province&rsquo;s and the district&rsquo;s own monitoring — the same samples, window and
        stations the irrigation side already reads for its sulphur and nitrate credit, so a figure
        quoted here and a figure quoted under irrigation cannot drift apart. A lab sheet always wins
        over them, because a sheet is this water and the median is the water upstream of it. The canal
        stations run no metals and no fluoride, and the page says so rather than filling them in.
      </p>
      <p>
        Agdex {LIVESTOCK_WATER_SOURCES.chart.agdex}, &ldquo;{LIVESTOCK_WATER_SOURCES.chart.paper}&rdquo;
        (second edition, revised April 2007). The chart gives a band and one of three words for each
        parameter — Acceptable, Poor, Unsuitable — in a single column for cattle, sheep and horses,
        and then names a class of animal in the prose beside several of those bands.
      </p>
      <p>
        That shape is kept exactly. Each band carries the chart&rsquo;s own grade, and a class is only
        moved off it where the publication names that class: &ldquo;acceptable for mature dry
        cows&rdquo;, &ldquo;avoid use for pregnant and/or lactating cows&rdquo;, &ldquo;may affect
        calves&rdquo;, &ldquo;decreased performance in feedlot cattle&rdquo;. &ldquo;Limits gain&rdquo;
        on this screen is the chart&rsquo;s &ldquo;Poor&rdquo;.
      </p>
      <p>
        Nothing is added up. Two parameters that each limit gain do not make water unusable, because
        the publication gives no basis for saying they would — and it is explicit that no single
        concentration is dangerous in all situations.
      </p>
      <p>
        <b>The feed counts too.</b> The chart&rsquo;s figures come from studies where the feed met and
        did not exceed the animals&rsquo; requirements, and it says to add the water&rsquo;s mineral
        content to the feed&rsquo;s to get total intake. A ration already high in sulphur or nitrate
        changes what this water means.
      </p>
      <p>
        <b>Why high sulphate says &ldquo;limits gain&rdquo; and not &ldquo;do not use&rdquo;.</b>{' '}
        {LIVESTOCK_WATER_SOURCES.sulphateGain.year}: 48 crossbred Angus heifers on naturally saline
        water at 980, 5,190 and 9,720 mg/L TDS — sulphate 350, 2,970 and 5,770 — for 100 days. Weight,
        daily gain, dry matter and water intake and gain:feed were all unaffected. Serum and liver
        copper fell at the two higher levels and liver selenium at the highest. So past the
        chart&rsquo;s limits what is at risk is the herd&rsquo;s copper and selenium reserves, which is
        a mineral-programme problem. That paper also notes Saskatchewan&rsquo;s 2,000 mg/L sulphate
        limit would condemn 40 to 60 per cent of that province&rsquo;s surveyed water sources.
      </p>
      <p>
        The southern Alberta work on the same question — &ldquo;{LIVESTOCK_WATER_SOURCES.southernAlberta.paper}&rdquo;{' '}
        ({LIVESTOCK_WATER_SOURCES.southernAlberta.year}) — is in the library as a citation only. No text
        was extracted from it, so nothing on this screen is quoted from it.
      </p>
      <p>
        <Link
          to={`/research?tab=search&q=${encodeURIComponent(LIVESTOCK_WATER_SOURCES.chart.paper)}`}
          className="font-medium underline"
        >
          Open the chart in the research library
        </Link>
      </p>
    </HelpNote>
      </div>
    </Modal>
  )
}

/** Where a source's water comes from, when it is not its own. */
function FedBySelect({ value, onChange }: { value: FedBy | null; onChange: (v: FedBy | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as FedBy | null)}
      aria-label="Where this water comes from"
      className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-700"
    >
      <option value="">Its own water</option>
      {FED_BY.map((f) => (
        <option key={f.value} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  )
}

/**
 * One reading opened out: every parameter, what the chart says, and the bloom
 * lean.
 *
 * `bodyClassName=""` because every section below draws its own `px-3` and its
 * own full-width rule: the card's padding only inset them, kept the rules off
 * the edges, and took 48 of a phone's 375 pixels.
 *
 * Its bar names only where the reading came from, not the source: the pop-up
 * this sits in is titled with the source, and carrying the name here too
 * wrapped the bar onto a second line on a phone to say the same thing twice.
 * `name` is still needed for the delete confirmation.
 */
function TestDetail({
  name,
  kind,
  reading,
  test,
  canEdit,
}: {
  name: string
  kind: string
  reading: Reading
  test: WaterTestRow | null
  canEdit: boolean
}) {
  const j = judgeWater(reading.values)
  const standing = STANDING.has(kind)
  const bloom = bloomLean(reading.values)
  const { remove } = useWaterTestMutations()

  return (
    <Card
      title={
        reading.from === 'district'
          ? `${fedByLabel(reading.fedBy)}, five seasons`
          : `Sampled ${day(reading.sampledOn)}`
      }
      right={
        canEdit && test ? (
          <button
            onClick={async () => {
              if (
                await askConfirm(`${name}, sampled ${day(test.sampled_on)}.`, {
                  title: 'Delete this lab sheet?',
                  confirmLabel: 'Delete',
                })
              )
                remove.mutate(test.id)
            }}
            className="flex items-center gap-1 text-xs text-white/80 hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        ) : undefined
      }
      bodyClassName=""
    >
      {reading.from === 'district' && (
        <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-600">
          <p>
            Not a lab sheet: the median of {reading.samples?.toLocaleString('en-CA')} readings at{' '}
            {reading.stationNames}, May to September over five seasons. Newest {day(reading.sampledOn)}.
          </p>
        </div>
      )}
      {/* The readings themselves. On a phone each parameter is its own card,
          because the reading — the number Sam came for — is the third column
          of three and was off the right edge of a 620-pixel table. */}
      <CardList>
        {j.findings.map((f) => (
          <RowCard
            key={f.param.key}
            heading={
              <span className="flex flex-wrap items-center gap-1.5">
                {f.param.label}
                <span className={cn(CHIP, VERDICT_STYLE[f.grade])}>{VERDICT_LABEL[f.grade]}</span>
              </span>
            }
            facts={[]}
            summary={
              <>
                <p className="mt-0.5 text-sm font-medium tabular-nums text-gray-900">
                  {num(f.value, f.param.digits)} {f.param.unit}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">{f.says}</p>
                {f.note && <p className="mt-0.5 text-xs text-gray-500">{f.note}</p>}
              </>
            }
          />
        ))}
      </CardList>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[620px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TABLE_TH}>Parameter</th>
              <th className={cn(TABLE_TH, 'text-right')}>Reading</th>
              <th className={TABLE_TH}>What the chart says</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {j.findings.map((f) => (
              <tr key={f.param.key} className="align-top">
                <td className="px-3 py-2">
                  <span className="text-gray-900">{f.param.label}</span>
                  <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', VERDICT_STYLE[f.grade])}>
                    {VERDICT_LABEL[f.grade]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                  {num(f.value, f.param.digits)} {f.param.unit}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {f.says}
                  {f.note && <span className="mt-1 block text-gray-500">{f.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {j.combined.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            The combinations the chart insists on
          </p>
          <ul className="mt-1 space-y-1">
            {j.combined.map((c) => (
              <li key={c.key} className="text-xs text-gray-600">
                <span className={cn('mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', VERDICT_STYLE[c.verdict])}>
                  {c.label}
                </span>
                {c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {j.trace.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Against the recommended maximum
          </p>
          <ul className="mt-1 space-y-1">
            {j.trace.map((t) => (
              <li key={t.key} className={cn('text-xs', t.over ? 'text-amber-900' : 'text-gray-600')}>
                {t.over && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                <b>{t.label}</b> {num(t.value, 3)} mg/L against a maximum of {t.max} — {t.says}
              </li>
            ))}
          </ul>
        </div>
      )}

      {standing && (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Blue-green algae — a lean, not a threshold
          </p>
          {bloom.lean === 'unknown' ? (
            <p className="mt-1 text-xs text-gray-500">
              Nothing on this sheet speaks to it. Sulphate, molybdenum or total nitrogen would.
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-600">
              <span
                className={cn(
                  'mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  bloom.lean === 'watch' ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-900',
                )}
              >
                {bloom.lean === 'watch' ? 'Worth watching' : 'Less likely'}
              </span>
              {bloom.reasons.join('; ')}.
            </p>
          )}
          {bloom.microcystin && (
            <p
              className={cn(
                'mt-1 text-xs',
                bloom.microcystin.overRecreational ? 'text-red-800' : bloom.microcystin.overDrinking ? 'text-amber-900' : 'text-gray-600',
              )}
            >
              Microcystin {num(bloom.microcystin.value, 2)} µg/L — Health Canada&rsquo;s drinking-water
              guideline is {MICROCYSTIN_DRINKING} and its recreational guideline {MICROCYSTIN_RECREATIONAL}.
            </p>
          )}
          <HelpNote className="mt-1.5" summary="Why there is no number to clear here." title="The Alberta shallow-lake work">
            <p>
              &ldquo;{LIVESTOCK_WATER_SOURCES.bloom.paper}&rdquo; ({LIVESTOCK_WATER_SOURCES.bloom.year}),
              University of Calgary: 25 shallow Alberta prairie lakes sampled over four months.
              Cyanobacteria pigment went <i>down</i> as sulphate went up, and up with molybdenum and total
              nitrogen. Microcystins tracked pigment and turbidity.
            </p>
            <p>
              Its own conclusion: &ldquo;No thresholds were found in either analysis&rdquo; — no tipping
              point where sulphate limits cyanobacteria, and no environmental trigger for microcystin
              production over the season. So this is a direction and never a limit.
            </p>
            <p>
              The useful consequence is backwards from the livestock chart: the low-sulphate,
              nitrogen-rich dugout is the bloom risk, while the high-sulphate one is the
              trace-mineral risk. A source can be at one end of that and not the other.
            </p>
          </HelpNote>
        </div>
      )}

      {j.untested.length > 0 && (
        <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
          {reading.from === 'district' ? 'Not measured there, so not judged' : 'Not on this sheet, so not judged'}:{' '}
          {j.untested.join(', ')}.
        </p>
      )}
      {test?.notes && <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">{test.notes}</p>}
      {test?.lab && <p className="px-3 pb-2 text-xs text-gray-400">Lab: {test.lab}</p>}
    </Card>
  )
}

/** Fields in the order a lab sheet prints them, so typing one in reads down the page. */
const FORM_FIELDS: { key: string; label: string; unit: string }[] = [
  ...WATER_PARAMS.map((p) => ({ key: p.key, label: p.label, unit: p.unit })),
  { key: 'ec_us_cm', label: 'Conductivity (EC)', unit: 'µS/cm' },
  { key: 'cl_mg_l', label: 'Chloride', unit: 'mg/L' },
  { key: 'k_mg_l', label: 'Potassium', unit: 'mg/L' },
  ...TRACE_MAXIMA.map((t) => ({ key: t.key, label: t.label, unit: 'mg/L' })),
  { key: 'mn_mg_l', label: 'Manganese (recorded, not graded)', unit: 'mg/L' },
  { key: 'total_n_ug_l', label: 'Total nitrogen', unit: 'µg/L' },
  { key: 'total_p_ug_l', label: 'Total phosphorus', unit: 'µg/L' },
  { key: 'microcystin_ug_l', label: 'Microcystin', unit: 'µg/L' },
]

function TestForm({ waterId, name, onDone }: { waterId: string; name: string; onDone: () => void }) {
  const { save } = useWaterTestMutations()
  const [sampledOn, setSampledOn] = useState(new Date().toLocaleDateString('en-CA'))
  const [lab, setLab] = useState('')
  const [bloom, setBloom] = useState('')
  const [notes, setNotes] = useState('')
  const [vals, setVals] = useState<Record<string, string>>({})

  const submit = () => {
    const row: Record<string, unknown> = { water_id: waterId, sampled_on: sampledOn, lab: lab || null, notes: notes || null }
    for (const f of FORM_FIELDS) {
      const raw = vals[f.key]
      const n = raw == null || raw.trim() === '' ? null : Number(raw)
      row[f.key] = n != null && Number.isFinite(n) ? n : null
    }
    row.bloom_seen = bloom === '' ? null : bloom === 'yes'
    save.mutate(row as Parameters<typeof save.mutate>[0], { onSuccess: onDone })
  }

  return (
    <Card title={`Lab sheet · ${name}`} icon={FlaskConical}>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            Sampled
            <input
              type="date"
              value={sampledOn}
              onChange={(e) => setSampledOn(e.target.value)}
              className="mt-0.5 block rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            Lab
            <input
              value={lab}
              onChange={(e) => setLab(e.target.value)}
              placeholder="Who ran it"
              className="mt-0.5 block w-44 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            Algae seen on the water
            <Select
              value={bloom}
              onChange={setBloom}
              placeholder="Not noted"
              options={[
                { value: '', label: 'Not noted' },
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              className="mt-0.5 w-40"
            />
          </label>
        </div>

        <p className="text-xs text-gray-500">
          Type in only what the sheet reports. A blank stays blank, and an untested parameter is shown as
          untested rather than passed.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FORM_FIELDS.map((f) => (
            <label key={f.key} className="text-xs text-gray-600">
              {f.label} <span className="text-gray-400">{f.unit}</span>
              <input
                type="number"
                step="any"
                value={vals[f.key] ?? ''}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-sm tabular-nums"
              />
            </label>
          ))}
        </div>

        <label className="block text-xs text-gray-600">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={save.isPending}
            className="rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save sheet'}
          </button>
          <button onClick={onDone} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </Card>
  )
}
