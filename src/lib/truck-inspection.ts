/**
 * The yearly semi truck inspection (Sam, 21 Oct 2026): the trip inspection
 * in Alberta's Commercial Driver's Guide to Operation, Safety and Licensing,
 * chapter 3 (pp. 29–36), from the photos Sam sent. Only the items for all
 * vehicle types, truck-tractors (and three-axle vehicles), vehicles with air
 * brakes and a trailer if one is hooked up; the bus and ambulance items are
 * left out. The trip air brake inspection's steps follow.
 *
 * Each item is answered OK, Needs work or Not applicable; each section has a
 * note. An answer's key is the item's key, so wording can be tidied without
 * losing old answers — add new items with new keys, never reuse one.
 */

export type Answer = 'ok' | 'fix' | 'na'
export type Item = { key: string; text: string }
export type Section = { key: string; title: string; hint?: string; items: Item[] }

const tires = (axle: string, min: string) => `${axle} tires: tread at least ${min}, properly inflated, no bulges, sidewall separation, cuts or uneven wear; duals not touching and nothing trapped between them`
const rims = (axle: string) => `${axle} rims: no cracks, missing pieces, bends or rust streaks; wheel fasteners secure, none missing, broken or loose`

export const INSPECTION_SECTIONS: Section[] = [
  {
    key: 'hood',
    title: 'Under the hood',
    hint: 'Start at the front and work down the driver’s side, front to back.',
    items: [
      { key: 'radiator', text: 'Radiator has no leaks, coolant level is adequate and the cap fits properly' },
      { key: 'fan', text: 'Fan has no bent, cracked or missing blades and no loose mountings' },
      { key: 'belts', text: 'All belts have correct tension and show no wear' },
      { key: 'fluids', text: 'Oil and other fluid levels are adequate' },
      { key: 'air_filter', text: 'Air filter is in good condition' },
      { key: 'battery', text: 'Battery has no cracks, heavy corrosion or leaks; terminals secure; battery securely mounted' },
      { key: 'steering', text: 'Steering mechanism has no bent, broken or missing parts or excessive play; power steering pump and hose not leaking, fluid level adequate' },
      { key: 'hoses', text: 'All hose connections secure, no leaks, kinks, cuts, abrasions or cracks' },
      { key: 'shocks', text: 'Shock absorbers not loose or leaking (if visible)' },
      { key: 'front_suspension', text: 'Suspension has no cracked, missing or broken leaf springs and no loose, broken or missing U-bolts (if visible)' },
    ],
  },
  {
    key: 'hood_air',
    title: 'Under the hood: air brakes',
    items: [
      { key: 'compressor', text: 'Air compressor securely mounted; lines, fittings, hoses and couplers in good condition' },
      { key: 'front_chambers', text: 'Brake chambers in good condition and secure' },
      { key: 'front_slack', text: 'Slack adjusters: angle, push rod travel, mechanical condition and wear' },
      { key: 'front_air_lines', text: 'Air lines have no leaks, kinks, cuts, abrasions or cracks' },
    ],
  },
  {
    key: 'front',
    title: 'Front of the truck',
    hint: 'Go back to the cab to turn the lights on and off as you check them.',
    items: [
      { key: 'ground_leaks', text: 'No traces of leaking fluid on the ground under the truck' },
      { key: 'headlights', text: 'High and low beam headlights work; lenses clean and not cracked' },
      { key: 'front_hazards', text: 'Hazard warning lights work; lenses clean and not cracked' },
      { key: 'front_signals', text: 'Right and left turn signals work; lenses clean and not cracked' },
      { key: 'front_clearance', text: 'Clearance and marker lights work, lenses clean and not cracked, reflectors clean' },
      { key: 'windshield', text: 'Windshield clean and free of major cracks' },
      { key: 'front_plate', text: 'Licence plate valid, clean and secure' },
    ],
  },
  {
    key: 'driver_side',
    title: 'Driver’s side of the truck',
    items: [
      { key: 'steer_tire', text: tires('Steering axle', '3.2 mm') },
      { key: 'steer_rim', text: rims('Steering axle') },
      { key: 'steer_bearing_oil', text: 'Oil level in the steering axle wheel bearing (if equipped)' },
      { key: 'decal', text: 'Inspection decal present, valid and in the proper place (if required)' },
      { key: 'mirrors', text: 'Mirrors attached securely and not cracked' },
      { key: 'driver_door', text: 'Driver’s door operates properly' },
      { key: 'side_windows', text: 'Windows are clean' },
      { key: 'fuel_cap', text: 'Fuel cap present and secure' },
      { key: 'handrail', text: 'Handrail is secure' },
      { key: 'steps', text: 'Steps secure and in good condition' },
      { key: 'fuel_tank', text: 'Fuel tank has no leaks and is secure, air vent not plugged, proper cap secure' },
      { key: 'fuel_lines', text: 'Fuel system lines secure, no leaks' },
      { key: 'exhaust', text: 'Exhaust in good condition, no leaks, muffler securely attached, heat shield (if present) secure' },
      { key: 'compartments', text: 'Storage compartment doors open and close properly; contents secure' },
      { key: 'drive1_tire', text: tires('First drive axle', '1.6 mm') },
      { key: 'drive1_rim', text: rims('First drive axle') },
      { key: 'drive2_tire', text: tires('Second drive axle', '1.6 mm') },
      { key: 'drive2_rim', text: rims('Second drive axle') },
      { key: 'fifth_wheel_plate', text: 'Fifth wheel: coupler bolt secure, slider locked, plate not damaged, cracked or separated at welds, flush to the apron (no daylight between)' },
      { key: 'fifth_wheel_jaws', text: 'Fifth wheel locking jaws closed, plate flat on the underside of the trailer, kingpin enclosed' },
      { key: 'kingpin', text: 'Kingpin and pintle hitch eyehook (if equipped) not worn, damaged, cracked or broken' },
      { key: 'hitches', text: 'Hitches (if equipped): pintle or ball hitch not worn, locking mechanism closed' },
      { key: 'chains', text: 'Chains and cables (if equipped) have no stress cracks or weld breaks and are securely attached' },
      { key: 'drive_shaft', text: 'Drive shaft in good condition, nothing obstructing it' },
      { key: 'drive_suspension', text: 'Suspension: no cracked, missing or broken springs; torsion bars and walking beams secure; no loose or broken U-bolts; shocks mounted and not leaking; air bags (if air ride) not damaged, worn or inoperative' },
      { key: 'drive_axle', text: 'Axle assembly has no breaks, cracks, holes, broken seals or bends' },
      { key: 'side_signals', text: 'Signal lights work; lenses clean and not cracked' },
      { key: 'side_brake_lights', text: 'Brake lights work; lenses clean and not cracked (have someone press the brakes)' },
      { key: 'backing_lights', text: 'Backing and docking lights work; lenses clean and not cracked' },
      { key: 'drive_chambers', text: 'Brake chambers secure, no cracks, corrosion or holes, nothing obstructing push rod travel' },
      { key: 'drive_slack', text: 'Slack adjusters: pull by hand or with a pry bar to check travel, mechanical condition and wear' },
      { key: 'drive_air_lines', text: 'Air lines secured, no leaks, kinks, cuts, abrasions or cracks in the housing' },
      { key: 'mud_flap', text: 'Mud flap secure and does not rub the tires' },
      { key: 'body', text: 'Body has no damage, broken or missing rivets, holes or weld separations' },
    ],
  },
  {
    key: 'trailer',
    title: 'Trailer: driver’s front and side',
    hint: 'If a trailer is hooked up; otherwise mark these Not applicable.',
    items: [
      { key: 'trailer_decal', text: 'Inspection decal present, valid and in the proper place' },
      { key: 'trailer_body', text: 'Body has no damage, broken or missing rivets, holes or weld separations' },
      { key: 'trailer_frame', text: 'Frame and structural supports have no holes, bends, cracks, weld separations or broken cross members' },
      { key: 'landing_gear', text: 'Landing gear raised, handle secure, no cracks or breaks in cross members or webbing, lowering mechanism secure' },
      { key: 'trailer_air_lines', text: 'Air lines secured safely; no leaks, kinks, cuts, abrasions or cracks in the housing' },
      { key: 'trailer_clearance', text: 'Clearance and marker lights work, lenses clean and not cracked, reflectors and reflective tape clean' },
      { key: 'load_security', text: 'Load security devices work, anchor points secure, devices not damaged' },
      { key: 'trailer1_tire', text: tires('First trailer axle', '1.6 mm') },
      { key: 'trailer1_rim', text: rims('First trailer axle') },
      { key: 'trailer2_tire', text: tires('Second trailer axle', '1.6 mm') },
      { key: 'trailer2_rim', text: rims('Second trailer axle') },
      { key: 'sliding_tandem', text: 'Sliding tandem locking pin locked and secure; no bends, cracks, breaks or weld separations in cross members, torsion bars or flanges' },
      { key: 'trailer_chambers', text: 'Brake chambers secure, no cracks or corrosion, nothing obstructing push rod travel' },
      { key: 'trailer_slack', text: 'All slack adjusters: pull by hand or with a pry bar to check travel, mechanical condition and wear' },
      { key: 'trailer_suspension', text: 'Suspension: no cracked, missing or broken springs; torsion bars and walking beams secure; no loose or broken U-bolts; air bags not damaged, worn or inoperative' },
      { key: 'trailer_axle', text: 'Axle assembly has no breaks, cracks, holes or cracked seals' },
    ],
  },
  {
    key: 'rear',
    title: 'Rear',
    items: [
      { key: 'rear_signals', text: 'Right and left turn signals work; lenses clean and not cracked' },
      { key: 'rear_hazards', text: 'Hazard warning lights work; lenses clean and not cracked' },
      { key: 'rear_brake_lights', text: 'Brake lights work; lenses clean and not cracked (have someone press the brakes)' },
      { key: 'rear_clearance', text: 'Clearance and marker lights work, lenses clean and not cracked, reflectors and reflective tape clean' },
      { key: 'rear_plate', text: 'Licence plate clean and attached securely, registration decal valid, plate light works and its lens is clean' },
      { key: 'doors_gates', text: 'Doors or gates work, are closed and secure (if applicable)' },
      { key: 'rear_windows', text: 'Rear windows clean (if applicable)' },
      { key: 'rear_mud_flaps', text: 'Mud flaps secure and do not rub the tires' },
      { key: 'rear_exhaust', text: 'Exhaust secure with no visible leaks, muffler securely attached (if applicable)' },
    ],
  },
  {
    key: 'passenger_side',
    title: 'Passenger side',
    items: [
      { key: 'passenger_side', text: 'Passenger side of the truck and trailer checked the same way as the driver’s side' },
    ],
  },
  {
    key: 'cab',
    title: 'Inside the cab and engine start-up',
    items: [
      { key: 'seat_mirrors', text: 'Seat and mirrors adjusted properly' },
      { key: 'seat_belt', text: 'Seat belt adjusted and fastens properly' },
      { key: 'pedals', text: 'Brake pedal and clutch pedal (if equipped) feel and work right' },
      { key: 'steering_play', text: 'Steering has no excessive play or slack' },
      { key: 'gauges', text: 'All gauges and warning lights work' },
      { key: 'fuel_level', text: 'Fuel level is adequate' },
      { key: 'cab_windows', text: 'Windows and windshield clean, windshield free of major cracks' },
      { key: 'wipers', text: 'Wipers work; washer has enough fluid and sprays well' },
      { key: 'defroster', text: 'Defroster and heater work properly' },
      { key: 'horn', text: 'Horn works, and the backing alarm if equipped' },
      { key: 'engine_smooth', text: 'Engine runs smoothly' },
      { key: 'engine_noise', text: 'No unusual engine noises' },
      { key: 'clutch_noise', text: 'No unusual noise when the clutch is pushed in and released in neutral (manual transmission)' },
      { key: 'radio', text: 'Radio equipment works (if applicable)' },
      { key: 'throttle', text: 'Hand throttle and accelerator pedal operate properly' },
      { key: 'air_buildup', text: 'Air pressure builds up in good time and does not drop too far when the brakes are applied' },
      { key: 'service_brake_drive', text: 'Service brakes tested by driving forward slowly and stopping' },
    ],
  },
  {
    key: 'equipment',
    title: 'Extra equipment and paperwork',
    items: [
      { key: 'extinguisher', text: 'Fire extinguisher fully charged and its label shows it has not expired' },
      { key: 'warning_device', text: 'An approved warning device is in the truck' },
      { key: 'first_aid', text: 'First aid kit fully equipped' },
      { key: 'documents', text: 'Paperwork in the truck and valid: registration, insurance, CVIP inspection certificate, pre-trip inspection form, safety fitness certificate, permits, logbook' },
      { key: 'ppe', text: 'Personal protective equipment needed on a work site is in the truck' },
      { key: 'tools', text: 'Tools properly secured' },
      { key: 'spares', text: 'Spare light bulbs, fuses, belts and other parts are in the truck' },
    ],
  },
  {
    key: 'air_protection',
    title: 'Air brake test: tractor protection',
    hint: 'Step 1: chock the wheels on level ground and look over the air brake parts. Then, engine off with the key at run:',
    items: [
      { key: 'ab_chocked', text: 'Wheels chocked on level ground; air brake parts looked over' },
      { key: 'ab_valves_set', text: 'Trailer air supply valve (red) pushed in, park control valve (yellow) pulled out' },
      { key: 'ab_disconnect', text: 'Both air lines to the trailer disconnected' },
      { key: 'ab_trailer_pop', text: 'Trailer air supply valve pops out at 40–60 psi (276–414 kPa) or higher' },
      { key: 'ab_low_warn_on', text: 'Low air pressure warning comes on by 60 psi (414 kPa)' },
      { key: 'ab_service_line', text: 'With the foot or hand valve applied and held, no air leaks from the open trailer service line' },
    ],
  },
  {
    key: 'air_park',
    title: 'Air brake test: park control valve',
    items: [
      { key: 'ab_park_pushed', text: 'Park control valve (yellow) pushed in; foot valve pumped' },
      { key: 'ab_park_pop', text: 'Park control valve pops out at 20–45 psi (138–311 kPa)' },
      { key: 'ab_reconnect', text: 'Both air lines reconnected to the trailer' },
    ],
  },
  {
    key: 'air_supply',
    title: 'Air brake test: supply circuit',
    hint: 'Start the engine and run it at a fast idle, about 1,200 rpm.',
    items: [
      { key: 'ab_buildup', text: 'Compressor build-up: 50 to 90 psi (345 to 621 kPa) within 3 minutes' },
      { key: 'ab_low_warn_off', text: 'Low air pressure warning light goes out by 60 psi (414 kPa)' },
      { key: 'ab_cutout', text: 'Governor cuts out at 120–135 psi (828–931 kPa)' },
      { key: 'ab_cutin', text: 'Governor cuts back in 20–25 psi (138–172 kPa) below cut-out' },
    ],
  },
  {
    key: 'air_leaks',
    title: 'Air brake test: leaks',
    hint: 'Push in both park control valves and rebuild the air pressure, then turn the engine off.',
    items: [
      { key: 'ab_hold', text: 'Full service brake applied and held firmly for 2 minutes' },
      { key: 'ab_loss', text: 'Loss no more than 4 psi (28 kPa) for the truck, plus 2 psi (14 kPa) a trailer, once the system settles' },
      { key: 'ab_release', text: 'Service brake released and spring park brakes reapplied' },
    ],
  },
  {
    key: 'air_response',
    title: 'Air brake test: service brake response',
    items: [
      { key: 'ab_unchock', text: 'Wheel chocks removed and spring park brakes released' },
      { key: 'ab_foot_valve', text: 'Brake response test with the foot valve passed' },
      { key: 'ab_hand_valve', text: 'Brake response test with the trailer hand valve passed' },
    ],
  },
]

export const ALL_ITEMS: (Item & { section: Section })[] = INSPECTION_SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s })))

export type Answers = Partial<Record<string, Answer>>

/** How far through: items answered, of all of them. */
export function progress(answers: Answers): { done: number; total: number } {
  return { done: ALL_ITEMS.filter((i) => answers[i.key]).length, total: ALL_ITEMS.length }
}

/** The items to fix, in the order they were inspected, with the section's note. */
export function toFix(answers: Answers, notes: Partial<Record<string, string>>): { section: string; text: string; note: string | null }[] {
  return ALL_ITEMS.filter((i) => answers[i.key] === 'fix').map((i) => ({ section: i.section.title, text: i.text, note: notes[i.section.key]?.trim() || null }))
}

/** Every item answered: the inspection can be signed off. */
export const allAnswered = (answers: Answers) => ALL_ITEMS.every((i) => !!answers[i.key])

/**
 * A truck's yearly inspection is due when none has been signed off in the
 * calendar year (Sam: "required at least once a year with a reminder in
 * January").
 */
export function isDue(lastSignedOn: string | null | undefined, year: number): boolean {
  return !lastSignedOn || Number(lastSignedOn.slice(0, 4)) < year
}
