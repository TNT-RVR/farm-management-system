/**
 * TELUS Farm Inventory fuel gauges: turning what farminventory.telus.com's
 * API returns into a level per tank, and pairing gauges with the farm's tanks.
 * Pure, so the server sync (netlify/shared/telus-fuel.ts) and the tests share it.
 *
 * What the API gives (read 19 Oct 2026 from the farm's own account):
 *  - /api/devices: one per gauge — id, name, type ("farmHub_diesel",
 *    "farmHub_gasoline", "farmHub_propane"), status, lastUpdate.
 *  - /api/positions: the latest report per gauge — fixTime, latitude,
 *    longitude, and attributes Port1adc … Port4adc, where the sensor's port
 *    carries the fuel HEIGHT as a percent of the tank's height.
 *  - /api/devices/port: each gauge's sensor set-up — portNumber, capacity
 *    (litres), tankType ("regularTank" upright, or a horizontal type).
 *
 * Height is not volume in a tank lying on its side: 5 % up a horizontal tank
 * is under 2 % of it. Telus's page does the same sum: the gas tank at 5 %
 * shows 83 L of 4,460, the horizontal diesel at 74 % shows 3,570 L of 4,500.
 */
import type { FuelProduct } from './fuel-supplier-invoice'

export type TelusDevice = { id: number; name: string; type?: string | null; status?: string | null; lastUpdate?: string | null }
export type TelusPosition = { deviceId: number; fixTime?: string | null; latitude?: number | null; longitude?: number | null; attributes?: Record<string, unknown> }
export type TelusPort = { deviceId: number; portNumber: number; capacity?: number | null; tankType?: string | null; deletedAt?: string | null }

/** One gauge's latest reading, in the app's terms. */
export type GaugeReading = {
  deviceId: number
  name: string
  product: FuelProduct
  capacityL: number
  /** Fuel height, % of the tank's height, as Telus reports it. */
  heightPct: number
  /** Litres in the tank, from the height and the tank's shape. */
  litres: number
  readAt: string
  lat: number | null
  lng: number | null
  online: boolean
  /** Telus's own word for the gauge: online, offline, unknown. */
  status: string | null
  /** When Telus last heard from the gauge at all (its lastUpdate), which can be later than its last reading. */
  seenAt: string | null
  /** What the last report says about the gauge itself: battery, power, signal. */
  info: Record<string, number | string | boolean>
}

/** Volume fraction of a horizontal cylinder filled to height fraction h. */
export function horizontalFill(h: number): number {
  const x = Math.min(1, Math.max(0, h))
  const theta = 2 * Math.acos(1 - 2 * x)
  return (theta - Math.sin(theta)) / (2 * Math.PI)
}

const isHorizontal = (tankType: string | null | undefined) => /horiz/i.test(tankType ?? '')

/** Telus's fuel type, as one of ours. Farm (marked) fuel unless told otherwise: it is a farm. */
export function productOf(type: string | null | undefined): FuelProduct {
  const t = (type ?? '').toLowerCase()
  if (t.includes('diesel')) return 'farm_diesel'
  if (t.includes('gas')) return 'farm_gasoline'
  return 'other'
}

/**
 * The parts of a report about the gauge rather than the fuel: battery and
 * supply voltage, charge, signal. Kept as Telus names them, since what each
 * gauge sends varies; the fuel ports (Port1adc …) are left out.
 */
export function gaugeInfo(attributes: Record<string, unknown> | undefined): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [k, v] of Object.entries(attributes ?? {})) {
    if (/^port\d+adc$/i.test(k)) continue
    if (!/batt|power|volt|charg|rssi|signal|gsm|solar/i.test(k)) continue
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v
  }
  return out
}

/**
 * The gauge's own figures in words. The farm's gauges send battery and
 * solarPanelV in millivolts and cellsignal on the 0–31 modem scale (read
 * 20 Oct 2026: working gauges 6.2–6.6 V battery, 7.3–7.4 V panel, signal
 * 19–31). Anything else is shown as Telus names it.
 */
export function gaugeInfoText(info: Record<string, unknown> | null | undefined): string[] {
  const volts = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? `${(n > 100 ? n / 1000 : n).toFixed(2)} V` : String(v)
  }
  return Object.entries(info ?? {}).map(([k, v]) =>
    /^battery$/i.test(k) ? `battery ${volts(v)}` : /^solarpanelv$/i.test(k) ? `solar panel ${volts(v)}` : /^cellsignal$/i.test(k) ? `cell signal ${v} of 31` : `${k} ${String(v)}`,
  )
}

/** Hours without a report before a gauge counts as silent (they report about hourly). */
export const SILENT_HOURS = 24

/**
 * Whether a gauge's report goes onto its tank. A level from the gauge is
 * replaced whenever the gauge reports again. A level typed by hand (Sam,
 * 20 Oct 2026: "make sure the actual gauge overrides that") is replaced by the
 * gauge's next report: only a report older than the typed level, from a gauge
 * gone quiet, leaves it.
 */
export function gaugeReplacesLevel(t: { level_source: string | null; level_at: string | null }, readAt: string): boolean {
  if (t.level_source === 'telus') return t.level_at == null || Date.parse(t.level_at) !== Date.parse(readAt)
  if (t.level_source === 'typed' && t.level_at) return Date.parse(readAt) > Date.parse(t.level_at)
  return true
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The gauges with a usable reading. A gauge needs a set-up port with a
 * capacity, and a report; the never-named spare (no port, last heard 2025)
 * drops out.
 */
export function readGauges(devices: TelusDevice[], positions: TelusPosition[], ports: TelusPort[]): GaugeReading[] {
  const out: GaugeReading[] = []
  for (const d of devices) {
    const port = ports.find((p) => p.deviceId === d.id && !p.deletedAt && (p.capacity ?? 0) > 0)
    const pos = positions.find((p) => p.deviceId === d.id)
    if (!port || !pos?.fixTime) continue
    const pct = num(pos.attributes?.[`Port${port.portNumber}adc`])
    if (pct == null) continue
    const capacity = Number(port.capacity)
    const h = Math.min(100, Math.max(0, pct)) / 100
    const fill = isHorizontal(port.tankType) ? horizontalFill(h) : h
    const lat = num(pos.latitude)
    const lng = num(pos.longitude)
    out.push({
      deviceId: d.id,
      name: d.name,
      product: productOf(d.type),
      capacityL: capacity,
      heightPct: pct,
      litres: Math.round(fill * capacity * 100) / 100,
      readAt: pos.fixTime,
      // 0,0 is "no fix", not the Gulf of Guinea.
      lat: lat && lng ? lat : null,
      lng: lat && lng ? lng : null,
      online: d.status === 'online',
      status: d.status ?? null,
      seenAt: d.lastUpdate ?? null,
      info: gaugeInfo(pos.attributes),
    })
  }
  return out
}

export type TankForMatch = { id: string; name: string; product: FuelProduct; capacity_l: number; telus_device_id: number | null }

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const diesel = (p: FuelProduct) => p === 'farm_diesel' || p === 'clear_diesel'
const gas = (p: FuelProduct) => p === 'gasoline' || p === 'farm_gasoline'
const sameFuel = (a: FuelProduct, b: FuelProduct) => a === b || (diesel(a) && diesel(b)) || (gas(a) && gas(b))

/**
 * Which tank each gauge belongs to: one already linked to it; else the one
 * tank of the same fuel with the same name (ignoring "(Prairie Creek Farm)"),
 * else the one of the same fuel within 2 % of its capacity. A gauge with no
 * single match gets null, and the sync adds a tank for it.
 */
export function matchGauges(gauges: GaugeReading[], tanks: TankForMatch[]): Map<number, string | null> {
  const out = new Map<number, string | null>()
  const taken = new Set(tanks.filter((t) => t.telus_device_id != null).map((t) => t.id))
  for (const g of gauges) {
    const linked = tanks.find((t) => t.telus_device_id === g.deviceId)
    if (linked) out.set(g.deviceId, linked.id)
  }
  for (const g of gauges) {
    if (out.has(g.deviceId)) continue
    const open = tanks.filter((t) => !taken.has(t.id) && sameFuel(t.product, g.product))
    const byName = open.filter((t) => norm(t.name) === norm(g.name))
    const bySize = open.filter((t) => Math.abs(t.capacity_l - g.capacityL) <= 0.02 * g.capacityL)
    const pick = byName.length === 1 ? byName[0] : bySize.length === 1 ? bySize[0] : null
    out.set(g.deviceId, pick?.id ?? null)
    if (pick) taken.add(pick.id)
  }
  return out
}
