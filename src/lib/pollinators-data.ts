/**
 * The reads and writes behind the pollinators tab.
 *
 * The rules in pollinators.ts stay pure; everything that touches the database
 * is here. One hook assembles the tab, because every warning needs a field's
 * placements, its sprays, its pivot passes and its hail reports together — and
 * the bloom rows the page already has.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import {
  hailWarnings,
  pivotWarnings,
  sortWarnings,
  mergePasses,
  sprayWarnings,
  stockingAdvice,
  type BeeWarning,
  type Placement,
  type SprayPass,
  type StockingAdvice,
} from './pollinators'
import type { Database } from './database.types'

export type PlacementRow = Database['public']['Tables']['bee_placements']['Row']

/** The farm's own day, so a placement does not look over a day early. */
export const farmToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' })

export type PollinatorField = {
  fieldId: string
  fieldName: string
  /** The satellite's petal share, 0-1, as the bloom row gives it. */
  yellowNow: number | null
  stage: string | null
  placements: Placement[]
  warnings: BeeWarning[]
  advice: StockingAdvice
  /** Sprays booked or applied from today on, for the note to the beekeeper. */
  upcoming: SprayPass[]
}

export type PollinatorSeason = {
  cropYear: number
  today: string
  fields: PollinatorField[]
  /** Beekeepers and leafcutter producers already on file, for the picker. */
  contacts: { id: string; label: string }[]
}

/**
 * Every canola field this year with its bloom, its bees and what happened to them.
 *
 * Canola fields come from the bloom rows rather than the crop plan: the bloom
 * row is what carries the satellite's share, and a canola field with no bloom
 * row has nothing to say about stocking anyway.
 */
export function usePollinatorSeason(cropYear: number) {
  return useQuery({
    queryKey: ['pollinators', cropYear],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PollinatorSeason> => {
      const today = farmToday()
      const [bloom, fields, placements, contacts] = await Promise.all([
        supabase.from('canola_bloom').select('field_id, crop_year, yellow_now, stage').eq('crop_year', cropYear),
        supabase.from('fields').select('id, name, active'),
        supabase.from('bee_placements').select('*').eq('crop_year', cropYear),
        supabase.from('contacts').select('id, company, contact_name, type, tags, active'),
      ])
      for (const r of [bloom, fields, placements, contacts]) if (r.error) throw r.error

      const nameOf = new Map((fields.data ?? []).map((f) => [f.id as string, f.name as string]))
      const contactLabel = new Map(
        (contacts.data ?? []).map((c) => [
          c.id as string,
          [c.company, c.contact_name].filter(Boolean).join(' — ') || 'Unnamed contact',
        ]),
      )

      const fieldIds = [...new Set((bloom.data ?? []).map((b) => b.field_id as string))]
      if (!fieldIds.length) {
        return { cropYear, today, fields: [], contacts: beeContacts(contacts.data ?? [], contactLabel) }
      }

      const from = `${cropYear}-04-01`
      const to = `${cropYear}-11-30`
      const [moa, unplaced, irrigation, hail] = await Promise.all([
        supabase
          .from('field_moa_history_v')
          .select('field_id, operation_id, product_id, applied_on, product_name, scheme')
          .in('field_id', fieldIds)
          .gte('applied_on', from)
          .lte('applied_on', to),
        // Every pass, so a product the MOA view could not place still appears:
        // an unplaced jug is not a cleared one.
        supabase
          .from('product_applications')
          .select('field_id, operation_id, product_id, applied_on, applied_name')
          .in('field_id', fieldIds)
          .gte('applied_on', from)
          .lte('applied_on', to),
        supabase.from('irrigation_events').select('field_id, date, gross_mm').in('field_id', fieldIds).gte('date', from).lte('date', to),
        supabase.from('field_hail_events').select('field_id, event_date, loss_pct').in('field_id', fieldIds).eq('crop_year', cropYear),
      ])
      for (const r of [moa, unplaced, irrigation, hail]) if (r.error) throw r.error

      // One pass per product per operation, merged across the two sources by
      // operation and product id. See mergePasses: the two sources name the
      // same jug differently, so a name-keyed merge warns about one spray
      // twice.
      const passesBy = mergePasses(
        (moa.data ?? []).map((m) => ({
          field_id: m.field_id as string,
          operation_id: m.operation_id as string,
          product_id: (m.product_id as string) ?? null,
          name: m.product_name as string,
          applied_on: m.applied_on as string,
          scheme: m.scheme as string,
        })),
        (unplaced.data ?? []).map((a) => ({
          field_id: a.field_id as string,
          operation_id: a.operation_id as string,
          product_id: (a.product_id as string) ?? null,
          name: (a.applied_name as string) ?? 'Unnamed product',
          applied_on: a.applied_on as string,
          scheme: null,
        })),
      )

      const out: PollinatorField[] = []
      for (const b of bloom.data ?? []) {
        const fieldId = b.field_id as string
        const mine: Placement[] = (placements.data ?? [])
          .filter((p) => p.field_id === fieldId)
          .map((p) => ({
            id: p.id as string,
            field_id: fieldId,
            kind: p.kind as Placement['kind'],
            placed_on: p.placed_on as string,
            removed_on: (p.removed_on as string) ?? null,
            units: p.units == null ? null : Number(p.units),
            contact_id: (p.contact_id as string) ?? null,
            contactName: p.contact_id ? (contactLabel.get(p.contact_id as string) ?? null) : null,
            note: (p.note as string) ?? null,
          }))
          .sort((a, c) => a.placed_on.localeCompare(c.placed_on))

        const passes = passesBy.get(fieldId) ?? []
        const warnings = sortWarnings([
          ...sprayWarnings(passes, mine),
          ...pivotWarnings(
            (irrigation.data ?? [])
              .filter((e) => e.field_id === fieldId)
              .map((e) => ({ date: e.date as string, gross_mm: e.gross_mm == null ? null : Number(e.gross_mm) })),
            mine,
          ),
          ...hailWarnings(
            (hail.data ?? [])
              .filter((h) => h.field_id === fieldId)
              .map((h) => ({ event_date: h.event_date as string, loss_pct: h.loss_pct == null ? null : Number(h.loss_pct) })),
            mine,
          ),
        ])

        out.push({
          fieldId,
          fieldName: nameOf.get(fieldId) ?? 'Unknown field',
          yellowNow: b.yellow_now == null ? null : Number(b.yellow_now),
          stage: (b.stage as string) ?? null,
          placements: mine,
          warnings,
          advice: stockingAdvice({
            yellowNow: b.yellow_now == null ? null : Number(b.yellow_now),
            stage: (b.stage as string) ?? null,
            placements: mine,
            today,
          }),
          upcoming: passes.filter((p) => p.applied_on >= today),
        })
      }

      // Bees first, then the fields a decision is waiting on, then the rest.
      const rank = (f: PollinatorField) =>
        f.warnings.length ? 0 : f.placements.length ? 1 : f.advice.state.endsWith('due') || f.advice.state.startsWith('stock') ? 2 : 3
      out.sort((a, b) => rank(a) - rank(b) || a.fieldName.localeCompare(b.fieldName))

      return { cropYear, today, fields: out, contacts: beeContacts(contacts.data ?? [], contactLabel) }
    },
  })
}

/**
 * Contacts to offer as the beekeeper.
 *
 * Narrowed where the contact list says something useful — a type or tag
 * mentioning bees — and otherwise the whole active list, because a farm that
 * has never tagged a beekeeper would otherwise get an empty picker and no way
 * to record one.
 */
function beeContacts(
  rows: { id: string; company: string | null; contact_name: string | null; type: string | null; tags: string[] | null; active: boolean | null }[],
  labels: Map<string, string>,
) {
  const active = rows.filter((c) => c.active !== false)
  const beeish = active.filter((c) => /bee|honey|pollinat|apiar/i.test([c.type, c.company, ...(c.tags ?? [])].join(' ')))
  const use = beeish.length ? beeish : active
  return use.map((c) => ({ id: c.id, label: labels.get(c.id) ?? 'Unnamed contact' })).sort((a, b) => a.label.localeCompare(b.label))
}

export function useSavePlacement(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: Database['public']['Tables']['bee_placements']['Insert'] & { id?: string }) => {
      const { error } = v.id
        ? await supabase.from('bee_placements').update({ ...v, updated_at: new Date().toISOString() }).eq('id', v.id)
        : await supabase.from('bee_placements').insert(v)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pollinators', cropYear] }),
  })
}

export function useDeletePlacement(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bee_placements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pollinators', cropYear] }),
  })
}
