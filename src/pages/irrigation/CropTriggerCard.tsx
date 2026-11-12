import { useMemo, useState, type ReactNode } from 'react'
import { ExternalLink, Sprout } from 'lucide-react'
import { Link } from 'react-router-dom'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { Select } from '@/components/Select'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import {
  useCropCoefficients,
  useFieldSeasons,
  useLatestBalance,
  useSoilProfiles,
  type FieldSeasonRow,
} from '@/lib/irrigation'
import {
  STAGE_PHASES,
  VERDICT_COLOR,
  VERDICT_LABEL,
  WATCH_BAND_PCT,
  sortTriggerRows,
  stageTriggerPct,
  triggerRow,
  triggerSentence,
  triggerSummary,
  useCropIrrigationSheets,
  useSetCropStage,
  type CropSheet,
  type StagePhase,
  type TriggerRow,
} from '@/lib/crop-irrigation'
import { cn } from '@/lib/utils'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'

/** "Thu, Nov 5" — the same wording the irrigation plan above this card uses. */
const fmtDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const n = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/** The sheet in the library, opened on its own title. */
function SheetLink({ sheet, children }: { sheet: CropSheet; children: ReactNode }) {
  const title = `Irrigation scheduling for ${sheet.crop_label.replace(/ hay$/, '')} in southern Alberta`
  return (
    <Link
      to={`/research?tab=search&q=${encodeURIComponent(title)}`}
      className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"
      title={`${title}${sheet.agdex ? ` — Agdex ${sheet.agdex}` : ''}`}
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </Link>
  )
}

const PHASE_OPTIONS = (sheet: CropSheet) => [
  { value: '', label: 'From the planting date' },
  ...STAGE_PHASES.flatMap((p) => {
    const s = sheet.stages.find((x) => x.phase === p)
    return s ? [{ value: p, label: s.stage_label }] : []
  }),
]

/** A cell's label, shown only when the row is stacked on a phone. */
function Lbl({ children }: { children: ReactNode }) {
  return <span className="block text-[10px] uppercase tracking-wide text-gray-400 sm:hidden">{children}</span>
}

function Row({ r, isManager }: { r: TriggerRow; isManager: boolean }) {
  const setStage = useSetCropStage()
  const sentence = triggerSentence(r)
  const floor = r.stage ? n(r.stage.floor_pct) : null
  const trigger = r.stage ? stageTriggerPct(r.stage) : null
  // The sheet names a depth to read at; the balance tracks the whole profile.
  const depthDiffers =
    r.stage != null && r.trackedDepthCm != null && Math.abs(r.stage.monitor_depth_cm - r.trackedDepthCm) > 10

  return (
    <tr className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 sm:table-row sm:p-0">
      <td className="col-span-2 align-top sm:px-3 sm:py-1.5">
        <span className="font-medium text-gray-800">{r.fieldName}</span>
        <span className="block text-gray-500">{r.cropName ?? 'no crop planned'}</span>
        {r.sheet ? (
          <SheetLink sheet={r.sheet}>
            <span className="text-[11px]">
              {r.sheet.crop_label} sheet{r.sheet.published ? `, ${r.sheet.published}` : ''}
            </span>
          </SheetLink>
        ) : (
          r.nearSheet && (
            <SheetLink sheet={r.nearSheet}>
              <span className="text-[11px]">nearest: the {r.nearSheet.crop_label.toLowerCase()} sheet</span>
            </SheetLink>
          )
        )}
      </td>

      <td className="align-top sm:px-3 sm:py-1.5">
        <Lbl>Stage</Lbl>
        {r.stage ? (
          <>
            <span className="font-medium text-gray-700">{r.stage.stage_label}</span>
            <span className="block text-[11px] text-gray-400">
              {r.stageSource === 'by_hand' ? 'set by hand' : 'from the planting date'}
            </span>
            {r.stage.note && (
              <InfoPopover title={`${r.sheet?.crop_label ?? 'Sheet'} — ${r.stage.stage_label}`} width={360}>
                <p>{r.stage.note}</p>
                <p>
                  Read soil moisture at {r.stage.monitor_depth_cm} cm. Do not let available water fall below{' '}
                  {floor}%{trigger != null && trigger !== floor ? `; start near ${trigger}%` : ''}.
                </p>
              </InfoPopover>
            )}
          </>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>

      <td className="align-top tabular-nums sm:px-3 sm:py-1.5">
        <Lbl>Available now</Lbl>
        {r.pct != null ? (
          <>
            <span className="font-semibold text-gray-900">{Math.round(r.pct)}%</span>
            {r.availMm != null && r.capacityMm != null && (
              <span className="block text-[11px] text-gray-400">
                {Math.round(r.availMm)} of {Math.round(r.capacityMm)} mm
                {r.trackedDepthCm != null && ` · ${r.trackedDepthCm} cm`}
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>

      <td className="align-top tabular-nums sm:px-3 sm:py-1.5">
        <Lbl>Sheet&rsquo;s trigger</Lbl>
        {trigger != null ? (
          <>
            <span className="font-medium text-gray-700">{trigger}%</span>
            {floor != null && floor !== trigger && (
              <span className="block text-[11px] text-gray-500">floor {floor}%</span>
            )}
            {depthDiffers && (
              <span className="block text-[11px] text-amber-700">
                read at {r.stage!.monitor_depth_cm} cm
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>

      <td className="col-span-2 align-top sm:px-3 sm:py-1.5">
        <Lbl>What the sheet says</Lbl>
        {r.done ? (
          <>
            <span className="text-gray-500">Done for the season</span>
            {/* Still say why the stage and trigger are blank: otherwise the two
                em-dashes beside a finished field look like a fault. */}
            {r.gap && <span className="mt-0.5 block text-[11px] text-gray-400">{r.gap}</span>}
          </>
        ) : r.verdict ? (
          <>
            <span className={cn('inline-block rounded px-1.5 py-0.5 font-medium', VERDICT_COLOR[r.verdict])}>
              {VERDICT_LABEL[r.verdict]}
            </span>
            {sentence && <span className="mt-0.5 block text-[11px] text-gray-500">{sentence}</span>}
          </>
        ) : (
          <span className="text-[11px] text-gray-500">{r.gap ?? '—'}</span>
        )}
        {isManager && r.sheet && r.seasonId && (
          <Select
            size="sm"
            className="mt-1 w-full max-w-[14rem]"
            ariaLabel={`Growth stage for ${r.fieldName}`}
            value={r.stageSource === 'by_hand' && r.stage ? r.stage.phase : ''}
            options={PHASE_OPTIONS(r.sheet)}
            disabled={setStage.isPending}
            onChange={(v) => setStage.mutate({ seasonId: r.seasonId!, phase: (v || null) as StagePhase | null })}
          />
        )}
      </td>
    </tr>
  )
}

/** The sheets behind the table: their season figures and their refill tables. */
function SheetDetail({ sheets }: { sheets: CropSheet[] }) {
  return (
    <div className="space-y-2">
      {sheets.map((s) => (
        <div key={s.id} className="rounded-md border border-gray-200 p-2.5">
          <p className="text-sm font-semibold text-gray-800">
            <SheetLink sheet={s}>{s.crop_label}</SheetLink>
            {s.agdex && <span className="ml-1.5 text-[11px] font-normal text-gray-400">Agdex {s.agdex}</span>}
            {s.published && <span className="ml-1.5 text-[11px] font-normal text-gray-400">{s.published}</span>}
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            {s.season_mm_low != null && (
              <>
                Season{' '}
                <b>
                  {s.season_mm_low === s.season_mm_high
                    ? `${s.season_mm_low} mm`
                    : `${s.season_mm_low}–${s.season_mm_high} mm`}
                </b>
                {' · '}
              </>
            )}
            {s.peak_mm_day != null && (
              <>
                peak <b>{Number(s.peak_mm_day)} mm/day</b>
                {s.peak_when ? ` at ${s.peak_when}` : ''}
                {' · '}
              </>
            )}
            root zone <b>{s.root_zone_cm} cm</b>
          </p>
          {s.root_note && <p className="mt-0.5 text-[11px] text-gray-500">{s.root_note}</p>}
          {s.final_note && <p className="mt-0.5 text-[11px] text-gray-500">Last pass: {s.final_note}</p>}
          {s.establish_note && <p className="mt-0.5 text-[11px] text-gray-500">{s.establish_note}</p>}

          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[11px]">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Stage</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Read at</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Start</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Floor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.stages.map((st) => (
                  <tr key={st.id}>
                    <td className="px-2 py-1">{st.stage_label}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{st.monitor_depth_cm} cm</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {st.start_pct != null ? `${Number(st.start_pct)}%` : '—'}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{Number(st.floor_pct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {s.refill.length > 0 && (
            <Fold
              title="What it takes to refill, by soil texture"
              summary={`${[...new Set(s.refill.map((r) => r.depth_cm))].sort((a, b) => a - b).join(' and ')} cm zones`}
              className="mt-1.5"
              bodyClassName="p-0"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-[11px]">
                  <thead className={TABLE_HEAD}>
                    <tr>
                      <th className={TABLE_TH}>Texture</th>
                      {[...new Set(s.refill.map((r) => r.depth_cm))]
                        .sort((a, b) => a - b)
                        .map((d) => {
                          const depl = s.refill.find((r) => r.depth_cm === d)?.depletion_pct
                          return (
                            <th key={d} className={cn(TABLE_TH, 'text-right')}>
                              {d} cm
                              <span className="block font-normal text-gray-400">
                                holds / refill at {Number(depl)}%
                              </span>
                            </th>
                          )
                        })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...new Set(s.refill.map((r) => r.texture))].map((tex) => (
                      <tr key={tex}>
                        <td className="px-2 py-1">{tex}</td>
                        {[...new Set(s.refill.map((r) => r.depth_cm))]
                          .sort((a, b) => a - b)
                          .map((d) => {
                            const cell = s.refill.find((r) => r.depth_cm === d && r.texture === tex)
                            return (
                              <td key={d} className="px-2 py-1 text-right tabular-nums">
                                {cell ? `${cell.taw_mm} / ${cell.refill_mm} mm` : '—'}
                              </td>
                            )
                          })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Fold>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * What Alberta's own sheet for each field's crop says about today's reading.
 *
 * The table beside this one is the engine's: field capacity over the root zone
 * less the soil profile's allowable depletion, the same trigger for every
 * field. This one reads the province's sheet for the crop that is actually in
 * the field, at the stage it is actually at -- which is where potato's 70 per
 * cent at tuber initiation and winter wheat's 50 before heading come from.
 */
export function CropTriggerCard({ year, isManager }: { year: number; isManager: boolean }) {
  const { data: fields } = useFields()
  const { data: seasons, isLoading: seasonsLoading } = useFieldSeasons(year)
  const { data: plans } = useCropPlans(year)
  const { data: crops } = useCrops()
  const { data: coefs } = useCropCoefficients()
  const { data: latest, isLoading: balanceLoading } = useLatestBalance()
  const { data: profiles } = useSoilProfiles()
  const { data: sheets, isLoading: sheetsLoading } = useCropIrrigationSheets()
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(() => {
    // One season row per field: the whole-field one where there is one, else
    // the first zone's -- the sheet's trigger is a per-crop figure, and a
    // zoned field's zones share the crop the plan names.
    const seasonFor = new Map<string, FieldSeasonRow>()
    for (const s of seasons ?? []) {
      if (!s.active) continue
      const held = seasonFor.get(s.field_id)
      if (!held || (held.zone_id && !s.zone_id)) seasonFor.set(s.field_id, s)
    }
    const out: TriggerRow[] = []
    for (const f of fields ?? []) {
      if (!f.active) continue
      const season = seasonFor.get(f.id)
      if (!season) continue

      // The crop the plan names, largest acres first -- the same crop the
      // Overview table labels the row with.
      const planned = (plans ?? [])
        .filter((p) => p.field_id === f.id)
        .sort((a, b) => Number(b.planned_acres ?? 0) - Number(a.planned_acres ?? 0))
      const crop = planned.length ? crops?.find((c) => c.id === planned[0].crop_id) : undefined
      // The season's own coefficient wins; it is what the balance was run on.
      const coef = coefs?.find((c) => c.id === (season.crop_coefficient_id ?? crop?.crop_coefficient_id))

      const b = latest?.find((x) => x.field_id === f.id && !x.zone_id) ?? latest?.find((x) => x.field_id === f.id)
      const profile = profiles?.find((p) => p.field_id === f.id)
      const doneSeasons = (seasons ?? []).filter((s) => s.field_id === f.id && s.active)

      out.push(
        triggerRow(
          {
            fieldId: f.id,
            fieldName: f.name,
            cropName: crop?.name ?? null,
            coefCrop: coef?.crop ?? null,
            coefVariant: coef?.variant ?? null,
            lengths: coef
              ? { l_ini: coef.l_ini, l_dev: coef.l_dev, l_mid: coef.l_mid, l_late: coef.l_late }
              : null,
            plantingDate: season.planting_date,
            stageOverride: season.irrigation_stage ?? null,
            availMm: n(b?.avail_100_mm),
            // taw_mm is field capacity over the tracked root zone in the
            // AIMM-parity balance the Graph draws, which is what a per cent
            // of available has to be read against.
            capacityMm: n(b?.taw_mm),
            trackedDepthCm: profile ? Math.round(Number(profile.max_root_zone_depth_m) * 100) : null,
            balanceOn: b?.date ?? null,
            done: doneSeasons.some((s) => s.irrigation_done_at),
            seasonId: season.id,
          },
          sheets,
        ),
      )
    }
    return sortTriggerRows(out)
  }, [fields, seasons, plans, crops, coefs, latest, profiles, sheets])

  /**
   * Fields with a crop this year that the table cannot speak for, because
   * their irrigation season is not switched on.
   *
   * `field_crop_seasons.active` means "this row feeds the water balance", not
   * "the field has a crop" -- a dryland field carries a real planting date on
   * an inactive row. Without this line those fields just vanish from a table
   * that lists every other field, which reads as a bug rather than as setup.
   */
  const leftOut = useMemo(() => {
    const live = new Set((seasons ?? []).filter((s) => s.active).map((s) => s.field_id))
    const planted = new Set((plans ?? []).map((p) => p.field_id))
    return (fields ?? []).filter((f) => f.active && planted.has(f.id) && !live.has(f.id)).length
  }, [fields, seasons, plans])

  const loading = seasonsLoading || balanceLoading || sheetsLoading
  // Fields with something to say come first; the rest are behind "show every
  // field", so the card stays the size of the decision it is helping with.
  const notable = rows.filter((r) => !r.done && (r.verdict === 'below' || r.verdict === 'start' || r.verdict === 'watch'))
  const shown = showAll || notable.length === 0 ? rows : notable
  const asOf = rows.map((r) => r.balanceOn).filter((d): d is string => Boolean(d)).sort()[0] ?? null
  const usedSheets = useMemo(() => {
    const ids = new Set(rows.map((r) => r.sheet?.id).filter(Boolean))
    return (sheets ?? []).filter((s) => ids.has(s.id))
  }, [rows, sheets])

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start gap-1.5 p-3">
        <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800">Alberta&rsquo;s trigger, crop by crop</h3>
          <p className="text-xs text-gray-600">{loading ? 'Reading the sheets…' : triggerSummary(rows)}</p>
        </div>
        <InfoPopover title="Where this trigger comes from">
          <p>
            Alberta publishes an &ldquo;Irrigation scheduling for X in southern Alberta&rdquo; sheet for each
            irrigated crop. Each one names the depth to read soil moisture at in every growth stage, the share
            of available water to start irrigating at, and the share not to cross. Those are the numbers in
            this table, and each row links to the sheet in the library.
          </p>
          <p>
            The stage is worked out from the field&rsquo;s planting date and the stage lengths its water-use
            curve already uses, so it needs nothing typed in. Somebody who has walked the field can set it by
            hand instead, and that wins.
          </p>
          <p>
            <b>Available now</b> is the water in the field&rsquo;s tracked root zone as a share of what that
            zone holds full — the same figure the Graph draws. Where a sheet asks for a shallower reading
            (potato&rsquo;s 30 cm at tuber initiation, dry bean&rsquo;s 30 cm before flowering) the row says
            so: a shallow zone dries faster than the whole profile, so the whole-profile figure reads a little
            wetter than a probe at that depth would.
          </p>
          <p>
            <b>Getting close</b> is this app&rsquo;s own line, {WATCH_BAND_PCT} points of available water above
            the sheet&rsquo;s trigger — roughly a day of peak use, about the notice a pivot needs to finish a
            lap. The sheets themselves give only the trigger and the floor.
          </p>
        </InfoPopover>
      </div>

      {loading ? (
        <p className="px-3 pb-3 text-center text-xs text-gray-400">Reading the sheets…</p>
      ) : rows.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-gray-500">
          No {year} field has an irrigation season set up.{' '}
          <SetupLink to={SETUP_LINKS.plantingDate()}>Add planting dates</SetupLink>
        </p>
      ) : (
        <>
          <table className="w-full text-xs">
            <thead className={cn(TABLE_HEAD, 'hidden sm:table-header-group')}>
              <tr>
                <th className={TABLE_TH}>Field</th>
                <th className={TABLE_TH}>Stage</th>
                <th className={TABLE_TH}>Available now</th>
                <th className={TABLE_TH}>Sheet&rsquo;s trigger</th>
                <th className={TABLE_TH}>What the sheet says</th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-gray-100 sm:table-row-group">
              {shown.map((r) => (
                <Row key={r.fieldId} r={r} isManager={isManager} />
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <p className="text-[11px] text-gray-400">
              From the balance as of {asOf ? fmtDay(asOf) : '—'}.
              {leftOut > 0 && (
                <>
                  {' '}
                  {leftOut} field{leftOut === 1 ? '' : 's'} with a {year} crop {leftOut === 1 ? 'is' : 'are'} left
                  out: no irrigation season, so there is no balance to read.{' '}
                  <SetupLink to={SETUP_LINKS.plantingDate()}>Irrigation setup</SetupLink>
                </>
              )}
            </p>
            {notable.length > 0 && rows.length > notable.length && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
              >
                {showAll ? 'Only the fields that need something' : `Show every field (${rows.length})`}
              </button>
            )}
          </div>
          {usedSheets.length > 0 && (
            <Fold
              title="The sheets these come from"
              summary={`${usedSheets.length} Alberta sheet${usedSheets.length === 1 ? '' : 's'}: season total, peak use, root zone, refill by texture`}
              storageKey="irr-crop-sheets"
              className="mx-3 mb-3"
            >
              <SheetDetail sheets={usedSheets} />
            </Fold>
          )}
          <HelpNote
            className="mx-3 mb-3"
            summary="The trigger beside each field is the province's, not the model's."
            title="This table and the plan above it"
          >
            <p>
              This week&rsquo;s plan works from the engine&rsquo;s own trigger: field capacity over the root
              zone less the soil profile&rsquo;s allowable depletion, which is the same rule for every field.
              This table reads the province&rsquo;s sheet for the crop that is in the field, at the stage it is
              at. They usually agree; where they do not, the sheet is the one with a crop and a growth stage
              behind it, and the plan is the one that knows the pivot&rsquo;s lap time and the rain forecast.
            </p>
            <p>
              A field with no sheet is not a fault: Alberta publishes a silage corn sheet and no grain corn
              sheet, so a grain corn field says so rather than borrowing silage figures.
            </p>
          </HelpNote>
        </>
      )}
    </section>
  )
}
