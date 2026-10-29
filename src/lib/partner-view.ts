import { useFields } from '@/lib/queries'

// The public copy's stand-in for partner-view.ts, which is farm-only: the copy
// has staff accounts only, so nothing is narrowed and every year is open.
type FieldId = string | null | undefined
type Year = number | null | undefined

export const usePartnerView = () => false

export const usePartnerFarmId = (): string | null => null

/** Null: no limit on the crops anyone edits beyond their role. */
export const usePartnerCrops = (): Set<string> | null => null

export function usePartnerAccess() {
  const assigned: { field_id: string; crop_year: number }[] = []
  const yearsOn: (fieldId: FieldId) => number[] = () => []
  const isOwnField: (fieldId: FieldId) => boolean = () => false
  const canRecordOn: (fieldId: FieldId) => boolean = () => true
  const canWrite: (fieldId: FieldId, year: Year) => boolean = () => true
  return { partner: false, assigned, yearsOn, isOwnField, canRecordOn, canWrite }
}

export function usePartnerYears(fieldId: FieldId) {
  const { partner, yearsOn } = usePartnerAccess()
  const canWrite: (year: Year) => boolean = () => true
  return { partner, years: yearsOn(fieldId), own: false, canWrite }
}

/** The rotation grid's fields: the usual list. */
export const useRotationFields = useFields
