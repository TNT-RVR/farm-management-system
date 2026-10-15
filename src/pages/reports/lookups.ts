import { supabase } from '@/lib/supabase'
import { CONTACT_TYPES } from '@/lib/sales'
import { alertGuide } from '@/lib/alert-guides'
import { AUDIT_TABLES } from '@/lib/reports/audit'
import { fetchAll, type LookupKey } from '@/lib/reports/framework'

/**
 * The lists a report row's lookup picker offers, one entry per LookupKey.
 * Read when the row is drawn and kept ten minutes, so a page of rows does
 * not ask twice. Each is value + label; '' (the "all" choice) is added by
 * the picker.
 */

export type LookupOption = { value: string; label: string }

const sorted = (xs: LookupOption[]) => xs.sort((a, b) => a.label.localeCompare(b.label))

export const LOOKUP_LISTS: Record<LookupKey, () => Promise<LookupOption[]>> = {
  suppliers: async () => {
    const rows = await fetchAll<{ supplier: string | null }>((a, b) => supabase.from('product_purchases').select('supplier').order('id').range(a, b))
    return [...new Set(rows.map((r) => r.supplier?.trim()).filter((s): s is string => !!s))].sort().map((s) => ({ value: s, label: s }))
  },
  auditTables: async () => AUDIT_TABLES,
  contactTypes: async () => CONTACT_TYPES.map((t) => ({ value: t, label: t.replaceAll('_', ' ') })),

  // The kinds of alert this person has had (notifications are each person's
  // own), by the guide's plain name.
  alertKinds: async () => {
    const rows = await fetchAll<{ kind: string }>((a, b) => supabase.from('notifications').select('kind').order('id').range(a, b))
    return sorted([...new Set(rows.map((r) => r.kind))].map((k) => ({ value: k, label: alertGuide(k).name })))
  },

  // Newest first: the one just hauled is the one wanted.
  manifests: async () => {
    const rows = await fetchAll<{ id: string; manifest_no: string | null; moved_on: string | null; destination_name: string | null }>((a, b) =>
      supabase.from('cattle_manifests').select('id, manifest_no, moved_on, destination_name').order('moved_on', { ascending: false }).order('id').range(a, b),
    )
    return rows.map((m) => ({ value: m.id, label: [m.moved_on, m.manifest_no ? `no. ${m.manifest_no}` : null, m.destination_name].filter(Boolean).join(' · ') || 'Manifest' }))
  },

  // The 50/50 joint ventures on land we farm: each is insured under its own
  // agreement, so each has its own AFSC reports. The "all" choice is the
  // farm's own fields.
  jointVentures: async () => {
    const rows = await fetchAll<{ landlord: string }>((a, b) =>
      supabase.from('land_leases').select('landlord').eq('active', true).eq('direction', 'in').eq('arrangement', 'profit_share').order('id').range(a, b),
    )
    return sorted([...new Set(rows.map((r) => r.landlord))].map((l) => ({ value: l, label: `Joint venture with ${l}` })))
  },

  // The provincial grazing leases, by ranch then as the page orders them.
  grazingDispositions: async () => {
    const [leases, ranches] = await Promise.all([
      fetchAll<{ id: string; disposition_no: string; ranch_id: string | null; sort_order: number; active: boolean }>((a, b) =>
        supabase.from('grazing_dispositions').select('id, disposition_no, ranch_id, sort_order, active').order('sort_order').order('id').range(a, b),
      ),
      fetchAll<{ id: string; name: string; sort_order: number }>((a, b) => supabase.from('ranches').select('id, name, sort_order').order('sort_order').order('id').range(a, b)),
    ])
    const rank = new Map(ranches.map((r, i) => [r.id, i]))
    const name = new Map(ranches.map((r) => [r.id, r.name]))
    return leases
      .filter((l) => l.active)
      .sort((x, y) => (rank.get(x.ranch_id ?? '') ?? 99) - (rank.get(y.ranch_id ?? '') ?? 99) || x.sort_order - y.sort_order)
      .map((l) => ({ value: l.id, label: [name.get(l.ranch_id ?? ''), l.disposition_no].filter(Boolean).join(' · ') }))
  },

  // Every year's trials, newest first, named by field, year and rates.
  nTrials: async () => {
    const [trials, fields] = await Promise.all([
      fetchAll<{ id: string; crop_year: number; field_id: string; name: string | null; rates: unknown }>((a, b) =>
        supabase.from('n_trials').select('id, crop_year, field_id, name, rates').order('crop_year', { ascending: false }).order('id').range(a, b),
      ),
      fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    ])
    const fieldName = new Map(fields.map((f) => [f.id, f.name]))
    return trials.map((t) => ({
      value: t.id,
      label: [t.crop_year, t.name || fieldName.get(t.field_id) || 'Field', Array.isArray(t.rates) ? `${t.rates.join('/')} lb N` : null].filter(Boolean).join(' · '),
    }))
  },
}
