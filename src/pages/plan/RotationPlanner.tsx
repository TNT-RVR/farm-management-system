import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  FileText,
  Lock,
  Pencil,
  Plus,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CheckSelect } from '@/components/CheckSelect'
import { InfoPopover } from '@/components/InfoPopover'
import {
  adviseCell,
  repeatQuestion,
  type CropAdvice,
  type RepeatQuestion,
  type RotationAdvice,
  type Verdict,
} from '@/lib/rotation-advice'
import { pastChoices, useAddRotationFeedback, useRotationFeedback } from '@/lib/rotation-feedback'
import type { CheckOption } from '@/components/CheckSelect'
import { Select } from '@/components/Select'
import { Modal } from '@/components/Modal'
import { openChemicalLabel } from '@/lib/chemicals'
import type { Violation } from '@/lib/rotation'
import { SoilMoistureEntry } from '@/components/SoilMoistureEntry'
import { useCropYear } from '@/lib/crop-year'
import { useAllCropZones } from '@/lib/cropZones'
import {
  boundariesForYear,
  useAllBoundaries,
  useCropHistoryByYear,
  useCropPlans,
  useCrops,
} from '@/lib/queries'
import {
  buildSuccessionMap,
  buildSuccessionNotes,
  checkPlacement,
  checkSplitPlacement,
  suggestCrop,
  useBulkSetRotation,
  useFieldInspections,
  useSetCropRotationSettings,
  useSetFieldInspection,
  useSetRotationCrop,
  useSuccessionMutations,
  useSuccessionRules,
  type CropInfo,
  type FieldInspection,
} from '@/lib/rotation'
import {
  fieldYearMap,
  firstPlanYear,
  optionsMap,
  useAddOneYearField,
  useSavePlanColumn,
  useCropPlanOptions,
  useFieldYearPlan,
  useSeedingProgress,
  useSetFieldYear,
  useSetPlanChoices,
} from '@/lib/rotation-plan'
import { cn } from '@/lib/utils'
import { RotationAdvisor } from '@/pages/plan/RotationAdvisor'
import { useRotationContext } from '@/lib/rotation-context'
import { usePartnerAccess, useRotationFields } from '@/lib/partner-view'
import { carryover, cropKey, groupOf, LIMIT_GROUPS, scoutHits } from '@/lib/rotation-engine'
import { volunteerConflicts } from '@/lib/canola-trait'
import {
  EMPTY_SOIL_READING,
  readingProblem,
  readingToMm,
  useFieldCapacity,
  useSaveSoilReading,
} from '@/lib/soil-moisture'
import { useUnitSystem } from '@/lib/units'
import { n0 } from '@/lib/format'
import { HelpNote } from '@/components/HelpNote'
import { TABLE_HEAD, TABLE_TH_MUTED } from '@/lib/table-style'

/** Stable empty set, so a render before the progress query lands is not a new one each time. */
const EMPTY_SET: ReadonlySet<string> = new Set<string>()

const VERDICT_WORD: Record<Verdict, string> = {
  recommended: 'recommended',
  possible: 'it will do',
  caution: 'with care',
  no_go: 'breaks a rule',
}

const VERDICT_TONE: Record<Verdict, 'good' | 'warn' | 'bad' | undefined> = {
  recommended: 'good',
  possible: undefined,
  caution: 'warn',
  no_go: 'bad',
}

/** Every crop as a line to tick, best first, with the one-line reason. */
function cropChecks(ranked: CropAdvice[]): CheckOption[] {
  return ranked.map((a) => ({
    value: a.cropId,
    label: a.name,
    hint: `${VERDICT_WORD[a.verdict]} \u00b7 ${a.reasons[0] ?? ''}`.trim(),
    tone: VERDICT_TONE[a.verdict],
  }))
}

/**
 * What the app makes of a cell: each ticked crop in a sentence, and the one
 * worth a thought that is not ticked (Sam, 28 Oct 2026 — "a recommendation
 * based on the ones they have selected, as well as a recommended one they may
 * not have selected").
 */
function CellAdvice({
  advice,
  onPick,
  onAnswer,
  canPick,
}: {
  advice: RotationAdvice
  onPick: (cropId: string) => void
  /** Yes or no to what it put forward, with the reason in your own words. */
  onAnswer?: (cropId: string, accepted: boolean, reason: string | null) => void
  canPick: boolean
}) {
  const tone = (v: Verdict) =>
    v === 'no_go'
      ? 'text-red-700'
      : v === 'caution'
        ? 'text-amber-700'
        : v === 'recommended'
          ? 'text-green-700'
          : 'text-gray-700'
  return (
    <div className="space-y-2 text-[11px]">
      {advice.picked.length === 0 ? (
        <p className="text-gray-500">No crop picked for this field yet.</p>
      ) : (
        advice.picked.map((a, i) => (
          <div key={a.cropId}>
            <p className={cn('font-semibold', tone(a.verdict))}>
              {a.name} — {VERDICT_WORD[a.verdict]}
              {i === 0 && <span className="ml-1 font-normal text-gray-400">(the plan)</span>}
            </p>
            <ul className="ml-3 list-disc text-gray-600">
              {a.reasons.slice(0, 3).map((r, j) => (
                <li key={j}>{r}</li>
              ))}
            </ul>
          </div>
        ))
      )}
      {advice.alsoConsider && (
        <div className="rounded-md bg-gray-50 p-1.5">
          <p className="font-semibold text-gray-800">
            Also worth a thought: {advice.alsoConsider.name}
            <span className={cn('ml-1 font-normal', tone(advice.alsoConsider.verdict))}>
              ({VERDICT_WORD[advice.alsoConsider.verdict]})
            </span>
          </p>
          <ul className="ml-3 list-disc text-gray-600">
            {advice.alsoConsider.reasons.slice(0, 2).map((r, j) => (
              <li key={j}>{r}</li>
            ))}
          </ul>
          {canPick && (
            <Answer
              cropId={advice.alsoConsider.cropId}
              onYes={(reason) => {
                onPick(advice.alsoConsider!.cropId)
                onAnswer?.(advice.alsoConsider!.cropId, true, reason)
              }}
              onNo={(reason) => onAnswer?.(advice.alsoConsider!.cropId, false, reason)}
              yesLabel="Yes, make it the plan"
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Yes or no to a recommendation, and why.
 *
 * Sam, 28 Oct 2026: "when it gives a recommendation I can say yes or no and
 * then type in the reason and it logs that as information for the future to
 * make it smarter". The reason is the part worth having, so both answers ask
 * for one; neither insists, because an answer with no reason still says which
 * way it went.
 */
function Answer({
  cropId,
  onYes,
  onNo,
  yesLabel,
}: {
  cropId: string
  onYes: (reason: string | null) => void
  onNo: (reason: string | null) => void
  yesLabel: string
}) {
  const [asking, setAsking] = useState<'yes' | 'no' | null>(null)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState<'yes' | 'no' | null>(null)

  if (done)
    return (
      <p className="mt-1 text-[11px] text-gray-500">
        {done === 'yes' ? 'Taken' : 'Noted'} — the reason is kept for next time.
      </p>
    )

  if (asking)
    return (
      <div className="mt-1 space-y-1">
        <textarea
          autoFocus
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={asking === 'yes' ? 'Why this one?' : 'Why not?'}
          aria-label={asking === 'yes' ? 'Why this one' : 'Why not'}
          className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px] text-gray-900"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              const r = reason.trim() || null
              if (asking === 'yes') onYes(r)
              else onNo(r)
              setDone(asking)
            }}
            className="rounded bg-brand-700 px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-800"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setAsking(null)
              setReason('')
            }}
            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      <button
        key={`${cropId}-yes`}
        type="button"
        onClick={() => setAsking('yes')}
        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={() => setAsking('no')}
        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
      >
        No — say why
      </button>
    </div>
  )
}

/**
 * The same crop two years running, when the rules say otherwise.
 *
 * Sam, 28 Oct 2026: "ask if we actually want to do that and if so then ask
 * if we want to change the rule to match what we are doing." Both answers are
 * on one screen, because they are one decision: plan it and leave the rule to
 * complain every year, or plan it and let the rule follow.
 */
function RepeatAnyway({
  q,
  fieldName,
  year,
  prevCropName,
  canEditRules,
  onPlanIt,
  onClose,
}: {
  q: RepeatQuestion
  fieldName: string
  year: number
  prevCropName: string | null
  canEditRules: boolean
  onPlanIt: (changeRule: boolean, reason: string | null) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const ruleLine =
    q.fix === 'in_a_row'
      ? `${q.cropName} may follow itself ${q.run} ${q.run === 1 ? 'year' : 'years'} in a row (it is ${q.allowedInARow} today).`
      : q.fix === 'succession' && prevCropName
        ? `${q.cropName} may follow ${prevCropName} — the sheet says never today.`
        : null

  return (
    <Modal title={`${q.cropName} again on ${fieldName}?`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-800">
          {q.cropName} is on {fieldName} in {year - 1} as well, so {year} would be year {q.run} in a
          row.
        </p>
        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {q.breaks.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        <label className="block text-xs text-gray-500">
          Why, for next time
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. the stand is still good, or the contract wants it"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPlanIt(false, reason.trim() || null)}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Plan it anyway
          </button>
          {canEditRules && ruleLine && (
            <button
              type="button"
              onClick={() => onPlanIt(true, reason.trim() || null)}
              title={ruleLine}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Plan it and change the rule
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
        {canEditRules && ruleLine && (
          <p className="text-[11px] text-gray-500">Changing the rule: {ruleLine}</p>
        )}
      </div>
    </Modal>
  )
}

/**
 * Edit, then Save, one year at a time.
 *
 * A column is opened on purpose, filled in, and closed again by saving it;
 * everything else stays read-only meanwhile, so there is never a question of
 * which year a click lands in. Saving writes the whole column at once.
 */
function ColumnEdit({
  year,
  editing,
  busy,
  blocked,
  changes,
  onEdit,
  onSave,
  onCancel,
}: {
  year: number
  editing: boolean
  busy: boolean
  /** Another year is open: finish that one first. */
  blocked: boolean
  changes: number
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
}) {
  if (!editing)
    return (
      <button
        type="button"
        onClick={onEdit}
        disabled={blocked}
        title={blocked ? 'Finish the year you have open first' : `Edit ${year}`}
        className="mt-0.5 flex w-full items-center justify-center gap-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-gray-600 hover:bg-gray-50 disabled:opacity-30"
      >
        <Pencil className="h-3 w-3" /> Edit
      </button>
    )
  return (
    <span className="mt-0.5 flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        title={
          changes
            ? `Save ${changes} field${changes === 1 ? '' : 's'} and close ${year}`
            : `Close ${year}`
        }
        className="flex items-center gap-1 rounded bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-white hover:bg-brand-800 disabled:opacity-50"
      >
        <Check className="h-3 w-3" /> {busy ? 'Saving\u2026' : changes ? `Save ${changes}` : 'Done'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        title={
          changes
            ? `Throw away ${changes} change${changes === 1 ? '' : 's'}`
            : 'Close without changing anything'
        }
        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-gray-600 hover:bg-gray-50"
      >
        Cancel
      </button>
    </span>
  )
}

export function RotationPlanner({
  isManager,
  view = 'plan',
}: {
  isManager: boolean
  view?: 'plan' | 'advice'
}) {
  const { cropYear, setCropYear } = useCropYear()
  const navigate = useNavigate()
  // A crop-share partner reads every one of our fields here and plans only
  // his own field-years (lib/partner-view.ts); staff get the usual list.
  const { data: fields } = useRotationFields()
  const { partner, canWrite } = usePartnerAccess()
  const canPlan = isManager || partner
  const canCell = (fieldId: string, year: number) => isManager || canWrite(fieldId, year)
  const { data: crops } = useCrops()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: rules } = useSuccessionRules()
  const { data: allZones } = useAllCropZones()
  const { data: inspections } = useFieldInspections()
  const setInspection = useSetFieldInspection()
  const [inspecting, setInspecting] = useState<{
    fieldId: string
    fieldName: string
    year: number
    cropId: string | null
  } | null>(null)

  const inspByFieldYear = useMemo(() => {
    const m = new Map<string, FieldInspection>()
    for (const i of inspections ?? []) m.set(`${i.field_id}:${i.crop_year}`, i)
    return m
  }, [inspections])

  // (field_id, year) → the crop zones splitting that field (multi-crop fields).
  const zonesByFieldYear = useMemo(() => {
    const m = new Map<string, { crop_id: string; acres: number }[]>()
    for (const z of allZones ?? []) {
      const k = `${z.field_id}:${z.crop_year}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push({ crop_id: z.crop_id, acres: Number(z.acres ?? 0) })
    }
    return m
  }, [allZones])

  /*
   * Which year the plan starts at (Sam, 28 Oct 2026). It used to start at the
   * crop year, which is right until the drill is parked: once the farm is
   * seeded there is nothing left to decide about this year, and the first
   * editable column sat second. Everything that is ours to seed in 2026 is
   * seeded, so the plan now opens on 2027 and says why.
   */
  const progress = useSeedingProgress(cropYear)
  const planFrom = useMemo(
    () => firstPlanYear(cropYear, progress.data?.years ?? []),
    [cropYear, progress.data],
  )
  const planted = progress.data?.planted ?? EMPTY_SET
  const { planYears, histYears, allYears } = useMemo(() => {
    const planYears = [planFrom, planFrom + 1, planFrom + 2, planFrom + 3]
    // Four years back, not two (Sam, 28 Oct 2026): a four-year return
    // interval cannot be judged against two years of history.
    const histYears = [planFrom - 4, planFrom - 3, planFrom - 2, planFrom - 1]
    return { planYears, histYears, allYears: [...histYears, ...planYears] }
  }, [planFrom])

  // Fixed-count hooks for the eight columns.
  const h4 = useCropHistoryByYear(planFrom - 4)
  const h3 = useCropHistoryByYear(planFrom - 3)
  const h2 = useCropHistoryByYear(planFrom - 2)
  const h1 = useCropHistoryByYear(planFrom - 1)
  // The year just gone is history with holes — crop_history gets its row when
  // the field is harvested or imported, which has not happened everywhere yet.
  // Its plan fills the gaps so a planted field is never blank.
  const hp = useCropPlans(planFrom - 1)
  const p0 = useCropPlans(planFrom)
  const p1 = useCropPlans(planFrom + 1)
  const p2 = useCropPlans(planFrom + 2)
  const p3 = useCropPlans(planFrom + 3)

  // Which fields are in the plan each year, and the other crops each field-year
  // could carry.
  const { data: fieldYearRows } = useFieldYearPlan()
  const fieldYears = useMemo(() => fieldYearMap(fieldYearRows ?? []), [fieldYearRows])
  const oursIn = (fieldId: string, year: number) =>
    fieldYears.get(`${fieldId}:${year}`)?.ours ?? true
  const { data: optionRows } = useCropPlanOptions()
  const options = useMemo(() => optionsMap(optionRows ?? []), [optionRows])
  // Is the field normally ours at all? False for a neighbour's quarter taken a
  // year at a time, where only the years ticked in count.
  const ourFields = useMemo(
    () => new Map((fields ?? []).map((f) => [f.id, f.ours_by_default ?? true])),
    [fields],
  )
  const fieldOurs = (fieldId: string) => ourFields.get(fieldId) ?? true
  const setChoices = useSetPlanChoices()
  const setFieldYear = useSetFieldYear()
  /** The cell whose crop list is open. */
  const [editing, setEditing] = useState<{ fieldId: string; year: number } | null>(null)
  const [adding, setAdding] = useState(false)

  // Why we chose what we chose, read back into the advice.
  const { data: feedbackRows } = useRotationFeedback()
  const past = useMemo(() => pastChoices(feedbackRows ?? []), [feedbackRows])
  const addFeedback = useAddRotationFeedback()
  const setRotationSettings = useSetCropRotationSettings()
  const { setPreference } = useSuccessionMutations()
  /** A crop being planned on top of itself, waiting on an answer. */
  const [repeat, setRepeat] = useState<{
    q: RepeatQuestion
    fieldName: string
    year: number
    prevCropId: string | null
    apply: () => void
  } | null>(null)

  /*
   * One year at a time (Sam, 29 Oct 2026): "you choose the column and it
   * allows you to edit cells in that column but then you hit save and locks
   * the column... When not editing the column looks like history columns."
   *
   * Everything typed goes into `draft` and nothing is written until Save, so
   * a year is one decision rather than twenty. A field already planted stays
   * locked inside an open column — that part of the year is settled.
   */
  const [editYear, setEditYear] = useState<number | null>(null)
  const [draft, setDraft] = useState<Map<string, string[]>>(new Map())
  const saveColumn = useSavePlanColumn()
  const startEditing = (y: number) => {
    setEditYear(y)
    setDraft(new Map())
  }
  const stopEditing = () => {
    setEditYear(null)
    setDraft(new Map())
  }

  const setCrop = useSetRotationCrop()
  const bulk = useBulkSetRotation()

  const activeCrops = useMemo<CropInfo[]>(
    () =>
      (crops ?? [])
        .filter((c) => c.active)
        .map((c) => ({
          id: c.id,
          name: c.name,
          min_return_years: c.min_return_years,
          max_in_a_row: c.max_in_a_row ?? 1,
          stand_max_years: c.stand_max_years ?? null,
          color: c.color,
        })),
    [crops],
  )
  // Every crop, retired ones too: the history names crops no longer grown
  // (plain "Canola"), and a lookup among active ones lost them — no name, no
  // return interval, no succession rule.
  const cropMap = useMemo(
    () =>
      new Map<string, CropInfo>(
        (crops ?? []).map((c) => [
          c.id,
          {
            id: c.id,
            name: c.name,
            min_return_years: c.min_return_years,
            max_in_a_row: c.max_in_a_row ?? 1,
            stand_max_years: c.stand_max_years ?? null,
            color: c.color,
          },
        ]),
      ),
    [crops],
  )
  const succession = useMemo(() => buildSuccessionMap(rules ?? []), [rules])
  const successionNotes = useMemo(() => buildSuccessionNotes(rules ?? []), [rules])
  const ctx = useRotationContext(cropYear)
  // The crop cell whose rule breaks are open, with their label links.
  const [alertCell, setAlertCell] = useState<{ title: string; violations: Violation[] } | null>(
    null,
  )

  /** Every rule a planned crop breaks: rotation, succession (with reasons), and herbicide carryover. */
  const problems = (fieldId: string, cid: string, y: number, sets: Map<number, Set<string>>) =>
    labelProblems(
      fieldId,
      cid,
      y,
      sets,
      checkPlacement(cid, y, sets, cropMap, succession, successionNotes),
    )

  /**
   * A cell opens the field, in that year (Sam, 28 Oct 2026: "if I click on a
   * cell, for example 2025 #4 Sainfoin it will take me to that fields detailed
   * view under that year"). The crop year is the app's, so the field's page
   * opens on the season the cell is about.
   */
  const openField = (fieldId: string, year: number) => {
    setCropYear(year)
    navigate(`/fields/${fieldId}`)
  }

  /** A split cell: every crop area checked against the field's earlier seasons, plus each one's label/scouting hits. */
  const splitProblems = (
    fieldId: string,
    cropIds: string[],
    y: number,
    sets: Map<number, Set<string>>,
  ) => {
    const v = checkSplitPlacement(cropIds, y, sets, cropMap, succession, successionNotes)
    const seen = new Set(v.map((x) => `${x.kind}|${x.message}`))
    for (const cid of new Set(cropIds)) {
      for (const x of labelProblems(fieldId, cid, y, sets, [])) {
        const k = `${x.kind}|${x.message}`
        if (!seen.has(k)) {
          seen.add(k)
          v.push(x)
        }
      }
    }
    return v
  }

  /** Scouting, herbicide carryover and canola-trait hits for one crop, appended to `v`. */
  const labelProblems = (
    fieldId: string,
    cid: string,
    y: number,
    sets: Map<number, Set<string>>,
    v: Violation[],
  ) => {
    if (ctx.ready) {
      const name = cropMap.get(cid)?.name ?? ''
      for (const h of scoutHits(cropKey(name), ctx.scoutingByField.get(fieldId) ?? [], y)) {
        v.push(
          h.block
            ? { kind: 'succession', message: `🔎 ${h.message}` }
            : { kind: 'caution', message: `🔎 ${h.message}` },
        )
      }
      for (const h of carryover(
        cropKey(name),
        ctx.appsByField.get(fieldId) ?? [],
        ctx.rulesByReg,
        `${y}-05-01`,
      )) {
        const label = { registration: h.registration, quote: h.quote }
        v.push(
          h.block
            ? { kind: 'herbicide', message: h.message, ...label }
            : { kind: 'caution', message: `🧪 ${h.message}`, ...label },
        )
      }
      // Seed canola on a field whose recent canola had the same herbicide trait.
      const trait = ctx.traitOf(cid)
      if (trait) {
        for (const m of volunteerConflicts({ name, trait }, y, ctx.canolaYears(fieldId, sets)))
          v.push({ kind: 'caution', message: m })
      }
    }
    return v
  }

  // field_id → acres (from the current boundary).
  const fieldAcres = useMemo(() => {
    const b = boundariesForYear(allBoundaries ?? [], cropYear)
    const m = new Map<string, number>()
    for (const bd of b) m.set(bd.field_id, Number(bd.acres ?? 0))
    return m
  }, [allBoundaries, cropYear])

  // field_id → (year → crop_id), from history + plans. History wins where both
  // exist: it is what grew, the plan is only what was meant to.
  const timelines = useMemo(() => {
    const m = new Map<string, Map<number, string>>()
    const put = (fid: string, year: number, cid: string | null | undefined) => {
      if (!cid) return
      if (!m.has(fid)) m.set(fid, new Map())
      m.get(fid)!.set(year, cid)
    }
    const fill = (fid: string, year: number, cid: string | null | undefined) => {
      if (!cid || m.get(fid)?.has(year)) return
      put(fid, year, cid)
    }
    ;(h4.data ?? []).forEach((r) => put(r.field_id, planFrom - 4, r.crop_id))
    ;(h3.data ?? []).forEach((r) => put(r.field_id, planFrom - 3, r.crop_id))
    ;(h2.data ?? []).forEach((r) => put(r.field_id, planFrom - 2, r.crop_id))
    ;(h1.data ?? []).forEach((r) => put(r.field_id, planFrom - 1, r.crop_id))
    ;(hp.data ?? []).forEach((r) => fill(r.field_id, planFrom - 1, r.crop_id))
    ;(p0.data ?? []).forEach((r) => put(r.field_id, planFrom, r.crop_id))
    ;(p1.data ?? []).forEach((r) => put(r.field_id, planFrom + 1, r.crop_id))
    ;(p2.data ?? []).forEach((r) => put(r.field_id, planFrom + 2, r.crop_id))
    ;(p3.data ?? []).forEach((r) => put(r.field_id, planFrom + 3, r.crop_id))
    return m
  }, [h4.data, h3.data, h2.data, h1.data, hp.data, p0.data, p1.data, p2.data, p3.data, planFrom])

  // field_id → (year → set of crops that year). A split field carries several
  // crops in one year; used for rule checks (succession must follow each of them).
  const cropSetsByField = useMemo(() => {
    const m = new Map<string, Map<number, Set<string>>>()
    for (const f of fields ?? []) {
      const byYear = new Map<number, Set<string>>()
      for (const y of allYears) {
        const zones = zonesByFieldYear.get(`${f.id}:${y}`)
        if (zones && zones.length) byYear.set(y, new Set(zones.map((z) => z.crop_id)))
        else {
          const cid = timelines.get(f.id)?.get(y)
          if (cid) byYear.set(y, new Set([cid]))
        }
      }
      m.set(f.id, byYear)
    }
    return m
  }, [fields, timelines, zonesByFieldYear, allYears])

  // Per-year acres by crop (the forecast the user asked for). A split field
  // contributes its zone acres per crop; otherwise the whole field's acres go to
  // its single planned/historical crop.
  const totals = useMemo(() => {
    const byYear = new Map<number, Map<string, number>>(allYears.map((y) => [y, new Map()]))
    const addAc = (y: number, cid: string, ac: number) => {
      const ym = byYear.get(y)!
      ym.set(cid, (ym.get(cid) ?? 0) + ac)
    }
    for (const f of fields ?? []) {
      const tl = timelines.get(f.id)
      const ac = fieldAcres.get(f.id) ?? 0
      for (const y of allYears) {
        // A year somebody else has the field does not add acres to our
        // forecast, whatever is recorded against it.
        if (!(fieldYears.get(`${f.id}:${y}`)?.ours ?? true)) continue
        const zones = zonesByFieldYear.get(`${f.id}:${y}`)
        if (zones && zones.length) {
          for (const z of zones) addAc(y, z.crop_id, z.acres)
        } else {
          const cid = tl?.get(y)
          if (cid) addAc(y, cid, ac)
        }
      }
    }
    return byYear
  }, [fields, timelines, fieldAcres, allYears, zonesByFieldYear, fieldYears])

  // Every crop with acres against it, retired ones included: a crop taken off
  // the list while a plan still names it must keep its row, or the acres go
  // missing from the forecast with nothing said.
  const cropsInPlan = useMemo(() => {
    const ids = new Set<string>()
    for (const ym of totals.values()) for (const id of ym.keys()) ids.add(id)
    return [...ids]
      .flatMap((id) => {
        const c = cropMap.get(id)
        return c ? [c] : []
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [totals, cropMap])

  // Clickable inspection dot: grey = none/pending, green = passed, red = failed.
  const inspBadge = (fieldId: string, fieldName: string, year: number, cid: string | undefined) => {
    const insp = inspByFieldYear.get(`${fieldId}:${year}`)
    const dot =
      insp?.status === 'passed'
        ? 'bg-green-500'
        : insp?.status === 'failed'
          ? 'bg-red-500'
          : 'border border-gray-300 bg-white'
    const title = insp
      ? `Inspection: ${insp.status}${insp.rating ? ` · ${insp.rating}` : ''}${insp.notes ? ` — ${insp.notes}` : ''}`
      : 'Record crop inspection'
    return (
      <button
        onClick={() => setInspecting({ fieldId, fieldName, year, cropId: cid ?? null })}
        title={title}
        aria-label="Crop inspection"
        className="shrink-0"
      >
        <span className={cn('inline-block h-2.5 w-2.5 rounded-full', dot)} />
      </button>
    )
  }

  const suggestEmpty = () => {
    const rows: {
      field_id: string
      crop_year: number
      crop_id: string
      planned_acres: number | null
    }[] = []
    for (const f of fields ?? []) {
      // Clone the field's crop-sets so later years see earlier suggestions.
      const sets = new Map<number, Set<string>>()
      for (const [y, s] of cropSetsByField.get(f.id) ?? []) sets.set(y, new Set(s))
      for (const y of planYears) {
        if (sets.get(y)?.size) continue // already planned (or a split year)
        if (!oursIn(f.id, y)) continue // somebody else has it that year
        if (planted.has(`${f.id}:${y}`)) continue // in the ground already
        const cid = suggestCrop(y, sets, activeCrops, cropMap, succession)
        if (cid) {
          sets.set(y, new Set([cid]))
          rows.push({
            field_id: f.id,
            crop_year: y,
            crop_id: cid,
            planned_acres: fieldAcres.get(f.id) ?? null,
          })
        }
      }
    }
    if (rows.length) bulk.mutate(rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {view === 'plan' ? (
          <p className="text-sm text-gray-600">
            Crops for {planYears[0]}–{planYears[3]}, with {histYears[0]}–{histYears[3]} behind them.{' '}
            {planFrom > cropYear && (
              <span className="text-gray-500">
                {cropYear} is all planted, so planning starts at {planFrom}.
              </span>
            )}
          </p>
        ) : (
          <span />
        )}
        {isManager && view === 'plan' && (
          <div className="flex gap-2">
            <button
              onClick={suggestEmpty}
              // It writes straight to the plans, which an open column's draft
              // would then be out of step with.
              disabled={bulk.isPending || editYear != null}
              title={editYear != null ? `Save or cancel ${editYear} first` : undefined}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />{' '}
              {bulk.isPending ? 'Filling…' : 'Suggest empty cells'}
            </button>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" /> Field for one year
            </button>
          </div>
        )}
      </div>

      {view === 'advice' && (
        <RotationAdvisor
          isManager={isManager}
          planYears={planYears}
          fields={(fields ?? []).map((f) => ({ id: f.id, name: f.name }))}
          fieldAcres={fieldAcres}
          cropSetsByField={cropSetsByField}
          succession={succession}
          notes={successionNotes}
          plannedFor={(fid, y) => timelines.get(fid)?.get(y)}
          // Auto-fill acts only on plans read from the server this visit, not
          // on the offline copy the page opens with.
          plansFresh={[p1, p2, p3].every((q) => q.isFetchedAfterMount && !q.isFetching)}
        />
      )}

      {view === 'plan' && (
        <>
          <p className="flex flex-wrap gap-x-4 text-[11px] text-gray-500">
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-50 ring-2 ring-red-400" />
              breaks a rule — rotation, crop after crop, or herbicide carryover (hover for the
              product and the label&apos;s reason)
            </span>
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-amber-400" />
              caution
            </span>
          </p>

          {/*
        One card a field on a phone (Sam, 28 Oct 2026). Eight year columns on
        a 375 px screen left every crop name about a word wide; the history runs
        as one line and the years to plan as tappable rows.
      */}
          {/* The same one-year-at-a-time rule on a phone, where the column
              headers are not there to carry it. */}
          {canPlan && (
            <div className="flex flex-wrap items-center gap-1.5 sm:hidden">
              {editYear == null ? (
                <>
                  <span className="text-[11px] text-gray-500">Edit a year:</span>
                  {planYears.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => startEditing(y)}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700"
                    >
                      {y}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <span className="text-xs font-semibold text-brand-800">Editing {editYear}</span>
                  <button
                    type="button"
                    disabled={saveColumn.isPending}
                    onClick={() => {
                      const rows = [...draft].map(([field_id, crop_ids]) => ({
                        field_id,
                        crop_ids,
                        planned_acres: crop_ids.length ? (fieldAcres.get(field_id) ?? null) : null,
                      }))
                      if (!rows.length) {
                        stopEditing()
                        return
                      }
                      saveColumn.mutate({ crop_year: editYear, rows }, { onSuccess: stopEditing })
                    }}
                    className="rounded bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {saveColumn.isPending
                      ? 'Saving\u2026'
                      : draft.size
                        ? `Save ${draft.size}`
                        : 'Done'}
                  </button>
                  <button
                    type="button"
                    onClick={stopEditing}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white sm:hidden">
            {(fields ?? []).map((f) => {
              const tl = timelines.get(f.id) ?? new Map<number, string>()
              const sets = cropSetsByField.get(f.id) ?? new Map<number, Set<string>>()
              return (
                <li key={f.id} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                      {f.name}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                      {n0(fieldAcres.get(f.id) ?? 0)} ac
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                    {histYears.map((y) => {
                      const cid = tl.get(y)
                      const zones = zonesByFieldYear.get(`${f.id}:${y}`)
                      // Several crops read as the crops themselves, not "split · 2".
                      const label = zones?.length
                        ? zones.map((z) => cropMap.get(z.crop_id)?.name ?? 'crop').join(' + ')
                        : !oursIn(f.id, y)
                          ? 'not ours'
                          : (cropMap.get(cid ?? '')?.name ?? '\u2014')
                      return (
                        <button
                          key={y}
                          type="button"
                          onClick={() => openField(f.id, y)}
                          title={`Open ${f.name} in ${y}`}
                          className="inline-flex items-center gap-1"
                        >
                          <span className="tabular-nums text-gray-400">{String(y).slice(2)}</span>
                          <span
                            className={cn(
                              cid || zones?.length
                                ? 'text-gray-700 hover:underline'
                                : 'text-gray-300',
                            )}
                          >
                            {label}
                          </span>
                        </button>
                      )
                    })}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {planYears.map((y) => {
                      const cid = tl.get(y)
                      const zones = zonesByFieldYear.get(`${f.id}:${y}`)
                      const ours = oursIn(f.id, y)
                      const locked = planted.has(`${f.id}:${y}`)
                      const alts = options.get(`${f.id}:${y}`) ?? []
                      const picked =
                        (editYear === y && draft.get(f.id)) || (cid ? [cid, ...alts] : alts)
                      const violations = ours && !locked && cid ? problems(f.id, cid, y, sets) : []
                      const bad = violations.some((v) => v.kind !== 'caution')
                      const warn = !bad && violations.length > 0
                      return (
                        <li key={y} className="flex items-center gap-2">
                          <span className="w-10 shrink-0 text-xs tabular-nums text-gray-400">
                            {y}
                          </span>
                          {!ours ? (
                            <span className="flex-1 text-xs text-gray-400">
                              Not ours
                              {fieldYears.get(`${f.id}:${y}`)?.rented_to
                                ? ` — ${fieldYears.get(`${f.id}:${y}`)!.rented_to}`
                                : ''}
                            </span>
                          ) : zones?.length ? (
                            <button
                              type="button"
                              onClick={() => openField(f.id, y)}
                              className="flex-1 text-left text-xs text-gray-600 hover:underline"
                            >
                              {zones.map((z) => cropMap.get(z.crop_id)?.name ?? 'crop').join(' + ')}{' '}
                              — split, edit on the map
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={!canCell(f.id, y) || locked || editYear !== y}
                              title={
                                locked
                                  ? `Planted in ${y}`
                                  : editYear === y
                                    ? `Pick the crops for ${y}`
                                    : `Press Edit on ${y} first`
                              }
                              onClick={() => setEditing({ fieldId: f.id, year: y })}
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs',
                                bad
                                  ? 'border-red-400 bg-red-50'
                                  : warn
                                    ? 'border-amber-400'
                                    : 'border-gray-200',
                                locked ? 'bg-gray-50 text-gray-600' : 'text-gray-900',
                              )}
                            >
                              {locked && <Lock className="h-3 w-3 shrink-0 text-gray-400" />}
                              {picked.length ? (
                                <span className="min-w-0 flex-1 truncate">
                                  {picked.map((id) => cropMap.get(id)?.name ?? '?').join(' or ')}
                                </span>
                              ) : (
                                <span className="flex-1 text-gray-400">Pick a crop</span>
                              )}
                              {(bad || warn) && (
                                <AlertTriangle
                                  className={cn(
                                    'h-3.5 w-3.5 shrink-0',
                                    bad ? 'text-red-500' : 'text-amber-500',
                                  )}
                                />
                              )}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>

          {/* Planner grid */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-2 py-2 text-right font-medium">Acres</th>
                  {allYears.map((y) => (
                    <th
                      key={y}
                      className={cn(
                        'px-2 py-2 text-center font-medium',
                        // A history year recedes. On the green bar that is a
                        // pale green, not the grey that worked on white.
                        y < planFrom && TABLE_TH_MUTED,
                        // The year being planned now, picked out so it is obvious
                        // which column the work is in (Sam, 28 Oct 2026),
                        // and a shade darker again on 29 Oct. One background
                        // or the other, never both: two bg- classes on one
                        // element are settled by the order Tailwind happens to
                        // emit them in, not by the order written here.
                        y === planFrom
                          ? 'bg-brand-200 text-brand-900'
                          : editYear === y && 'bg-brand-100 text-brand-900',
                      )}
                    >
                      <span className="whitespace-nowrap">
                        {y}
                        {y < planFrom && <span className="ml-1 normal-case">(history)</span>}
                        {y === planFrom && editYear !== y && (
                          <span className="ml-1 normal-case">(planning now)</span>
                        )}
                      </span>
                      {canPlan && y >= planFrom && (
                        <ColumnEdit
                          year={y}
                          editing={editYear === y}
                          busy={saveColumn.isPending}
                          blocked={editYear != null && editYear !== y}
                          changes={editYear === y ? draft.size : 0}
                          onEdit={() => startEditing(y)}
                          onCancel={stopEditing}
                          onSave={() => {
                            const rows = [...draft].map(([field_id, crop_ids]) => ({
                              field_id,
                              crop_ids,
                              planned_acres: crop_ids.length
                                ? (fieldAcres.get(field_id) ?? null)
                                : null,
                            }))
                            if (!rows.length) {
                              stopEditing()
                              return
                            }
                            saveColumn.mutate({ crop_year: y, rows }, { onSuccess: stopEditing })
                          }}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(fields ?? []).map((f) => {
                  const tl = timelines.get(f.id) ?? new Map<number, string>()
                  const sets = cropSetsByField.get(f.id) ?? new Map<number, Set<string>>()
                  return (
                    <tr key={f.id} className="border-b border-gray-100 last:border-0 last:[&>td]:border-b-0">
                      <td className="px-3 py-1.5 font-medium text-gray-900">{f.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                        {n0(fieldAcres.get(f.id) ?? 0)}
                      </td>
                      {allYears.map((y) => {
                        const cid = tl.get(y)
                        const isHist = y < planFrom
                        const zones = zonesByFieldYear.get(`${f.id}:${y}`)
                        // A year somebody else farms it: no crop of ours to plan or
                        // to check, and its acres are out of the forecast.
                        if (!oursIn(f.id, y)) {
                          const fy = fieldYears.get(`${f.id}:${y}`)
                          return (
                            <td key={y} className="px-2 py-1.5 text-center">
                              <span
                                className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-400"
                                title={[
                                  fy?.rented_to
                                    ? `${fy.rented_to} has it in ${y}`
                                    : `Not ours in ${y}`,
                                  fy?.note,
                                ]
                                  .filter(Boolean)
                                  .join(' — ')}
                              >
                                not ours
                              </span>
                              {isManager && !isHist && (
                                <button
                                  type="button"
                                  title={`Put ${f.name} back in the ${y} plan`}
                                  onClick={() =>
                                    setFieldYear.mutate({
                                      field_id: f.id,
                                      crop_year: y,
                                      ours: true,
                                      ours_by_default: fieldOurs(f.id),
                                    })
                                  }
                                  className="ml-1 text-gray-300 hover:text-brand-700"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          )
                        }
                        if (zones && zones.length) {
                          // Past seasons aren't checked (as for single-crop cells).
                          const zv = isHist
                            ? []
                            : splitProblems(
                                f.id,
                                zones.map((z) => z.crop_id),
                                y,
                                sets,
                              )
                          const zBad = zv.some((v) => v.kind !== 'caution')
                          const zWarn = !zBad && zv.length > 0
                          const summary = zones
                            .map(
                              (z) =>
                                `${cropMap.get(z.crop_id)?.name ?? 'crop'} ${Math.round(z.acres)}ac`,
                            )
                            .join(', ')
                          return (
                            <td
                              key={y}
                              className={cn(
                                'px-2 py-1.5 text-center',
                                y === planFrom && 'border-b border-brand-200 bg-brand-100',
                              )}
                            >
                              {/* Both crops, one above the other (Sam, 28 Oct
                              2026) — "split · 2" said how many but never which. */}
                              <span
                                className={cn(
                                  'inline-flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-600',
                                  zBad
                                    ? 'bg-red-50 ring-2 ring-red-400'
                                    : zWarn && 'ring-1 ring-amber-400',
                                )}
                                title={`Split: ${summary} — edit on the map${zv.length ? `\n${zv.map((v) => `${v.kind === 'herbicide' ? '🧪 ' : v.kind === 'caution' ? '⚠ ' : '⛔ '}${v.message}`).join('\n')}` : ''}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => openField(f.id, y)}
                                  title={`Open ${f.name} in ${y}`}
                                  className="text-left hover:text-brand-700 hover:underline"
                                >
                                  {zones.map((z, i) => (
                                    <span key={i} className="block whitespace-nowrap">
                                      {cropMap.get(z.crop_id)?.name ?? 'crop'}
                                      <span className="ml-1 tabular-nums text-gray-400">
                                        {Math.round(z.acres)} ac
                                      </span>
                                    </span>
                                  ))}
                                </button>
                                {(zBad || zWarn) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAlertCell({
                                        title: `${f.name} · ${y} · ${summary}`,
                                        violations: zv,
                                      })
                                    }
                                    aria-label="What this split breaks, with the labels"
                                    className="shrink-0 rounded hover:bg-white"
                                  >
                                    <AlertTriangle
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        zBad ? 'text-red-500' : 'text-amber-500',
                                      )}
                                    />
                                  </button>
                                )}
                              </span>
                            </td>
                          )
                        }
                        if (isHist) {
                          return (
                            <td key={y} className="px-2 py-1.5 text-center">
                              {cid ? (
                                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                  <button
                                    type="button"
                                    onClick={() => openField(f.id, y)}
                                    title={`Open ${f.name} in ${y}`}
                                    className="hover:underline hover:text-brand-700"
                                  >
                                    {cropMap.get(cid)?.name ?? '\u2014'}
                                  </button>
                                  {inspBadge(f.id, f.name, y, cid)}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openField(f.id, y)}
                                  title={`Open ${f.name} in ${y}`}
                                  className="text-gray-300 hover:text-brand-700"
                                >
                                  —
                                </button>
                              )}
                            </td>
                          )
                        }
                        /*
                         * Planted and settled (Sam, 28 Oct 2026): "after a crop
                         * has been marked as planted, then fill in that field and
                         * lock it." The crop shown is what grew where the harvest
                         * or the import has filled it in, and the plan until then.
                         */
                        const locked = planted.has(`${f.id}:${y}`)
                        if (locked) {
                          return (
                            <td
                              key={y}
                              className={cn(
                                'px-2 py-1.5 text-center',
                                y === planFrom && 'border-b border-brand-200 bg-brand-100',
                              )}
                            >
                              <span
                                className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600"
                                title={`Planted in ${y} — the plan is settled. Change it on the field's own page.`}
                              >
                                <Lock className="h-3 w-3 shrink-0 text-gray-400" />
                                <button
                                  type="button"
                                  onClick={() => openField(f.id, y)}
                                  title={`Open ${f.name} in ${y}`}
                                  className="hover:underline hover:text-brand-700"
                                >
                                  {cid ? (cropMap.get(cid)?.name ?? '\u2014') : 'planted'}
                                </button>
                                {cid && inspBadge(f.id, f.name, y, cid)}
                              </span>
                            </td>
                          )
                        }
                        const alts = options.get(`${f.id}:${y}`) ?? []
                        const violations = cid ? problems(f.id, cid, y, sets) : []
                        const bad = violations.some((v) => v.kind !== 'caution')
                        const warn = !bad && violations.length > 0
                        const saved = cid ? [cid, ...alts] : alts
                        // While its column is open, a cell shows what is typed
                        // into it rather than what is stored.
                        const editingCell = editYear === y
                        const pickedIds = (editingCell && draft.get(f.id)) || saved
                        const adviceInput = {
                          year: y,
                          cropSets: sets,
                          crops: activeCrops,
                          cropMap,
                          succession,
                          notes: successionNotes,
                          past,
                        }
                        const advice = adviseCell(pickedIds, adviceInput)
                        // What it would follow, for the reasons kept against
                        // the same pairing on any field.
                        const prevCropId = [...(sets.get(y - 1) ?? [])][0] ?? null
                        const answer = (cropId: string, accepted: boolean, reason: string | null) =>
                          addFeedback.mutate({
                            field_id: f.id,
                            crop_year: y,
                            crop_id: cropId,
                            after_crop_id: prevCropId,
                            verdict:
                              advice.ranked.find((a) => a.cropId === cropId)?.verdict ?? 'possible',
                            accepted,
                            reason,
                          })
                        const setPicked = (ids: string[]) => {
                          if (editingCell) {
                            setDraft((d) => new Map(d).set(f.id, ids))
                            return
                          }
                          setChoices.mutate({
                            field_id: f.id,
                            crop_year: y,
                            crop_ids: ids,
                            planned_acres: ids.length ? (fieldAcres.get(f.id) ?? null) : null,
                          })
                        }
                        // A column that is not open reads like the history
                        // beside it: the crops, and the flag if they break a
                        // rule. Nothing to change until Edit is pressed.
                        if (!editingCell) {
                          return (
                            <td
                              key={y}
                              className={cn(
                                'px-2 py-1.5 text-center',
                                y === planFrom && 'border-b border-brand-200 bg-brand-100',
                              )}
                            >
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded px-1 text-xs',
                                  bad
                                    ? 'bg-red-50 ring-2 ring-red-400'
                                    : warn && 'ring-1 ring-amber-400',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => openField(f.id, y)}
                                  title={`Open ${f.name} in ${y}`}
                                  className={cn(
                                    'text-left hover:underline hover:text-brand-700',
                                    pickedIds.length ? 'text-gray-700' : 'text-gray-300',
                                  )}
                                >
                                  {pickedIds.length
                                    ? pickedIds
                                        .map((id) => cropMap.get(id)?.name ?? '?')
                                        .join(' or ')
                                    : '—'}
                                </button>
                                {(bad || warn) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAlertCell({
                                        title: `${f.name} · ${y} · ${cropMap.get(cid!)?.name ?? ''}`,
                                        violations,
                                      })
                                    }
                                    aria-label="What this crop breaks, with the labels"
                                    className="shrink-0 rounded hover:bg-white"
                                  >
                                    <AlertTriangle
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        bad ? 'text-red-500' : 'text-amber-500',
                                      )}
                                    />
                                  </button>
                                )}
                                {cid && inspBadge(f.id, f.name, y, cid)}
                              </span>
                            </td>
                          )
                        }
                        return (
                          <td
                            key={y}
                            className={cn('px-1 py-1', y === planFrom && 'border-b border-brand-200 bg-brand-100')}
                          >
                            <div
                              className={cn(
                                'rounded-md',
                                bad
                                  ? 'bg-red-50 ring-2 ring-red-400'
                                  : warn && 'ring-1 ring-amber-400',
                              )}
                              title={
                                violations.length
                                  ? violations
                                      .map(
                                        (v) =>
                                          `${v.kind === 'herbicide' ? '🧪 ' : v.kind === 'caution' ? '⚠ ' : '⛔ '}${v.message}`,
                                      )
                                      .join('\n')
                                  : undefined
                              }
                            >
                              <div className="flex items-center gap-1">
                                {/*
                              Tick as many crops as are in the running (Sam,
                              28 Oct 2026). The first ticked is the plan of
                              record — the budget, the acre forecast and the
                              fertility plan all read it — and the rest are
                              kept beside it so the thinking is not lost.
                            */}
                                <CheckSelect
                                  values={pickedIds}
                                  size="sm"
                                  disabled={!canCell(f.id, y)}
                                  ariaLabel={`${f.name} ${y} crops`}
                                  placeholder="Pick a crop"
                                  className="min-w-[7rem] flex-1"
                                  onToggle={(v) => {
                                    const taking = !pickedIds.includes(v)
                                    const next = taking
                                      ? [...pickedIds, v]
                                      : pickedIds.filter((x) => x !== v)
                                    // The same crop again when the rules say
                                    // no: ask, then offer to move the rule.
                                    const q = taking ? repeatQuestion(v, adviceInput) : null
                                    if (q) {
                                      setRepeat({
                                        q,
                                        fieldName: f.name,
                                        year: y,
                                        prevCropId,
                                        apply: () => setPicked(next),
                                      })
                                      return
                                    }
                                    setPicked(next)
                                  }}
                                  onMakeFirst={(v) =>
                                    setPicked([v, ...pickedIds.filter((x) => x !== v)])
                                  }
                                  options={cropChecks(advice.ranked)}
                                  footer={
                                    <CellAdvice
                                      advice={advice}
                                      onPick={(id) =>
                                        setPicked([id, ...pickedIds.filter((x) => x !== id)])
                                      }
                                      onAnswer={answer}
                                      canPick={canCell(f.id, y)}
                                    />
                                  }
                                />
                                <InfoPopover
                                  hover
                                  width={340}
                                  title={`${f.name} \u00b7 ${y}`}
                                  className="shrink-0"
                                >
                                  <CellAdvice
                                    advice={advice}
                                    onPick={(id) =>
                                      setPicked([id, ...pickedIds.filter((x) => x !== id)])
                                    }
                                    onAnswer={answer}
                                    canPick={canCell(f.id, y)}
                                  />
                                </InfoPopover>
                                {(bad || warn) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAlertCell({
                                        title: `${f.name} · ${y} · ${cropMap.get(cid!)?.name ?? ''}`,
                                        violations,
                                      })
                                    }
                                    aria-label="What this crop breaks, with the labels"
                                    className="shrink-0 rounded hover:bg-white"
                                  >
                                    <AlertTriangle
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        bad ? 'text-red-500' : 'text-amber-500',
                                      )}
                                    />
                                  </button>
                                )}
                                {cid && inspBadge(f.id, f.name, y, cid)}
                                {!cid && canCell(f.id, y) && (
                                  <button
                                    title="Suggest a valid crop"
                                    onClick={() => {
                                      const s = suggestCrop(
                                        y,
                                        sets,
                                        activeCrops,
                                        cropMap,
                                        succession,
                                      )
                                      if (s)
                                        setCrop.mutate({
                                          field_id: f.id,
                                          crop_year: y,
                                          crop_id: s,
                                          planned_acres: fieldAcres.get(f.id) ?? null,
                                        })
                                    }}
                                    className="shrink-0 text-gray-300 hover:text-brand-700"
                                  >
                                    <Wand2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              {/* The field itself, for everything the cell cannot say. */}
                              <button
                                type="button"
                                onClick={() => openField(f.id, y)}
                                title={`Open ${f.name} in ${y}`}
                                className="flex w-full items-center px-1 pb-0.5 text-left text-[10px] text-gray-400 hover:text-brand-700"
                              >
                                open the field
                              </button>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Acres per crop per year (the forecast) */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Total acres by crop &amp; year
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full min-w-[720px] text-sm">
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className="px-3 py-2 font-medium">Crop</th>
                    <th className="px-2 py-2 text-right font-medium">Max / yr</th>
                    {allYears.map((y) => (
                      <th
                        key={y}
                        className={cn(
                          'px-2 py-2 text-right font-medium',
                          y < planFrom && TABLE_TH_MUTED,
                        )}
                      >
                        {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cropsInPlan.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-1.5">{c.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                        {ctx.ready && ctx.maxFor(c.id, planFrom) != null
                          ? n0(ctx.maxFor(c.id, planFrom)!)
                          : '—'}
                      </td>
                      {allYears.map((y) => {
                        const a = totals.get(y)?.get(c.id) ?? 0
                        const max = ctx.ready && y >= planFrom ? ctx.maxFor(c.id, y) : null
                        const over = max != null && a > max + 0.5
                        return (
                          <td
                            key={y}
                            className={cn(
                              'px-2 py-1.5 text-right tabular-nums',
                              y < planFrom
                                ? 'text-gray-400'
                                : over
                                  ? 'bg-red-50 font-semibold text-red-700'
                                  : 'text-gray-800',
                            )}
                            title={
                              over ? `Over the ${n0(max!)} ac limit by ${n0(a - max!)}` : undefined
                            }
                          >
                            {a > 0 ? n0(a) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {ctx.ready &&
                    LIMIT_GROUPS.filter((g) => ctx.groupMaxFor(planFrom).has(g.group)).map((g) => {
                      const inGroup = cropsInPlan.filter(
                        (c) => groupOf(cropKey(c.name)) === g.group,
                      )
                      const cap = ctx.groupMaxFor(planFrom).get(g.group)!
                      return (
                        <tr key={g.group} className="border-t border-gray-200 bg-gray-50/60">
                          <td className="px-3 py-1.5 font-medium text-gray-700">{g.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                            {n0(cap)}
                          </td>
                          {allYears.map((y) => {
                            const a = inGroup.reduce(
                              (sum, c) => sum + (totals.get(y)?.get(c.id) ?? 0),
                              0,
                            )
                            const max = y >= planFrom ? ctx.groupMaxFor(y).get(g.group) : undefined
                            const over = max != null && a > max + 0.5
                            return (
                              <td
                                key={y}
                                className={cn(
                                  'px-2 py-1.5 text-right tabular-nums',
                                  y < planFrom
                                    ? 'text-gray-400'
                                    : over
                                      ? 'bg-red-50 font-semibold text-red-700'
                                      : 'text-gray-800',
                                )}
                                title={
                                  over
                                    ? `Over the ${n0(max!)} ac limit by ${n0(a - max!)}`
                                    : undefined
                                }
                              >
                                {a > 0 ? n0(a) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-3 py-2">Total planned</td>
                    <td />
                    {allYears.map((y) => {
                      const sum = [...(totals.get(y)?.values() ?? [])].reduce((s, v) => s + v, 0)
                      return (
                        <td key={y} className="px-2 py-2 text-right tabular-nums">
                          {sum > 0 ? n0(sum) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {repeat && (
        <RepeatAnyway
          q={repeat.q}
          fieldName={repeat.fieldName}
          year={repeat.year}
          canEditRules={isManager}
          prevCropName={repeat.prevCropId ? (cropMap.get(repeat.prevCropId)?.name ?? null) : null}
          onPlanIt={(changeRule, reason) => {
            repeat.apply()
            if (reason)
              addFeedback.mutate({
                field_id: null,
                crop_year: repeat.year,
                crop_id: repeat.q.cropId,
                after_crop_id: repeat.prevCropId,
                verdict: 'no_go',
                accepted: true,
                reason,
              })
            if (changeRule) {
              if (repeat.q.fix === 'in_a_row')
                setRotationSettings.mutate({ id: repeat.q.cropId, max_in_a_row: repeat.q.run })
              else if (repeat.q.fix === 'succession' && repeat.prevCropId)
                // Clearing the pairing, rather than rating it: an unlisted
                // pair is allowed, which is what "change the rule to match"
                // means here.
                setPreference.mutate({
                  prev: repeat.prevCropId,
                  next: repeat.q.cropId,
                  preference: null,
                })
            }
            setRepeat(null)
          }}
          onClose={() => setRepeat(null)}
        />
      )}
      {alertCell && (
        <RuleBreaks
          title={alertCell.title}
          violations={alertCell.violations}
          onClose={() => setAlertCell(null)}
        />
      )}
      {editing && (
        <PlanChoices
          isManager={canCell(editing.fieldId, editing.year)}
          fieldName={(fields ?? []).find((f) => f.id === editing.fieldId)?.name ?? ''}
          year={editing.year}
          crops={activeCrops}
          nameOf={(id) => cropMap.get(id)?.name ?? '?'}
          picked={(() => {
            const first = timelines.get(editing.fieldId)?.get(editing.year)
            const alts = options.get(`${editing.fieldId}:${editing.year}`) ?? []
            return first ? [first, ...alts] : alts
          })()}
          ours={oursIn(editing.fieldId, editing.year)}
          oursByDefault={fieldOurs(editing.fieldId)}
          rentedTo={fieldYears.get(`${editing.fieldId}:${editing.year}`)?.rented_to ?? null}
          problemsFor={(cid) =>
            problems(
              editing.fieldId,
              cid,
              editing.year,
              cropSetsByField.get(editing.fieldId) ?? new Map(),
            )
          }
          onSave={(ids) => {
            // Inside an open column it goes into the draft, like the grid;
            // the column's own Save is what writes it.
            if (editYear === editing.year) {
              setDraft((d) => new Map(d).set(editing.fieldId, ids))
              return
            }
            setChoices.mutate({
              field_id: editing.fieldId,
              crop_year: editing.year,
              crop_ids: ids,
              planned_acres: fieldAcres.get(editing.fieldId) ?? null,
            })
          }}
          onSetOurs={(ours) =>
            setFieldYear.mutate({
              field_id: editing.fieldId,
              crop_year: editing.year,
              ours,
              ours_by_default: fieldOurs(editing.fieldId),
            })
          }
          onClose={() => setEditing(null)}
        />
      )}
      {adding && <AddOneYearField years={planYears} onClose={() => setAdding(false)} />}
      {inspecting && (
        <InspectionModal
          isManager={isManager}
          fieldId={inspecting.fieldId}
          fieldName={inspecting.fieldName}
          year={inspecting.year}
          cropName={inspecting.cropId ? (cropMap.get(inspecting.cropId)?.name ?? null) : null}
          existing={inspByFieldYear.get(`${inspecting.fieldId}:${inspecting.year}`) ?? null}
          onClose={() => setInspecting(null)}
          onSave={(patch) =>
            setInspection.mutate(
              {
                field_id: inspecting.fieldId,
                crop_year: inspecting.year,
                crop_id: inspecting.cropId,
                ...patch,
              },
              { onSuccess: () => setInspecting(null) },
            )
          }
        />
      )}
    </div>
  )
}

/**
 * Every crop that could go on one field in one year, in order of preference.
 *
 * Four years out the answer is rarely one crop: it is "canola or wheat,
 * depending on the contract" (Sam, 28 Oct 2026). The first in the list is the
 * plan of record — the budget, the acre forecast and the fertility plan all
 * read it — and the rest are the alternatives, each checked against the field's
 * own history so a candidate that breaks the bean interval says so here,
 * before the contract is signed.
 *
 * It is also where a field leaves or joins one year's plan, because that is the
 * same decision: a year somebody else has the field has no crop to pick.
 */
function PlanChoices({
  isManager,
  fieldName,
  year,
  crops,
  nameOf,
  picked,
  ours,
  oursByDefault,
  rentedTo,
  problemsFor,
  onSave,
  onSetOurs,
  onClose,
}: {
  isManager: boolean
  fieldName: string
  year: number
  crops: CropInfo[]
  nameOf: (id: string) => string
  picked: string[]
  ours: boolean
  oursByDefault: boolean
  rentedTo: string | null
  problemsFor: (cropId: string) => Violation[]
  onSave: (ids: string[]) => void
  onSetOurs: (ours: boolean) => void
  onClose: () => void
}) {
  const [list, setList] = useState<string[]>(picked)
  const add = (id: string) => setList((l) => (l.includes(id) ? l : [...l, id]))
  const drop = (id: string) => setList((l) => l.filter((x) => x !== id))
  const first = (id: string) => setList((l) => [id, ...l.filter((x) => x !== id)])
  const rest = crops.filter((c) => !list.includes(c.id))

  return (
    <Modal title={`${fieldName} · ${year}`} onClose={onClose}>
      {!ours ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {rentedTo ? `${rentedTo} has this field in ${year}.` : `Not ours in ${year}.`} Its acres
            are out of the {year} forecast and no crop is planned for it.
          </p>
          {isManager && (
            <button
              type="button"
              onClick={() => {
                onSetOurs(true)
                onClose()
              }}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              We farm it in {year}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {list.length > 0 && (
            <ol className="space-y-1.5">
              {list.map((id, i) => {
                const v = problemsFor(id)
                const bad = v.some((x) => x.kind !== 'caution')
                const warn = !bad && v.length > 0
                return (
                  <li
                    key={id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm',
                      bad
                        ? 'border-red-300 bg-red-50'
                        : warn
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-gray-200',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-gray-900">{nameOf(id)}</span>
                      <span className="block text-[11px] text-gray-500">
                        {i === 0 ? 'First choice — this is the plan' : 'Could go here instead'}
                        {v.length > 0 &&
                          ` · ${v.length} ${v.length === 1 ? 'warning' : 'warnings'}`}
                      </span>
                    </span>
                    {i > 0 && isManager && (
                      <button
                        type="button"
                        onClick={() => first(id)}
                        className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Make first
                      </button>
                    )}
                    {isManager && (
                      <button
                        type="button"
                        onClick={() => drop(id)}
                        aria-label={`Take ${nameOf(id)} off the list`}
                        className="shrink-0 text-gray-400 hover:text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
          {isManager && (
            <Select
              value=""
              ariaLabel="Add a crop that could go here"
              placeholder={list.length ? 'Or it could be…' : 'Pick a crop'}
              className="w-full"
              onChange={(v) => v && add(v)}
              options={rest.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          <HelpNote
            summary="The first crop is the one every other screen uses."
            title="Why the order matters"
          >
            The budget, the acre forecast, the fertility plan and the seed reports all read the
            first choice — the others are kept beside it so the decision is not lost, and are
            checked against this field&apos;s history the same way. Put the one you would seed today
            first.
          </HelpNote>
          {isManager && !(year < new Date().getFullYear()) && (
            <button
              type="button"
              onClick={() => {
                onSetOurs(false)
                onClose()
              }}
              className="text-xs text-gray-500 underline hover:text-red-700"
            >
              {oursByDefault
                ? `We are not growing this field in ${year}`
                : `Take it back out of ${year}`}
            </button>
          )}
        </div>
      )}
      {ours && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {isManager ? 'Cancel' : 'Close'}
          </button>
          {isManager && (
            <button
              onClick={() => {
                onSave(list)
                onClose()
              }}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Save
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

/**
 * A neighbour's field for one season. We take a quarter on a 50/50 crop share a
 * year at a time, so the field has to exist — to be mapped, planned, sprayed
 * and harvested — without sitting in every other year's plan (Sam, 28 Oct
 * 2026).
 */
function AddOneYearField({ years, onClose }: { years: number[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [year, setYear] = useState(String(years[0]))
  const [note, setNote] = useState('')
  const add = useAddOneYearField()
  return (
    <Modal title="Add a field for one year" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs text-gray-500">
          Field name
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Novak's north quarter"
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="block text-xs text-gray-500">
          The year we have it
          <Select
            value={year}
            ariaLabel="The year we have it"
            className="mt-0.5 w-full"
            onChange={setYear}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        </label>
        <label className="block text-xs text-gray-500">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="50/50 crop share with the landowner"
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <HelpNote summary="It has no acres until a boundary is drawn." title="What happens next">
          The field is added with no boundary, so it counts nothing towards the acre forecast until
          one is drawn for it on the map. It sits out every year but the one chosen here; add
          another year from that year&apos;s cell when the deal is renewed.
        </HelpNote>
        {add.isError && <p className="text-xs text-red-600">{(add.error as Error).message}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          disabled={!name.trim() || add.isPending}
          onClick={() =>
            add.mutate(
              { name: name.trim(), crop_year: Number(year), note: note.trim() || null },
              { onSuccess: onClose },
            )
          }
          className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add the field'}
        </button>
      </div>
    </Modal>
  )
}

/**
 * What a planned crop breaks, opened from its warning icon: rotation and
 * crop-after-crop rules, scouting, and herbicide carryover — each sprayed
 * product with its label one click away (the current PMRA label, looked up at
 * the click) and the label's own words behind the rule.
 */
function RuleBreaks({
  title,
  violations,
  onClose,
}: {
  title: string
  violations: Violation[]
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <ul className="space-y-2 text-sm">
        {violations.map((v, i) => (
          <li
            key={i}
            className={cn(
              'rounded-md border px-3 py-2',
              v.kind === 'caution' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50',
            )}
          >
            <p className="text-gray-800">
              {v.kind === 'herbicide' ? '🧪 ' : v.kind === 'caution' ? '' : '⛔ '}
              {v.message}
            </p>
            {v.quote && (
              <p className="mt-1 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600">
                &ldquo;{v.quote}&rdquo;
              </p>
            )}
            {v.registration && (
              <button
                type="button"
                onClick={() => openChemicalLabel(v.registration!)}
                className="mt-1.5 inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-gray-50"
              >
                <FileText className="h-3.5 w-3.5" /> Open the label (PCP {v.registration})
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-gray-400">
        Labels open from Health Canada&apos;s pesticide registry, the current version at the moment
        you click.
      </p>
    </Modal>
  )
}

function InspectionModal({
  isManager,
  fieldId,
  fieldName,
  year,
  cropName,
  existing,
  onClose,
  onSave,
}: {
  isManager: boolean
  fieldId: string
  fieldName: string
  year: number
  cropName: string | null
  existing: FieldInspection | null
  onClose: () => void
  onSave: (patch: {
    status: string
    rating: string | null
    notes: string | null
    inspected_on: string | null
  }) => void
}) {
  const [status, setStatus] = useState(existing?.status ?? 'pending')
  const [rating, setRating] = useState(existing?.rating ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [on, setOn] = useState(existing?.inspected_on ?? '')
  // Optional soil moisture, filed as an AIMM reading on the inspection day
  // (today if none is set). Only for this season: a reading on an old or a
  // planned year's inspection has no balance to correct.
  const today = new Date().toLocaleDateString('en-CA')
  const readOn = on || today
  const soilSeason = year === Number(today.slice(0, 4)) && readOn <= today
  const [soil, setSoil] = useState(EMPTY_SOIL_READING)
  const u = useUnitSystem()
  const fc = useFieldCapacity(fieldId)
  const saveSoil = useSaveSoilReading()
  const soilMm = soilSeason ? readingToMm(soil, fc, u) : null
  const soilProblem = soilSeason ? readingProblem(soil, fc, u) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Crop inspection</h2>
        <p className="text-xs text-gray-500">
          {fieldName} · {year}
          {cropName ? ` · ${cropName}` : ''}
        </p>
        <div className="mt-3 space-y-3">
          <div className="flex rounded-md border border-gray-200 p-0.5 text-sm">
            {(['pending', 'passed', 'failed'] as const).map((s) => (
              <button
                key={s}
                disabled={!isManager}
                onClick={() => setStatus(s)}
                className={cn(
                  'flex-1 rounded px-3 py-1 capitalize',
                  status === s
                    ? s === 'passed'
                      ? 'bg-green-600 font-semibold text-white'
                      : s === 'failed'
                        ? 'bg-red-600 font-semibold text-white'
                        : 'bg-gray-700 font-semibold text-white'
                    : 'text-gray-600',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">
              Rating
              <input
                value={rating}
                disabled={!isManager}
                onChange={(e) => setRating(e.target.value)}
                placeholder="e.g. clean / grade / % volunteers"
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Inspected on
              <DateField
                value={on}
                onChange={(v) => setOn(v)}
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
          </div>
          <label className="block text-xs text-gray-500">
            Notes
            <textarea
              value={notes}
              disabled={!isManager}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Volunteers found, isolation, actions taken, why it failed even after the 4-year gap…"
              className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          {soilSeason && (
            <SoilMoistureEntry
              fieldId={fieldId}
              value={soil}
              onChange={setSoil}
              disabled={!isManager}
              readOnLabel={
                readOn === today
                  ? 'today'
                  : new Date(`${readOn}T00:00:00`).toLocaleDateString('en-CA', {
                      month: 'short',
                      day: 'numeric',
                    })
              }
            />
          )}
          {saveSoil.error && (
            <p className="text-xs text-red-700">
              Soil moisture not saved: {(saveSoil.error as Error).message}
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {isManager ? 'Cancel' : 'Close'}
          </button>
          {isManager && (
            <button
              disabled={saveSoil.isPending || !!soilProblem}
              onClick={async () => {
                if (soilMm != null) {
                  try {
                    await saveSoil.mutateAsync({
                      fieldId,
                      readOn,
                      mm: soilMm,
                      fc,
                      method: soil.method,
                      note: soil.note.trim() || 'From a crop inspection',
                    })
                  } catch {
                    return
                  }
                }
                onSave({
                  status,
                  rating: rating.trim() || null,
                  notes: notes.trim() || null,
                  inspected_on: on || null,
                })
              }}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {saveSoil.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
