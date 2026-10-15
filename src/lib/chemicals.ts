import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type Chemical = Database['public']['Tables']['chemicals']['Row']

/**
 * The approved label PDF, given Health Canada's id for the document.
 *
 * In Canada the label IS the safety document — precautions, protective
 * equipment, first aid, re-entry intervals and rates are all on it, and it is
 * the label rather than a separate data sheet that legally governs use.
 */
export const labelPdfUrl = (docId: string) =>
  `https://pest-control.canada.ca/pesticide-registry-api/api/pdf/inline/en/${encodeURIComponent(docId)}`

/**
 * Pull the CURRENT document id for a registration, straight from the registry.
 *
 * The id we already hold cannot be used for this. PMRA renumbered every
 * document at some point on 15-16 Sep 2026: every id in chemical_labels now
 * answers 500, including ones fetched the previous night. They are still
 * perfectly good as a CHANGE SIGNAL for the label reader — a new number means a
 * reissued label — but as an address they go stale without warning, and a dead
 * link on the page somebody opened to check a precaution is the wrong failure.
 *
 * One request per click, which is the right trade: it is the difference between
 * a link that always works and one that works until Health Canada tidies up.
 */
export async function currentLabelDocId(registrationNumber: string): Promise<string | null> {
  const res = await fetch(
    `https://pest-control.canada.ca/pesticide-registry-api/api/search/product-labels/${encodeURIComponent(registrationNumber)}?lang=en`,
  )
  if (!res.ok) throw new Error(`label lookup ${res.status}`)
  return englishLabelDocId((await res.json()) as LabelSearchRow[] | { data?: LabelSearchRow[] })
}

export type LabelSearchRow = { DOC_EPR_TYPE_E?: string; links?: string }

/**
 * The English approved label's id out of the registry's reply.
 *
 * The French row carries an `/en/` PDF link too, so matching the link alone
 * picks whichever came back first — it is the TYPE column that says which
 * language the document is.
 */
export function englishLabelDocId(
  body: LabelSearchRow[] | { data?: LabelSearchRow[] },
): string | null {
  const rows = Array.isArray(body) ? body : (body.data ?? [])
  const english = rows.find((r) => /APPROVED LABEL\s*-\s*English/i.test(r.DOC_EPR_TYPE_E ?? ''))
  if (!english) return null
  const m = /pdf\/inline\/en\/(\d+)/.exec(english.links ?? '')
  return m ? m[1] : null
}

/**
 * Open a product's current label in a new tab, from its registration number.
 * The tab opens at the click (a popup opened after the lookup would be
 * blocked) and is pointed at the English label PDF once the registry says
 * which document that is today; failing that, the registry's label search.
 */
export function openChemicalLabel(registration: string) {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  const go = (href: string) => {
    if (tab) tab.location.href = href
    // A blocked popup is not a reason to lose the page they are on.
    else window.open(href, '_blank', 'noopener')
  }
  currentLabelDocId(registration)
    .then((docId) => go(docId ? labelPdfUrl(docId) : labelUrl(registration)))
    .catch(() => go(labelUrl(registration)))
}

/** Official Health Canada label search for a registration number. */
export const labelUrl = (registrationNumber: string) =>
  `https://pr-rp.hc-sc.gc.ca/ls-re/result-eng.php?p_search_label=&searchfield1=REGNU&operator1=CONTAIN&criteria1=${encodeURIComponent(registrationNumber)}`

/**
 * What the search term is meant to match.
 *
 * Searching everything at once is the right default — people look a chemical up
 * by whichever detail they happen to know — but it gets noisy: "canola" matches
 * a hundred products by registered site, burying the one whose name contains it.
 * Narrowing to a single column is what makes that search usable.
 */
export const SEARCH_FIELDS = {
  any: { label: 'Anything', columns: null },
  name: { label: 'Product name', columns: ['name', 'registration_number'] },
  pest: { label: 'Pest controlled', columns: ['pests'] },
  crop: { label: 'Crop', columns: ['sites_of_use'] },
  ingredient: { label: 'Active ingredient', columns: ['active_ingredients'] },
} as const
export type SearchField = keyof typeof SEARCH_FIELDS

const ALL_COLUMNS = ['name', 'active_ingredients', 'pests', 'sites_of_use', 'registration_number']

export const SEARCH_LIMIT = 200

/** Merge per-column result sets into one list: unique, by name, capped. */
export function mergeMatches(sets: Chemical[][], limit = SEARCH_LIMIT): Chemical[] {
  const byId = new Map<string, Chemical>()
  for (const set of sets) for (const row of set) byId.set(row.id, row)
  return [...byId.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Search the registry mirror.
 *
 * One query per column, merged here, rather than a single PostgREST `or=(...)`.
 * That filter is comma-separated, so a search for "2,4-D" would be read as two
 * broken conditions — and 2,4-D is in 77 of these products, so the most ordinary
 * herbicide search on the farm would quietly return nothing. Quoting the value
 * is supposed to solve it, but RLS blocks anonymous reads so that could not be
 * verified against the live API, and an unverified assumption is not worth
 * shipping under a search box. Separate `ilike` filters are encoded properly and
 * cannot misread the term.
 */
/**
 * The query itself, separate from the hook.
 *
 * The offline warm-up needs to fetch exactly what the page fetches, under
 * exactly the key the page reads. Writing it out a second time there would
 * work until one of the two changed, and then the warm-up would be filling a
 * cache entry nothing looks at — a failure with no symptom except an empty
 * screen in a field.
 */
export function chemicalSearchQuery(term: string, productType: string, field: SearchField = 'any') {
  const q = term.trim()
  return {
    queryKey: ['chemicals', q, productType, field],
    queryFn: async () => {
      const base = () => {
        let x = supabase.from('chemicals').select('*').order('name').limit(SEARCH_LIMIT)
        if (productType) x = x.eq('product_type', productType)
        return x
      }
      if (!q) {
        const { data, error } = await base()
        if (error) throw error
        return data
      }
      const like = `%${q}%`
      const columns = SEARCH_FIELDS[field].columns ?? ALL_COLUMNS
      const results = await Promise.all(columns.map((c) => base().ilike(c, like)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
      return mergeMatches(results.map((r) => r.data ?? []))
    },
  }
}

export function useChemicalSearch(term: string, productType: string, field: SearchField = 'any') {
  return useQuery(chemicalSearchQuery(term, productType, field))
}

export type ChemicalLabel = Database['public']['Tables']['chemical_labels']['Row']
export type ChemicalLabelCrop = Database['public']['Tables']['chemical_label_crops']['Row']

/**
 * The label details for one product: how much water, how it may be applied, how
 * long before rain, and the per-crop rates and cropping restrictions.
 *
 * None of this is in Health Canada's data feed — the registry carries name,
 * ingredient, pests and registered sites and nothing more. It is read out of the
 * official label PDF, and every value keeps the label sentence it came from.
 *
 * A blank field means the label does not state it, or nobody has read the label
 * yet — never that the restriction does not exist.
 */
export function useChemicalLabel(registrationNumber: string | null) {
  return useQuery({
    queryKey: ['chemical_label', registrationNumber],
    enabled: Boolean(registrationNumber),
    // While a read is in flight the row says so, so poll until it settles
    // instead of guessing at timers.
    refetchInterval: (q) => {
      const d = q.state.data as
        | { label?: { extraction_status?: string | null; extraction_started_at?: string | null } }
        | undefined
      // Poll while queued too — the worker may pick it up at any moment.
      if (d?.label?.extraction_status === 'queued') return 15000
      if (d?.label?.extraction_status !== 'reading') return false
      // Stop polling a read that was abandoned, rather than forever.
      const started = d.label.extraction_started_at
        ? Date.parse(d.label.extraction_started_at)
        : 0
      return started > 0 && Date.now() - started > 5 * 60_000 ? false : 4000
    },
    queryFn: async () => {
      const [label, crops] = await Promise.all([
        supabase
          .from('chemical_labels')
          .select('*')
          .eq('registration_number', registrationNumber!)
          .maybeSingle(),
        supabase
          .from('chemical_label_crops')
          .select('*')
          .eq('registration_number', registrationNumber!)
          .order('crop'),
      ])
      if (label.error) throw label.error
      if (crops.error) throw crops.error
      return { label: label.data, crops: crops.data ?? [] }
    },
  })
}

/** Columns a person can correct, and which therefore need protecting. */
const EDITABLE = [
  'water_volume',
  'application_method',
  'rainfast_hours',
  'irrigation_hours',
  'reentry_hours',
  'reentry_note',
  'grazing_restriction',
] as const

export function useSaveChemicalLabel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: Database['public']['Tables']['chemical_labels']['Insert']) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: existing } = await supabase
        .from('chemical_labels')
        .select(
          'manual_fields, water_volume, application_method, rainfast_hours, irrigation_hours, reentry_hours, reentry_note, grazing_restriction',
        )
        .eq('registration_number', row.registration_number)
        .maybeSingle()

      // Anything the person actually changed becomes theirs: next month's
      // re-read leaves it alone instead of overwriting the correction.
      const manual = new Set(existing?.manual_fields ?? [])
      for (const k of EDITABLE) {
        const before = (existing as Record<string, unknown> | null)?.[k] ?? null
        const after = (row as Record<string, unknown>)[k] ?? null
        if (existing && before !== after) manual.add(k)
      }

      const { error } = await supabase.from('chemical_labels').upsert(
        {
          ...row,
          manual_fields: [...manual],
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'registration_number' },
      )
      if (error) throw error
    },
    onSuccess: (_d, row) =>
      void qc.invalidateQueries({ queryKey: ['chemical_label', row.registration_number] }),
  })
}

export function useSaveLabelCrop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      row: Database['public']['Tables']['chemical_label_crops']['Insert'] & { id?: string },
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      // `id` identifies the row; it is not part of the row's own data.
      const { id, ...rest } = row
      const patch = { ...rest, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }
      const { error } = id
        ? await supabase.from('chemical_label_crops').update(patch).eq('id', id)
        : await supabase.from('chemical_label_crops').insert(patch)
      if (error) throw error
    },
    onSuccess: (_d, row) =>
      void qc.invalidateQueries({ queryKey: ['chemical_label', row.registration_number] }),
  })
}

/**
 * Read this product's label now.
 *
 * The function runs in the background — a 20-56 page PDF plus Claude reading it
 * takes longer than a request should be held open — so a 202 means "started",
 * not "done". The caller polls the label query rather than awaiting a result.
 */
export function useExtractLabel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { registration_number: string; force?: boolean }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/chemical-label-extract-background', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(v),
      })
      if (res.status === 202 || res.ok) return { started: true }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Could not start (${res.status})`)
    },
    onSuccess: (_d, v) => {
      // A background run returns 202 straight away and finishes in roughly half
      // a minute, so re-check a few times rather than once — otherwise the page
      // sits empty until something else happens to refetch it.
      for (const ms of [8000, 20000, 45000, 90000]) {
        setTimeout(
          () => void qc.invalidateQueries({ queryKey: ['chemical_label', v.registration_number] }),
          ms,
        )
      }
    },
  })
}

export function useDeleteLabelCrop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: { id: string; registration_number: string }) => {
      const { error } = await supabase.from('chemical_label_crops').delete().eq('id', row.id)
      if (error) throw error
    },
    onSuccess: (_d, row) =>
      void qc.invalidateQueries({ queryKey: ['chemical_label', row.registration_number] }),
  })
}

/** Distinct product types, for the filter. */
export function useChemicalTypes() {
  return useQuery({
    queryKey: ['chemical_types'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('chemicals').select('product_type')
      if (error) throw error
      const set = new Set((data ?? []).map((d) => d.product_type).filter(Boolean) as string[])
      return [...set].sort()
    },
  })
}

export function useChemicalCount() {
  return useQuery({
    queryKey: ['chemicals_count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('chemicals')
        .select('*', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },
  })
}

/** Manager-only: pull the registry now instead of waiting for the nightly run. */
export function useSyncChemicals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/chemicals-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? body.detail ?? 'Sync failed')
      return body as { written: number; detail: string }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['chemicals'] })
      void queryClient.invalidateQueries({ queryKey: ['chemicals_count'] })
      void queryClient.invalidateQueries({ queryKey: ['chemical_types'] })
    },
  })
}

/** Manager-only: queue label reads for the whole lookup, or just what we spray. */
export function useQueueLabels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { scope: 'used' | 'all' }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/chemical-labels-queue-background', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(v),
      })
      const body = (await res.json().catch(() => ({}))) as {
        queued?: number
        candidates?: number
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? `Could not queue (${res.status})`)
      return body
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chemical_label'] }),
  })
}

/** How far through the label backlog we are. */
export function useLabelProgress() {
  return useQuery({
    queryKey: ['chemical_label_progress'],
    refetchInterval: (q) => {
      const d = q.state.data as { queued?: number } | undefined
      return (d?.queued ?? 0) > 0 ? 20000 : false
    },
    queryFn: async () => {
      const counts = await Promise.all(
        (['queued', 'reading', 'ok', 'error'] as const).map(async (status) => {
          const { count } = await supabase
            .from('chemical_labels')
            .select('registration_number', { count: 'exact', head: true })
            .eq('extraction_status', status)
          return [status, count ?? 0] as const
        }),
      )
      return Object.fromEntries(counts) as Record<'queued' | 'reading' | 'ok' | 'error', number>
    },
  })
}
