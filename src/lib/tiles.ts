import type { ComponentType } from 'react'
import { GrainBin } from '@/components/icons/GrainBin'
import {
  ShieldCheck,
  Umbrella,
  Ban,
  Baby,
  Beef,
  Bell,
  BookOpen,
  Bug,
  Boxes,
  Calculator,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  CloudHail,
  Container,
  Droplet,
  Droplets,
  FileSignature,
  FileText,
  FlaskConical,
  Fuel,
  KeyRound,
  Landmark,
  Leaf,
  LineChart,
  ListChecks,
  Map as MapIcon,
  Mic,
  PiggyBank,
  Presentation,
  Sparkles,
  Repeat,
  Scale,
  ArrowLeftRight,
  ScrollText,
  Search,
  Settings,
  SprayCan,
  Sprout,
  Thermometer,
  Timer,
  Plug,
  Tractor,
  Truck,
  Users,
  Video,
  Waves,
  Wheat,
  Flower2,
} from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { NAV_ITEMS, isViewDenied } from './nav'
import { isPathOff, useDisabledPaths } from './farm-setup'
import { isPartner, isPartnerPath } from './partner'

/**
 * The phone home screen.
 *
 * The sidebar is a list of seventeen sections, which is the right shape on a
 * desktop and the wrong one on a phone held in one hand at the end of a field.
 * What gets wanted out there is narrower and deeper than a section: not
 * "Irrigation" but the turbine screen, not "Crop Plan" but this year's
 * rotation. So the tiles are DEEP links — a tile per screen rather than per
 * section — and there are more of them than anybody wants at once, which is why
 * choosing is part of the feature rather than an afterthought.
 */

export type TileGroup =
  'Water' | 'Work' | 'Fields & crop' | 'Fertilizer' | 'Cattle' | 'Storage & kit' | 'Reference'

export type Tile = {
  /** Stable id. Never reuse one for a different destination — it is saved. */
  key: string
  label: string
  /** Second line. Says what the screen answers, not what it is called. */
  hint: string
  to: string
  icon: ComponentType<{ className?: string }>
  group: TileGroup
  /** The nav section this belongs to, for the admin's per-user access check. */
  section: string
  /** On by default for a new user. The rest are opt-in from Settings. */
  default?: boolean
}

/**
 * Everything a tile could point at.
 *
 * Deliberately more than fits on a screen. A catalogue somebody picks eight
 * from is more useful than a fixed eight chosen for them, because the eight
 * differ by person: the man who runs the pivots and the man who does the books
 * want almost no tiles in common.
 */
// RULE: a new view goes in this list. Enforced by tiles.test.ts, which reads
// App.tsx and fails on any route with no tile — see CONTRIBUTING.md. It does
// not have to be a default; being available in Settings is the point.
export const TILES: Tile[] = [
  // ── Water ────────────────────────────────────────────────────────────────
  {
    key: 'pumps',
    label: 'Pump overview',
    hint: 'All stations at a glance',
    to: '/irrigation-info?tab=pump',
    icon: Droplets,
    group: 'Water',
    section: '/irrigation-info',
  },
  {
    key: 'pivots',
    label: 'Pivots',
    hint: 'Where each machine is pointing',
    to: '/irrigation-info',
    icon: Repeat,
    group: 'Water',
    section: '/irrigation-info',
    default: true,
  },
  {
    key: 'aimm',
    label: 'Soil moisture',
    hint: 'Which fields need water',
    to: '/irrigation',
    icon: Waves,
    group: 'Water',
    section: '/irrigation',
    default: true,
  },
  {
    key: 'river',
    label: 'River levels',
    hint: 'Flow, and dam releases coming',
    to: '/river',
    icon: Waves,
    group: 'Water',
    section: '/river',
  },

  // ── Work ─────────────────────────────────────────────────────────────────
  {
    key: 'tasks',
    label: 'To-do list',
    hint: 'What is open and what is late',
    to: '/tasks',
    icon: CheckSquare,
    group: 'Work',
    section: '/tasks',
    default: true,
  },
  {
    key: 'checklists',
    label: 'Checklists',
    hint: 'Start-up and shut-down runs',
    to: '/checklists',
    icon: ClipboardCheck,
    group: 'Work',
    section: '/tasks',
  },
  {
    key: 'meeting',
    label: 'Monday meeting',
    hint: 'The week: carried over, due, and the plan',
    to: '/meeting',
    icon: Presentation,
    group: 'Work',
    section: '/meeting',
    default: true,
  },
  {
    key: 'missing',
    label: "What's missing",
    hint: 'Data to fill in, and where',
    to: '/missing',
    icon: ListChecks,
    group: 'Work',
    section: '/meeting',
  },
  {
    key: 'whats-new',
    label: "What's new",
    hint: 'What changed in the app last week',
    to: '/meeting?tab=whats-new',
    icon: Sparkles,
    group: 'Work',
    section: '/meeting',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    hint: 'What is happening this week',
    to: '/calendar',
    icon: CalendarDays,
    group: 'Work',
    section: '/calendar',
    default: true,
  },
  {
    key: 'monthly',
    label: 'Monthly jobs',
    hint: 'What needs doing this month',
    to: '/monthly',
    icon: CalendarDays,
    group: 'Work',
    section: '/monthly',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    hint: 'Your notifications, newest first',
    to: '/notifications',
    icon: Bell,
    group: 'Work',
    section: '/notifications',
  },
  {
    key: 'search',
    label: 'Search',
    hint: 'Find a field, task or record',
    to: '/search',
    icon: Search,
    group: 'Work',
    section: '/search',
  },

  // ── Fields & crop ────────────────────────────────────────────────────────
  {
    key: 'map',
    label: 'Map',
    hint: 'Boundaries, and where you are',
    to: '/map',
    icon: MapIcon,
    group: 'Fields & crop',
    section: '/map',
    default: true,
  },
  {
    key: 'profitloss',
    label: 'Profit / Loss',
    hint: 'Which parts of a field made money',
    to: '/map?tab=profit',
    icon: CircleDollarSign,
    group: 'Fields & crop',
    section: '/map',
  },
  {
    key: 'fieldprogress',
    label: 'Seeding & harvest',
    hint: 'How many acres are in and how many are off',
    to: '/field-progress',
    icon: Sprout,
    group: 'Fields & crop',
    section: '/field-progress',
  },
  {
    key: 'fields',
    label: 'Fields',
    hint: 'Every field and its record',
    to: '/fields',
    icon: Wheat,
    group: 'Fields & crop',
    section: '/fields',
    default: true,
  },
  {
    key: 'plan',
    label: 'Crop financials',
    hint: 'Plan, budget, actuals and field work',
    to: '/plan',
    icon: ClipboardList,
    group: 'Fields & crop',
    section: '/plan',
  },
  {
    key: 'fieldwork',
    label: 'Field work',
    hint: 'Passes the machines recorded',
    to: '/plan?tab=field work',
    icon: Tractor,
    group: 'Fields & crop',
    section: '/plan',
  },
  {
    key: 'cropmarkets',
    label: 'Crop prices',
    hint: 'What grain and cattle are worth',
    to: '/markets',
    icon: LineChart,
    group: 'Fields & crop',
    section: '/markets',
  },
  {
    key: 'cropsettings',
    label: 'Crop settings',
    hint: 'Varieties, coefficients and the crop list',
    to: '/crops',
    icon: Wheat,
    group: 'Fields & crop',
    section: '/crops',
  },
  {
    key: 'contracts',
    label: 'Contracts',
    hint: 'What is sold and at what price',
    to: '/contracts',
    icon: FileSignature,
    group: 'Fields & crop',
    section: '/plan',
  },
  {
    key: 'farmcosts',
    label: 'Farm costs',
    hint: 'Fixed expenses every budget carries',
    to: '/plan?tab=farm costs',
    icon: Landmark,
    group: 'Fields & crop',
    section: '/plan',
  },
  {
    key: 'hail',
    label: 'Hail reports',
    hint: 'AFSC inspections waiting to be confirmed',
    to: '/hail',
    icon: CloudHail,
    group: 'Fields & crop',
    section: '/hail',
  },
  {
    key: 'rotation',
    label: 'Rotation',
    hint: 'What follows what, field by field',
    to: '/rotation',
    icon: Repeat,
    group: 'Fields & crop',
    section: '/rotation',
  },
  {
    key: 'crop-compare',
    label: 'Compare crops',
    hint: 'Two crops on one field: which pays, and at what yield',
    to: '/crop-compare',
    icon: ArrowLeftRight,
    group: 'Fields & crop',
    section: '/crop-compare',
  },
  {
    key: 'canola-reports',
    label: 'Isolation',
    hint: 'Isolation map and field history for the seed companies',
    to: '/canola-reports',
    icon: Flower2,
    group: 'Fields & crop',
    section: '/canola-reports',
  },
  {
    key: 'bale-checks',
    label: 'Bale checks',
    hint: 'Monthly bale temperature and moisture, for the insurance record',
    to: '/feed?tab=bale-checks',
    icon: Thermometer,
    group: 'Cattle',
    section: '/feed',
  },
  {
    key: 'quickbooks',
    label: 'QuickBooks',
    hint: 'Find any bill or invoice, spending by vendor, ask the books',
    to: '/quickbooks',
    icon: CircleDollarSign,
    group: 'Fields & crop',
    section: '/quickbooks',
  },
  {
    key: 'fuel',
    label: 'Fuel prices',
    hint: 'What Fuel supplier charged, and the market',
    to: '/fuel?tab=fuel',
    icon: Fuel,
    group: 'Fields & crop',
    section: '/fuel',
  },
  {
    // A tab of Chemicals again (Sam, 29 Oct 2026); its own tile either way,
    // because checking a spray is its own errand.
    key: 'spraying',
    label: 'Spraying',
    hint: 'Check a spray, and when fields are safe to enter',
    to: '/chemicals?tab=spraycheck',
    icon: SprayCan,
    group: 'Fields & crop',
    section: '/chemicals',
  },
  {
    key: 'chem-inventory',
    label: 'Chemical inventory',
    hint: 'Jugs and totes left in the shed',
    to: '/chemicals?tab=inventory',
    icon: FlaskConical,
    group: 'Fields & crop',
    section: '/chemicals',
  },
  {
    key: 'scouting',
    label: 'Scouting report',
    hint: 'Pin a weed, bug or disease with a photo',
    // Straight to the form: the tile is for the person standing in the field.
    to: '/scouting?new=1',
    icon: Bug,
    group: 'Fields & crop',
    section: '/scouting',
    default: true,
  },
  {
    key: 'leases',
    label: 'Leases',
    hint: 'Rent due and renewal notice dates',
    to: '/leases',
    icon: KeyRound,
    group: 'Fields & crop',
    section: '/leases',
  },
  {
    key: 'weather',
    label: 'Weather',
    hint: 'Rain, wind and frost, three sites',
    to: '/weather',
    icon: Cloud,
    group: 'Fields & crop',
    section: '/weather',
    default: true,
  },

  // ── Fertilizer ───────────────────────────────────────────────────────────
  {
    key: 'soil',
    label: 'Soil tests',
    hint: 'Results and the agronomy write-up',
    to: '/fertilizer/soil?tab=tests',
    icon: FlaskConical,
    group: 'Fertilizer',
    section: '/fertilizer',
  },
  {
    key: 'nutrients',
    label: 'Nutrient history',
    hint: 'How a field has moved over years',
    to: '/fertilizer/soil?tab=history',
    icon: LineChart,
    group: 'Fertilizer',
    section: '/fertilizer',
  },
  {
    key: 'fertmarket',
    label: 'Fertilizer prices',
    hint: 'Whether now is dear or cheap',
    to: '/fertilizer/prices?tab=market',
    icon: LineChart,
    group: 'Fertilizer',
    section: '/fertilizer',
  },
  {
    key: 'fertsavings',
    label: 'Fertilizer savings',
    hint: 'Twenty ways to spend less, worked out from our records',
    to: '/fertilizer/savings',
    icon: PiggyBank,
    group: 'Fertilizer',
    section: '/fertilizer',
  },
  {
    key: 'fertblends',
    label: 'Blend calculator',
    hint: 'Cheapest mix for a field’s N-P-K-S',
    to: '/fertilizer/plan?tab=blends',
    icon: Calculator,
    group: 'Fertilizer',
    section: '/fertilizer',
  },
  {
    key: 'fertneeds',
    label: 'Fertilizer needed',
    hint: 'Tonnes to order, by field',
    to: '/fertilizer/plan?tab=requirements',
    icon: Sprout,
    group: 'Fertilizer',
    section: '/fertilizer',
  },
  {
    // Its own view since the Fertilizer split (Sam, 24 Oct 2026), so its own tile.
    key: 'fertmanure',
    label: 'Manure',
    hint: 'What was spread, and its fertilizer worth',
    to: '/fertilizer/manure',
    icon: Container,
    group: 'Fertilizer',
    section: '/fertilizer',
  },

  // ── Cattle ───────────────────────────────────────────────────────────────
  {
    key: 'herd',
    label: 'Herd',
    hint: 'Head, groups and where they are',
    to: '/herd?tab=herd',
    icon: Beef,
    group: 'Cattle',
    section: '/herd',
  },
  {
    key: 'grazing',
    label: 'Grazing',
    hint: 'Which pasture is next',
    to: '/cattle?tab=grazing',
    icon: Leaf,
    group: 'Cattle',
    section: '/cattle',
  },
  {
    key: 'feed',
    label: 'Winter feed',
    hint: 'What is needed and what is on hand',
    to: '/feed?tab=plan',
    icon: Container,
    group: 'Cattle',
    section: '/feed',
  },
  {
    key: 'feedrecords',
    label: 'Feed today',
    hint: 'Write down what went in the bunk',
    to: '/feed?tab=records&new=1',
    icon: ClipboardList,
    group: 'Cattle',
    section: '/feed',
  },
  {
    key: 'pregnancy',
    label: 'Pregnancy',
    hint: 'eShepherd collars: bred, open or unsure, and due dates',
    to: '/herd?tab=pregnancy',
    icon: Baby,
    group: 'Cattle',
    section: '/herd',
  },
  {
    key: 'grazingrestrictions',
    label: 'Spray restrictions',
    hint: 'Where a spray keeps cattle off, and until when',
    to: '/cattle?tab=restrictions',
    icon: Ban,
    group: 'Cattle',
    section: '/cattle',
  },
  {
    key: 'cattlemarket',
    label: 'Cattle prices',
    hint: 'Auction and futures',
    to: '/cattle-markets?tab=markets',
    icon: LineChart,
    group: 'Cattle',
    section: '/cattle-markets',
  },
  {
    key: 'cattlesettings',
    label: 'Cattle settings',
    hint: 'Ranch knobs, classes and grazing rules',
    to: '/cattle-settings',
    icon: Settings,
    group: 'Cattle',
    section: '/cattle-settings',
  },
  {
    key: 'pasturemap',
    label: 'Pasture map',
    hint: 'Fences, water and paddocks',
    to: '/cattle?tab=map',
    icon: MapIcon,
    group: 'Cattle',
    section: '/cattle',
  },

  // ── Storage & kit ────────────────────────────────────────────────────────
  {
    key: 'inventory',
    label: 'Grain inventory',
    hint: 'What is on hand and where',
    to: '/harvest?tab=bins',
    icon: Boxes,
    group: 'Storage & kit',
    section: '/harvest',
  },
  {
    key: 'moisture',
    label: 'Moisture',
    hint: 'Test a sample, safe binning levels by crop, and how to test',
    to: '/harvest?tab=moisture',
    icon: Droplet,
    group: 'Storage & kit',
    section: '/harvest',
  },
  {
    key: 'daybook',
    label: 'Day book',
    hint: 'What happened today, written by the machines',
    to: '/daybook',
    icon: BookOpen,
    group: 'Work',
    section: '/daybook',
  },
  {
    key: 'say-it',
    label: 'Say it',
    hint: 'Speak a task or a field note',
    to: '/tasks?say=1',
    icon: Mic,
    group: 'Work',
    section: '/tasks',
  },
  {
    key: 'bins',
    label: 'Bin estimator',
    hint: 'How many bins this year’s crop needs, field by field',
    to: '/harvest?tab=estimator',
    icon: GrainBin,
    group: 'Storage & kit',
    section: '/harvest',
  },
  // Harvest's other three views (Sam, 24 Oct 2026), each its own section so access follows the sidebar.
  {
    key: 'weigh-scale',
    label: 'Weigh scale',
    hint: 'Every load and ticket, and each truck and driver',
    to: '/weigh-scale',
    icon: Scale,
    group: 'Storage & kit',
    section: '/weigh-scale',
  },
  {
    key: 'pre-harvest',
    label: 'Pre-harvest intervals',
    hint: 'Which fields are still inside a spray’s pre-harvest days',
    to: '/pre-harvest',
    icon: Timer,
    group: 'Storage & kit',
    section: '/pre-harvest',
  },
  {
    key: 'harvest-reports',
    label: 'Harvest reports',
    hint: 'Bin temperatures, deliveries, yields and the seed forms',
    to: '/harvest-reports',
    icon: FileText,
    group: 'Storage & kit',
    section: '/harvest-reports',
  },
  {
    key: 'planter',
    label: 'Seed & planter',
    hint: 'Settings per crop, spacing and plate checks',
    to: '/planter',
    icon: Sprout,
    group: 'Storage & kit',
    section: '/planter',
  },
  {
    key: 'manifests',
    label: 'Manifests',
    hint: 'Paperwork for cattle leaving the place',
    to: '/cattle-markets?tab=manifests',
    icon: FileSignature,
    group: 'Cattle',
    section: '/cattle-markets',
  },
  {
    key: 'pasture-insurance',
    label: 'Pasture insurance',
    hint: 'AFSC’s moisture deficiency forms, filled in. Due 28 February',
    to: '/cattle-markets?tab=insurance',
    icon: Umbrella,
    group: 'Cattle',
    section: '/cattle-markets',
  },
  {
    key: 'grazing-leases',
    label: 'Grazing leases',
    hint: 'The province’s stock return for each lease, due 31 January',
    to: '/cattle-markets?tab=leases',
    icon: ScrollText,
    group: 'Cattle',
    section: '/cattle-markets',
  },
  {
    key: 'hauling',
    // Key kept so home screens that have it keep it; the page is a tab of Fuel & trucking (24 Oct 2026).
    label: 'Distances & trucking',
    hint: 'Road km to each field, and haul plans to the elevator',
    to: '/fuel?tab=distances',
    icon: Truck,
    group: 'Storage & kit',
    section: '/fuel',
  },
  {
    // The key stays (it is saved on home screens); since 24 Oct 2026 it opens
    // the Truck inspection checklist, where the truck is picked on the form.
    key: 'truck-inspections',
    label: 'Truck inspection',
    hint: 'Pick the truck, do its yearly inspection, sign it off',
    to: '/checklists/truck-inspection',
    icon: ShieldCheck,
    group: 'Storage & kit',
    section: '/equipment',
  },
  {
    key: 'utilities',
    label: 'Utilities',
    hint: 'Solar production, power and gas bills, the pumps’ meters',
    to: '/utilities',
    icon: Plug,
    group: 'Fields & crop',
    section: '/utilities',
  },
  {
    key: 'combine',
    label: 'Combine',
    hint: 'Settings, and what it is losing',
    to: '/combine',
    icon: Wheat,
    group: 'Storage & kit',
    section: '/equipment',
  },
  {
    key: 'bin-weigh',
    label: 'Weigh in a load',
    hint: 'Truck full and empty off the scale, straight into the bin',
    to: '/harvest?tab=bins&weigh=1',
    icon: Scale,
    group: 'Storage & kit',
    section: '/harvest',
    // On every new home screen: the pit is where the phone is out.
    default: true,
  },
  {
    key: 'equipment',
    label: 'Equipment service',
    hint: 'The fleet, hours, service and truck inspections',
    to: '/equipment',
    icon: Tractor,
    group: 'Storage & kit',
    section: '/equipment',
  },
  {
    key: 'cameras',
    label: 'Cameras',
    hint: 'Yard and shop views',
    to: '/cameras',
    icon: Video,
    group: 'Storage & kit',
    section: '/cameras',
  },

  // ── Reference ────────────────────────────────────────────────────────────
  {
    key: 'chemicals',
    label: 'Chemical labels',
    hint: 'Rates, and what is registered',
    to: '/chemicals',
    icon: FlaskConical,
    group: 'Reference',
    section: '/chemicals',
    default: true,
  },
  {
    key: 'calculator',
    label: 'Calculator',
    hint: 'Water depths, areas and rates',
    to: '/calculator',
    icon: Calculator,
    group: 'Reference',
    section: '/calculator',
  },
  {
    key: 'contacts',
    label: 'Contacts',
    hint: 'Agronomist, dealer, neighbours',
    to: '/contacts',
    icon: Users,
    group: 'Reference',
    section: '/contacts',
    default: true,
  },
  {
    key: 'events',
    label: 'Conferences',
    hint: 'Shows worth the trip, and their deadlines',
    to: '/events',
    icon: CalendarDays,
    group: 'Reference',
    section: '/events',
  },
  {
    key: 'reports',
    label: 'Reports',
    hint: 'Download records for the CPA, AFSC or a buyer',
    to: '/reports',
    icon: FileText,
    group: 'Reference',
    section: '/reports',
  },
  {
    key: 'grants',
    label: 'Grants',
    hint: 'Funding open and deadlines',
    to: '/grants',
    icon: Landmark,
    group: 'Reference',
    section: '/grants',
  },
]

export const TILE_GROUPS: TileGroup[] = [
  'Water',
  'Work',
  'Fields & crop',
  'Fertilizer',
  'Cattle',
  'Storage & kit',
  'Reference',
]

export type TilePrefs = { order: string[]; hidden: string[] }

const byKey = new Map(TILES.map((t) => [t.key, t]))

/**
 * Sections you can reach from the sidebar, parents and children alike.
 *
 * A tile whose section is NOT in here is the only way into that view — there is
 * no menu entry to fall back on. Weather is the one: deliberately kept off the
 * sidebar as a glance-at-once-a-morning thing, which meant that when the rule
 * below quietly withheld its tile, the whole feature became unreachable without
 * typing the address.
 */
const IN_SIDEBAR = new Set(NAV_ITEMS.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]))

/**
 * Tiles to put on an arranged home screen without being asked.
 *
 * Only one kind qualifies: a default tile the person has never made a decision
 * about, whose view has no sidebar entry. That is not a new option on their
 * desk — it is the only door to a part of the app, and withholding it removes
 * the feature rather than tidying the screen.
 *
 * Takes its inputs rather than reading the catalogue, so the rule can be tested
 * on its own. It is deliberately possible for this to match nothing: every view
 * having a second way in is the better state, and the rule is a backstop for
 * when one does not.
 */
export function tilesToAppend(
  catalogue: Tile[],
  chosen: Set<string>,
  hidden: Set<string>,
  reachableElsewhere: (section: string) => boolean,
): Tile[] {
  return catalogue.filter(
    (t) => t.default && !chosen.has(t.key) && !hidden.has(t.key) && !reachableElsewhere(t.section),
  )
}

/**
 * Resolve saved choices against the catalogue.
 *
 * Same defensive shape as the sidebar's: unknown keys (a tile since removed)
 * are dropped, and a tile the catalogue has gained is NOT silently visible —
 * unlike the nav, where a new section appearing is welcome. A home screen is
 * something a person arranged, and eight tiles becoming nine without being
 * asked is the app rearranging their desk.
 *
 * The exception is somebody who has never chosen: they get the defaults.
 */
export function resolveTiles(prefs: TilePrefs | null | undefined): {
  visible: Tile[]
  hidden: Tile[]
} {
  if (!prefs?.order?.length) {
    return {
      visible: TILES.filter((t) => t.default),
      hidden: TILES.filter((t) => !t.default),
    }
  }
  const hidden = new Set(prefs.hidden ?? [])
  const chosen = prefs.order.filter((k) => byKey.has(k))
  const seen = new Set(chosen)
  const visible = chosen.filter((k) => !hidden.has(k)).map((k) => byKey.get(k)!)

  // The exception to "a new tile is not silently visible": a default tile the
  // person has never made a decision about, whose view has no sidebar entry, is
  // not a new option on their desk — it is the only door to a part of the app,
  // and withholding it removes the feature rather than tidying the screen.
  // Explicitly hidden still means hidden; this is only about never-chosen.
  const stranded = tilesToAppend(TILES, seen, hidden, (section) => IN_SIDEBAR.has(section))

  const shown = [...visible, ...stranded]
  const shownKeys = new Set(shown.map((t) => t.key))
  const rest = TILES.filter((t) => !shownKeys.has(t.key))
  return { visible: shown, hidden: rest }
}

/** The user's tiles, with anything an admin closed off removed. */
export function useTiles() {
  const { profile } = useAuth()
  const prefs = (profile?.tile_prefs as TilePrefs | null | undefined) ?? null
  const { visible, hidden } = resolveTiles(prefs)
  const off = useDisabledPaths()
  // A tile goes with its section, and with the page it opens: the combine tile
  // sits under Equipment but opens /combine, which can be switched off alone.
  // A crop-share partner's home holds only the pages he can open (lib/partner.ts).
  const partner = isPartner(profile?.role)
  const allowed = (t: Tile) =>
    !isViewDenied(profile, t.section) && !isPathOff(off, t.section) && !isPathOff(off, t.to) && (!partner || isPartnerPath(t.to))
  return { visible: visible.filter(allowed), hidden: hidden.filter(allowed) }
}

export function useSaveTilePrefs() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (prefs: TilePrefs) => {
      if (!profile) throw new Error('Not signed in')
      const { error } = await supabase
        .from('users')
        .update({ tile_prefs: prefs })
        .eq('id', profile.id)
      if (error) throw error
      return prefs
    },
    // Optimistic, so a tap toggles the tile at once rather than after a round
    // trip — the picker is a list of switches and it should behave like one.
    onMutate: async (prefs) => {
      const key = ['profile', profile?.id]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, (old: unknown) =>
        old ? { ...(old as object), tile_prefs: prefs } : old,
      )
      return { prev, key }
    },
    onError: (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['profile'] }),
  })
}
