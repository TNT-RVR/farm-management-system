// Starting points for a machine's service schedule.
//
// GENERIC, NOT THIS FARM'S AND NOT THE MANUFACTURER'S: these are the intervals
// commonly quoted for modern diesel farm machinery, offered so a manager is
// not typing the same eight lines into every machine. Every one is meant to be
// checked against that machine's operator manual and changed. Where there is
// no widely shared figure the hours are left blank and only a yearly check is
// suggested — a made-up number here would read as advice.
//
// Deere will not share its own plans with this app (every maintenancePlans
// endpoint is 403/404), so nothing here may be presented as Deere's.

export type MachineType = 'tractor' | 'combine' | 'sprayer' | 'swather' | 'truck'

export type ServiceTemplate = {
  name: string
  interval_hours: number | null
  interval_months: number | null
  parts?: string
  notes?: string
}

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  tractor: 'Tractor',
  combine: 'Combine',
  sprayer: 'Sprayer',
  swather: 'Swather / windrower',
  truck: 'Truck',
}

const CHECK = 'Common starting point — check the operator manual and adjust.'

const engine: ServiceTemplate[] = [
  { name: 'Engine oil and filter', interval_hours: 500, interval_months: 12, parts: 'Oil filter, engine oil', notes: CHECK },
  { name: 'Fuel filters', interval_hours: 500, interval_months: 12, parts: 'Primary and final fuel filters', notes: CHECK },
  { name: 'Air cleaner element', interval_hours: null, interval_months: 12, notes: 'Or when the restriction indicator shows. ' + CHECK },
  { name: 'Coolant', interval_hours: 6000, interval_months: 72, notes: CHECK },
]

export const SERVICE_TEMPLATES: Record<MachineType, ServiceTemplate[]> = {
  tractor: [
    ...engine,
    { name: 'Cab air filter', interval_hours: 500, interval_months: 12, notes: 'More often in dust. ' + CHECK },
    { name: 'Transmission and hydraulic filters', interval_hours: 1500, interval_months: null, notes: CHECK },
    { name: 'Transmission and hydraulic oil', interval_hours: 1500, interval_months: null, notes: CHECK },
    { name: 'Grease all points', interval_hours: 50, interval_months: null, notes: CHECK },
  ],
  combine: [
    ...engine,
    { name: 'Hydraulic and hydrostatic filters', interval_hours: null, interval_months: 12, notes: CHECK },
    { name: 'Gearcase oils (feeder house, rotor, unloader)', interval_hours: null, interval_months: 12, notes: CHECK },
    { name: 'Pre-harvest inspection (belts, chains, bearings)', interval_hours: null, interval_months: 12 },
    { name: 'Grease all points', interval_hours: 50, interval_months: null, notes: CHECK },
  ],
  sprayer: [
    ...engine,
    { name: 'Hydraulic filters', interval_hours: null, interval_months: 12, notes: CHECK },
    { name: 'Nozzle and flow check', interval_hours: null, interval_months: 12, notes: 'And at the start of every season — worn nozzles change the rate applied.' },
    { name: 'Solution pump inspection', interval_hours: null, interval_months: 12, notes: 'Seals and diaphragms.' },
    { name: 'Winterize plumbing', interval_hours: null, interval_months: 12 },
    { name: 'Grease all points', interval_hours: 50, interval_months: null, notes: CHECK },
  ],
  swather: [
    ...engine,
    { name: 'Hydraulic filters', interval_hours: null, interval_months: 12, notes: CHECK },
    { name: 'Header gearbox oil', interval_hours: null, interval_months: 12, notes: CHECK },
    { name: 'Knife and guards inspection', interval_hours: null, interval_months: 12 },
    { name: 'Grease all points', interval_hours: 50, interval_months: null, notes: CHECK },
  ],
  // Trucks are serviced by distance, which no feed here reports; the calendar
  // is the only clock the app has for them.
  truck: [
    { name: 'Engine oil and filter', interval_hours: null, interval_months: 6, notes: 'Trucks go by distance — set the months to match your usual mileage. ' + CHECK },
    { name: 'Fuel filters', interval_hours: null, interval_months: 12, notes: CHECK },
    { name: 'Annual safety inspection', interval_hours: null, interval_months: 12 },
    { name: 'Grease chassis', interval_hours: null, interval_months: 3, notes: CHECK },
  ],
}

/**
 * A best guess at what kind of machine this is, from Deere's type, the model
 * and the name — only to choose which list to show first. The manager can pick
 * another.
 */
export function guessMachineType(m: { name?: string | null; model?: string | null; equipment_type?: string | null }): MachineType {
  const text = [m.equipment_type, m.model, m.name].filter(Boolean).join(' ').toLowerCase()
  if (/combine|harvester|\bs[67]\d{2}\b|\bx9\b/.test(text)) return 'combine'
  if (/sprayer|\br4\d{3}\b|patriot|rogator/.test(text)) return 'sprayer'
  if (/swather|windrower|\bw[12]\d{2}\b/.test(text)) return 'swather'
  if (/truck|pickup|\bsemi\b|tandem|\bf-?[1-9]50\b|\bram\b|silverado|sierra|kenworth|paulbilt|freightliner/.test(text)) return 'truck'
  return 'tractor'
}

/** The template rows not already on the machine, matched by name. */
export function missingTemplates(type: MachineType, existingNames: readonly string[]): ServiceTemplate[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  return SERVICE_TEMPLATES[type].filter((t) => !have.has(t.name.toLowerCase()))
}
