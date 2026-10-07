import type { FieldPivotRow, PumpRow } from './irrigation'

/**
 * What the irrigation equipment's plates and panels say, as label / value
 * lines for the details under a pump or pivot row. Pure, so the wording and
 * the units are tested rather than eyeballed.
 */

export type PlateLine = [label: string, value: string]

const has = (v: unknown) => v != null && v !== ''

/** A label and value, or null when there is nothing to show. */
export function plateLine(label: string, v: unknown, unit = ''): PlateLine | null {
  return has(v) ? [label, `${String(v)}${unit}`] : null
}

const lines = (rows: (PlateLine | null)[]) => rows.filter((r): r is PlateLine => r != null)

const phaseHz = (phase: number | null, hz: number | null) =>
  has(phase) || has(hz) ? `${phase ?? '—'} phase, ${hz ?? '—'} Hz` : null

/**
 * The "things to check" on a record: one per line, blank lines and list
 * bullets dropped, so a pasted list reads the same as a typed one.
 */
export function flagLines(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
}

/** The pivot nameplate. */
export function pivotPlateLines(p: Pick<FieldPivotRow,
  'brand' | 'model' | 'serial_number' | 'pivot_type' | 'voltage' | 'running_amps' | 'max_fuse_amps' | 'plate_amps' | 'phase' | 'hz' | 'pivot_year'>): PlateLine[] {
  return lines([
    plateLine('Maker', p.brand),
    plateLine('Model', p.model),
    plateLine('Serial', p.serial_number),
    plateLine('Type', p.pivot_type),
    plateLine('Volts', p.voltage, ' V'),
    plateLine('Phase / Hz', phaseHz(p.phase, p.hz)),
    plateLine('Running amps', p.running_amps, ' A'),
    plateLine('Max fuse size', p.max_fuse_amps, ' A'),
    plateLine('Other amps (see note)', p.plate_amps, ' A'),
    plateLine('Year', p.pivot_year),
  ])
}

/** The pump plate. */
export function pumpPlateLines(p: PumpRow): PlateLine[] {
  return lines([
    plateLine('Maker', p.brand),
    plateLine('Model', p.model),
    plateLine('Serial', p.serial_number),
    plateLine('Impeller', p.impeller_in, '"'),
    plateLine('Stages', p.stages),
    plateLine('Rotation', p.rotation),
    plateLine('Discharge head', p.discharge_head),
    plateLine('Also stamped', p.plate_code),
    plateLine('Type', p.kind),
    plateLine('Legal land', p.legal_land),
    plateLine('Water priority', p.water_priority_number),
  ])
}

/** The motor plate. */
export function motorPlateLines(p: PumpRow): PlateLine[] {
  return lines([
    plateLine('Maker', p.motor_brand),
    plateLine('Catalogue #', p.motor_catalogue),
    plateLine('Spec', p.motor_spec),
    plateLine('Horsepower', p.horse_power, ' hp'),
    plateLine('Volts', motorVolts(p.voltage, p.supply_volts)),
    plateLine('Full-load amps', p.amps, ' A'),
    plateLine('Phase / Hz', phaseHz(p.phase, p.hz)),
    plateLine('Speed', p.rpm, ' rpm'),
    plateLine('Frame', p.motor_frame),
    plateLine('Type', p.motor_type),
    plateLine('NEMA design / code', has(p.nema_design) || has(p.kva_code) ? `design ${p.nema_design ?? '—'}, code ${p.kva_code ?? '—'}` : null),
    plateLine('Service factor', p.service_factor),
    plateLine('Efficiency', p.efficiency_pct, '%'),
    plateLine('Power factor', p.power_factor_pct, '%'),
    plateLine('Max capacitor', p.max_kvar, ' kVAR'),
    plateLine('Insulation class', p.insulation_class),
    plateLine('Rating', p.ambient),
    plateLine(
      'Bearings',
      has(p.bearing_shaft_end) || has(p.bearing_opp_end) ? `${p.bearing_shaft_end ?? '—'} shaft end, ${p.bearing_opp_end ?? '—'} opposite end` : null,
    ),
    plateLine('Enclosure', p.motor_enclosure),
    plateLine('Serial', p.motor_serial),
    plateLine('ID #', p.motor_id),
    plateLine('Part #', p.motor_part_number),
  ])
}

/** The motor's rated volts, and the service it is on when that differs (460 V motors on 480 V services). */
export function motorVolts(rated: number | null, supply: number | null): string | null {
  if (!has(rated) && !has(supply)) return null
  if (!has(rated)) return `${supply} V supply`
  if (!has(supply) || Number(supply) === Number(rated)) return `${rated} V`
  return `${rated} V (on a ${supply} V supply)`
}

export type FlowCheck = { pivot: string; gpm: number; verdict: 'inside' | 'above' | 'below' }

/**
 * Each pivot's recorded flow against the pump's estimated range. Several
 * pivots on one pump are checked one at a time: they may not run together.
 * Nothing to say without an estimate range or a pivot flow.
 */
export function pivotFlowChecks(
  pump: Pick<PumpRow, 'gpm' | 'gpm_estimate_low' | 'gpm_estimate_high'>,
  pivots: { name: string; gpm: number | null }[],
): FlowCheck[] {
  // A measured pump flow is the better yardstick when there is one.
  const lo = pump.gpm != null ? Number(pump.gpm) * 0.9 : pump.gpm_estimate_low
  const hi = pump.gpm != null ? Number(pump.gpm) * 1.1 : pump.gpm_estimate_high
  if (lo == null || hi == null) return []
  return pivots
    .filter((p): p is { name: string; gpm: number } => p.gpm != null && Number(p.gpm) > 0)
    .map((p) => {
      const g = Number(p.gpm)
      return { pivot: p.name, gpm: g, verdict: g > Number(hi) ? 'above' : g < Number(lo) ? 'below' : 'inside' }
    })
}

type PanelFields = Pick<PumpRow,
  | 'panel_maker' | 'panel_type' | 'panel_catalogue' | 'panel_shop_order' | 'panel_hp' | 'panel_main_volts' | 'panel_control_volts'
  | 'panel_interrupting_ka' | 'panel_enclosure_rating' | 'panel_main_breaker' | 'panel_breaker_amps' | 'panel_starter_size'
  | 'panel_overload_heaters' | 'panel_cable_size' | 'panel_meter_socket' | 'panel_fuse' | 'panel_coil' | 'panel_enclosure_part'
  | 'panel_selector' | 'panel_extras' | 'panel_drawing_date' | 'panel_parts_basis' | 'horse_power' | 'panel_model'>

/**
 * The pump's control panel: its label first, then the parts inside, and where
 * the parts list comes from when it is not what is fitted (a maker's table row).
 */
export function panelLines(p: PanelFields): { label: PlateLine[]; parts: PlateLine[]; partsBasis: string | null } {
  // A panel built bigger than its motor is normal; say so beside the rating.
  const builtFor = has(p.panel_hp)
    ? `${p.panel_hp} hp${has(p.horse_power) && Number(p.panel_hp) !== Number(p.horse_power) ? ` (the motor is ${p.horse_power} hp)` : ''}`
    : null
  const breaker = [p.panel_main_breaker, has(p.panel_breaker_amps) ? `${p.panel_breaker_amps} A` : null].filter(has).join(', ')
  const volts =
    has(p.panel_main_volts) || has(p.panel_control_volts)
      ? `${p.panel_main_volts ?? '—'} V main, ${p.panel_control_volts ?? '—'} V control`
      : null
  return {
    label: lines([
      plateLine('Maker', p.panel_maker),
      plateLine('Type', p.panel_type),
      plateLine('Model', p.panel_model),
      plateLine('Catalogue #', p.panel_catalogue),
      plateLine('Shop order / drawing', p.panel_shop_order),
      plateLine('Drawing date', p.panel_drawing_date),
      plateLine('Built for', builtFor),
      plateLine('Volts', volts),
      plateLine('Interrupting rating', p.panel_interrupting_ka, ' kA'),
      plateLine('Enclosure', p.panel_enclosure_rating),
    ]),
    parts: lines([
      plateLine('Main breaker', breaker),
      plateLine('Starter size', p.panel_starter_size),
      plateLine('Overload heaters', p.panel_overload_heaters),
      plateLine('Cable', p.panel_cable_size),
      plateLine('Meter socket', p.panel_meter_socket),
      plateLine('Fuse', p.panel_fuse),
      plateLine('Coil', p.panel_coil),
      plateLine('Enclosure part', p.panel_enclosure_part),
      plateLine('Selector', p.panel_selector),
      plateLine('Also on the front', p.panel_extras),
    ]),
    partsBasis: has(p.panel_parts_basis) ? p.panel_parts_basis : null,
  }
}

/**
 * The power meter a pump runs off. The utility's meter number is the one on
 * the power bill; a pump with no meter of its own names the pump whose meter
 * it shares (the Creek flat gravel pit pump runs off the Creek Flat Pump's).
 */
export function meterLines(
  p: Pick<PumpRow, 'power_utility' | 'power_meter_number' | 'power_meter_model' | 'power_meter_module' | 'power_meter_reading_kwh' | 'power_meter_read_on'>,
  shares: { sharesWith: string | null; alsoOnIt: string[] },
): PlateLine[] {
  const reading = has(p.power_meter_reading_kwh)
    ? `${Number(p.power_meter_reading_kwh).toLocaleString('en-CA')} kWh delivered${has(p.power_meter_read_on) ? ` on ${p.power_meter_read_on}` : ''}`
    : null
  return lines([
    plateLine('Utility', p.power_utility),
    plateLine('Meter #', p.power_meter_number),
    plateLine('Runs off', shares.sharesWith ? `${shares.sharesWith}'s meter (no meter of its own)` : null),
    plateLine('Also on this meter', shares.alsoOnIt.length ? shares.alsoOnIt.join(', ') : null),
    plateLine('Meter', p.power_meter_model),
    plateLine('Radio module', p.power_meter_module),
    plateLine('Reading', reading),
  ])
}

/** Photo rows grouped by the equipment they belong to, oldest first as read. */
export function groupPhotos<T extends { created_at: string }>(rows: T[], ownerOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = ownerOf(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}
