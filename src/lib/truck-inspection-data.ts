/**
 * Reads and writes for the yearly semi truck inspections (truck-inspection.ts
 * has the checklist). An inspection is saved as it goes, so it can be left
 * and finished later; signing it off is the person's own signature and the
 * date they give, after which it is not changed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database, Json } from './database.types'
import type { Answers } from './truck-inspection'
import { INSPECTED_TYPES } from './equipment-types'

export type InspectionRow = Database['public']['Tables']['truck_inspections']['Row']
export type Inspection = Omit<InspectionRow, 'answers' | 'notes'> & { answers: Answers; notes: Partial<Record<string, string>> }
export type SemiTruck = { id: string; name: string; make: string | null; model: string | null; notes: string | null; equipment_type: string | null }

const KEY = ['truck_inspections'] as const

const asInspection = (r: InspectionRow): Inspection => ({
  ...r,
  answers: (r.answers ?? {}) as Answers,
  notes: (r.notes ?? {}) as Partial<Record<string, string>>,
})

/**
 * What can be inspected, for the drop-down on the Checklists form: the semis
 * (type 'Truck'; pickups are 'Pickup Truck') and trailers still in use.
 */
export function useInspectedVehicles() {
  return useQuery({
    queryKey: ['inspected_vehicles'],
    queryFn: async (): Promise<SemiTruck[]> => {
      const { data, error } = await supabase
        .from('jd_equipment')
        .select('id, name, make, model, notes, equipment_type')
        .in('equipment_type', [...INSPECTED_TYPES])
        .eq('archived', false)
        .order('name')
      if (error) throw error
      return (data ?? []).filter((t): t is SemiTruck => !!t.name)
    },
    staleTime: 10 * 60_000,
  })
}

export async function fetchInspections(): Promise<Inspection[]> {
  const { data, error } = await supabase.from('truck_inspections').select('*').order('started_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(asInspection)
}

export function useTruckInspections() {
  return useQuery({ queryKey: KEY, queryFn: fetchInspections })
}

export function useStartInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (equipmentId: string): Promise<Inspection> => {
      const { data, error } = await supabase.from('truck_inspections').insert({ equipment_id: equipmentId }).select('*').single()
      if (error) throw error
      return asInspection(data)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Save the answers and notes so far. */
export function useSaveInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; answers: Answers; notes: Partial<Record<string, string>> }) => {
      const { error } = await supabase
        .from('truck_inspections')
        .update({ answers: v.answers as Json, notes: v.notes as Json })
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Sign it off: the signer's own signature, copied onto the inspection, and the date they give. */
export function useSignInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; userId: string; name: string | null; signature: string; signedOn: string; answers: Answers; notes: Partial<Record<string, string>> }) => {
      const { error } = await supabase
        .from('truck_inspections')
        .update({
          answers: v.answers as Json,
          notes: v.notes as Json,
          signed_by: v.userId,
          signer_name: v.name,
          signature: v.signature,
          signed_on: v.signedOn,
          signed_at: new Date().toISOString(),
        })
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Put an unfinished inspection on another truck: the one picked on the
 * Checklists form (Sam, 24 Oct 2026), or a slip on the first pick. Only one
 * may be open per truck (truck_inspections_one_open).
 */
export function useMoveInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; equipmentId: string }) => {
      const { error } = await supabase.from('truck_inspections').update({ equipment_id: v.equipmentId }).eq('id', v.id)
      if (error) throw error.code === '23505' ? new Error('That one already has an inspection in progress. Open it from its own page.') : error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Throw away an unfinished inspection. */
export function useDeleteInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('truck_inspections').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

export type Truckish = { id: string; name: string; make: string | null; model: string | null }

/** The drop-down's trucks and trailers, grouped; the inspection's own kept even if archived since. */
export function vehicleOptions(vehicles: SemiTruck[], current?: Truckish | null) {
  const list = current && !vehicles.some((v) => v.id === current.id) ? [...vehicles, { ...current, notes: null, equipment_type: null }] : vehicles
  return list
    .map((v) => ({ value: v.id, label: v.name, group: v.equipment_type === 'Trailers' ? 'Trailers' : 'Trucks' }))
    .sort((a, b) => b.group.localeCompare(a.group) || a.label.localeCompare(b.label))
}
