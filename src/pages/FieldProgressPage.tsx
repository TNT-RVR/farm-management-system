import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { Sprout, Tractor, TriangleAlert } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCropYear } from '@/lib/crop-year'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { CropProgressExemptions } from '@/components/CropProgressExemptions'
import { useCropPlans } from '@/lib/queries'
import { useSaveFieldWork } from '@/lib/field-work-data'
import { FIELD_FINISHED } from '@/lib/field-work'
import { usePartnerAccess } from '@/lib/partner-view'
import { useSeasonProgress } from '@/lib/field-progress-data'
import { shortDay } from '@/lib/field-state'
import {
  describeProgress,
  progressFor,
  type Progress,
  type ProgressField,
  type ProgressKind,
} from '@/lib/fieldProgress'

/**
 * How much of the farm is seeded, and how much is off.
 *
 * Acres across the whole farm rather than a field count, because acres are what
 * says how much work is left — a 22-acre corner should not weigh the same as a
 * 226-acre field.
 *
 * The unrecorded bucket is the part worth understanding. Deere's seeding
 * records have holes: two fields carry 2026 applications and tillage but no
 * seeding operation ever arrived. Counting those as unseeded reports 91% on a
 * farm that is fully seeded, so they are shown separately — the gap is visible
 * as a gap rather than buried inside a wrong percentage.
 */

const ac = (n: number) => Math.round(n).toLocaleString('en-CA')

function Bar({ p }: { p: Progress }) {
  const done = p.pct ?? 0
  const extra = (p.pctIncludingUnrecorded ?? 0) - done
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={p.kind === 'seeding' ? 'bg-emerald-500' : 'bg-amber-500'}
          style={{ width: `${done}%` }}
        />
        {/* Hatched, because this is work believed done rather than recorded
            done. Showing it in the solid colour would state more than is
            known; leaving it off would say the farm is less far along than it
            is. */}
        {extra > 0 && (
          <div
            className="bg-emerald-300"
            style={{
              width: `${extra}%`,
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,.6) 3px, rgba(255,255,255,.6) 6px)',
            }}
          />
        )}
      </div>
    </div>
  )
}

function ProgressPanel({
  p,
  title,
  icon: Icon,
}: {
  p: Progress
  title: string
  icon: typeof Sprout
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Icon className="h-4 w-4" /> {title}
        </h2>
        <span className="text-xs text-gray-500">{describeProgress(p)}</span>
      </div>

      <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
        {p.pct == null ? '—' : `${p.pct.toFixed(0)}%`}
      </p>

      <div className="mt-2">
        <Bar p={p} />
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-gray-500">Recorded</dt>
          <dd className="tabular-nums text-gray-900">
            {ac(p.done.acres)} ac · {p.done.fields} field{p.done.fields === 1 ? '' : 's'}
          </dd>
        </div>
        {p.unrecorded.acres > 0 && (
          <div className="flex justify-between">
            <dt className="text-amber-700">In crop, not recorded</dt>
            <dd className="tabular-nums text-amber-700">
              {ac(p.unrecorded.acres)} ac · {p.unrecorded.fields} field
              {p.unrecorded.fields === 1 ? '' : 's'}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-gray-500">Still to do</dt>
          <dd className="tabular-nums text-gray-900">
            {ac(p.remaining.acres)} ac · {p.remaining.fields} field
            {p.remaining.fields === 1 ? '' : 's'}
          </dd>
        </div>
        {/* Of the acres still to do, the ones a combine is already on. Counted
            inside "still to do", not beside it: a field being combined is not
            finished, and reading it as finished is what this fixes. */}
        {p.going.acres > 0 && (
          <div className="flex justify-between">
            <dt className="text-amber-700">…of which being combined</dt>
            <dd className="tabular-nums text-amber-700">
              {ac(p.going.acres)} ac · {p.going.fields} field
              {p.going.fields === 1 ? '' : 's'}
            </dd>
          </div>
        )}
        {p.excluded.acres > 0 && (
          <div className="flex justify-between border-t border-gray-100 pt-1">
            <dt className="text-gray-400">
              Not ours to {p.kind === 'seeding' ? 'seed' : 'harvest'}
            </dt>
            <dd className="tabular-nums text-gray-400">{ac(p.excluded.acres)} ac</dd>
          </div>
        )}
      </dl>

      {p.unrecorded.acres > 0 && (
        <div className="mt-2 flex items-start gap-1 text-[11px] text-amber-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {ac(p.unrecorded.acres)} ac in crop with no Deere {p.kind} record — counted separately.
          </span>
          <InfoPopover title="Why these are counted separately" width={320}>
            <p>
              {ac(p.unrecorded.acres)} acres are plainly in crop — they carry other operations this
              season — but no {p.kind} record ever came from John Deere. Counted separately rather
              than as unseeded, which would read {p.pct?.toFixed(0)}% on ground that is done.
            </p>
          </InfoPopover>
        </div>
      )}
    </div>
  )
}

/** "Harvested", "Grazed", "Seeded" on a row of the outstanding list. */
function MarkButton({
  children,
  busy,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // Thumb-sized on a phone: these are tapped in a truck at the end of a
      // day, and at 22 px tall they were a mouse target sitting on a phone.
      className="min-h-10 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:px-2 sm:py-0.5"
    >
      {busy ? 'Saving\u2026' : children}
    </button>
  )
}

export function FieldProgressPage() {
  const { cropYear } = useCropYear()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [year, setYear] = useState(cropYear)
  const { data: fields, isLoading, isError } = useSeasonProgress(year)
  const [kind, setKind] = useState<ProgressKind | 'both'>('both')

  const seeding = useMemo(() => progressFor('seeding', fields ?? []), [fields])
  const harvest = useMemo(() => progressFor('harvest', fields ?? []), [fields])

  const years = useMemo(() => {
    const now = new Date().getFullYear()
    return [now + 1, now, now - 1, now - 2].map((y) => ({ value: String(y), label: String(y) }))
  }, [])

  // Saying a field is done, from the list of what is not (Sam, 27 Oct
  // 2026). It writes the same work record the finish form writes —
  // "Field finished", or "Grazed" for a crop that was grazed off
  // instead of combined — so the progress view, the field's own work
  // list and the yield all read one record.
  const { data: plans } = useCropPlans(year)
  const saveWork = useSaveFieldWork()
  const access = usePartnerAccess()
  const qc = useQueryClient()
  const [marking, setMarking] = useState<string | null>(null)
  const [markFailed, setMarkFailed] = useState<string | null>(null)

  /**
   * `on` dates the finish. The day the last load came off is the day the
   * field was done, not the evening somebody got round to the list — and
   * that date is the one the irrigation balance, the yield and the AFSC
   * production report all read (lib/harvest-date.ts).
   */
  const markDone = async (
    f: ProgressField,
    how: 'harvested' | 'grazed' | 'seeded',
    on?: string | null,
  ) => {
    if (!profile || marking) return
    setMarking(`${f.fieldId}:${how}`)
    setMarkFailed(null)
    const now = new Date().toISOString()
    // Noon on the farm day, so a timezone cannot shift it either side of midnight.
    const finishedAt = on ? new Date(`${on.slice(0, 10)}T12:00:00`).toISOString() : now
    try {
      await saveWork.mutateAsync({
        photos: [],
        row: {
          id: crypto.randomUUID(),
          field_id: f.fieldId,
          crop_year: year,
          crop_id: plans?.find((p) => p.field_id === f.fieldId)?.crop_id ?? null,
          work_type: how === 'seeded' ? 'seeding' : how === 'grazed' ? 'grazing' : FIELD_FINISHED,
          counts_as: how === 'seeded' ? 'seeding' : 'harvest',
          field_finished: how !== 'seeded',
          finished_at: finishedAt,
          notes: on ? 'The last of it was off on the day of the last load.' : null,
          created_by: profile.id,
          entered_at: now,
        },
      })
      await qc.invalidateQueries({ queryKey: ['field_season_progress'] })
    } catch (e) {
      setMarkFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setMarking(null)
    }
  }

  const outstanding = useMemo(
    () =>
      (fields ?? [])
        .filter((f) => f.acres > 0)
        .filter((f) =>
          kind === 'harvest'
            ? f.countsForHarvest && !(f.harvestFinished ?? f.hasHarvest)
            : f.countsForSeeding && !f.hasSeeding,
        )
        .sort((a, b) => b.acres - a.acres),
    [fields, kind],
  )

  /**
   * Harvest, in two groups: the fields a combine is already on, and the ones
   * nothing has touched. Going first — those are the ones somebody can
   * answer from memory at the end of the day, and the ones that have a last
   * load to date the finish from.
   */
  const groups = useMemo(() => {
    if (kind !== 'harvest') return [{ title: '', fields: outstanding }]
    const going = outstanding.filter((f) => f.harvestStarted)
    const notStarted = outstanding.filter((f) => !f.harvestStarted)
    return [
      { title: 'Being combined', fields: going },
      { title: 'Nothing started', fields: notStarted },
    ].filter((g) => g.fields.length)
  }, [kind, outstanding])

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Seeding &amp; harvest progress</h1>
          <HelpNote summary="Acres across the whole farm." title="What is counted">
            Acres across the whole farm. Ground that is not ours to do is left out of the side it
            does not belong to — summer fallow from both, established perennials from seeding only,
            and the crop-shared potatoes from both.
          </HelpNote>
        </div>
        <Select
          value={String(year)}
          ariaLabel="Crop year"
          onChange={(v) => setYear(Number(v))}
          options={years}
          className="shrink-0"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-gray-500">Could not load progress right now.</p>
      ) : !fields?.length ? (
        <p className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          No crop plan for {year}, so there is nothing to measure against.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.cropPlan()}>
            Plan the crops
          </SetupLink>
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <ProgressPanel p={seeding} title="Seeded" icon={Sprout} />
            <ProgressPanel p={harvest} title="Harvested" icon={Tractor} />
          </div>

          <CropProgressExemptions canEdit={isManager} />

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Still outstanding</h2>
              <Select
                value={kind === 'harvest' ? 'harvest' : 'seeding'}
                ariaLabel="Which operation"
                onChange={(v) => setKind(v as ProgressKind)}
                options={[
                  { value: 'seeding', label: 'Seeding' },
                  { value: 'harvest', label: 'Harvest' },
                ]}
                size="sm"
              />
            </div>
            {markFailed && <p className="mt-2 text-xs text-red-600">{markFailed}</p>}
            {!outstanding.length ? (
              <p className="mt-3 text-sm text-gray-500">
                Nothing outstanding — every acre that needs it is recorded.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.title} className="mt-2">
                  {g.title && (
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {g.title} · {ac(g.fields.reduce((s, f) => s + f.acres, 0))} ac
                    </h3>
                  )}
                  <ul className="divide-y divide-gray-100 text-sm">
                    {g.fields.map((f) => (
                      <li key={f.fieldId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
                        <span className="min-w-0 flex-auto basis-48">
                          <span className="text-gray-900">{f.name}</span>
                          <span className="ml-1.5 text-xs text-gray-400">
                            {f.cropName ?? 'no crop'}
                          </span>
                          {f.hasAnyOperation && kind === 'seeding' && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                              in crop, not recorded
                            </span>
                          )}
                          {/* What the scale knows, so the question can be
                              answered without opening the field. */}
                          {kind === 'harvest' && (f.loads ?? 0) > 0 && (
                            <span className="block text-xs text-gray-500">
                              {f.loads} load{f.loads === 1 ? '' : 's'}
                              {f.lastLoadOn && `, last ${shortDay(f.lastLoadOn)}`}
                            </span>
                          )}
                          {kind === 'harvest' && !(f.loads ?? 0) && f.progressNote && (
                            <span className="block text-xs text-gray-500">{f.progressNote}</span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-600">{ac(f.acres)} ac</span>
                        {access.canWrite(f.fieldId, year) && (
                          <span className="flex shrink-0 flex-wrap gap-1">
                            {/* The suggestion, with the date already in it: one
                                tap, and the finish lands on the day the last
                                load came off rather than tonight. */}
                            {kind === 'harvest' && f.lastLoadOn && (
                              <MarkButton
                                busy={marking === `${f.fieldId}:harvested`}
                                disabled={!!marking}
                                onClick={() => void markDone(f, 'harvested', f.lastLoadOn)}
                              >
                                Off {shortDay(f.lastLoadOn)}
                              </MarkButton>
                            )}
                            <MarkButton
                              busy={
                                marking ===
                                `${f.fieldId}:${kind === 'harvest' ? 'harvested' : 'seeded'}`
                              }
                              disabled={!!marking}
                              onClick={() =>
                                void markDone(f, kind === 'harvest' ? 'harvested' : 'seeded')
                              }
                            >
                              {kind === 'harvest' ? (f.lastLoadOn ? 'Off today' : 'Harvested') : 'Seeded'}
                            </MarkButton>
                            {/* Grazed off instead of combined: still done. */}
                            {kind === 'harvest' && (
                              <MarkButton
                                busy={marking === `${f.fieldId}:grazed`}
                                disabled={!!marking}
                                onClick={() => void markDone(f, 'grazed')}
                              >
                                Grazed
                              </MarkButton>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <HelpNote summary="Mapped acres; harvest counts when somebody says the field is off.">
            Acres are the mapped boundary, not the planned acreage — the {year} plan totals more
            acres than the farm has. Seeding counts once John Deere records it or somebody records
            it here. Harvest needs more than a pass: Deere merges every visit to a field into one
            operation, so the operation exists from the hour the combine arrives. It counts when
            the last load off the field is weighed and marked, or when somebody says here that the
            field is off. Deere reports no treated area either way, so a part-finished field counts
            whole.
          </HelpNote>
        </>
      )}
    </div>
  )
}
