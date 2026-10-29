// The public copy's stand-in for partner-view.ts, which is farm-only: the copy
// has staff accounts only, so nothing is narrowed and every year is open.
type FieldId = string | null | undefined
type Year = number | null | undefined

export const usePartnerView = () => false

export function usePartnerAccess() {
  const yearsOn: (fieldId: FieldId) => number[] = () => []
  const canRecordOn: (fieldId: FieldId) => boolean = () => true
  const canWrite: (fieldId: FieldId, year: Year) => boolean = () => true
  return { partner: false, yearsOn, canRecordOn, canWrite }
}

export function usePartnerYears(fieldId: FieldId) {
  const { partner, yearsOn } = usePartnerAccess()
  const canWrite: (year: Year) => boolean = () => true
  return { partner, years: yearsOn(fieldId), canWrite }
}
