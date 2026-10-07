import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Cog, Droplets, ExternalLink, EyeOff, RefreshCw, Sprout, Tractor, User, Wind } from 'lucide-react'
import { ACRES_BASIS_LABEL, appliedByProduct, fmtMoney, fmtQty, passAcres, toCanonicalRate, type AppliedOp } from '@/lib/applied'
import {
  LONG_PASS_MS,
  duration,
  formatRate,
  spanMs,
  useFieldOperations,
  type FieldOperation,
  type OpMachine,
  type OpProduct,
  type OpRaw,
  mergeMixEntries,
  useDismissOperation,
  useDuplicateOperations,
  useSetCostAcres,
  useSetDuplicate,
  useReadSessions,
} from '@/lib/fieldOps'
import { useProductResolver } from '@/lib/products'
import { useAllBoundaries, useAllFields } from '@/lib/queries'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { describeSessions, fmtMinutes, type OpSession } from '@/lib/op-sessions'
import {
  opsCenterIds,
  templateFromExample,
  useJdWorkTemplate,
  useSetJdWorkTemplate,
  workLink,
} from '@/lib/jd-links'
import { FieldMoistureCard } from '@/components/FieldMoistureCard'
import { UnconfirmedSprays } from '@/components/UnconfirmedSprays'
import { SprayCheck } from '@/components/SprayCheck'
import { FarmWideLinks, FieldTabBar } from './field/FieldTabs'
import { FuelTotal, PassFuel } from '@/components/FuelSummary'
import { fuelByOp, useFuelModel } from '@/lib/operating-costs'
import type { FuelOpRow } from '@/lib/hauling-data'
import type { OpFuel } from '@/lib/fuel'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { AdminOnly } from '@/components/TechnicalDetails'

const TYPE_LABEL: Record<string, string> = {
  application: 'Application',
  seeding: 'Seeding',
  harvest: 'Harvest',
  tillage: 'Tillage',
}
const TYPE_COLOR: Record<string, string> = {
  application: 'bg-sky-100 text-sky-800',
  seeding: 'bg-green-100 text-green-800',
  harvest: 'bg-amber-100 text-amber-800',
  tillage: 'bg-stone-200 text-stone-700',
}

const dt = (v?: string) =>
  v
    ? new Date(v).toLocaleString('en-CA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cog
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h4>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/**
 * One product on one pass, with the per-acre rate Deere recorded alongside what
 * that adds up to over the whole field.
 */
function ComponentRow({
  name,
  rate,
  acres,
  price,
  muted,
}: {
  name: string
  rate?: { value?: number; unitId?: string }
  acres: number | null
  price?: number | null
  muted?: boolean
}) {
  const conv = toCanonicalRate(rate?.value, rate?.unitId)
  const total = conv && acres ? conv.rate * acres : null
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1 text-sm',
        muted && 'text-gray-500',
      )}
    >
      <span className={cn('min-w-40 flex-1', muted ? 'text-gray-500' : 'text-gray-800')}>
        {name}
      </span>
      <span className="w-24 text-right tabular-nums text-gray-500">{formatRate(rate)}</span>
      <span className="w-24 text-right tabular-nums text-gray-700">
        {total != null ? fmtQty(total, conv!.unit) : <span className="text-gray-300">—</span>}
      </span>
      <span className="w-20 text-right tabular-nums text-gray-700">
        {total != null && price != null ? (
          fmtMoney(total * price)
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </span>
    </div>
  )
}

function MachineLine({ m }: { m: OpMachine }) {
  const operators = (m.operators ?? []).map((o) => o.name).filter(Boolean)
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 text-sm text-gray-700">
      {/* Deere's own name for it beats an internal id nobody recognises. */}
      <span className="font-medium">{m.name ?? `Machine ${m.machineId ?? '—'}`}</span>
      {m.vin && <span className="font-mono text-xs text-gray-500">VIN {m.vin}</span>}
      {operators.length > 0 && (
        <span className="flex items-center gap-1 text-gray-600">
          <User className="h-3.5 w-3.5 text-gray-400" />
          {operators.join(', ')}
        </span>
      )}
    </div>
  )
}

/** Everything Deere holds about a single pass. */
/**
 * The acres a pass is costed on and why, with the two corrections a manager
 * needs: a different acreage, and "this is the same job as that pass".
 */
function CostAcres({
  op,
  pass,
  fieldAcres,
  canEdit,
  siblings,
}: {
  op: FieldOperation
  pass: ReturnType<typeof passAcres>
  fieldAcres: number | null
  canEdit: boolean
  siblings: FieldOperation[]
}) {
  const setAcres = useSetCostAcres()
  const setDup = useSetDuplicate()
  const qc = useQueryClient()
  const setOwner = useMutation({
    mutationFn: async (kind: string) => {
      const { error } = await supabase.rpc('jd_set_not_ours', {
        p_id: op.id,
        p_kind: kind || null,
        p_note: kind === 'custom_work' ? "Renter's crop — our sprayer, their field" : kind === 'rented_out' ? 'Field rented out that year' : null,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_field_operations'] }),
  })
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [copyOf, setCopyOf] = useState('')
  const loggedAc = op.applied_area_ha != null ? Number(op.applied_area_ha) * 2.4710538146716536 : null
  return (
    <div className={cn('mt-2 rounded-md px-2.5 py-1.5 text-xs', pass.basis === 'covered' || pass.basis === 'override' ? 'bg-gray-50 text-gray-600' : 'bg-amber-50 text-amber-900')}>
      <span className="font-medium tabular-nums">Costed on {pass.acres.toFixed(pass.acres < 10 ? 1 : 0)} ac</span> —{' '}
      {op.source === 'app' && pass.basis === 'covered' ? "the field's acres, as billed" : ACRES_BASIS_LABEL[pass.basis]}
      {pass.basis === 'capped' && loggedAc != null && ` (Deere logged ${loggedAc.toFixed(0)} ac on a ${fieldAcres?.toFixed(0)} ac field)`}
      {!op.machine_id && (op.source === 'app' ? ' · added in the app' : ' · entered by hand in Operations Center')}
      {op.not_ours_note && <span className="block">{op.not_ours_note}</span>}
      {op.correction_note && <span className="block font-medium">Corrected: {op.correction_note}</span>}
      {canEdit && (
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span>Whose job</span>
          <select
            value={op.not_ours ?? ''}
            onChange={(e) => setOwner.mutate(e.target.value)}
            className="rounded border border-gray-300 px-1 py-0.5 text-xs text-gray-900"
            aria-label="Whose job"
          >
            <option value="">Ours — our cost</option>
            <option value="custom_work">Renter's crop (custom work)</option>
            <option value="rented_out">Field rented out</option>
          </select>
        </span>
      )}
      {canEdit && !editing && (
        <button type="button" onClick={() => { setValue(pass.acres.toFixed(1)); setEditing(true) }} className="ml-2 text-brand-700 underline">
          change
        </button>
      )}
      {editing && (
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-900"
            aria-label="Acres to cost this pass on"
          />
          <span>ac</span>
          <button
            type="button"
            onClick={() => setAcres.mutate({ id: op.id, acres: value.trim() === '' ? null : Number(value) }, { onSuccess: () => setEditing(false) })}
            className="rounded bg-brand-700 px-2 py-0.5 font-semibold text-white"
          >
            Save
          </button>
          {op.cost_acres_override != null && (
            <button type="button" onClick={() => setAcres.mutate({ id: op.id, acres: null }, { onSuccess: () => setEditing(false) })} className="underline">
              back to Deere&apos;s
            </button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="text-gray-500 underline">
            cancel
          </button>
        </span>
      )}
      {canEdit && siblings.length > 0 && (
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span>Same job as</span>
          <select value={copyOf} onChange={(e) => setCopyOf(e.target.value)} className="rounded border border-gray-300 px-1 py-0.5 text-xs text-gray-900" aria-label="Same job as">
            <option value="">pick a pass…</option>
            {siblings.map((o) => (
              <option key={o.id} value={o.id}>
                {dt(o.started_at ?? undefined)} · {((o.products ?? []) as unknown as OpProduct[])[0]?.name ?? 'pass'}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!copyOf || setDup.isPending}
            onClick={() => setDup.mutate({ id: op.id, of: copyOf })}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 disabled:opacity-50"
          >
            hide this one as a copy
          </button>
        </span>
      )}
    </div>
  )
}

function PassCard({
  op,
  acres,
  priceOf,
  link,
  canEdit,
  onHide,
  siblings = [],
  fuel,
  dieselPerL,
}: {
  op: FieldOperation
  acres: number | null
  priceOf: (name: string) => number | null
  /** In the field and on the road; undefined until distances and settings load. */
  fuel?: OpFuel
  dieselPerL: number
  /** The same pass in Operations Center, once the farm has taught the app the address. */
  link: string | null
  canEdit: boolean
  onHide: (op: FieldOperation, reason: string) => void
  /** Other applications on this field close in time — what this one could be a copy of. */
  siblings?: FieldOperation[]
}) {
  const raw = (op.raw ?? {}) as OpRaw
  const type = op.operation_type ?? ''
  // A mix Deere lists twice in one record is shown (and costed) once.
  const products = mergeMixEntries((op.products ?? []) as unknown as OpProduct[])
  // Machines come off `raw` rather than the flattened columns, which keep only
  // the first machine and its first operator. Every pass synced so far has
  // exactly one of each, so this recovers nothing today — it just means a
  // two-machine pass renders correctly instead of silently dropping one.
  const machines = raw.fieldOperationMachines ?? []
  const varieties = raw.varieties ?? []
  const tillage = (raw.tillageProducts ?? []).map((t) => t.tillageType).filter(Boolean)
  const dur = duration(op.started_at ?? undefined, op.ended_at ?? undefined)
  const crop = op.treated_crop ?? raw.cropName
  // The sittings off the per-point export. Null until read; [] when Deere
  // logged no points, which is a pass that never happened.
  const sessions = (op.sessions as OpSession[] | null) ?? null
  const work = op.work_minutes != null ? Number(op.work_minutes) : null
  const days = sessions ? describeSessions(sessions) : []
  const [hiding, setHiding] = useState(false)
  const [reason, setReason] = useState('')
  // An application is costed on the ground it covered, not the whole field.
  const pass = type === 'application' ? passAcres(op as unknown as AppliedOp, acres ?? 0) : null
  const costAcres = pass ? pass.acres : acres
  const [details, setDetails] = useState(false)
  const hasDetails =
    op.wind_speed_kmh != null ||
    op.air_temp_c != null ||
    op.app_speed_kmh != null ||
    machines.length > 0 ||
    tillage.length > 0 ||
    !!fuel

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-600',
          )}
        >
          {TYPE_LABEL[type] ?? (type || 'operation')}
        </span>
        <span className="text-sm font-medium text-gray-900">{dt(op.started_at ?? undefined)}</span>
        {op.ended_at && (
          <span className="text-sm text-gray-500">
            to{' '}
            {new Date(op.ended_at).toLocaleTimeString('en-CA', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
        {/* Time on the field once the sprayer's clock has been read; Deere's
            first-to-last-point span until then, which rolls days together. */}
        {sessions && sessions.length > 0 && work != null ? (
          <span className="flex items-center gap-1 text-xs text-gray-700" title={dur ? `Deere's own span: ${dur}` : undefined}>
            <Clock className="h-3.5 w-3.5" /> {fmtMinutes(work)} on the field
            {days.length > 1 && ` over ${days.length} days`}
          </span>
        ) : (
          dur && (
            <span
              className="flex items-center gap-1 text-xs text-gray-500"
              title="Deere's first to last logged point. Several days of spraying roll into one."
            >
              <Clock className="h-3.5 w-3.5" /> {dur}
            </span>
          )
        )}
        {crop && (
          <span className="ml-auto text-xs text-gray-500">
            {crop.replace(/_/g, ' ').toLowerCase()}
          </span>
        )}
      </div>

      {days.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
          {days.map((d) => (
            <li key={d.day} className="tabular-nums">
              <span className="font-medium">{d.day}</span> · {d.when} · {fmtMinutes(d.minutes)}
            </li>
          ))}
        </ul>
      )}
      {sessions && sessions.length === 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {op.sessions_note ?? 'Deere logged no points for this pass — nothing was applied.'}
        </p>
      )}

      {products.length > 0 && (
        <Section icon={Droplets} title="Products applied">
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-gray-100 pb-1 text-[10px] uppercase tracking-wide text-gray-400">
            <span className="min-w-40 flex-1" />
            <span className="w-24 text-right">Rate</span>
            <span className="w-24 text-right">Total on {costAcres ? `${costAcres.toFixed(costAcres < 10 ? 1 : 0)} ac` : 'field'}</span>
            <span className="w-20 text-right">Cost</span>
          </div>
          {products.map((p, i) => (
            <div key={i} className="mt-1.5 first:mt-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-gray-800">{p.name ?? 'product'}</span>
                {p.tankMix && (
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    tank mix
                  </span>
                )}
                {p.rate?.value != null && (
                  <span className="text-xs tabular-nums text-gray-500">
                    {formatRate(p.rate)} total solution
                  </span>
                )}
              </div>
              <div className="ml-3 border-l border-gray-200 pl-3">
                {(p.components ?? []).map((c, j) => (
                  <ComponentRow
                    key={j}
                    name={c.name ?? 'component'}
                    rate={c.rate}
                    acres={costAcres}
                    price={priceOf(c.name ?? '')}
                  />
                ))}
                {/* A single-product pass has no components — the product is the rate. */}
                {(p.components ?? []).length === 0 && p.name && (
                  <ComponentRow
                    name={p.name}
                    rate={p.rate}
                    acres={costAcres}
                    price={priceOf(p.name)}
                  />
                )}
                {p.carrier && (
                  <ComponentRow
                    name={`Carrier: ${p.carrier.name ?? 'water'}`}
                    rate={p.carrier.rate}
                    acres={costAcres}
                    muted
                  />
                )}
              </div>
            </div>
          ))}
        </Section>
      )}

      {pass && <CostAcres op={op} pass={pass} fieldAcres={acres} canEdit={canEdit} siblings={siblings} />}

      {varieties.length > 0 && (
        <Section icon={Sprout} title="Seed">
          <ul className="text-sm">
            {varieties.map((v, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-gray-800">{v.name ?? 'variety'}</span>
                {v.brand && v.brand !== '---' && (
                  <span className="text-xs text-gray-500">{v.brand}</span>
                )}
                {v.productType && (
                  <span className="rounded bg-gray-100 px-1.5 text-[10px] uppercase text-gray-500">
                    {v.productType}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* Deere records the variety on a seeding pass but not the seeding rate. */}
          <p className="mt-0.5 text-xs text-gray-400">Deere records no seeding rate for this pass.</p>
        </Section>
      )}

      {/* Products and cost are what most people open a pass for; the weather,
          the machine, the implement and the fuel wait behind Details. */}
      {details && (
        <>
        {/* The weather is ECMWF over the field, not a machine reading — Deere's
            sprayers carry no weather sensor. The ground speed IS measured. */}
        {(op.wind_speed_kmh != null || op.air_temp_c != null || op.app_speed_kmh != null) && (
          <Section icon={Wind} title="Conditions">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
              {op.wind_speed_kmh != null && (
                <span>
                  <span className="font-semibold tabular-nums">
                    {Number(op.wind_speed_kmh).toFixed(1)} km/h
                  </span>{' '}
                  <span className="text-gray-500">
                    wind
                    {op.wind_gust_kmh != null && `, gust ${Number(op.wind_gust_kmh).toFixed(0)}`}
                  </span>
                </span>
              )}
              {op.air_temp_c != null && (
                <span className="font-semibold tabular-nums">
                  {Number(op.air_temp_c).toFixed(1)} °C
                </span>
              )}
              {op.humidity_pct != null && (
                <span>
                  <span className="font-semibold tabular-nums">
                    {Math.round(Number(op.humidity_pct))}%
                  </span>{' '}
                  <span className="text-gray-500">humidity</span>
                </span>
              )}
              {op.app_speed_kmh != null && (
                <span>
                  <span className="font-semibold tabular-nums">
                    {Number(op.app_speed_kmh).toFixed(1)} km/h
                  </span>{' '}
                  <span className="text-gray-500">ground speed</span>
                </span>
              )}
            </div>
            {op.conditions_source === 'ecmwf' && (
              <p className="mt-0.5 text-[11px] text-gray-400" title="ECMWF weather model">
                Weather is modelled over the field
                {/* Deere rolls several days of spraying into one operation often
                    enough that the hour has to be stated, or the reading looks
                    like it covers the whole span. */}
                {op.weather_at && spanMs(op.started_at, op.ended_at) > LONG_PASS_MS
                  ? ` at ${dt(op.weather_at)}, when this ${dur} operation started`
                  : ' for that hour'}
                . Ground speed is measured by the machine.
              </p>
            )}
          </Section>
        )}

        {machines.length > 0 && (
          <Section icon={Tractor} title={machines.length > 1 ? 'Machines' : 'Machine'}>
            <div className="space-y-0.5">
              {machines.map((m, i) => (
                <MachineLine key={m.vin ?? i} m={m} />
              ))}
            </div>
          </Section>
        )}

        {tillage.length > 0 && (
          <Section icon={Cog} title="Implement">
            <p className="text-sm text-gray-800">{tillage.join(', ')}</p>
          </Section>
        )}

        {fuel && <PassFuel fuel={fuel} dieselPerL={dieselPerL} />}
        </>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            Open in Operations Center <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {hasDetails && (
          <button
            type="button"
            onClick={() => setDetails((d) => !d)}
            className="rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {details ? 'Hide details' : 'Details'}
          </button>
        )}
        {op.source === 'app' ? (
          <span className="font-medium text-gray-600">
            Added in the app
            <AdminOnly> · {op.source_ref}</AdminOnly>
          </span>
        ) : (
          <span>
            Season {op.crop_season ?? '—'}
            <AdminOnly> · Deere id {op.jd_id}</AdminOnly>
          </span>
        )}
        {canEdit &&
          (hiding ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why — e.g. never sprayed, logged on the wrong field"
                className="w-64 rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-900"
              />
              <button
                onClick={() => onHide(op, reason)}
                className="rounded-md bg-red-700 px-2 py-0.5 text-xs font-semibold text-white"
              >
                Delete this pass
              </button>
              <button onClick={() => setHiding(false)} className="text-xs text-gray-500 underline">
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setHiding(true)}
              title="Removes it from the app for good. Deere keeps its copy; the sync will not bring it back."
              className="inline-flex items-center gap-1 text-gray-400 hover:text-red-700"
            >
              <EyeOff className="h-3 w-3" /> delete
            </button>
          ))}
        {raw.modifiedTime && <span>· last changed in Deere {dt(raw.modifiedTime)}</span>}
        {raw.adaptMachineType && (
          <AdminOnly>
            <span>· {raw.adaptMachineType.toLowerCase()}</span>
          </AdminOnly>
        )}
      </p>
    </li>
  )
}

/** Every pass on one field, in full. */
export function FieldWorkPage() {
  const { id } = useParams<{ id: string }>()
  // Every field, archived ones included: the work done on a field that has
  // since been put away is still its work, and the heading should still say
  // whose it was.
  const { data: fields } = useAllFields()
  const { data: boundaries } = useAllBoundaries()
  const { data: ops, isLoading } = useFieldOperations(id)
  const resolve = useProductResolver()
  const [season, setSeason] = useState<number | 'all'>('all')
  const [type, setType] = useState<string>('all')
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: farm } = useJdWorkTemplate()
  const setTemplate = useSetJdWorkTemplate()
  const [teaching, setTeaching] = useState(false)
  const [example, setExample] = useState('')
  const [taught, setTaught] = useState<string | null>(null)
  const template = farm?.jd_work_url ?? null
  const dismiss = useDismissOperation()
  const { data: duplicates } = useDuplicateOperations(id)
  const setDup = useSetDuplicate()
  const readClock = useReadSessions()
  const unread = (ops ?? []).filter((o) => o.operation_type === 'application' && o.sessions == null).length
  // Every id the passes on this field carry, so a pasted address can be read
  // against all of them and the one it names is found.
  const known = useMemo(() => {
    const orgs = new Set<string>()
    const fieldIds = new Set<string>()
    const operations: string[] = []
    for (const o of ops ?? []) {
      const ids = opsCenterIds(o)
      if (ids.org) orgs.add(ids.org)
      if (ids.field) fieldIds.add(ids.field)
      operations.push(ids.operation)
    }
    return { orgs: [...orgs], fields: [...fieldIds], operations }
  }, [ops])
  const teach = () => {
    const r = templateFromExample(example, known)
    if (!r || !farm) {
      setTaught('That address does not contain the Deere id of any pass on this field. Open one of these passes in Operations Center and paste its address.')
      return
    }
    setTemplate.mutate(
      { id: farm.id, jd_work_url: r.template },
      {
        onSuccess: () => {
          setTaught(null)
          setTeaching(false)
          setExample('')
        },
        onError: (e) => setTaught((e as Error).message),
      },
    )
  }

  const field = fields?.find((f) => f.id === id)
  const acres = useMemo(() => {
    const b = boundaries?.find((x) => x.field_id === id && x.acres != null)
    return b ? Number(b.acres) : null
  }, [boundaries, id])

  const priceOf = useMemo(() => {
    return (name: string) => resolve?.(name)?.pricePerUnit ?? null
  }, [resolve])

  const seasons = useMemo(() => {
    const s = new Set<number>()
    for (const o of ops ?? []) if (o.crop_season != null) s.add(o.crop_season)
    return [...s].sort((a, b) => b - a)
  }, [ops])

  const types = useMemo(() => {
    const t = new Set<string>()
    for (const o of ops ?? []) if (o.operation_type) t.add(o.operation_type)
    return [...t].sort()
  }, [ops])

  const shown = useMemo(
    () =>
      (ops ?? []).filter(
        (o) =>
          (season === 'all' || o.crop_season === season) &&
          (type === 'all' || o.operation_type === type),
      ),
    [ops, season, type],
  )

  // Fuel per pass: logged by the machine where Deere has it, estimated where
  // not, plus the road from the shop and back for each day worked.
  const fuelModel = useFuelModel()
  const fuel = useMemo(
    () => (id && ops && fuelModel.ready ? fuelByOp(ops as unknown as FuelOpRow[], id, fuelModel) : new Map<string, OpFuel>()),
    [id, ops, fuelModel],
  )
  const shownFuel = useMemo(() => shown.map((o) => fuel.get(o.id)).filter((f): f is OpFuel => !!f), [shown, fuel])

  const cost = useMemo(() => {
    const apps = shown.filter((o) => o.operation_type === 'application')
    if (!acres || apps.length === 0) return null
    return appliedByProduct(apps, acres, resolve)
  }, [shown, acres, resolve])

  if (isLoading) return <p className="p-4 text-sm text-gray-500 md:p-6">Loading…</p>

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <Link
        to="/fields"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" /> Fields
      </Link>

      {/* The same heading and the same tabs as every other section of this
          field. This was a page of its own before the field page had sections;
          it is one of them now, and it has to look like it. */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-lg font-semibold text-gray-900">{field?.name ?? 'Field'}</h1>
        <p className="text-xs text-gray-500">
          {field?.legal_land_description || 'no legal description'}
          {acres != null && ` · ${acres.toFixed(1)} mapped acres`}
        </p>
      </div>

      {id && <FieldTabBar fieldId={id} active="work" />}
      <FarmWideLinks section="work" />

      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
        <span>{ops?.length ?? 0} passes recorded by the machines</span>
        <InfoPopover title="How rates and totals are shown">
          <p>
            Rates are shown exactly as Deere recorded them, with the field total beside each. Each total is that rate over the acres the pass actually
            covered — never more than the field&apos;s {acres != null ? `${acres.toFixed(1)} acres` : 'acreage'} per visit — so
            half a field on one day and half the next adds up to one field, not two. Deere gallons are US.
          </p>
        </InfoPopover>
        {isManager && unread > 0 && (
          <button
            onClick={() => readClock.mutate({ season: new Date().getFullYear() - 1 })}
            disabled={readClock.isPending || readClock.isSuccess}
            title="Reads the per-point export for every application not yet read. Deere builds them for a few minutes; reload the page after."
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', readClock.isPending && 'animate-spin')} />
            {readClock.isSuccess ? 'Reading — reload in a few minutes' : `Read the sprayer's clock (${unread} to read)`}
          </button>
        )}
        {dismiss.isError && <span className="text-red-600">{(dismiss.error as Error).message}</span>}
      </p>

      {(seasons.length > 1 || types.length > 1) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {seasons.length > 1 && (
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="all">All seasons</option>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {types.length > 1 && (
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="all">All work</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          )}
          <span className="self-center text-xs text-gray-500">
            {shown.length} of {ops?.length ?? 0} passes
          </span>
        </div>
      )}

      <div className="mt-3">{id && <UnconfirmedSprays fieldId={id} />}</div>
      <div className="mt-3">{id && <SprayCheck fieldId={id} />}</div>

      {cost && cost.costed > 0 && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <span className="font-medium text-gray-900">{fmtMoney(cost.costed)}</span>
          <span className="text-gray-500">
            {' '}
            in priced inputs across these passes
            {acres ? ` · ${fmtMoney(cost.costed / acres)}/ac` : ''}
            {cost.uncosted > 0 && ` · ${cost.uncosted} product${
              cost.uncosted === 1 ? '' : 's'
            } still unpriced`}
          </span>
        </div>
      )}

      <FuelTotal rows={shownFuel} dieselPerL={fuelModel.settings.dieselPerL} acres={acres} />

      {shown.length === 0 ? (
        <p className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No passes match this filter.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {shown.map((op) => (
            <PassCard
              key={op.id}
              op={op}
              acres={acres}
              priceOf={priceOf}
              link={op.source === 'app' ? null : workLink(template, opsCenterIds(op))}
              canEdit={isManager}
              onHide={(o, reason) => dismiss.mutate({ op: o, reason })}
              fuel={fuel.get(op.id)}
              dieselPerL={fuelModel.settings.dieselPerL}
              siblings={
                op.operation_type === 'application'
                  ? (ops ?? []).filter(
                      (o) =>
                        o.id !== op.id &&
                        o.operation_type === 'application' &&
                        Math.abs(Date.parse(o.started_at ?? '') - Date.parse(op.started_at ?? '')) < 10 * 86_400_000,
                    )
                  : []
              }
            />
          ))}
        </ul>
      )}

      {(duplicates?.length ?? 0) > 0 && (
        <details className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-gray-800">
            {duplicates!.length} pass{duplicates!.length === 1 ? '' : 'es'} hidden as copies of another job
          </summary>
          <p className="mt-1 text-xs text-gray-500">
            Left out of costs, pass counts, inventory and the spray checks. Usually a job typed into Operations Center by hand
            as well as logged by the sprayer — Deere fills a hand-entered job with the whole field.
          </p>
          <ul className="mt-2 divide-y divide-gray-100 text-xs">
            {duplicates!.map((d) => {
              const of = (ops ?? []).find((o) => o.id === d.duplicate_of)
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="font-medium text-gray-800">{dt(d.started_at ?? undefined)}</span>
                  <span className="text-gray-600">{((d.products ?? []) as unknown as OpProduct[])[0]?.name ?? d.operation_type}</span>
                  <span className="text-gray-500">
                    copy of the {of ? dt(of.started_at ?? undefined) : 'other'} pass · {d.duplicate_by === 'auto' ? 'found automatically' : 'marked by hand'}
                  </span>
                  {isManager && (
                    <button type="button" onClick={() => setDup.mutate({ id: d.id, of: null })} className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50">
                      Not a copy — count it
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {/* Deere publishes no browser address for a pass, so the shape of the
          link is learned from one example. Once. */}
      {isManager && (ops?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {teaching || !template ? (
            <>
              <p>
                <strong>Link these passes to Operations Center.</strong> Open any one of the passes
                above in Operations Center, copy the address from the browser, and paste it here.
                The app swaps the ids for placeholders and every pass links from then on.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                  placeholder="https://…deere.com/…"
                  className="min-w-0 flex-1 basis-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={teach}
                  disabled={!example.trim() || setTemplate.isPending}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Use this
                </button>
                {template && (
                  <button
                    onClick={() => setTeaching(false)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {taught && <p className="mt-1 text-red-600">{taught}</p>}
            </>
          ) : (
            <p>
              <span title={template}>Passes link to Operations Center.</span>{' '}
              <button onClick={() => setTeaching(true)} className="underline hover:text-brand-700">
                Change
              </button>
            </p>
          )}
        </div>
      )}

      {/* What came off it, beside what was done to it. Harvest moisture is the
          last thing that happens in a field's year and it was three cards away
          from the passes that produced it. */}
      {id && <FieldMoistureCard fieldId={id} />}
    </div>
  )
}
