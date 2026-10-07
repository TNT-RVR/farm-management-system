import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { HelpNote } from '@/components/HelpNote'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Leaf, Pencil, Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { useFields } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { petioleNitrateBand } from '@/lib/fert-savings/alberta'
import { petioleFertigation } from '@/lib/fert-savings/checks'
import {
  NUTRIENTS,
  SUFFICIENCY,
  cropKey,
  nutrientsFor,
  readTissue,
  shortages,
  tissueFormOf,
  type NutrientKey,
  type Verdict,
} from '@/lib/tissue'

type TissueRow = Database['public']['Tables']['tissue_tests']['Row']

function useTissueTests(cropYear: number) {
  return useQuery({
    queryKey: ['tissue_tests', cropYear],
    queryFn: async (): Promise<TissueRow[]> => {
      const { data, error } = await supabase
        .from('tissue_tests')
        .select('*')
        .eq('crop_year', cropYear)
        .order('sampled_on', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Planting date per field this season, for days after planting. */
function usePlantingDates(cropYear: number) {
  return useQuery({
    queryKey: ['field_crop_seasons', 'planting', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_crop_seasons').select('field_id, planting_date').eq('crop_year', cropYear)
      if (error) throw error
      const m = new Map<string, string>()
      for (const r of data ?? []) if (r.planting_date && !m.has(r.field_id)) m.set(r.field_id, r.planting_date)
      return m
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * The potato petiole reading, turned into a pivot top-up: days after planting
 * from the season's planting date, Alberta's band for that day, and 20–40 lb
 * N when the reading is under it (see petioleFertigation).
 */
function PetioleAdvice({ reading, sampledOn, plantedOn, fieldId }: { reading: number | null; sampledOn: string | null; plantedOn: string | null; fieldId: string | null }) {
  if (reading == null) return null
  const dap = sampledOn && plantedOn ? Math.round((Date.parse(sampledOn) - Date.parse(plantedOn)) / 86_400_000) : null
  const band = dap != null ? petioleNitrateBand(dap) : null
  const a = petioleFertigation(reading, band, dap)
  return (
    <p
      className={cn(
        'mb-2 rounded-md px-2.5 py-2 text-xs',
        a.verdict === 'short' ? 'bg-amber-50 text-amber-900' : a.verdict === 'unknown' ? 'bg-gray-50 text-gray-600' : 'bg-green-50 text-green-900',
      )}
    >
      <strong>Pivot top-up:</strong>{' '}
      {a.verdict === 'unknown'
        ? plantedOn
          ? 'needs the sample date.'
          : (
            <>
              no planting date for this field this season — set it on the field’s crop season (or let Deere’s seeding pass fill it) to read the petiole by
              days after planting. <SetupLink to={SETUP_LINKS.plantingDate(fieldId)}>Set the planting date</SetupLink>
            </>
          )
        : `${dap} days after planting (planted ${plantedOn}). ${a.why}.`}
    </p>
  )
}

function useTissueMutations(cropYear: number) {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['tissue_tests'] })
  const save = useMutation({
    mutationFn: async (row: Database['public']['Tables']['tissue_tests']['Insert']) => {
      const { error } = await supabase
        .from('tissue_tests')
        .upsert(
          { ...row, crop_year: row.crop_year ?? cropYear },
          { onConflict: 'field_id,sampled_on,sample_code' },
        )
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tissue_tests').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  // Sam, 7 Oct 2026: every reading on a test can be corrected, not only its stage.
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['tissue_tests']['Update'] }) => {
      const { error } = await supabase.from('tissue_tests').update(patch).eq('id', id)
      if (error) {
        if (error.code === '23505') throw new Error('There is already a test for that field, date and sample code.')
        throw error
      }
    },
    onSuccess: invalidate,
  })
  const setStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string | null }) => {
      const { error } = await supabase
        .from('tissue_tests')
        .update({ growth_stage: stage })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { save, update, remove, setStage }
}

const VERDICT_STYLE: Record<Verdict, string> = {
  low: 'bg-red-50 text-red-800 font-semibold',
  ok: 'text-gray-900',
  high: 'bg-sky-50 text-sky-800',
  unknown: 'text-gray-400',
}

const n = (v: number | null, unit: string) =>
  v == null ? '—' : unit === '%' ? v.toFixed(2) : v.toFixed(1)

/**
 * What the crop took up, against what it should have.
 *
 * A soil test says what is in the ground before the season; this says whether
 * the crop actually got it, in time to do something about it. The number on its
 * own means nothing — 17 ppm of zinc is short in corn at tassel and fine in
 * wheat at boot — so every reading is shown against the sufficiency band for
 * that crop and stage, and the shortages are called out first.
 */
export function TissueTests({ cropYear, canEdit }: { cropYear: number; canEdit: boolean }) {
  const { data: tests, isLoading } = useTissueTests(cropYear)
  const { data: fields } = useFields()
  const { remove, setStage } = useTissueMutations(cropYear)
  const { data: plantings } = usePlantingDates(cropYear)
  const [confirmDelete, setConfirmDelete] = useState<TissueRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TissueRow | null>(null)
  // Which records are folded. Open by default: the verdict is the point of
  // the page, and a season has a handful of tests, not a hundred.
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setFolded((f) => ({ ...f, [id]: !f[id] }))

  const fieldName = (id: string | null) =>
    fields?.find((f) => f.id === id)?.name ?? 'Field not recorded'

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HelpNote
          className="max-w-2xl text-xs"
          summary="Readings are judged for the crop and growth stage — set the stage on each test."
          title="About tissue tests"
        >
          Tissue tests say whether the crop got what the soil test said to give it, while there is
          still time to act. Readings are judged against the sufficiency band for the crop and
          growth stage — set the stage on each test, because the same number means different things
          at V6 and at tassel.
        </HelpNote>
        {canEdit && (
          <button
            onClick={() => setAdding(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> Add a test
          </button>
        )}
      </div>

      {!tests?.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No tissue tests for {cropYear}.
        </p>
      ) : (
        tests.map((t) => {
          const { readings, ranges } = readTissue(
            t as Partial<Record<NutrientKey, number | null>>,
            t.crop,
            t.growth_stage,
          )
          const short = shortages(readings)
          const stages = SUFFICIENCY[cropKey(t.crop) ?? ''] ?? []
          const isOpen = !folded[t.id]

          return (
            <section
              key={t.id}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2',
                  isOpen && 'border-b border-gray-200',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  aria-expanded={isOpen}
                  className="flex items-center gap-2 text-left"
                >
                  <ChevronRight
                    className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-90')}
                  />
                  <Leaf className="h-4 w-4 shrink-0 text-green-600" />
                  <span className="font-semibold text-gray-900">{fieldName(t.field_id)}</span>
                </button>
                {/* Folded, the header still says the one thing worth knowing. */}
                {!isOpen && ranges && (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px] font-semibold',
                      short.length ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800',
                    )}
                  >
                    {short.length ? `Short: ${short.map((r) => r.nutrient.label).join(', ')}` : 'All in band'}
                  </span>
                )}
                <span className="text-sm text-gray-600">
                  {t.crop ?? 'crop not recorded'}
                  {t.sampled_on ? ` · ${t.sampled_on}` : ''}
                  {t.lab ? ` · ${t.lab}` : ''}
                </span>

                {stages.length > 0 && canEdit ? (
                  <Select
                    value={t.growth_stage ?? ''}
                    ariaLabel="Growth stage"
                    size="sm"
                    className="w-56"
                    onChange={(v) => setStage.mutate({ id: t.id, stage: v || null })}
                    options={[
                      { value: '', label: 'Stage not recorded' },
                      ...stages.map((s) => ({ value: s.stage, label: `${s.stage} — ${s.part}` })),
                    ]}
                  />
                ) : (
                  <span className="text-xs text-gray-500">
                    {t.growth_stage ?? 'stage not recorded'}
                  </span>
                )}

                {canEdit && (
                  <span className="ml-auto flex items-center gap-0.5">
                    <button
                      onClick={() => setEditing(t)}
                      className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Edit this test"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(t)}
                      className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete this test"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                )}
              </div>

              {isOpen && (
              <div className="px-3 py-2">
                {!ranges && stages.length > 1 ? (
                  <p className="mb-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <strong>Pick the growth stage to judge this test.</strong> The sufficiency bands
                    for {t.crop ?? 'this crop'} change through the season, and judging against the
                    wrong one either hides a real shortage or invents one.
                  </p>
                ) : !ranges ? (
                  <p className="mb-2 rounded-md bg-gray-50 px-2.5 py-2 text-xs text-gray-600">
                    No sufficiency bands held for {t.crop ?? 'this crop'}, so the readings are shown
                    as measured and judged against nothing.
                  </p>
                ) : short.length > 0 ? (
                  <p className="mb-2 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-900">
                    <strong>Short: {short.map((r) => r.nutrient.label).join(', ')}.</strong>{' '}
                    {short
                      .map(
                        (r) =>
                          `${r.nutrient.label} ${n(r.value, r.nutrient.unit)} against ${r.band![0]}–${r.band![1]}`,
                      )
                      .join('; ')}
                    .
                  </p>
                ) : (
                  <p className="mb-2 rounded-md bg-green-50 px-2.5 py-2 text-xs text-green-900">
                    Everything measured is within its sufficiency band.
                  </p>
                )}

                {cropKey(t.crop) === 'potato' && (
                  <PetioleAdvice
                    reading={t.no3n_ppm == null ? null : Number(t.no3n_ppm)}
                    sampledOn={t.sampled_on}
                    plantedOn={t.field_id ? (plantings?.get(t.field_id) ?? null) : null}
                    fieldId={t.field_id}
                  />
                )}

                {ranges?.assumed && (
                  <p className="mb-2 text-[11px] text-amber-800">
                    Judged against <strong>{ranges.stage}</strong> ({ranges.part}), the one band held
                    for this crop. A sample taken at another stage reads differently.
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-1 pr-3 font-medium">Nutrient</th>
                        <th className="py-1 pr-3 text-right font-medium">Reading</th>
                        <th className="py-1 pr-3 text-right font-medium">Sufficient</th>
                        <th className="py-1 font-medium">Where it sits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readings.map((r) => (
                        <tr key={r.nutrient.key} className="border-b border-gray-100 last:border-0">
                          <td className="py-1 pr-3">
                            {r.nutrient.label}
                            {r.nutrient.group === 'micro' && (
                              <span className="ml-1 text-[10px] uppercase text-gray-400">
                                micro
                              </span>
                            )}
                          </td>
                          <td
                            className={cn(
                              'py-1 pr-3 text-right tabular-nums',
                              VERDICT_STYLE[r.verdict],
                            )}
                          >
                            {n(r.value, r.nutrient.unit)}
                            <span className="ml-0.5 text-[10px] text-gray-400">
                              {r.nutrient.unit}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums text-gray-500">
                            {r.band ? `${r.band[0]}–${r.band[1]}` : '—'}
                          </td>
                          <td className="py-1 text-xs">
                            {r.verdict === 'low' && (
                              <span className="text-red-700">below band</span>
                            )}
                            {r.verdict === 'ok' && <span className="text-gray-400">in band</span>}
                            {r.verdict === 'high' && (
                              <span className="text-sky-700">above band</span>
                            )}
                            {r.verdict === 'unknown' && (
                              <span className="text-gray-300">
                                {r.value == null ? 'not measured' : 'no band'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {t.notes && <p className="mt-2 text-xs text-gray-500">{t.notes}</p>}
              </div>
              )}
            </section>
          )
        })
      )}

      {adding && <TissueTestForm cropYear={cropYear} onClose={() => setAdding(false)} />}
      {editing && <TissueTestForm cropYear={cropYear} existing={editing} onClose={() => setEditing(null)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this tissue test?"
          message="The readings go. Nothing else refers to them."
          onConfirm={() => {
            remove.mutate(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/**
 * Typing a lab report in by hand, or correcting one — the panel is fixed, so
 * the form can be too.
 */
function TissueTestForm({ cropYear, existing, onClose }: { cropYear: number; existing?: TissueRow; onClose: () => void }) {
  const { data: fields } = useFields()
  const { save, update } = useTissueMutations(cropYear)
  const busy = existing ? update : save
  const [form, setForm] = useState<Record<string, string>>(() =>
    existing ? tissueFormOf(existing) : { sampled_on: new Date().toISOString().slice(0, 10) },
  )
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const num = (k: string) => {
    const v = form[k]?.trim()
    if (!v) return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }

  const stages = SUFFICIENCY[cropKey(form.crop) ?? ''] ?? []
  const preview = useMemo(
    () =>
      readTissue(
        Object.fromEntries(NUTRIENTS.map((x) => [x.key, form[x.key] ?? null])) as Partial<
          Record<NutrientKey, string | null>
        >,
        form.crop,
        form.growth_stage,
      ),
    [form],
  )
  const short = shortages(preview.readings)

  return (
    <Modal title={existing ? `Edit tissue test — ${existing.crop_year}` : `Add a tissue test — ${cropYear}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-500">
            Field
            <Select
              value={form.field_id ?? ''}
              ariaLabel="Field"
              className="mt-1"
              onChange={(v) => set('field_id', v)}
              options={[
                { value: '', label: '—' },
                ...(fields ?? [])
                  .filter((f) => f.active || f.id === existing?.field_id)
                  .map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
          </label>
          <label className="text-xs text-gray-500">
            Sampled on
            <input
              type="date"
              value={form.sampled_on ?? ''}
              onChange={(e) => set('sampled_on', e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            Crop
            <input
              value={form.crop ?? ''}
              onChange={(e) => set('crop', e.target.value)}
              placeholder="Corn"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            Growth stage
            <Select
              value={form.growth_stage ?? ''}
              ariaLabel="Growth stage"
              className="mt-1"
              onChange={(v) => set('growth_stage', v)}
              options={[
                { value: '', label: stages.length ? 'Not recorded' : 'Enter a crop first' },
                ...stages.map((s) => ({ value: s.stage, label: s.stage })),
                // A stage from an import that is not in the bands list stays pickable.
                ...(form.growth_stage && !stages.some((s) => s.stage === form.growth_stage) ? [{ value: form.growth_stage, label: form.growth_stage }] : []),
              ]}
            />
          </label>
          {(
            [
              ['plant_part', 'Plant part', 'Ear leaf'],
              ['lab', 'Lab', ''],
              ['sample_code', 'Sample code', ''],
            ] as const
          ).map(([k, label, ph]) => (
            <label key={k} className="text-xs text-gray-500">
              {label}
              <input
                value={form[k] ?? ''}
                onChange={(e) => set(k, e.target.value)}
                placeholder={ph}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {nutrientsFor(form.crop).map((x) => (
            <label key={x.key} className="text-xs text-gray-500">
              {x.label} ({x.unit})
              <input
                type="number"
                inputMode="decimal"
                value={form[x.key] ?? ''}
                onChange={(e) => set(x.key, e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
              />
            </label>
          ))}
        </div>

        <label className="block text-xs text-gray-500">
          Note
          <textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>

        {short.length > 0 && (
          <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-900">
            As typed, short of {short.map((r) => r.nutrient.label).join(', ')}.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            disabled={busy.isPending}
            onClick={() => {
              const values = {
                field_id: form.field_id || null,
                sampled_on: form.sampled_on || null,
                crop: form.crop?.trim() || null,
                growth_stage: form.growth_stage || null,
                plant_part: form.plant_part?.trim() || null,
                lab: form.lab?.trim() || null,
                sample_code: form.sample_code?.trim() || null,
                notes: form.notes?.trim() || null,
                ...Object.fromEntries(NUTRIENTS.map((x) => [x.key, num(x.key)])),
              }
              if (existing) update.mutate({ id: existing.id, patch: values }, { onSuccess: onClose })
              else save.mutate({ crop_year: cropYear, ...values }, { onSuccess: onClose })
            }}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {busy.isPending ? 'Saving…' : 'Save test'}
          </button>
        </div>
        {busy.error && <p className="text-xs text-red-700">{(busy.error as Error).message}</p>}
      </div>
    </Modal>
  )
}
