import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { CropMoisture } from '@/components/CropMoisture'
import { CropNotes } from '@/components/CropNotes'
import { CropFieldHistory } from '@/pages/crops/CropFieldHistory'
import { CropPlanterSettings } from '@/pages/crops/CropPlanterSettings'
import { Fold } from '@/components/Fold'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import {
  useCropVarieties,
  useCropVarietyMutations,
  useCrops,
  type CropInputRow,
  type CropRow,
} from '@/lib/queries'
import { ColourPicker } from '@/components/ColourPicker'
import { cropColour } from '@/lib/crop-colour'
import { useSetCropColour } from '@/lib/crop-colour-mutation'
import { Select } from '@/components/Select'
import type { Database } from '@/lib/database.types'
import { useAllCropInputs, useAllCropPrices, useYieldHistory } from '@/lib/forecast-data'
import { expectedYield, marketPrice, resolveCosts, resolvePrice } from '@/lib/forecast'
import { useElevatorBids } from '@/components/BreakevenCard'
import { BOTH_TRAITS, isCanola, TRAIT_LABEL, TRAITS, VOLUNTEER_WINDOW_YEARS, type TraitSetting } from '@/lib/canola-trait'

type CropUpdate = Database['public']['Tables']['crops']['Update']
type InputCategory = CropInputRow['category']
const CATEGORIES: InputCategory[] = ['seed', 'fert', 'chem', 'fuel', 'custom', 'other']
const UNITS: CropRow['yield_unit'][] = ['bu', 'lbs', 'cwt', 'ton', 'MT', 'ac']
// What the crop is grown for. Every Prairie Creek crop is segregated by field, so
// the bin policy told nobody anything and is gone.
const GROWN_FOR: { value: NonNullable<CropRow['category']>; label: string }[] = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'seed', label: 'Seed' },
  { value: 'own_use', label: 'Own use' },
]

function CropForm({ crop, readonly }: { crop: CropRow; readonly: boolean }) {
  const queryClient = useQueryClient()
  const { data: allCrops } = useCrops()
  const [form, setForm] = useState({
    name: crop.name,
    category: crop.category ?? 'commercial',
    default_yield_per_acre: crop.default_yield_per_acre?.toString() ?? '',
    yield_unit: crop.yield_unit,
    test_weight_lb_per_bu: crop.test_weight_lb_per_bu?.toString() ?? '',
    color: cropColour(crop),
    active: crop.active,
    afsc_insured: crop.afsc_insured,
    herbicide_trait: (crop.herbicide_trait ?? '') as TraitSetting | '',
  })
  const [dirty, setDirty] = useState(false)
  const saveColour = useSetCropColour()

  const save = useMutation({
    mutationFn: async () => {
      const patch: CropUpdate = {
        name: form.name.trim(),
        category: form.category,
        default_yield_per_acre: form.default_yield_per_acre
          ? Number(form.default_yield_per_acre)
          : null,
        yield_unit: form.yield_unit,
        test_weight_lb_per_bu: form.test_weight_lb_per_bu
          ? Number(form.test_weight_lb_per_bu)
          : null,
        color: form.color,
        active: form.active,
        afsc_insured: form.afsc_insured,
        herbicide_trait: form.herbicide_trait || null,
      }
      const { error } = await supabase.from('crops').update(patch).eq('id', crop.id)
      if (error) {
        if ((error as { code?: string }).code === '23505')
          throw new Error('Another crop already uses that name.')
        throw error
      }
    },
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['crops'] })
      // The trait feeds the rotation warnings.
      void queryClient.invalidateQueries({ queryKey: ['rotation-context'] })
    },
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Crop details</h3>
        {dirty && !readonly && (
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.name.trim()}
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-500">
          Crop name
          <input
            disabled={readonly}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Grown for
          <Select
            disabled={readonly}
            value={form.category}
            ariaLabel="What this crop is grown for"
            className="mt-1"
            onChange={(v) => set('category', v as NonNullable<CropRow['category']>)}
            options={GROWN_FOR}
          />
        </label>
        <label className="text-xs text-gray-500">
          Normal yield /ac (goal)
          <input
            type="number"
            disabled={readonly}
            value={form.default_yield_per_acre}
            onChange={(e) => set('default_yield_per_acre', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Unit
          <Select
            disabled={readonly}
            value={form.yield_unit}
            ariaLabel="Yield unit"
            className="mt-1"
            onChange={(v) => set('yield_unit', v as CropRow['yield_unit'])}
            options={UNITS.map((u) => ({ value: u, label: u }))}
          />
        </label>
        <label className="text-xs text-gray-500">
          Test weight lb/bu
          <input
            type="number"
            disabled={readonly}
            value={form.test_weight_lb_per_bu}
            onChange={(e) => set('test_weight_lb_per_bu', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <div className="text-xs text-gray-500">
          Colour
          <div className="mt-1">
            {/* Shared, not per-user: this is the colour the crop is drawn in on
                every map, chart and bin for everybody. */}
            {/* Saves on its own like the rest of this form's fields do not —
                the colour is written the moment it settles, so there is no
                half-chosen colour waiting on the Save button below. */}
            <ColourPicker
              value={form.color}
              disabled={readonly}
              ariaLabel={`Colour for ${crop.name}`}
              onCommit={(hex) => {
                set('color', hex)
                saveColour.mutate({ id: crop.id, color: hex })
              }}
            />
          </div>
        </div>
        <label className="flex items-end gap-2 pb-1 text-xs text-gray-500">
          <input
            type="checkbox"
            disabled={readonly}
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          Active
        </label>
        <label
          className="flex items-end gap-2 pb-1 text-xs text-gray-500"
          title="Untick when the crop is insured another way, such as a seed contract's own cover. It is then left off the AFSC reports."
        >
          <input
            type="checkbox"
            disabled={readonly}
            checked={form.afsc_insured}
            onChange={(e) => set('afsc_insured', e.target.checked)}
          />
          Insured with AFSC
        </label>
      </div>
      <TraitSetting
        crop={crop}
        name={form.name}
        value={form.herbicide_trait}
        readonly={readonly}
        onChange={(v) => set('herbicide_trait', v)}
        members={(crop.average_of ?? []).map((id) => allCrops?.find((c) => c.id === id)?.name).filter(Boolean) as string[]}
      />
      <ExpectedYieldNote crop={crop} />
      {save.isError && <p className="mt-2 text-xs text-red-600">{(save.error as Error).message}</p>}
    </div>
  )
}

/**
 * A canola's herbicide trait, which decides whose canola may follow whose on
 * a field (canola-trait.ts). Unset shows as a prompt, never a guess. The
 * stand-in for a company not yet chosen has no trait to set, and says what it
 * averages instead.
 */
function TraitSetting({
  crop,
  name,
  value,
  readonly,
  onChange,
  members,
}: {
  crop: CropRow
  name: string
  value: TraitSetting | ''
  readonly: boolean
  onChange: (v: TraitSetting | '') => void
  members: string[]
}) {
  if (crop.average_of?.length)
    return (
      <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Stands in for a seed canola whose company isn't chosen yet. Its price, input budget, normal yield and sister value are the
        average of {members.length ? members.join(', ') : 'the company crops'}, kept in step as theirs change — change those, not
        these. No herbicide trait until the company is known.
      </p>
    )
  if (!isCanola(name) && !value) return null
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-xs text-gray-500">
        Herbicide trait
        <Select
          disabled={readonly}
          value={value}
          ariaLabel="Herbicide trait"
          className="mt-1 min-w-[16rem]"
          onChange={(v) => onChange(v as TraitSetting | '')}
          options={[
            { value: '', label: 'Not set' },
            ...TRAITS.map((t) => ({ value: t, label: TRAIT_LABEL[t] })),
            { value: BOTH_TRAITS, label: 'Both — depends on the hybrid' },
          ]}
        />
      </label>
      {!value && (
        <p className="pb-1.5 text-xs font-medium text-amber-700">
          Set the trait: the rotation warns when a canola of the same trait grew on the field in the last {VOLUNTEER_WINDOW_YEARS} years.
        </p>
      )}
    </div>
  )
}

/**
 * What estimates use for this crop's yield: the farm's harvested average once
 * there is one, the normal yield until then. A field with five seasons of the
 * crop uses its own average (shown on the plan).
 */
function ExpectedYieldNote({ crop }: { crop: CropRow }) {
  const { cropYear } = useCropYear()
  const { data: history } = useYieldHistory()
  if (crop.land_rent_only)
    return <p className="mt-2 text-xs text-gray-500">Land rented out for this crop: no yield or price is expected.</p>
  const e = expectedYield({ cropId: crop.id, year: cropYear, unit: crop.yield_unit, goal: crop.default_yield_per_acre, history: history ?? [] })
  if (e.value == null) return null
  return (
    <p className="mt-2 text-xs text-gray-500">
      Estimates use{' '}
      <b className="text-gray-700">
        {(Math.round(e.value * 10) / 10).toLocaleString('en-CA')} {crop.yield_unit}/ac
      </b>{' '}
      — {e.label}. A field with five harvested seasons of {crop.name} uses its own average.
    </p>
  )
}

function VarietiesEditor({ crop, readonly }: { crop: CropRow; readonly: boolean }) {
  const { data: varieties } = useCropVarieties()
  const { add, update, remove } = useCropVarietyMutations()
  const mine = (varieties ?? []).filter((v) => v.crop_id === crop.id)
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', company: '' })
  const problem = (update.error ?? add.error) as Error | null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">Varieties</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        What the planner offers for this crop. A company (BASF, Corteva) reads ahead of the crop
        name wherever a plan records the variety.
      </p>
      {mine.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {mine.map((v) =>
            editing === v.id ? (
              <li key={v.id} className="flex w-full flex-wrap items-center gap-2 rounded-md border border-brand-200 bg-brand-50/40 p-2">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Name"
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <input
                  value={draft.company}
                  onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                  placeholder="Company (optional)"
                  className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={() =>
                    update.mutate(
                      { id: v.id, crop_id: crop.id, name: draft.name, company: draft.company, oldName: v.name },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                  disabled={!draft.name.trim() || update.isPending}
                  className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700"
                >
                  Cancel
                </button>
              </li>
            ) : (
              <li
                key={v.id}
                className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-sm text-gray-700"
              >
                {v.company && <span className="text-gray-500">{v.company}</span>}
                {v.name}
                {!readonly && (
                  <>
                    <button
                      onClick={() => {
                        setEditing(v.id)
                        setDraft({ name: v.name, company: v.company ?? '' })
                      }}
                      className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                      aria-label={`Edit ${v.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Remove the variety "${v.name}"? Plans that named it keep the name.`))
                          remove.mutate(v.id)
                      }}
                      className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-red-600"
                      aria-label={`Remove ${v.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-400">No varieties yet.</p>
      )}
      {!readonly && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim())
              add.mutate(
                { crop_id: crop.id, name, company: company.trim() || null },
                {
                  onSuccess: () => {
                    setName('')
                    setCompany('')
                  },
                },
              )
          }}
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3"
        >
          <input
            placeholder="Add a variety (e.g. Silage, Yellow, Chipper)…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 basis-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Company (optional)"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!name.trim() || add.isPending}
            className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>
      )}
      {problem && <p className="mt-2 text-xs text-red-600">{problem.message}</p>}
    </div>
  )
}

function PriceEditor({ crop, readonly }: { crop: CropRow; readonly: boolean }) {
  const { cropYear } = useCropYear()
  const queryClient = useQueryClient()
  const { data: prices } = useAllCropPrices()
  const { data: bidList } = useElevatorBids()
  const current = prices?.find((p) => p.crop_id === crop.id && p.crop_year === cropYear)
  const currentYear = new Date().getFullYear()
  // What the plan uses when nothing is typed for this year: the market for a
  // crop with an elevator bid, else the latest earlier year's price.
  const fallback = resolvePrice(
    crop.id,
    cropYear,
    (prices ?? []).filter((p) => p.crop_year !== cropYear),
    { market: marketPrice(crop.name, crop.yield_unit, new Map(bidList ?? [])), currentYear },
  )
  const forecast = cropYear > currentYear
  const [value, setValue] = useState<string | null>(null)
  const shown = value ?? current?.price_per_unit?.toString() ?? ''

  const save = useMutation({
    mutationFn: async (v: string) => {
      if (v === '') {
        if (current) {
          const { error } = await supabase.from('crop_prices').delete().eq('id', current.id)
          if (error) throw error
        }
      } else {
        const { error } = await supabase
          .from('crop_prices')
          .upsert(
            { crop_id: crop.id, crop_year: cropYear, price_per_unit: Number(v) },
            { onConflict: 'crop_id,crop_year' },
          )
        if (error) throw error
      }
    },
    onSuccess: () => {
      setValue(null)
      void queryClient.invalidateQueries({ queryKey: ['crop_prices'] })
    },
  })

  if (crop.land_rent_only)
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700">{cropYear} price</h3>
        <p className="mt-1 text-xs text-gray-500">Land rented out — the rent is on the lease, so no price is needed.</p>
      </div>
    )

  const fallbackText =
    fallback.value == null
      ? null
      : `${crop.yield_unit === 'lbs' ? fallback.value.toFixed(3) : fallback.value.toFixed(2)} (${fallback.basis === 'market' ? fallback.label : `the ${fallback.fromYear} price`})`

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">
        {cropYear} {forecast ? 'forecast price' : 'estimated price'}{' '}
        <span className="font-normal text-gray-400">($/{crop.yield_unit})</span>
      </h3>
      <input
        type="number"
        step="0.01"
        disabled={readonly}
        value={shown}
        placeholder={fallbackText ? fallbackText.split(' ')[0] : 'no price set'}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== null && value !== (current?.price_per_unit?.toString() ?? '')) {
            save.mutate(value)
          }
        }}
        className="mt-2 w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <p className="mt-1 text-xs text-gray-500">
        {current
          ? forecast
            ? `A ${cropYear} forecast, typed. Clear it to go back to ${fallbackText ?? 'no price'}.`
            : `Typed for ${cropYear}.${fallback.basis === 'market' ? ` Clear it to follow the market (${fallbackText}).` : ''}`
          : fallbackText
            ? `Using ${fallbackText} — it follows that as it changes. Type a price to set ${cropYear}'s own${forecast ? ' forecast' : ''}.`
            : `No price yet for ${cropYear}.`}
      </p>
      {save.isError && <p className="mt-1 text-xs text-red-600">{(save.error as Error).message}</p>}
    </div>
  )
}

function InputsEditor({ crop, readonly }: { crop: CropRow; readonly: boolean }) {
  const { cropYear } = useCropYear()
  const queryClient = useQueryClient()
  const { data: inputs } = useAllCropInputs()
  const resolved = resolveCosts(crop.id, cropYear, inputs ?? [], new Date().getFullYear())
  // This year's own lines; with none, the earlier year's are shown (read-only)
  // and are what the plan uses until they are copied into a forecast.
  const carried = resolved.basis === 'carried'
  const mine = carried ? [] : resolved.lines
  const total = resolved.total
  const [adding, setAdding] = useState({ name: '', category: 'other' as InputCategory, cost: '' })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['crop_inputs'] })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('crop_inputs').insert({
        crop_id: crop.id,
        crop_year: cropYear,
        name: adding.name,
        category: adding.category,
        cost_per_acre: Number(adding.cost || 0),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setAdding({ name: '', category: 'other', cost: '' })
      invalidate()
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, cost }: { id: string; cost: number }) => {
      const { error } = await supabase
        .from('crop_inputs')
        .update({ cost_per_acre: cost })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('crop_inputs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  // Copy the earlier year's budget into this year, where it can be changed
  // without touching the year it came from.
  const forecast = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('crop_inputs').insert(
        resolved.lines.map((i) => ({ crop_id: crop.id, crop_year: cropYear, name: i.name, category: i.category, cost_per_acre: i.cost_per_acre })),
      )
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          {cropYear} inputs / costs{resolved.basis === 'forecast' && <span className="ml-1 font-normal text-sky-700">(forecast)</span>}
        </h3>
        <span className="text-sm font-semibold text-gray-900">${total.toFixed(2)}/ac</span>
      </div>
      {carried && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Using the {resolved.fromYear} costs — they follow {resolved.fromYear} as it changes.
          <ul className="mt-1 divide-y divide-amber-100">
            {resolved.lines.map((i) => (
              <li key={i.id} className="flex justify-between py-0.5">
                <span>{i.name}</span>
                <span className="tabular-nums">${Number(i.cost_per_acre).toFixed(2)}</span>
              </li>
            ))}
          </ul>
          {!readonly && (
            <button
              onClick={() => forecast.mutate()}
              disabled={forecast.isPending}
              className="mt-2 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {forecast.isPending ? 'Copying…' : `Copy into ${cropYear} to edit`}
            </button>
          )}
        </div>
      )}
      {mine.length > 0 ? (
        <ul className="mt-2 divide-y divide-gray-100">
          {mine.map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {i.category}
              </span>
              {i.farm_fixed ? (
                // One farm-wide figure, set on Financials → Farm costs; the
                // database refuses an edit here, so none is offered.
                <Link
                  to="/plan?tab=farm costs"
                  title="Set for the whole farm on Financials → Farm costs"
                  className="w-24 px-2 py-1 text-right text-sm tabular-nums text-gray-700 underline decoration-gray-300 decoration-dotted"
                >
                  {Number(i.cost_per_acre).toFixed(2)}
                </Link>
              ) : (
                <input
                  type="number"
                  step="0.01"
                  disabled={readonly}
                  defaultValue={i.cost_per_acre}
                  onBlur={(e) => {
                    const v = Number(e.target.value || 0)
                    if (v !== i.cost_per_acre) update.mutate({ id: i.id, cost: v })
                  }}
                  className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
                />
              )}
              {!readonly && !i.farm_fixed && (
                <button
                  onClick={() => del.mutate(i.id)}
                  className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${i.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !carried && <p className="mt-2 text-sm text-gray-400">No inputs for {cropYear}.</p>
      )}
      {!readonly && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
          <input
            placeholder="Input name"
            value={adding.name}
            onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <Select
            value={adding.category}
            ariaLabel="Input category"
            className="w-28"
            onChange={(v) => setAdding((a) => ({ ...a, category: v as InputCategory }))}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <input
            type="number"
            step="0.01"
            placeholder="$/ac"
            value={adding.cost}
            onChange={(e) => setAdding((a) => ({ ...a, cost: e.target.value }))}
            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm"
          />
          <button
            onClick={() => add.mutate()}
            disabled={!adding.name || add.isPending}
            className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      )}
    </div>
  )
}

export function CropDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { data: crops } = useCrops()
  const crop = crops?.find((c) => c.id === id)
  const readonly = !hasManagerAccess(profile?.role)

  if (!crop) {
    return <div className="p-6 text-sm text-gray-500">{crops ? 'Crop not found.' : 'Loading…'}</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <Link
        to="/crops"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Crops
      </Link>
      <h1 className="mt-2 text-xl font-bold text-gray-900">{crop.name}</h1>

      <div className="mt-4 flex flex-col gap-3">
        <CropForm key={`form-${crop.id}`} crop={crop} readonly={readonly} />
        <VarietiesEditor key={`var-${crop.id}`} crop={crop} readonly={readonly} />
        <CropMoisture key={`moist-${crop.id}`} crop={crop} readonly={readonly} />
        <PriceEditor key={`price-${crop.id}`} crop={crop} readonly={readonly} />
        <InputsEditor key={`inputs-${crop.id}`} crop={crop} readonly={readonly} />
        {/* The four stage notes and "Other notes" in one card. */}
        <CropNotes
          key={`notes-${crop.id}-${crop.notes_planting ?? ''}${crop.notes_growing ?? ''}${crop.notes_harvest ?? ''}${crop.notes_storage ?? ''}${crop.cheatsheet_md ?? ''}`}
          crop={crop}
          readonly={readonly}
        />
        {/* Last, and folded, because they are the longest and they are
            reference rather than something you come here to change. Shown for
            archived crops too — an archived crop is exactly the one whose
            history you are looking up. */}
        <Fold title="Planter settings" storageKey="crop-planter-settings" className="border-0 bg-transparent" bodyClassName="border-t-0 p-0">
          <CropPlanterSettings
            key={`planter-${crop.id}`}
            cropId={crop.id}
            cropName={crop.name}
            readonly={readonly}
          />
        </Fold>
        <Fold title="Field history" storageKey="crop-field-history" className="border-0 bg-transparent" bodyClassName="border-t-0 p-0">
          <CropFieldHistory key={`hist-${crop.id}`} cropId={crop.id} cropName={crop.name} />
        </Fold>
      </div>
    </div>
  )
}
