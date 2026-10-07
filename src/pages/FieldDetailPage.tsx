import { useEffect, useMemo, useState } from 'react'
import { FieldScouting } from '@/pages/ScoutingPage'
import { Link, useParams } from 'react-router-dom'
import type { MultiPolygon } from 'geojson'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FieldYieldHistory } from '@/components/FieldYieldHistory'
import { ArrowLeft, CloudHail, ExternalLink, Gauge, MapPin, PenLine, Radio } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useFieldPivots, usePumps, useWaterLicences } from '@/lib/irrigation'
import { usePlcTurbines } from '@/lib/plc'
import {
  fieldnetAppUrl,
  fnStatus,
  useFieldnetByField,
  useFieldnetHistory,
  FN_STATUS_COLOR,
  FN_STATUS_LABEL,
} from '@/lib/fieldnet'
import { PivotStatusPanel } from '@/components/PivotStatusPanel'
import { BoundaryEditor } from '@/components/BoundaryEditor'
import { FieldMapSnapshot } from '@/components/FieldMapSnapshot'
import { FieldTenure } from '@/components/FieldTenure'
import { ReentryWarning } from '@/components/ReentryWarning'
import { FieldGrazingRestriction } from '@/components/GrazingRestrictions'
import { FieldInputsCard } from '@/components/FieldInputsCard'
import { FieldSoilOverride } from '@/components/FieldSoilOverride'
import { FieldSoilSurvey } from '@/components/FieldSoilSurvey'
import { FieldSoilTestCard } from '@/components/FieldSoilTestCard'
import type { Database } from '@/lib/database.types'
import { FieldCropCard } from '@/components/FieldCropCard'
import { FieldFiles } from '@/components/FieldFiles'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { labelPointOf } from '@/lib/geo/area'
import { reverseLld, sameParcel } from '@/lib/geo/ats'
import { useTownshipTable } from '@/lib/geo/atsTownships'
import { parseLld } from '@/lib/geo/lld'
import { FarmWideLinks, FieldTabBar, fieldSectionPath, type FieldSection } from './field/FieldTabs'
import { grownTrait, isCanola } from '@/lib/canola-trait'
import { companyLookup } from '@/lib/crop-label'
import { useFarmSettings } from '@/lib/farm-setup'
import { RecordEditModal, rowClick } from '@/components/RecordEditor'
import { keepInspectionRef } from '@/lib/record-edits'
import { cn } from '@/lib/utils'
import {
  boundariesForYear,
  useAllBoundaries,
  useCrops,
  useCropVarieties,
  useAllFields,
  useFieldAudit,
  useEditHailEvent,
  useFieldHailEvents,
  useFieldHistory,
  useFieldMutations,
  useUsers,
  type FieldRow,
} from '@/lib/queries'

/** Where a boundary came from, in words rather than the database enum. */
const BOUNDARY_SOURCE: Record<string, string> = {
  kml: 'a KML file',
  drawn: 'drawn in the app',
  jd_import: 'John Deere',
  fah_import: 'Farm at Hand',
  file_import: 'an imported file',
}

function NotesEditor({
  label,
  fieldId,
  column,
  initial,
}: {
  label: string
  fieldId: string
  column: 'notes_md' | 'soil_notes_md' | 'pivot_start_instructions_md'
  initial: string | null
}) {
  // Parent passes key={fieldId+column+initial} so state resets on data change.
  const [value, setValue] = useState(initial ?? '')
  const [dirty, setDirty] = useState(false)

  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: async () => {
      const patch: Database['public']['Tables']['fields']['Update'] = {}
      patch[column] = value || null
      const { error } = await supabase.from('fields').update(patch).eq('id', fieldId)
      if (error) throw error
    },
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['fields'] })
    },
  })

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
        {dirty && (
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setDirty(true)
        }}
        rows={4}
        placeholder="—"
        className="mt-2 w-full resize-y rounded-md border border-gray-200 p-2 text-sm focus:border-brand-600 focus:outline-none"
      />
      {save.isError && <p className="mt-1 text-xs text-red-600">{(save.error as Error).message}</p>}
    </div>
  )
}

function FieldInfoEditor({
  field,
  canEdit,
  centre,
}: {
  field: FieldRow
  canEdit: boolean
  /** Centre of the field's boundary, if it has one — [lng, lat]. */
  centre: [number, number] | null
}) {
  // Parent passes key={...name:legal} so state resets when the data changes.
  const [name, setName] = useState(field.name)
  const [legal, setLegal] = useState(field.legal_land_description ?? '')
  const [dirty, setDirty] = useState(false)
  const { update } = useFieldMutations()

  /**
   * The legal land description the boundary actually sits in.
   *
   * The boundary usually arrives from a shapefile or a drawn polygon, so the
   * description comes free with it — no reason to type it off a contract.
   *
   * Only a SURVEY-tier answer is offered. The fallback grid tier is ~300 m,
   * which is a third of a quarter section, and a plausible-looking wrong
   * description is worse than a blank box.
   */
  const townships = useTownshipTable(centre != null)
  const fromBoundary = useMemo(() => {
    if (!centre || !townships) return null
    const r = reverseLld({ lat: centre[1], lng: centre[0] }, townships)
    return r?.source === 'survey' ? r : null
  }, [centre, townships])

  // Offered, not applied. Unlike dropping a pin, opening this page is not an
  // edit — silently making the form dirty on a page view would be wrong, and
  // the description on a contract outranks one derived from a polygon anyway.
  const suggestion = fromBoundary && !legal.trim() ? fromBoundary.text : null
  const mismatch =
    fromBoundary && legal.trim() && !sameParcel(parseLld(legal), fromBoundary.parts)
      ? fromBoundary.text
      : null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Field information</h3>
        {canEdit && dirty && (
          <button
            onClick={() =>
              name.trim() &&
              update.mutate(
                {
                  id: field.id,
                  patch: { name: name.trim(), legal_land_description: legal.trim() || null },
                },
                { onSuccess: () => setDirty(false) },
              )
            }
            disabled={update.isPending || !name.trim()}
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-500">
          Field name
          <input
            value={name}
            disabled={!canEdit}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
            }}
            className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:border-brand-600 focus:outline-none disabled:bg-gray-50"
          />
        </label>
        <label className="text-xs font-medium text-gray-500">
          Legal land description
          <input
            value={legal}
            disabled={!canEdit}
            onChange={(e) => {
              setLegal(e.target.value)
              setDirty(true)
            }}
            placeholder="—"
            className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:border-brand-600 focus:outline-none disabled:bg-gray-50"
          />
          {canEdit && suggestion && (
            <button
              type="button"
              onClick={() => {
                setLegal(suggestion)
                setDirty(true)
              }}
              className="mt-1 text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              Use {suggestion} — from this field&rsquo;s boundary
            </button>
          )}
          {mismatch && (
            <p className="mt-1 text-xs text-amber-700">The boundary is in {mismatch}.</p>
          )}
        </label>
      </div>
      {canEdit && (
        <p className="mt-2 text-xs text-gray-400">
          Renaming updates this field everywhere — irrigation, crop plan, tasks, calendar.
        </p>
      )}
      {update.isError && (
        <p className="mt-1 text-xs text-red-600">{(update.error as Error).message}</p>
      )}
    </div>
  )
}

const TABLE_LABELS: Record<string, string> = {
  fields: 'Field',
  field_boundaries: 'Boundary',
  field_files: 'File',
  crop_plans: 'Crop plan',
  crop_history: 'Crop history',
  map_features: 'Map feature',
}

/**
 * The last few things that happened, and a way to the rest.
 *
 * This used to be the whole audit trail inline, which on a field with a few
 * seasons behind it ran to hundreds of rows and buried everything below it on
 * the page. The recent handful answers "has anyone touched this lately"; the
 * full list is a different question and now has its own page.
 */
const RECENT = 5

function ActivityTimeline({ fieldId }: { fieldId: string }) {
  const { data: audit } = useFieldAudit(fieldId)
  const { data: users } = useUsers()
  const userName = (id: string | null) =>
    (id && users?.find((u) => u.id === id)?.full_name) || 'system'
  // Changes a PERSON made. The pivot sync writes every ten minutes, so the
  // five most recent entries on a pivot field are five identical machine
  // writes — which answers nothing anybody opened this page to ask.
  const byPeople = (audit ?? []).filter((a) => a.actor_id)
  const total = audit?.length ?? 0
  const shown = byPeople.slice(0, RECENT)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Activity</h3>
        {total > 0 && (
          <Link
            to={`/fields/${fieldId}/activity`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {total > RECENT ? `All ${total} entries` : 'Full history'} →
          </Link>
        )}
      </div>
      {shown.length ? (
        <ul className="mt-2 divide-y divide-gray-100">
          {shown.map((a) => {
            const nv = (a.new_values ?? {}) as Record<string, unknown>
            const detail =
              a.table_name === 'field_files'
                ? String(nv.filename ?? '')
                : a.crop_year
                  ? `crop year ${a.crop_year}`
                  : ''
            return (
              <li key={a.id} className="flex items-baseline gap-2 py-1.5 text-sm">
                <span className="shrink-0 text-xs tabular-nums text-gray-400">
                  {new Date(a.changed_at).toLocaleString('en-CA', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{TABLE_LABELS[a.table_name] ?? a.table_name}</span>{' '}
                  {a.action === 'insert'
                    ? 'created'
                    : a.action === 'update'
                      ? 'updated'
                      : 'deleted'}
                  {detail && <span className="text-gray-500"> — {detail}</span>}
                </span>
                <span className="shrink-0 text-xs text-gray-400">{userName(a.actor_id)}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-400">Nobody has changed this field by hand.</p>
      )}
      {byPeople.length > RECENT && (
        <p className="mt-2 text-[11px] text-gray-400">
          The {RECENT} most recent changes made by somebody, of {byPeople.length}.
        </p>
      )}
    </div>
  )
}

/**
 * Hail on this field, with whatever the adjuster said.
 *
 * The tick box on the field list records THAT a field was hit; this records
 * what happened — 17% on 125 acres, assessed by name, on the day the hail
 * actually fell rather than the day somebody remembered to tick the box. An
 * AFSC report was being read, matched and recorded, and then appeared nowhere
 * on the field it was about.
 */
function FieldHailCard({ fieldId }: { fieldId: string }) {
  const { data: events } = useFieldHailEvents(fieldId)
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const edit = useEditHailEvent()
  // A hail record opened to correct it, with its loss % and acres as fields
  // of their own (Sam, 7 Oct 2026); AFSC inspections fill them when applied.
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const opened = (events ?? []).find((e) => e.id === openId) ?? null
  if (!events?.length) return null

  // mt-4 like every other card on this page: the spacing here is carried by
  // the cards themselves, not by the container, so one without it sits flush
  // against what follows and adrift from what precedes it.
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <CloudHail className="h-4 w-4 text-gray-400" /> Hail
      </h3>
      <ul className="mt-2 divide-y divide-gray-100">
        {events.map((e) => (
          <li
            key={e.id}
            onClick={isManager ? rowClick(() => setOpenId(e.id)) : undefined}
            className={cn('py-1.5', isManager && 'cursor-pointer hover:bg-gray-50')}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium tabular-nums text-gray-900">
                {new Date(e.event_date + 'T00:00:00').toLocaleDateString('en-CA', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
              <span className="text-xs text-gray-400">crop year {e.crop_year}</span>
              {(e.loss_pct != null || e.acres != null) && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-800">
                  {e.loss_pct != null ? `${Number(e.loss_pct)}% loss` : 'loss % not set'}
                  {e.acres != null && ` on ${Number(e.acres).toLocaleString('en-CA')} ac`}
                  {e.loss_pct != null && e.acres != null && ` · ${((Number(e.loss_pct) * Number(e.acres)) / 100).toFixed(1)} ac lost`}
                </span>
              )}
            </div>
            {e.notes ? (
              <p className="mt-0.5 text-sm text-gray-700">{e.notes}</p>
            ) : (
              // Entered by hand with no detail. Worth saying so rather than
              // leaving a bare date that looks like a truncated record.
              <p className="mt-0.5 text-xs text-gray-400">
                Recorded by hand — no assessment on file.
              </p>
            )}
          </li>
        ))}
      </ul>
      <Link to="/hail" className="mt-2 inline-block text-xs text-brand-700 hover:underline">
        AFSC inspection reports →
      </Link>

      {opened && (
        <RecordEditModal
          title="Hail on this field"
          fields={[
            { key: 'event_date', label: 'Date it hit', kind: 'date', required: true },
            { key: 'loss_pct', label: 'Loss %', kind: 'number', step: '0.1', hint: 'Hail loss on the damaged acres — the adjuster’s figure' },
            { key: 'acres', label: 'Acres', kind: 'number', step: '0.1', hint: 'Acres the loss applies to' },
            { key: 'notes', label: 'What happened', kind: 'textarea', placeholder: 'Who assessed it, which part of the field…' },
          ]}
          row={opened}
          saving={edit.update.isPending || edit.remove.isPending}
          error={error}
          onClose={() => {
            setOpenId(null)
            setError(null)
          }}
          onSave={async (p) => {
            setError(null)
            try {
              await edit.update.mutateAsync({
                id: opened.id,
                patch: {
                  event_date: p.event_date as string,
                  loss_pct: p.loss_pct == null ? null : Math.min(100, Math.max(0, p.loss_pct as number)),
                  acres: p.acres == null ? null : Math.max(0, p.acres as number),
                  // An AFSC report's number stays in the note, or importing the
                  // same report again would record this hail twice.
                  notes: keepInspectionRef(opened.notes, (p.notes as string | null) ?? null),
                },
              })
            } catch (err) {
              setError((err as Error).message)
              throw err
            }
          }}
          deleteConfirm={
            /AFSC inspection/.test(opened.notes ?? '')
              ? 'Delete this hail record? Applying its AFSC report again on the Hail page would record it again.'
              : 'Delete this hail record?'
          }
          onDelete={async () => {
            try {
              await edit.remove.mutateAsync(opened.id)
            } catch (err) {
              setError((err as Error).message)
              throw err
            }
          }}
        >
          {/AFSC inspection/.test(opened.notes ?? '') && (
            <p className="mt-2 text-[11px] text-gray-500">The AFSC inspection number is kept in the note.</p>
          )}
        </RecordEditModal>
      )}
    </div>
  )
}

/** The pivot / pump / licence tied to this field, with links to those tabs. */
function FieldIrrigationCard({ fieldId }: { fieldId: string }) {
  const { data: pivots } = useFieldPivots()
  const { data: turbines } = usePlcTurbines()
  const { data: pumps } = usePumps()
  const { data: licences } = useWaterLicences()
  const { districtName } = useFarmSettings()
  const [showMore, setShowMore] = useState(false)

  const pivot = pivots?.find((p) => p.field_id === fieldId)
  if (!pivot) return null
  const pump = pivot.pump_id ? pumps?.find((p) => p.id === pivot.pump_id) : null
  const plcTurbine = turbines?.find((t) => t.pump_id === pivot.pump_id)
  const lic = pivot.water_licence_id ? licences?.find((l) => l.id === pivot.water_licence_id) : null

  const cap = pivot.system_capacity_ls
  const capMm =
    cap != null && pivot.acres_irrigated
      ? (Number(cap) * 86_400) / (Number(pivot.acres_irrigated) * 4046.8564224)
      : null
  const eff =
    pivot.application_efficiency != null
      ? Math.round(Number(pivot.application_efficiency) * 100)
      : null

  // "Water from" and the old "Water source" (river or not) were two cells
  // answering one question. The named source wins; the river flag fills in
  // when no source is named, and is noted when the named one is not a river.
  const sourceName = (
    { oldman_river: 'Oldman River', south_saskatchewan_river: 'South Saskatchewan River', smrid: `${districtName} canal`, other: 'Other' } as Record<string, string>
  )[pivot.water_source ?? '']
  const waterFrom = sourceName
    ? pivot.on_river && !sourceName.includes('River')
      ? `${sourceName} · on river`
      : sourceName
    : pivot.on_river
      ? 'River'
      : '—'

  // The facts someone checks most, first; the rest of the pivot's record
  // behind "More".
  const keyFacts: [string, string][] = [
    [
      'Irrigated acres',
      pivot.acres_irrigated != null ? Number(pivot.acres_irrigated).toFixed(1) : '—',
    ],
    ['Capacity', cap != null ? `${cap} L/s` : '—'],
    ['Efficiency', eff != null ? `${eff}%` : '—'],
    ['Water from', waterFrom],
    ['Pump', pump?.name ?? '—'],
    ['Licence', lic?.licence_number ?? '—'],
  ]
  const moreFacts: [string, string][] = [
    ['Pivot brand', pivot.brand ?? '—'],
    ['System', pivot.system_type ?? '—'],
    ['Sprinklers', pivot.sprinkler_package ?? '—'],
    ['Towers', pivot.towers != null ? String(pivot.towers) : '—'],
    [
      'Licence share',
      pivot.acre_feet_allotment != null
        ? `${pivot.acre_feet_allotment} ac-ft${pivot.acres_irrigated ? ` (${((Number(pivot.acre_feet_allotment) * 12) / Number(pivot.acres_irrigated)).toFixed(1)}")` : ''}`
        : '—',
    ],
    ['Pump HP', pump?.horse_power != null ? String(pump.horse_power) : '—'],
    ['Pump flow', pump?.gpm != null ? `${pump.gpm} GPM` : '—'],
    [
      'Water priority',
      pivot.water_licence_id ? (lic?.priority_number ?? '—') : (pump?.water_priority_number ?? '—'),
    ],
    ['Meter', pivot.meter_name ?? '—'],
  ]
  const facts = showMore ? [...keyFacts, ...moreFacts] : keyFacts

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Gauge className="h-4 w-4 text-brand-700" /> Irrigation
        </h3>
        <div className="flex gap-3 text-xs">
          <Link to="/irrigation-info" className="font-medium text-brand-700 hover:underline">
            Pivot tab →
          </Link>
          <Link
            to="/irrigation-info?tab=pump"
            className="font-medium text-brand-700 hover:underline"
          >
            Pump tab →
          </Link>
          {/* Only for the two turbines that are actually on the PLC. A link to
              live control from a field fed by a pump we cannot see would go to a
              screen with nothing on it for that field. */}
          {plcTurbine && (
            <Link to="/turbines" className="font-medium text-brand-700 hover:underline">
              Turbine control →
            </Link>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-gray-500">{k}</dt>
            <dd className="font-medium text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => setShowMore((m) => !m)}
        className="mt-2 text-xs font-medium text-brand-700 hover:underline"
      >
        {showMore ? 'Less' : `More (${moreFacts.length})`}
      </button>
      <p className="mt-3 rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900">
        The soil-moisture model uses these for this field: system capacity{' '}
        <span className="font-semibold">
          {capMm != null ? `≈ ${capMm.toFixed(1)} mm/day` : 'not set'}
        </span>
        {eff != null ? (
          <>
            {' '}
            · efficiency <span className="font-semibold">{eff}%</span>
          </>
        ) : null}
        .
      </p>
    </div>
  )
}

/** Live FieldNET telemetry for the field's pivot (read-only). Renders nothing
 *  until a synced FieldNET system is linked to this field. */
function FieldNetLiveCard({ fieldId }: { fieldId: string }) {
  const { byField } = useFieldnetByField()
  const s = byField.get(fieldId)
  const { data: history } = useFieldnetHistory(s?.fieldnet_id)
  if (!s) return null

  const status = fnStatus(s)

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Radio className="h-4 w-4 text-brand-700" /> FieldNET live
          <span
            className="ml-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: FN_STATUS_COLOR[status] }}
          >
            {FN_STATUS_LABEL[status]}
          </span>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <Link
            to={`/map?field=${fieldId}`}
            className="flex items-center gap-1 font-medium text-brand-700 hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" /> Map
          </Link>
          <a
            href={fieldnetAppUrl(s)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-medium text-brand-700 hover:underline"
          >
            FieldNET <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="mt-3">
        <PivotStatusPanel system={s} />
      </div>

      {history && history.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <h4 className="text-xs font-semibold text-gray-600">Recent activity</h4>
          <ul className="mt-1.5 space-y-1">
            {history.slice(0, 12).map((h, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs">
                <span className="shrink-0 tabular-nums text-gray-400">
                  {new Date(h.timestamp).toLocaleString('en-CA', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
                <span className="font-medium text-gray-800">
                  {(h.status ?? 'unknown').replace(/-/g, ' ')}
                </span>
                {h.position != null && <span className="text-gray-400">· {h.position}°</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}


/**
 * One field, a section at a time.
 *
 * Everything here used to be one page, in one column, eighteen cards deep. The
 * sections are the questions people actually arrive with — what is this field,
 * what was done on it, what went on it, how is it watered, what is the ground
 * like, what has it grown, what did somebody write down, and who owns it — and
 * each of them is now a tab with its own URL.
 *
 * The data is loaded once here rather than per section: it is a handful of
 * cached queries shared by several tabs, and refetching them on every tab
 * change would make the page feel slower than the scroll it replaced.
 */
export function FieldDetailPage({ section = 'overview' }: { section?: FieldSection }) {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const { data: fields } = useAllFields()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: history } = useFieldHistory(id)
  const { data: crops } = useCrops()

  const field = fields?.find((f) => f.id === id)
  const boundary = useMemo(
    () =>
      allBoundaries
        ? boundariesForYear(allBoundaries, cropYear).find((b) => b.field_id === id)
        : undefined,
    [allBoundaries, cropYear, id],
  )
  // A point guaranteed to lie inside the field, the same anchor the map labels
  // use. It decides which quarter the boundary is offered as, so it must not be
  // a figure that can land outside the shape.
  const boundaryCentre = useMemo(
    () => (boundary?.geometry ? labelPointOf(boundary.geometry as unknown as MultiPolygon) : null),
    [boundary],
  )
  const cropName = (cropId: string) => crops?.find((c) => c.id === cropId)?.name ?? '…'
  const { data: varieties } = useCropVarieties()
  const companyOf = useMemo(() => companyLookup(varieties ?? undefined), [varieties])
  /** A canola's herbicide trait: its crop's, or (plain "Canola") its company's. */
  const canolaTrait = (cropId: string, variety: string | null) => {
    const crop = crops?.find((c) => c.id === cropId)
    if (!crop || !isCanola(crop.name)) return null
    return grownTrait(crop, companyOf(cropId, variety), crops ?? []) ?? { trait: null, from: null }
  }
  const canEdit = hasManagerAccess(profile?.role)

  const [editingBoundary, setEditingBoundary] = useState(false)
  // The neighbours, so an edge can be matched to the field beside it. Current
  // boundaries only: a field that has been redrawn holds several, and stacking
  // every version would put two dashed lines a few metres apart and make the
  // reference line worse than none.
  const neighbours = useMemo(
    () =>
      (allBoundaries ?? [])
        .filter((b) => b.field_id !== id && b.valid_to == null && b.geometry)
        .map((b) => b.geometry as unknown as MultiPolygon),
    [allBoundaries, id],
  )

  // The old Notes tab's address lands on Overview; take it to the notes.
  const fieldLoaded = !!field
  useEffect(() => {
    if (section === 'notes' && fieldLoaded) {
      document.getElementById('field-notes')?.scrollIntoView({ block: 'start' })
    }
  }, [section, fieldLoaded])

  if (!field) {
    return (
      <div className="p-6 text-sm text-gray-500">{fields ? 'Field not found.' : 'Loading…'}</div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <Link
        to="/fields"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Fields
      </Link>

      {/* Which field this is, on every tab. The tabs move the content around,
          so the one thing that must not move is the name at the top of it. */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-lg font-semibold text-gray-900">{field.name}</h1>
        <p className="text-xs text-gray-500">
          {field.legal_land_description || 'no legal description'}
          {boundary?.acres != null && ` · ${boundary.acres.toFixed(1)} mapped acres`}
          {!field.active && ' · archived'}
        </p>
      </div>

      {/* Above the tabs, because a re-entry interval is not something anybody
          should have to be on the right tab to find out about. */}
      <div className="mt-3 space-y-2">
        <ReentryWarning fieldId={field.id} />
        {/* Same reasoning: whoever opens the gate or the swather needs it. */}
        <FieldGrazingRestriction fieldId={field.id} />
      </div>

      <FieldTabBar fieldId={field.id} active={section} />
      <FarmWideLinks section={section} />

      {(section === 'overview' || section === 'notes') && (
        <>
          {/* What the field looks like, before what it measures. The first
              question about a field is which one it is, and a shape answers
              that faster than a legal land description. */}
          <div className="mt-3">
            <FieldMapSnapshot
              boundary={(boundary?.geometry as unknown as MultiPolygon) ?? null}
              name={field.name}
              fieldId={field.id}
            />
          </div>

          {/* Acres are in the heading above; where the boundary came from and
              since when are under Settings, beside the button that redraws it. */}
          {!boundary && canEdit && (
            <p className="mt-2 text-xs text-gray-500">
              This field has no boundary, so it has no acres, no soil survey and no place on the
              map.{' '}
              <Link to={fieldSectionPath(field.id, 'settings')} className="text-brand-700 underline">
                Draw one under Settings
              </Link>
              .
            </p>
          )}

          <div className="mt-4">
            <FieldCropCard
              fieldId={field.id}
              cropYear={cropYear}
              boundaryAcres={boundary?.acres ?? null}
              canEdit={canEdit}
            />
          </div>

          <FieldHailCard fieldId={field.id} />

          {/* Notes and files were a tab of their own with two cards on it.
              They live here now; /fields/:id/notes opens this tab at them. */}
          <div id="field-notes" className="mt-4 scroll-mt-4">
            <NotesEditor
              key={`${field.id}:notes:${field.notes_md ?? ''}`}
              label="Field notes"
              fieldId={field.id}
              column="notes_md"
              initial={field.notes_md}
            />
          </div>
          <div className="mt-4">
            <FieldFiles fieldId={field.id} />
          </div>
        </>
      )}

      {section === 'inputs' && (
        <FieldInputsCard fieldId={field.id} acres={boundary?.acres ?? null} />
      )}

      {section === 'irrigation' && (
        <>
          <FieldIrrigationCard fieldId={field.id} />
          <FieldNetLiveCard fieldId={field.id} />
          <div className="mt-4">
            <NotesEditor
              key={`${field.id}:pivot:${field.pivot_start_instructions_md ?? ''}`}
              label="Pivot starting instructions"
              fieldId={field.id}
              column="pivot_start_instructions_md"
              initial={field.pivot_start_instructions_md}
            />
          </div>
        </>
      )}

      {section === 'soil' && (
        <>
          <FieldSoilOverride
            fieldId={field.id}
            fc={field.soil_fc}
            wp={field.soil_wp}
            source={field.soil_source}
            canEdit={canEdit}
            className="mt-4"
          />
          <FieldSoilSurvey fieldId={field.id} className="mt-4" />
          <FieldSoilTestCard fieldId={field.id} />
          <div className="mt-4">
            <NotesEditor
              key={`${field.id}:soil:${field.soil_notes_md ?? ''}`}
              label="Soil / conditions notes"
              fieldId={field.id}
              column="soil_notes_md"
              initial={field.soil_notes_md}
            />
          </div>
        </>
      )}

      {section === 'history' && (
        <>
          <FieldYieldHistory fieldId={field.id} history={history ?? []} cropName={cropName} canEdit={canEdit} canolaTrait={canolaTrait} />

          <div className="mt-4">
            <ActivityTimeline fieldId={field.id} />
          </div>
        </>
      )}

      {section === 'scouting' && <FieldScouting fieldId={field.id} />}

      {section === 'settings' && (
        <>
          <div className="mt-4">
            <FieldInfoEditor
              key={`${field.id}:info:${field.name}:${field.legal_land_description ?? ''}`}
              field={field}
              canEdit={canEdit}
              centre={boundaryCentre}
            />
          </div>

          <div className="mt-4">
            <FieldTenure field={field} mappedAcres={boundary?.acres ?? null} canEdit={canEdit} />
          </div>

          {/* Shown to everyone: the source and date used to sit on the overview
              for anyone to read. Only the redraw button is for managers. The
              acres are in the heading. */}
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-700">Boundary ({cropYear})</h3>
            <p className="mt-1 text-xs text-gray-500">
              {boundary
                ? `From ${BOUNDARY_SOURCE[boundary.source ?? ''] ?? boundary.source ?? 'unknown'}${boundary.valid_from ? `, since ${boundary.valid_from}` : ''}.`
                : 'No boundary, so this field has no acres, no soil survey and no place on the map.'}
            </p>
            {canEdit && (
              <button
                onClick={() => setEditingBoundary(true)}
                className="mt-2 flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <PenLine className="h-4 w-4" />
                {boundary ? 'Edit boundary' : 'Draw boundary'}
              </button>
            )}
          </div>
        </>
      )}

      {editingBoundary && (
        <BoundaryEditor
          fieldId={field.id}
          fieldName={field.name}
          existing={(boundary?.geometry as unknown as MultiPolygon) ?? null}
          centre={boundaryCentre}
          others={neighbours}
          onClose={() => setEditingBoundary(false)}
        />
      )}
    </div>
  )
}
