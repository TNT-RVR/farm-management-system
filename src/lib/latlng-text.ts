import { parseLatLng, type LatLng } from '@/lib/road-routes'
import { farmBrand } from '@/lib/farm-setup'

/** The farm's own map centre (Farm setup), which a typed place is checked against. */
export const farmCentre = (): LatLng => {
  const [lng, lat] = farmBrand().mapCenter
  return { lat, lng }
}

/** A stored point as the text a location box starts with ("52.2, -113.9"); '' when either half is missing. */
export function latLngText(lat: unknown, lng: unknown): string {
  if (lat == null || lng == null || lat === '' || lng === '') return ''
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  // A whole degree keeps a decimal point, which parseLatLng needs.
  const t = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))
  return `${t(a)}, ${t(b)}`
}

/** A location box's text read back: the point, null when blank, 'bad' when it is not a location. */
export function readLatLng(text: string): LatLng | null | 'bad' {
  if (!text.trim()) return null
  return parseLatLng(text) ?? 'bad'
}
