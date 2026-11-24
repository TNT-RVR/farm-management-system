import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { DocumentListItem } from './documents'

export type InsurancePolicy = Database['public']['Tables']['insurance_policies']['Row']
export type InsuranceCoverage = Database['public']['Tables']['insurance_coverage']['Row']
export type InsuranceLand = Database['public']['Tables']['insurance_land']['Row']
export type InsuranceProduction = Database['public']['Tables']['insurance_production']['Row']
export type InsuranceProductionTotal = Database['public']['Tables']['insurance_production_totals']['Row']
export type InsuranceClaim = Database['public']['Tables']['insurance_claims']['Row']
export type InsuranceClaimLine = Database['public']['Tables']['insurance_claim_lines']['Row']

/** What AFSC calls each kind of statement, in the farm's own words. */
export const CLAIM_KIND: Record<string, string> = {
  pre_harvest: 'Pre-harvest',
  post_harvest: 'Post-harvest',
  post_harvest_advance: 'Post-harvest advance',
  hail: 'Hail endorsement',
  refund: 'Premium refund',
}

export function usePolicies() {
  return useQuery({
    queryKey: ['insurance_policies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('insurance_policies')
        .select('*')
        .order('crop_year', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function usePolicy(cropYear: number) {
  const { data: policies, ...rest } = usePolicies()
  return { ...rest, data: policies?.find((p) => p.crop_year === cropYear) ?? null, policies }
}

export function useCoverage(policyId: string | undefined) {
  return useQuery({
    queryKey: ['insurance_coverage', policyId],
    enabled: Boolean(policyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('insurance_coverage')
        .select('*')
        .eq('policy_id', policyId!)
        .order('crop_label')
        .order('ag_input')
      if (error) throw error
      return data
    },
  })
}

/** The land report, with the field each quarter turned out to be. */
export function useInsuredLand(policyId: string | undefined) {
  return useQuery({
    queryKey: ['insurance_land', policyId],
    enabled: Boolean(policyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('insurance_land')
        .select('*, fields(id, name)')
        .eq('policy_id', policyId!)
        .order('land_location')
      if (error) throw error
      return data as unknown as (InsuranceLand & { fields: { id: string; name: string } | null })[]
    },
  })
}

export function useInsuredProduction(policyId: string | undefined) {
  return useQuery({
    queryKey: ['insurance_production', policyId],
    enabled: Boolean(policyId),
    queryFn: async () => {
      const [rows, totals] = await Promise.all([
        supabase
          .from('insurance_production')
          .select('*, fields(id, name)')
          .eq('policy_id', policyId!)
          .order('crop_label')
          .order('land_location'),
        supabase.from('insurance_production_totals').select('*').eq('policy_id', policyId!).order('crop_label'),
      ])
      if (rows.error) throw rows.error
      if (totals.error) throw totals.error
      return {
        rows: rows.data as unknown as (InsuranceProduction & { fields: { id: string; name: string } | null })[],
        totals: totals.data,
      }
    },
  })
}

/** Every statement of loss, newest first, with its lines. */
export function useClaims(cropYear?: number | null) {
  return useQuery({
    queryKey: ['insurance_claims', cropYear ?? null],
    queryFn: async () => {
      let q = supabase
        .from('insurance_claims')
        .select('*, insurance_claim_lines(*, fields(id, name)), documents(id, title, doc_type, party, doc_date, crop_year, storage_bucket, storage_path, filename, mime, bytes, area, curated, summary, tags, source, source_table, source_id, added_by, created_at, updated_at)')
        .order('resolved_on', { ascending: false, nullsFirst: false })
      if (cropYear) q = q.eq('crop_year', cropYear)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as (InsuranceClaim & {
        insurance_claim_lines: (InsuranceClaimLine & { fields: { id: string; name: string } | null })[]
        documents: DocumentListItem | null
      })[]
    },
  })
}

/**
 * Kilograms are what AFSC pays on and bushels are what the farm thinks in, so
 * both belong on screen. These are the weights per bushel the statements use.
 */
export const KG_PER_BUSHEL: Record<string, number> = {
  Barley: 21.772,
  'Wheat - Durum': 27.216,
  'Corn (Grain)': 25.401,
  'Beans, Dry - Pinto': 27.216,
  'Beans, Dry - Great Northern': 27.216,
  'Beans, Dry - Yellow': 27.216,
}

export function kgToBu(kg: number | null, crop: string | null): number | null {
  if (kg == null || !crop) return null
  const per = KG_PER_BUSHEL[crop]
  return per ? kg / per : null
}
