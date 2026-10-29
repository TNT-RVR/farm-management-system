import type { ComponentType } from 'react'
import {
  Umbrella,
  ArrowLeftRight,
  BookOpen,
  Beef,
  Bug,
  Calculator,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  CloudHail,
  Container,
  Droplets,
  FileSignature,
  FileText,
  FlaskConical,
  Flower2,
  Fuel,
  Info,
  KeyRound,
  Landmark,
  LandPlot,
  LayoutDashboard,
  Leaf,
  LineChart,
  ListChecks,
  Map as MapIcon,
  PiggyBank,
  Plug,
  Presentation,
  RefreshCw,
  Repeat,
  Scale,
  Settings,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sprout,
  Sun,
  Thermometer,
  Timer,
  Tractor,
  UserCircle,
  Users,
  Video,
  Waves,
  Wheat,
  Wrench,
} from 'lucide-react'
import { GrainBin } from '@/components/icons/GrainBin'

/*
 * The season menu (Sam, 24 Oct 2026).
 *
 * The old sidebar grew one section per feature, and a farm does not think in
 * features: in May it is planting, in August it is harvest. This regroups the
 * same pages by the season they are used in, with the year-round things
 * (fields, money, cattle, equipment, tasks) as their own sections.
 *
 * Pure data and pure functions only, so the tests run without React or a
 * database. The hooks that read a person's prefs are in lib/menu-prefs.ts.
 *
 * Every view points at a page and route that exist today. Where a planned view
 * is really one tab of a bigger page, it deep-links the tab; the page splits
 * come later and only have to change a `to` here.
 *
 * On for everyone since 26 Oct 2026 (Sam, after he and Derek had tried it):
 * menu_prefs.enabled === false is the only way to the old menu (lib/nav.ts),
 * which stays as the fallback until it is retired. What a person had hidden in
 * the old menu carries over at read time (carryOverHidden, below).
 */

export type MenuIcon = ComponentType<{ className?: string }>

/** A place the menu can take you. Defined once; any section may list it. */
export type MenuView = {
  /** Stable: saved in menu_prefs (hidden, bar). Never reuse or rename one. */
  key: string
  label: string
  icon: MenuIcon
  /** An existing route, optionally with `?tab=`. */
  to: string
  /** One line, for the section pages. Written from the user's side. */
  description: string
  /**
   * The section this view belongs to, when that is not the first section to
   * list it. Leases are listed under Fields first, but they are money.
   */
  home?: string
  /** Shown only to managers (or admins), as the page or tab itself is. */
  access?: 'manager' | 'admin'
  /**
   * A tab of another view, listed elsewhere as a shortcut straight to that tab
   * (Bale checks in Harvest is Cattle › Feed › Bale checks). Its home section
   * lists the parent view, not this one, and the header names the parent.
   */
  tabOf?: string
}

/** A view listed in a section, optionally under another name there. */
type Entry = string | { view: string; label: string }
/**
 * A run of views folded under one label. It is drawn like the views under it
 * — same icon size, type and colour — with the same arrow a section has, so
 * the menu reads the same the whole way down (Sam, 29 Oct 2026: the old tiny
 * capitals "seemed out of place").
 */
type HeadingDef = { heading: string; icon: MenuIcon; views: Entry[] }
type SectionDef = {
  key: string
  label: string
  icon: MenuIcon
  /** A leaf section links straight to a page and lists no views. */
  to?: string
  /** Fixed to the bottom and never hidden: it is where you undo a menu change. */
  pinned?: boolean
  items: (Entry | HeadingDef)[]
}

/* ------------------------------------------------------------------ views */

const VIEW_LIST: MenuView[] = [
  // Fields
  { key: 'all-fields', label: 'All fields', icon: Wheat, to: '/fields', description: 'Every field: crop, acres, history and notes.' },
  { key: 'crops', label: 'Crops & varieties', icon: Sprout, to: '/crops', description: 'The crops you grow, their varieties and moisture grades.' },
  { key: 'field-progress', label: 'Field progress', icon: ListChecks, to: '/field-progress', description: 'Which fields are seeded, sprayed and combined.' },
  { key: 'leases', label: 'Leases', icon: KeyRound, to: '/leases', home: 'financials', description: 'Land leases, rent and renewal dates.' },

  // Planting
  { key: 'seed-planter', label: 'Seed & planter', icon: Sprout, to: '/planter', description: 'The planter calculator, and planter settings for each crop.' },
  { key: 'soil-tests', label: 'Soil tests', icon: FlaskConical, to: '/fertilizer/soil', description: 'Soil sample results for each field.' },
  { key: 'fertility-plan', label: 'Fertility plan', icon: ClipboardList, to: '/fertilizer/plan', description: 'How much fertilizer each field needs.' },
  // In season, so it lives in Growing (Sam, 26 Oct 2026).
  { key: 'tissue-tests', label: 'Tissue tests', icon: Leaf, to: '/fertilizer/soil?tab=tissue', home: 'growing', description: 'Plant tissue results through the season.' },
  { key: 'fertilizer-prices', label: 'Fertilizer prices', icon: LineChart, to: '/fertilizer/prices', description: 'What fertilizer costs, and the price book.' },
  // Hauled out over winter, so Winter is home; also listed with the fertilizer views (Sam, 26 Oct 2026).
  { key: 'manure', label: 'Manure', icon: Container, to: '/fertilizer/manure', home: 'winter', description: 'Manure spread, and what it is worth in fertilizer.' },
  { key: 'fertilizer-savings', label: 'Fertilizer savings', icon: PiggyBank, to: '/fertilizer/savings', description: 'Ways to spend less on fertilizer.' },
  // "Isolation", not "Canola isolation": not every farm grows canola (Sam, 26 Oct 2026). The key stays: it is saved in menu prefs.
  { key: 'canola-isolation', label: 'Isolation', icon: Flower2, to: '/canola-reports', description: 'The mile around each seed field, and its field history.' },
  { key: 'next-year-plan', label: "Next year's plan", icon: Repeat, to: '/plan?tab=plan', home: 'winter', description: 'Which crop goes on which field next year.' },

  // Growing: crop care
  // No ?tab=: every tab on /chemicals is this view, so Inventory and Prices
  // light it up too, and the page opens on the tab last used (Sam, 24 Oct 2026).
  { key: 'chemicals', label: 'Chemicals', icon: FlaskConical, to: '/chemicals', description: 'Labels, the shed, prices, and the spray check.' },
  { key: 'scouting', label: 'Scouting', icon: Bug, to: '/scouting', description: 'What was found in each field, and when.' },
  { key: 'hail', label: 'Hail reports', icon: CloudHail, to: '/hail', description: 'Hail damage reports and claims.' },
  // Growing: irrigation
  { key: 'soil-moisture', label: 'Soil moisture', icon: Waves, to: '/irrigation', description: 'Soil moisture by field, and when to water.' },
  { key: 'river', label: 'River', icon: Waves, to: '/river', description: 'Oldman River levels and dam releases.' },
  { key: 'pivots-pumps', label: 'Pivots & pumps', icon: Info, to: '/irrigation-info', description: 'Pivot and pump details.' },

  // Harvest
  { key: 'bins', label: 'Bins', icon: GrainBin, to: '/harvest', description: 'What is in each bin, the bin map and moisture.' },
  { key: 'weigh-scale', label: 'Weigh scale', icon: Scale, to: '/weigh-scale', description: 'Weigh loads in from the field, and each truck and driver.' },
  { key: 'combine', label: 'Combine', icon: Tractor, to: '/combine', description: 'Combine settings, fixes and loss checks.' },
  { key: 'phi', label: 'Pre-harvest intervals', icon: Timer, to: '/pre-harvest', description: 'Days from the last spray until a field can be cut.' },
  { key: 'harvest-reports', label: 'Harvest reports', icon: FileText, to: '/harvest-reports', description: 'Bin temperatures, deliveries, yields and seed reports.' },
  { key: 'contracts', label: 'Contracts', icon: FileSignature, to: '/contracts', home: 'financials', description: 'Grain contracts, tickets and deliveries.' },
  { key: 'bale-checks', label: 'Bale checks', icon: Thermometer, to: '/feed?tab=bale-checks', home: 'cattle', tabOf: 'feed', description: 'The monthly bale temperature and moisture log.' },

  // Winter
  { key: 'grants', label: 'Grants', icon: Landmark, to: '/grants', description: 'Farm and cattle grants to apply for.' },

  // Financials
  { key: 'crop-money', label: 'Crop money', icon: CircleDollarSign, to: '/plan?tab=budget', home: 'financials', description: 'Budget, breakeven and actual costs by crop.' },
  { key: 'markets', label: 'Markets', icon: LineChart, to: '/markets', description: 'Crop prices, basis and price targets.' },
  { key: 'quickbooks', label: 'QuickBooks', icon: CircleDollarSign, to: '/quickbooks', description: "The farm's books, from QuickBooks." },
  { key: 'utilities', label: 'Utilities', icon: Plug, to: '/utilities', description: 'Power, gas and solar.' },

  // Cattle
  // Five views, each with tabs (Sam, 24 Oct 2026). Grazing, Pregnancy, Feed
  // records, Manifests and Grazing leases were views of their own; they are
  // tabs now, so their keys are gone and a saved bar slot holding one is
  // refilled like any other unknown key.
  { key: 'pastures', label: 'Pastures', icon: MapIcon, to: '/cattle', description: 'The pasture map, grazing plan and spray restrictions.' },
  { key: 'herd', label: 'Herd', icon: Beef, to: '/herd', description: 'Every animal, and pregnancy from the collars.' },
  { key: 'feed', label: 'Feed', icon: Container, to: '/feed', description: 'The winter feed plan, what was fed and bale checks.' },
  { key: 'cattle-sales', label: 'Sales & paperwork', icon: LineChart, to: '/cattle-markets', home: 'cattle', description: 'Auction prices, manifests and grazing leases.' },
  { key: 'cattle-settings', label: 'Cattle settings', icon: Settings, to: '/cattle-settings', description: 'Ranches, grazing and herd settings.' },
  { key: 'cattle-markets', label: 'Cattle markets', icon: LineChart, to: '/cattle-markets?tab=markets', home: 'cattle', tabOf: 'cattle-sales', description: 'Auction and futures prices for cattle.' },
  { key: 'pasture-insurance', label: 'Pasture insurance', icon: Umbrella, to: '/cattle-markets?tab=insurance', home: 'cattle', tabOf: 'cattle-sales', description: 'AFSC’s moisture deficiency forms, filled in. Due 28 February.' },

  // Equipment
  { key: 'equipment-service', label: 'Equipment service', icon: Tractor, to: '/equipment', home: 'equipment', description: 'The fleet, service due, repairs and truck inspections.' },
  // One view with Travel & trucking since 24 Oct 2026 (Sam); /hauling redirects to its tabs.
  { key: 'fuel-trucking', label: 'Fuel & trucking', icon: Fuel, to: '/fuel', home: 'equipment', description: 'Fuel prices and tanks, road distances and trucking costs.' },
  // Truck inspections folded into Equipment service (Sam, 24 Oct 2026): a
  // truck's Inspections tab, and the Truck inspection checklist. The key
  // 'truck-inspections' is retired; saved prefs naming it are ignored.
  { key: 'cameras', label: 'Cameras', icon: Video, to: '/cameras', description: 'The yard and shop cameras.' },

  // Tasks & calendar
  { key: 'tasks', label: 'Tasks', icon: CheckSquare, to: '/tasks', description: 'Your to-do list, and the crew’s.' },
  { key: 'checklists', label: 'Checklists', icon: ClipboardCheck, to: '/checklists', description: 'Checklists such as winterizing.' },
  { key: 'daybook', label: 'Day book', icon: BookOpen, to: '/daybook', description: 'What happened each day.' },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, to: '/calendar', description: 'The farm calendar.' },
  // Its own view right after Calendar, not a tab of it (24 Oct 2026): Monthly has
  // To do | Completed | Jobs tabs, and a tab inside a tab breaks the one-row rule.
  { key: 'monthly', label: 'Monthly jobs', icon: CalendarDays, to: '/monthly', description: 'What needs doing each month, and who has it.' },
  { key: 'meeting', label: 'Monday meeting', icon: Presentation, to: '/meeting', description: "This week's meeting agenda." },
  { key: 'conferences', label: 'Conferences', icon: CalendarDays, to: '/events', home: 'tasks-calendar', description: 'Conferences and farm shows.' },

  // Tools
  { key: 'weather', label: 'Weather', icon: Cloud, to: '/weather', description: 'The forecast, spray windows and frost.' },
  { key: 'reports', label: 'Reports', icon: FileText, to: '/reports', description: 'Every download the app makes, by section.' },
  { key: 'calculator', label: 'Calculator', icon: Calculator, to: '/calculator', description: 'Water, bushels, units and job costs.' },
  { key: 'contacts', label: 'Contacts', icon: Users, to: '/contacts', description: 'Phone numbers for people and suppliers.' },
  { key: 'missing', label: 'Missing info', icon: ListChecks, to: '/missing', description: 'What still needs filling in.' },

  // Settings
  { key: 'my-account', label: 'My account', icon: UserCircle, to: '/settings/account', description: 'Your profile, notifications, home screen and menu.' },
  { key: 'users-access', label: 'Users & access', icon: Users, to: '/settings/people', access: 'manager', description: 'Who uses the app, and what they can open.' },
  { key: 'connections', label: 'Connections', icon: Plug, to: '/settings/connections', access: 'manager', description: 'John Deere, QuickBooks and the other feeds.' },
  { key: 'farm-setup', label: 'Farm setup', icon: Tractor, to: '/settings/farm', access: 'admin', description: 'Your farm, and which parts of the app are on.' },

  // Listed in Winter (its home), Planting season and Financials since 28 Oct
  // 2026: Sam could only reach it by searching, and it is the page three
  // different conversations start from — the winter plan, what to buy seed for,
  // and what next year is worth.
  { key: 'rotation', label: 'Crop rotation plan', icon: Repeat, to: '/rotation', home: 'winter', description: 'Which crops could go on each field for the next four years.' },
  // Its two other tabs, listed in Winter beside it (Sam, 28 Oct 2026): both
  // were drawers on the plan, and a drawer nobody opens is a page nobody has.
  { key: 'rotation-advice', label: 'Rotation recommendations', icon: Sparkles, to: '/rotation?tab=advice', home: 'winter', tabOf: 'rotation', description: 'A rotation worked out for you, by agronomy, by profit or by soil.' },
  { key: 'rotation-rules', label: 'Rotation rules', icon: ListChecks, to: '/rotation?tab=rules', home: 'winter', tabOf: 'rotation', description: 'Return intervals, what may follow what, and which crops you still grow.' },
  // Not listed in any section (see EXTRA_VIEW_KEYS).
  { key: 'crop-compare', label: 'Compare crops', icon: ArrowLeftRight, to: '/crop-compare', home: 'winter', description: 'Which crop earns the most over its inputs.' },
]

/**
 * Pages the agreed tree leaves out but which still exist and are linked from
 * elsewhere (the old sidebar had both, under Crops). In no section's list;
 * offered in "All views" and named by the header trail under their home, so a
 * person who lands on one still sees where they are.
 */
export const EXTRA_VIEW_KEYS = ['crop-compare'] as const

export const MENU_VIEWS: ReadonlyMap<string, MenuView> = new Map(VIEW_LIST.map((v) => [v.key, v]))

/* --------------------------------------------------------------- sections */

/** The agreed tree, in default order: the seasons in year order among the year-round sections. */
const SECTION_DEFS: SectionDef[] = [
  { key: 'home', label: 'Home', icon: LayoutDashboard, to: '/dashboard', items: [] },
  // The map sits right under Home (Sam, 27 Oct 2026): it is what people open
  // first. Anyone who drags the menu into their own order keeps theirs.
  { key: 'map', label: 'Map', icon: MapIcon, to: '/map', items: [] },
  { key: 'fields', label: 'Fields', icon: Wheat, items: ['all-fields', 'crops', 'field-progress', 'leases'] },
  {
    key: 'planting',
    label: 'Planting season',
    icon: Sprout,
    items: [
      'seed-planter',
      // The fertilizer views under one heading, "Fertility" (Sam, 26 Oct 2026). Tissue
      // tests moved to Growing; Manure's home is Winter, listed here too.
      { heading: 'Fertility', icon: LandPlot, views: ['soil-tests', 'fertility-plan', 'fertilizer-prices', 'fertilizer-savings', 'manure'] },
      'canola-isolation',
      'next-year-plan',
      'rotation',
      'field-progress',
    ],
  },
  {
    key: 'growing',
    label: 'Growing season',
    icon: Sun,
    items: [
      // Spray restrictions are not here (Sam, 29 Oct 2026): they are about
      // where cattle may go, and they are listed under Cattle only.
      { heading: 'Crop care', icon: ShieldCheck, views: ['chemicals', 'scouting', 'tissue-tests', 'hail'] },
      {
        heading: 'Irrigation',
        icon: Droplets,
        views: [
          'soil-moisture',
          'river',
          'pivots-pumps',
        ],
      },
    ],
  },
  {
    key: 'harvest',
    label: 'Harvest season',
    icon: GrainBin,
    items: ['bins', 'weigh-scale', 'combine', 'phi', 'harvest-reports', 'contracts', 'bale-checks', 'field-progress'],
  },
  {
    key: 'winter',
    label: 'Winter season',
    icon: Snowflake,
    items: [
      'next-year-plan',
      { heading: 'Rotation', icon: RefreshCw, views: ['rotation', 'rotation-advice', 'rotation-rules'] },
      'manure',
      { view: 'crop-money', label: 'Budget' },
      'equipment-service',
      'grants',
      'conferences',
      'leases',
    ],
  },
  {
    key: 'financials',
    label: 'Financials',
    icon: CircleDollarSign,
    items: [
      'crop-money',
      'rotation',
      'markets',
      'contracts',
      'quickbooks',
      'leases',
      'utilities',
      'fuel-trucking',
      'grants',
      'cattle-markets',
      'pasture-insurance',
    ],
  },
  {
    key: 'cattle',
    label: 'Cattle',
    icon: Beef,
    items: [
      // Spray restrictions is a tab of Pastures only (Sam, 29 Oct 2026: "we
      // already have spray restrictions as a sub tab under pastures").
      'pastures',
      'herd',
      'feed',
      'cattle-sales',
      'cattle-settings',
    ],
  },
  {
    key: 'equipment',
    label: 'Equipment',
    icon: Tractor,
    items: ['equipment-service', 'fuel-trucking', 'combine', 'seed-planter', 'cameras'],
  },
  {
    key: 'tasks-calendar',
    label: 'Tasks & calendar',
    icon: CheckSquare,
    items: ['tasks', 'checklists', 'daybook', 'calendar', 'monthly', 'meeting', 'conferences'],
  },
  { key: 'tools', label: 'Tools', icon: Wrench, items: ['weather', 'reports', 'calculator', 'contacts', 'missing'] },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    pinned: true,
    items: ['my-account', 'users-access', 'connections', 'farm-setup'],
  },
]

/* ---------------------------------------------------------- resolved tree */

/** One appearance of a view in a section. */
export type MenuItem = {
  view: MenuView
  /** The name it goes by here (Budget in Winter is Crop money). */
  label: string
  /** The section the view belongs to. */
  home: string
  /** Listed here, but its home is another section: drawn with ↗ and that section's name. */
  shortcut: boolean
}

/** A run of views under one heading, or under none (`heading: null`). */
export type MenuGroup = { key: string; heading: string | null; icon: MenuIcon | null; items: MenuItem[] }

export type MenuSection = {
  key: string
  label: string
  icon: MenuIcon
  to?: string
  pinned?: boolean
  groups: MenuGroup[]
}

const entryKey = (e: Entry) => (typeof e === 'string' ? e : e.view)
const isHeading = (x: Entry | HeadingDef): x is HeadingDef => typeof x === 'object' && 'heading' in x

/** Every view key a section definition lists, headings flattened. */
const listedIn = (s: SectionDef): string[] =>
  s.items.flatMap((x) => (isHeading(x) ? x.views.map(entryKey) : [entryKey(x)]))

/**
 * Each view's home: the section marked on the view, or else the first section
 * in DEFAULT order to list it. Never the person's own order, or reordering the
 * menu would quietly move a view's home, and the header with it.
 */
export const VIEW_HOME: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>()
  for (const v of VIEW_LIST) {
    const home = v.home ?? SECTION_DEFS.find((s) => listedIn(s).includes(v.key))?.key
    if (home) out.set(v.key, home)
  }
  return out
})()

function buildSection(def: SectionDef): MenuSection {
  const groups: MenuGroup[] = []
  const item = (e: Entry): MenuItem | null => {
    const view = MENU_VIEWS.get(entryKey(e))
    if (!view) return null
    const home = VIEW_HOME.get(view.key) ?? def.key
    return { view, label: typeof e === 'string' ? view.label : e.label, home, shortcut: home !== def.key }
  }
  let loose: MenuGroup | null = null
  for (const x of def.items) {
    if (isHeading(x)) {
      loose = null
      groups.push({
        key: `${def.key}:${x.heading}`,
        heading: x.heading,
        icon: x.icon,
        items: x.views.map(item).filter((i): i is MenuItem => !!i),
      })
    } else {
      const i = item(x)
      if (!i) continue
      if (!loose) {
        loose = { key: `${def.key}:${groups.length}`, heading: null, icon: null, items: [] }
        groups.push(loose)
      }
      loose.items.push(i)
    }
  }
  return { key: def.key, label: def.label, icon: def.icon, to: def.to, pinned: def.pinned, groups }
}

/** The whole tree, every view in, in default order. Pinned Settings is last. */
export const MENU_SECTIONS: MenuSection[] = SECTION_DEFS.map(buildSection)
export const MENU_SECTION_BY_KEY: ReadonlyMap<string, MenuSection> = new Map(MENU_SECTIONS.map((s) => [s.key, s]))

/** A section's items, headings flattened. */
export const sectionItems = (s: MenuSection): MenuItem[] => s.groups.flatMap((g) => g.items)

/** Is this section a single link (Home, Map) rather than a list? */
export const isLeaf = (s: MenuSection): s is MenuSection & { to: string } => !!s.to

/** Where a section takes you: its page for a leaf, its landing page otherwise. */
export const sectionHref = (s: MenuSection): string => s.to ?? `/menu/${s.key}`

/** The extra views, as items under their home section. */
export const EXTRA_ITEMS: MenuItem[] = EXTRA_VIEW_KEYS.map((k) => {
  const view = MENU_VIEWS.get(k)!
  return { view, label: view.label, home: VIEW_HOME.get(k)!, shortcut: false }
})

/* ------------------------------------------------------------- visibility */

/** Who is looking: decides which views exist for them at all. */
export type MenuAccess = (target: { to: string; access?: 'manager' | 'admin' }) => boolean

/**
 * Drop what a person cannot see, then anything left empty.
 *
 * `canSee` is access (denied views, switched-off features, role); `hidden` is
 * the person's own hiding on this device. A heading with no views left
 * disappears, and so does a section, so nobody taps into an empty list. A leaf
 * section stays while its page can be seen. Pinned sections ignore `hidden`:
 * Settings is where you go to undo a menu change.
 */
export function filterSections(
  sections: MenuSection[],
  canSee: MenuAccess,
  hidden: ReadonlySet<string> = new Set(),
): MenuSection[] {
  const out: MenuSection[] = []
  for (const s of sections) {
    const hideable = !s.pinned
    if (isLeaf(s)) {
      if (canSee({ to: s.to }) && !(hideable && hidden.has(s.key))) out.push(s)
      continue
    }
    if (hideable && hidden.has(s.key)) continue
    const groups = s.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => canSee(i.view) && !(hideable && hidden.has(i.view.key))) }))
      .filter((g) => g.items.length > 0)
    if (groups.length > 0) out.push({ ...s, groups })
  }
  return out
}

/* ------------------------------------------------------------------ prefs */

export type MenuDevice = 'desktop' | 'phone'

export type MenuDevicePrefs = {
  order?: string[]
  hidden?: string[]
  /** The old four-slot bar (before 29 Oct 2026). Read, never used: everyone moved to `buttons`. */
  bar?: string[]
  /** The phone bar's five buttons, left to right. */
  buttons?: string[]
}

/** users.menu_prefs. Everything optional: an empty object is "never touched it". */
export type MenuPrefs = {
  /**
   * false: they chose the old menu. Missing means the season menu, the default
   * for everyone since 26 Oct 2026 (Sam). Read it through menuEnabled().
   */
  enabled?: boolean
  desktop?: { order?: string[]; hidden?: string[] }
  phone?: MenuDevicePrefs
}

/** How many buttons the phone bar has. */
export const PHONE_BAR_SLOTS = 5

/**
 * Buttons that are not a place: Search (the search and ask sheet), Add (the
 * quick forms) and Menu (the whole menu, once called More).
 */
export const BAR_TOOLS = ['search', 'add', 'menu'] as const
export type BarTool = (typeof BAR_TOOLS)[number]
export const BAR_TOOL_LABEL: Record<BarTool, string> = { search: 'Search', add: 'Add', menu: 'Menu' }
const isTool = (k: string): k is BarTool => (BAR_TOOLS as readonly string[]).includes(k)

/**
 * Search, Dashboard, Add in the middle, Tasks, Menu (Sam, 29 Oct 2026:
 * "have that as the default"; Menu and Tasks swapped later that day). Saved as `buttons`, so the four-slot bars
 * saved before it do not hold anyone on the old layout.
 */
export const DEFAULT_PHONE_BAR = ['search', 'home', 'add', 'tasks', 'menu']

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Read whatever is in the column into a safe shape. It is jsonb that an older
 * app, or a hand-written SQL update, may have filled; a wrong type anywhere
 * means "not set", never a crash in the menu.
 */
export function readMenuPrefs(raw: unknown): MenuPrefs {
  if (!isObject(raw)) return {}
  const out: MenuPrefs = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  // `hidden` stays missing when it was never saved, rather than becoming [],
  // so withCarriedHidden can tell "never chose" from "chose to hide nothing".
  const device = (d: Record<string, unknown>) => ({
    order: strings(d.order),
    ...(Array.isArray(d.hidden) ? { hidden: strings(d.hidden) } : {}),
  })
  if (isObject(raw.desktop)) out.desktop = device(raw.desktop)
  if (isObject(raw.phone)) {
    out.phone = { ...device(raw.phone), bar: strings(raw.phone.bar) }
    if (Array.isArray(raw.phone.buttons)) out.phone.buttons = strings(raw.phone.buttons)
  }
  return out
}

/**
 * Does this person get the season menu? Yes unless they picked the old one
 * (Sam, 26 Oct 2026: go ahead for everyone, after he and Derek tried it).
 */
export const menuEnabled = (prefs: MenuPrefs): boolean => prefs.enabled !== false

/* ------------------------------------------------- carried over from nav.ts */

/**
 * What each old-menu entry (lib/nav.ts, keyed as users.nav_prefs and
 * denied_views are) led to in the season menu: view keys, or a leaf section's
 * key for Home and Map.
 *
 * A group's own entry is empty: hiding a group in the old menu hid everything
 * under it, and its children below say what that was. Tab views go with the
 * page they are a tab of (Bale checks with Feed). nav-tree.test.ts checks that
 * every old entry is here or in OLD_NAV_UNMAPPED.
 */
export const OLD_NAV_VIEWS: Readonly<Record<string, readonly string[]>> = {
  '/dashboard': ['home'],
  '/map': ['map'],
  '/fields': ['all-fields'],
  '/crop': [],
  '/plan': ['crop-money', 'next-year-plan'],
  '/quickbooks': ['quickbooks'],
  '/rotation': ['rotation'],
  '/crop-compare': ['crop-compare'],
  '/canola-reports': ['canola-isolation'],
  '/crops': ['crops'],
  '/markets': ['markets'],
  '/contracts': ['contracts'],
  '/scouting': ['scouting'],
  '/leases': ['leases'],
  '/work': [],
  '/tasks': ['tasks'],
  '/daybook': ['daybook'],
  '/checklists': ['checklists'],
  '/weather': ['weather'],
  '/dates': [],
  '/calendar': ['calendar'],
  '/monthly': ['monthly'],
  '/events': ['conferences'],
  '/meeting': ['meeting'],
  // The Harvest group's parent is the bins page, and so is its first child.
  '/harvest': ['bins'],
  '/weigh-scale': ['weigh-scale'],
  '/pre-harvest': ['phi'],
  '/harvest-reports': ['harvest-reports'],
  '/water': [],
  '/irrigation': ['soil-moisture'],
  '/river': ['river'],
  '/irrigation-info': ['pivots-pumps'],
  '/inputs': [],
  '/chemicals': ['chemicals'],
  '/spraying': ['chemicals'],
  '/fertilizer': ['soil-tests', 'fertility-plan', 'tissue-tests', 'fertilizer-prices', 'manure', 'fertilizer-savings'],
  '/fuel': ['fuel-trucking'],
  '/utilities': ['utilities'],
  '/livestock': [],
  '/cattle': ['pastures'],
  '/herd': ['herd'],
  '/feed': ['feed', 'bale-checks'],
  '/cattle-markets': ['cattle-sales', 'cattle-markets', 'pasture-insurance'],
  '/cattle-settings': ['cattle-settings'],
  '/equipment': ['equipment-service'],
  '/combine': ['combine'],
  '/planter': ['seed-planter'],
  '/fuel?tab=distances': ['fuel-trucking'],
  '/cameras': ['cameras'],
  '/reports': ['reports'],
  '/contacts': ['contacts'],
  '/calculator': ['calculator'],
  '/grants': ['grants'],
}

/** Old entries deliberately not carried over: Settings is never hidden. */
export const OLD_NAV_UNMAPPED: readonly string[] = ['/settings']

/** An old-menu entry, as resolveNav (lib/nav.ts) hands it back. */
export type OldNavEntry = { to: string; children?: { to: string }[] }

/**
 * The season-menu keys to hide for someone who hid things in the old menu
 * (Sam, 26 Oct 2026), from resolveNav's visible and hidden lists.
 *
 * A view is hidden only when every old entry that led to it was hidden: Fuel &
 * trucking was under both Inputs and Equipment, so hiding Inputs alone leaves
 * it. Views the old menu never had stay shown. A section left with nothing is
 * hidden too, so the Menu panel shows its switch off. Settings never hides.
 *
 * The old sidebar only ever hid whole entries, but `savedHidden` (the raw
 * nav_prefs.hidden) may name a child such as '/quickbooks' too, and that
 * counts as hidden even though resolveNav drops it.
 */
export function carryOverHidden(
  old: { visible: OldNavEntry[]; hidden: OldNavEntry[] },
  savedHidden: readonly string[] = [],
): string[] {
  const childHidden = new Set(savedHidden)
  const flat = (entries: OldNavEntry[]) => entries.flatMap((e) => [e, ...(e.children ?? [])])
  const shown = flat(old.visible).filter((e) => !childHidden.has(e.to) || old.visible.includes(e as OldNavEntry))
  const gone = [...flat(old.hidden), ...flat(old.visible).filter((e) => !shown.includes(e))]
  if (gone.length === 0) return []
  const reached = (entries: OldNavEntry[]) => new Set(entries.flatMap((e) => OLD_NAV_VIEWS[e.to] ?? []))
  const kept = reached(shown)
  const pinned = new Set(
    MENU_SECTIONS.filter((s) => s.pinned).flatMap((s) => [s.key, ...sectionItems(s).map((i) => i.view.key)]),
  )
  const hidden = new Set([...reached(gone)].filter((k) => !kept.has(k) && !pinned.has(k)))
  for (const s of MENU_SECTIONS) {
    if (s.pinned || isLeaf(s)) continue
    if (sectionItems(s).every((i) => hidden.has(i.view.key))) hidden.add(s.key)
  }
  return [...hidden]
}

/**
 * Fill in a device's hidden list from the old menu where the person never set
 * one. The old menu had one list for both screens, so it goes to both. Read
 * time only: the Menu panel saves what it shows, so their first change there
 * writes these down, and from then on their own menu_prefs win.
 */
export function withCarriedHidden(prefs: MenuPrefs, carried: string[]): MenuPrefs {
  if (carried.length === 0) return prefs
  const out = { ...prefs }
  if (out.desktop?.hidden === undefined) out.desktop = { ...out.desktop, hidden: carried }
  if (out.phone?.hidden === undefined) out.phone = { ...out.phone, hidden: carried }
  return out
}

export type ResolvedMenu = {
  /** In the person's order, with their hidden sections and views taken out. Pinned not included. */
  sections: MenuSection[]
  /** Sections they hid on this device, as they would otherwise appear. */
  hiddenSections: MenuSection[]
  pinned: MenuSection[]
}

/**
 * Section keys in the person's order: saved keys that still exist first, then
 * any section the saved order has never heard of, in default order. Pinned
 * sections are never in it.
 */
export function sectionOrder(sections: MenuSection[], saved: string[] | undefined): string[] {
  const movable = sections.filter((s) => !s.pinned).map((s) => s.key)
  const known = new Set(movable)
  const kept = [...new Set(strings(saved))].filter((k) => known.has(k))
  const seen = new Set(kept)
  return [...kept, ...movable.filter((k) => !seen.has(k))]
}

/**
 * Apply one device's prefs to the sections a person may see (already through
 * filterSections with their access). Defensive, like resolveNav: keys that no
 * longer exist are dropped, and sections the saved order has never heard of
 * are appended, visible, so shipping a new section never hides it from anyone.
 */
export function resolveMenu(allowed: MenuSection[], prefs: MenuDevicePrefs | undefined): ResolvedMenu {
  const byKey = new Map(allowed.map((s) => [s.key, s]))
  const ordered = sectionOrder(allowed, prefs?.order).map((k) => byKey.get(k)!)
  const hidden = new Set(strings(prefs?.hidden))
  return {
    sections: filterSections(ordered, () => true, hidden),
    hiddenSections: ordered.filter((s) => hidden.has(s.key)),
    pinned: allowed.filter((s) => s.pinned),
  }
}

/**
 * Move a section one place up (-1) or down (+1) among the ones the person can
 * see, keeping every other key where it was. The saved order covers every
 * section, the farm's switched-off ones included, so turning Cattle back on
 * puts it back where it was; and an arrow that swapped with an invisible
 * neighbour would look like it did nothing.
 */
export function moveSection(fullOrder: string[], visible: string[], key: string, by: -1 | 1): string[] {
  const shown = fullOrder.filter((k) => visible.includes(k))
  const i = shown.indexOf(key)
  const j = i + by
  if (i < 0 || j < 0 || j >= shown.length) return fullOrder
  ;[shown[i], shown[j]] = [shown[j], shown[i]]
  let n = 0
  return fullOrder.map((k) => (visible.includes(k) ? shown[n++] : k))
}

/** What a phone bar slot shows. */
export type BarSlot =
  | { kind: 'section'; key: string; section: MenuSection }
  | { kind: 'view'; key: string; item: MenuItem }
  | { kind: 'tool'; key: BarTool }

/**
 * The phone bar's five buttons.
 *
 * A slot is a tool (BAR_TOOLS), a section key or a view key. Menu is always
 * on the bar, in the last slot if they left it off: without it a phone has no
 * way to the rest of the app. A place that cannot be shown (Cattle
 * switched off for the farm, a view the person hid from their phone) is filled
 * with the next section in their order not already on the bar, so the bar
 * never has a hole and never shows the same thing twice.
 */
export function resolveBar(menu: ResolvedMenu, saved: string[] | undefined): BarSlot[] {
  const sections = [...menu.sections, ...menu.pinned]
  const secByKey = new Map(sections.map((s) => [s.key, s]))
  const itemByKey = new Map<string, MenuItem>()
  for (const s of sections) {
    for (const i of sectionItems(s)) {
      const had = itemByKey.get(i.view.key)
      if (!had || (had.shortcut && !i.shortcut)) itemByKey.set(i.view.key, { ...i, label: i.view.label })
    }
  }
  const wanted = strings(saved).length ? strings(saved) : DEFAULT_PHONE_BAR
  const used = new Set<string>()
  const slots: (BarSlot | null)[] = []
  for (const key of wanted.slice(0, PHONE_BAR_SLOTS)) {
    if (isTool(key) && !used.has(key)) {
      used.add(key)
      slots.push({ kind: 'tool', key })
      continue
    }
    const sec = secByKey.get(key)
    const item = itemByKey.get(key)
    if (used.has(key) || (!sec && !item)) {
      slots.push(null)
      continue
    }
    used.add(key)
    slots.push(sec ? { kind: 'section', key, section: sec } : { kind: 'view', key, item: item! })
  }
  while (slots.length < PHONE_BAR_SLOTS) slots.push(null)
  const spare = menu.sections.filter((s) => !used.has(s.key))
  const out: BarSlot[] = []
  for (const slot of slots) {
    if (slot) out.push(slot)
    else {
      const next = spare.shift()
      if (next) out.push({ kind: 'section', key: next.key, section: next })
    }
  }
  if (!out.some((s) => s.key === 'menu')) out.splice(Math.min(out.length, PHONE_BAR_SLOTS - 1), 1, { kind: 'tool', key: 'menu' })
  return out
}

/* --------------------------------------------------------------- location */

export type MenuMatch = {
  /** The section to name: a matched view's HOME, whichever section listed it. */
  section: MenuSection
  /** The view; null on a section page, a leaf section, or a tab the menu has no view for. */
  item: MenuItem | null
}

const splitTo = (to: string) => {
  const q = to.indexOf('?')
  return { path: q < 0 ? to : to.slice(0, q), params: new URLSearchParams(q < 0 ? '' : to.slice(q + 1)) }
}

/**
 * Which view the current address is.
 *
 * The path must be the view's path or under it (/fields/12 is All fields).
 * Ranked:
 *  3. the path and every param the view names (`?tab=`) matching;
 *  2. a view on that path that names no params (Calculator on /calculator?tab=water);
 *  1. a view on that path whose `?tab=` does not match: only its SECTION is
 *     named, since the page is showing something the menu has no entry for.
 * A longer path beats a shorter one at the same rank; a tie goes to the first
 * in default order. Shortcuts never compete: a view is matched once, at home.
 * Param values compare case-insensitively, as Settings reads its tabs.
 */
export function matchLocation(pathname: string, search: string): MenuMatch | null {
  const menuPage = /^\/menu\/([^/]+)/.exec(pathname)
  if (menuPage) {
    const s = MENU_SECTION_BY_KEY.get(decodeURIComponent(menuPage[1]))
    return s ? { section: s, item: null } : null
  }
  const here = new URLSearchParams(search)
  const under = (path: string) => pathname === path || pathname.startsWith(path + '/')
  let best: { rank: number; len: number; match: MenuMatch } | null = null
  const consider = (rank: number, len: number, match: MenuMatch) => {
    if (!best || rank > best.rank || (rank === best.rank && len > best.len)) best = { rank, len, match }
  }

  for (const s of MENU_SECTIONS) if (isLeaf(s) && under(s.to)) consider(2, s.to.length, { section: s, item: null })
  const homes = [...MENU_SECTIONS.flatMap((s) => sectionItems(s).filter((i) => !i.shortcut)), ...EXTRA_ITEMS]
  for (const item of homes) {
    const { path, params } = splitTo(item.view.to)
    if (!under(path)) continue
    const section = MENU_SECTION_BY_KEY.get(item.home)!
    const keys = [...params.keys()]
    if (keys.length === 0) {
      consider(2, path.length, { section, item })
      continue
    }
    const all = keys.every((k) => (here.get(k) ?? '').toLowerCase() === (params.get(k) ?? '').toLowerCase())
    if (all) consider(3, path.length, { section, item })
    else consider(1, path.length, { section, item: null })
  }
  return (best as { match: MenuMatch } | null)?.match ?? null
}

/** Every view anyone could be offered, once each, under its own name, in default order: for "All views". */
export function allItems(): MenuItem[] {
  const seen = new Set<string>()
  const out: MenuItem[] = []
  for (const s of MENU_SECTIONS) {
    for (const i of sectionItems(s)) {
      if (seen.has(i.view.key)) continue
      seen.add(i.view.key)
      out.push({ ...i, label: i.view.label, shortcut: false })
    }
  }
  for (const i of EXTRA_ITEMS) if (!seen.has(i.view.key)) out.push(i)
  return out
}
