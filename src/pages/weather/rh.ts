/** Humidity to colour: dry air amber, comfortable blues, very humid navy. */
export function rhClass(rh: number | null | undefined): string {
  if (rh == null) return 'text-gray-400'
  if (rh < 30) return 'text-amber-700'
  if (rh < 60) return 'text-sky-600'
  if (rh < 85) return 'text-sky-800'
  return 'text-blue-900'
}
