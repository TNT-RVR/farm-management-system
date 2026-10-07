import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CheckCircle2, Circle, ImageUp, MapPin, RotateCcw } from 'lucide-react'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'
import {
  FEATURES,
  featureOn,
  settingsOf,
  useBrand,
  useFarmSetup,
  useSaveFarmSetup,
  type FarmSetup,
} from '@/lib/farm-setup'
import { useRanches } from '@/lib/ranches'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { cn } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'
import { FRESH_OFF } from '@/lib/farm-context'
import { WEATHER_SITES, type WeatherSite } from '@/lib/weatherSites'
import { PillTabs } from '@/components/PillTabs'
import {
  CompanyMark,
  GroupBadge,
  KEY_GROUPS,
  SetupKeys,
  groupState,
  useKeyStatus,
} from '@/pages/settings/SetupKeys'
import { CustomizingGuide } from '@/pages/settings/CustomizingGuide'

const PROVINCES = [
  ['AB', 'Alberta'],
  ['BC', 'British Columbia'],
  ['SK', 'Saskatchewan'],
  ['MB', 'Manitoba'],
  ['ON', 'Ontario'],
  ['QC', 'Quebec'],
  ['NB', 'New Brunswick'],
  ['NS', 'Nova Scotia'],
  ['PE', 'Prince Edward Island'],
  ['NL', 'Newfoundland and Labrador'],
  ['YT', 'Yukon'],
  ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'],
  ['US', 'United States'],
  ['OTHER', 'Somewhere else'],
] as const

const TIME_ZONES = [
  'America/Edmonton',
  'America/Regina',
  'America/Winnipeg',
  'America/Vancouver',
  'America/Toronto',
  'America/Halifax',
  'America/St_Johns',
  'America/Denver',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'America/Phoenix',
  'Pacific/Auckland',
  'Australia/Sydney',
  'Europe/London',
]

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const card = 'rounded-lg border border-gray-200 bg-white p-4'
const field = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm'
const label = 'text-xs font-medium text-gray-600'

/** Tap the map to put the farm on it. Opens on the current centre. */
function LocationPicker({
  value,
  onChange,
}: {
  value: [number, number]
  onChange: (v: [number, number]) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const pin = useRef<maplibregl.Marker | null>(null)
  const changed = useRef(onChange)
  useEffect(() => {
    changed.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!box.current) return
    const m = new maplibregl.Map({
      container: box.current,
      style: SATELLITE_STYLE,
      center: value,
      zoom: 9,
      attributionControl: { compact: true },
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    pin.current = new maplibregl.Marker({ color: '#15803d' }).setLngLat(value).addTo(m)
    m.on('click', (e) => {
      const v: [number, number] = [Number(e.lngLat.lng.toFixed(4)), Number(e.lngLat.lat.toFixed(4))]
      pin.current?.setLngLat(v)
      changed.current(v)
    })
    map.current = m
    return () => m.remove()
    // Created once; later moves come from the click above or the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    pin.current?.setLngLat(value)
  }, [value])

  return <div ref={box} className="h-56 w-full overflow-hidden rounded-md border border-gray-200" />
}

/**
 * What is done and what is left, at the top of setup. The essentials are what
 * the app needs to be this farm's at all; the rest are connections a farm may
 * or may not use, counted but not demanded.
 */
/** The parts of Farm setup, each its own view. `?part=` in the address opens one. */
const PARTS = [
  { key: 'overview', label: 'Overview' },
  { key: 'farm', label: 'Your farm' },
  { key: 'features', label: 'Parts of the app' },
  { key: 'connections', label: 'Connections' },
  { key: 'customize', label: 'Fitting it to your farm' },
] as const
type Part = (typeof PARTS)[number]['key']
const isPart = (v: string | null): v is Part => PARTS.some((p) => p.key === v)

/**
 * What is done and what is left. The essentials are what the app needs to be
 * this farm's at all; the connections are ones a farm may or may not use,
 * shown company by company but not demanded.
 */
function SetupOverview({ setup, go }: { setup: FarmSetup | null; go: (p: Part) => void }) {
  const { data: keys } = useKeyStatus()
  const isSet = (env: string) => Boolean(keys?.find((k) => k.env === env)?.source)
  const items: { label: string; done: boolean; where: Part }[] = [
    { label: 'Farm name and logo', done: Boolean(setup?.farm_name), where: 'farm' },
    { label: 'Where the farm is', done: setup?.map_center_lat != null, where: 'farm' },
    {
      label: 'A few words about the farm (for the AI features)',
      done: Boolean(setup?.farm_description?.trim()),
      where: 'farm',
    },
    { label: 'Site address', done: isSet('SITE_URL'), where: 'connections' },
    { label: 'AI key', done: isSet('ANTHROPIC_API_KEY'), where: 'connections' },
    { label: 'Background jobs key', done: isSet('JOB_WORKER_KEY'), where: 'connections' },
  ]
  const done = items.filter((i) => i.done).length
  const companies = KEY_GROUPS.filter((g) => g !== 'Your site' && g !== 'AI features')
  const connected = companies.filter((g) => groupState(g, keys).state === 'connected').length

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Setup checklist</h2>
          <span
            className={cn(
              'text-xs font-medium',
              done === items.length ? 'text-green-700' : 'text-gray-500',
            )}
          >
            {done} of {items.length} done
          </span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {items.map((i) => (
            <li key={i.label}>
              <button
                onClick={() => go(i.where)}
                className="flex items-center gap-2 text-left text-sm text-gray-700 hover:text-brand-700"
              >
                {i.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-gray-300" />
                )}
                <span className={cn(i.done && 'text-gray-500')}>{i.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Connections</h2>
          <span className="text-xs text-gray-500">
            {keys ? `${connected} of ${companies.length} connected · all optional` : 'Checking…'}
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {companies.map((g) => (
            <li key={g}>
              <button
                onClick={() => go('connections')}
                className="flex w-full items-center gap-2.5 rounded-md border border-gray-200 px-2.5 py-2 text-left hover:border-gray-300 hover:bg-gray-50"
              >
                <CompanyMark group={g} className="h-7 w-7 text-xs" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                  {g}
                </span>
                {keys && <GroupBadge {...groupState(g, keys)} />}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * Settings → Farm setup: the farm's own answers, so the app fits it without
 * anyone editing code. Admins only (the database enforces it too).
 *
 * Profile and location save together from one button; feature switches save
 * the moment they are flipped, because each one is a single decision.
 */
export function FarmSetupPanel() {
  const { data: setup, isLoading } = useFarmSetup()
  const save = useSaveFarmSetup()
  const brand = useBrand()
  const { data: ranches } = useRanches()
  const [draft, setDraft] = useState<Partial<FarmSetup> | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [search, setSearch] = useSearchParams()
  const fromUrl = search.get('part')
  const part: Part = isPart(fromUrl) ? fromUrl : 'overview'
  const go = (p: Part) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('part', p)
        return next
      },
      { replace: true },
    )

  // The form starts from the saved row (or the brand.ts fallback on a fresh
  // install) and only becomes a draft once something is changed.
  const base: Partial<FarmSetup> = setup ?? {
    farm_name: BRAND.farmName,
    app_name: BRAND.appName,
    short_name: BRAND.shortName,
    logo_url: null,
    map_center_lng: BRAND.mapCenter[0],
    map_center_lat: BRAND.mapCenter[1],
    time_zone: 'America/Edmonton',
    province: 'AB',
    units: 'metric',
    farm_description: '',
    features: {},
  }
  const v = { ...base, ...draft }
  const set = (patch: Partial<FarmSetup>) => setDraft((d) => ({ ...(d ?? {}), ...patch }))
  const dirty = draft != null && Object.keys(draft).length > 0
  const features = (setup?.features ?? FRESH_OFF) as Record<string, boolean>
  // What each field falls back to when left empty, shown as its placeholder.
  const settings = settingsOf(null)

  // The forecast places as they will be saved: the draft's, the saved list,
  // or — until someone edits — the built-in list, copied so editing starts
  // from what the Weather page shows today.
  const usingSaved = Array.isArray(v.forecast_sites)
  const places: WeatherSite[] = usingSaved
    ? (v.forecast_sites as WeatherSite[])
    : v.map_center_lat != null && v.map_center_lng != null
      ? [
          {
            name: v.farm_name || 'The farm',
            lat: v.map_center_lat,
            lng: v.map_center_lng,
            note: 'Farm location',
          },
        ]
      : WEATHER_SITES
  const setPlace = (i: number, patch: Partial<WeatherSite>) =>
    set({ forecast_sites: places.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  if (isLoading) return <p className="p-6 text-sm text-gray-400">Loading…</p>

  const uploadLogo = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `logo-${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('branding')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      const { data } = supabase.storage.from('branding').getPublicUrl(path)
      set({ logo_url: data.publicUrl })
    } catch (e) {
      setUploadError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const toggle = (key: string, on: boolean) =>
    save.mutate({ ...(setup ? {} : base), features: { ...features, [key]: on } })

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      {!setup && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Welcome. This farm hasn&apos;t been set up yet — start with <strong>Your farm</strong> and
          save.
        </p>
      )}

      <PillTabs tabs={PARTS} value={part} onChange={go} />

      {part === 'overview' && <SetupOverview setup={setup ?? null} go={go} />}

      {part === 'farm' && (
        <>
          {/* Stacked columns, so a short card leaves no gap beside a tall one. */}
          <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
            <section id="setup-farm" className={card}>
              <h2 className="text-sm font-semibold text-gray-900">Your farm</h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={label}>
                  Farm name
                  <input
                    className={field}
                    value={v.farm_name ?? ''}
                    onChange={(e) => set({ farm_name: e.target.value })}
                  />
                </label>
                <label className={label}>
                  App name
                  <input
                    className={field}
                    value={v.app_name ?? ''}
                    onChange={(e) => set({ app_name: e.target.value })}
                  />
                </label>
                <label className={label}>
                  Short name{' '}
                  <span className="font-normal text-gray-400">(under the phone icon)</span>
                  <input
                    className={field}
                    maxLength={12}
                    value={v.short_name ?? ''}
                    onChange={(e) => set({ short_name: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <img
                  src={v.logo_url || brand.logo}
                  alt=""
                  className="h-12 w-auto rounded border border-gray-100 bg-white p-1"
                />
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <ImageUp className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload a logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                  />
                </label>
                {v.logo_url && (
                  <button
                    onClick={() => set({ logo_url: null })}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Use the default
                  </button>
                )}
                {uploadError && <span className="text-xs text-red-600">{uploadError}</span>}
              </div>
              <HelpNote
                className="mt-2"
                summary="The name and icon on a phone's home screen change after the next app update."
              >
                The installed app&apos;s name and icon are fixed when the app is built, so they
                follow on the next deploy. Everything inside the app — the header, the login page,
                printouts — changes as soon as you save.
              </HelpNote>
            </section>

            <section id="setup-location" className={card}>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <MapPin className="h-4 w-4 text-brand-700" /> Where the farm is
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Tap the middle of the farm. Maps open here.
              </p>
              <div className="mt-2">
                <LocationPicker
                  value={[
                    v.map_center_lng ?? BRAND.mapCenter[0],
                    v.map_center_lat ?? BRAND.mapCenter[1],
                  ]}
                  onChange={([lng, lat]) => set({ map_center_lng: lng, map_center_lat: lat })}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={label}>
                  Province or state
                  <Select
                    className="mt-1"
                    value={v.province ?? 'AB'}
                    onChange={(p) => set({ province: p })}
                    options={PROVINCES.map(([value, name]) => ({ value, label: name }))}
                  />
                </label>
                <label className={label}>
                  Time zone
                  <Select
                    className="mt-1"
                    value={v.time_zone ?? 'America/Edmonton'}
                    onChange={(t) => set({ time_zone: t })}
                    options={[...new Set([v.time_zone ?? 'America/Edmonton', ...TIME_ZONES])].map(
                      (t) => ({
                        value: t,
                        label: t.replace('America/', '').replace('_', ' '),
                      }),
                    )}
                  />
                </label>
                <div className={label}>
                  Units
                  <div className="mt-1 flex gap-1">
                    {(['imperial', 'metric'] as const).map((u) => (
                      <button
                        key={u}
                        onClick={() => set({ units: u })}
                        className={cn(
                          'flex-1 rounded-md border px-2 py-1.5 text-sm',
                          v.units === u
                            ? 'border-brand-700 bg-brand-700 text-white'
                            : 'border-gray-300 bg-white text-gray-700',
                        )}
                      >
                        {u === 'imperial' ? 'Imperial' : 'Metric'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <HelpNote
                className="mt-2"
                summary="Units are the default; anyone can still switch their own view."
              >
                The farm&apos;s units are what every screen starts in. A person who flips the units
                toggle on an irrigation screen keeps their own choice on their own device.
              </HelpNote>
            </section>

            <section id="setup-forecast" className={card}>
              <h2 className="text-sm font-semibold text-gray-900">Forecast places</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                The places on the Weather page. The first is the one used where only one fits, like
                the meeting&apos;s week.
              </p>
              <ul className="mt-2 space-y-2">
                {places.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-end gap-2">
                    <label className={cn(label, 'min-w-0 flex-1 basis-40')}>
                      Name
                      <input
                        className={field}
                        value={p.name}
                        onChange={(e) => setPlace(i, { name: e.target.value })}
                      />
                    </label>
                    <label className={cn(label, 'w-28')}>
                      Latitude
                      <input
                        className={field}
                        inputMode="decimal"
                        value={p.lat}
                        onChange={(e) => setPlace(i, { lat: Number(e.target.value) })}
                      />
                    </label>
                    <label className={cn(label, 'w-28')}>
                      Longitude
                      <input
                        className={field}
                        inputMode="decimal"
                        value={p.lng}
                        onChange={(e) => setPlace(i, { lng: Number(e.target.value) })}
                      />
                    </label>
                    <button
                      onClick={() => set({ forecast_sites: places.filter((_, j) => j !== i) })}
                      className="pb-1.5 text-xs text-gray-400 hover:text-red-600"
                      aria-label={`Remove ${p.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <button
                  onClick={() =>
                    set({
                      forecast_sites: [
                        ...places,
                        {
                          name: v.farm_name || 'The farm',
                          lat: v.map_center_lat ?? 0,
                          lng: v.map_center_lng ?? 0,
                          note: 'Farm location',
                        },
                      ],
                    })
                  }
                  className="font-medium text-brand-700 hover:underline"
                >
                  Add the farm&apos;s location
                </button>
                <button
                  onClick={() =>
                    set({ forecast_sites: [...places, { name: '', lat: 0, lng: 0, note: '' }] })
                  }
                  className="font-medium text-brand-700 hover:underline"
                >
                  Add a place
                </button>
                {usingSaved && (
                  <button
                    onClick={() => set({ forecast_sites: null })}
                    className="text-gray-500 hover:text-gray-800"
                  >
                    Just the farm&apos;s location
                  </button>
                )}
              </div>
            </section>

            <section id="setup-names" className={cn(card, 'lg:col-span-2')}>
              <h2 className="text-sm font-semibold text-gray-900">Names and defaults</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                What the screens call your suppliers and equipment, and what they assume when
                nothing else says.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                <label className={label}>
                  Fertilizer and chemical retailer
                  <input
                    className={field}
                    placeholder={settings.retailerName}
                    value={v.retailer_name ?? ''}
                    onChange={(e) => set({ retailer_name: e.target.value })}
                  />
                </label>
                <label className={label}>
                  Support contact email
                  <input
                    className={field}
                    type="email"
                    placeholder="who people email about this app"
                    value={v.support_email ?? ''}
                    onChange={(e) => set({ support_email: e.target.value })}
                  />
                </label>
                <label className={label}>
                  Irrigation district
                  <input
                    className={field}
                    placeholder={settings.districtName}
                    value={v.irrigation_district_name ?? ''}
                    onChange={(e) => set({ irrigation_district_name: e.target.value })}
                  />
                </label>
                <label className={label}>
                  Combine model
                  <input
                    className={field}
                    placeholder="e.g. CR9090, S780, 8250"
                    value={v.combine_model ?? ''}
                    onChange={(e) => set({ combine_model: e.target.value })}
                  />
                </label>
                <label className={label}>
                  Main ranch{' '}
                  <span className="font-normal text-gray-400">(used where only one fits)</span>
                  <Select
                    className="mt-1"
                    value={v.main_ranch_id ?? ''}
                    onChange={(id) => set({ main_ranch_id: id || null })}
                    options={[
                      { value: '', label: 'The first ranch' },
                      ...(ranches ?? []).map((r) => ({ value: r.id, label: r.name })),
                    ]}
                  />
                </label>
                <label className={label}>
                  Calves usually sold in
                  <span className="block text-[11px] font-normal text-gray-400">
                    Each ranch can set its own in Cattle settings; this is for a ranch that
                    hasn&apos;t.
                  </span>
                  <Select
                    className="mt-1"
                    value={String(v.calf_sale_month ?? settings.calfSaleMonth)}
                    onChange={(m) => set({ calf_sale_month: Number(m) })}
                    options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                  />
                </label>
                <label className={label}>
                  At about (lb)
                  <input
                    className={field}
                    inputMode="numeric"
                    value={v.calf_sale_weight_lb ?? settings.calfSaleWeightLb}
                    onChange={(e) => set({ calf_sale_weight_lb: Number(e.target.value) || null })}
                  />
                </label>
                <label className={label}>
                  Cattle breed
                  <input
                    className={field}
                    placeholder={settings.cattleBreed}
                    value={v.cattle_breed ?? ''}
                    onChange={(e) => set({ cattle_breed: e.target.value })}
                  />
                </label>
              </div>
            </section>

            <section id="setup-about" className={cn(card, 'lg:col-span-2')}>
              <h2 className="text-sm font-semibold text-gray-900">About the farm</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                A few sentences the AI features read before they answer: crops, soils, irrigation,
                livestock, your retailer.
              </p>
              <textarea
                rows={4}
                className={field}
                placeholder="Mixed farm near … — irrigated canola, durum and potatoes on brown soils, a 300-cow cow-calf herd, fertilizer from …"
                value={v.farm_description ?? ''}
                onChange={(e) => set({ farm_description: e.target.value })}
              />
            </section>
          </div>

          {/* Stays in reach at the bottom of the screen while the form is longer than it. */}
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
            <button
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate(
                  { ...(setup ? {} : base), ...draft },
                  { onSuccess: () => setDraft(null) },
                )
              }
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {dirty && (
              <button
                onClick={() => setDraft(null)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                Discard changes
              </button>
            )}
            {save.isSuccess && !dirty && <span className="text-sm text-green-700">Saved.</span>}
            {save.isError && (
              <span className="text-sm text-red-600">{(save.error as Error).message}</span>
            )}
          </div>
        </>
      )}

      {part === 'features' && (
        <section>
          <h2 className="text-base font-semibold text-gray-900">Parts of the app this farm uses</h2>
          <HelpNote
            className="mt-0.5"
            summary="Switched off: hidden from everyone's menu, home screen and pages. Data keeps syncing."
          >
            Turning a part off hides it for everyone on the farm — the menu, the home-screen tiles
            and the pages themselves. Anything it collects in the background (prices, weather, river
            flows, equipment syncs) carries on, so turning it back on shows the full history. Each
            switch saves straight away.
          </HelpNote>
          {/* One card per part, with the pieces inside it underneath, three across on a wide screen. */}
          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {FEATURES.filter((f) => !f.parent).map((top) => (
              <ul key={top.key} className={cn(card, 'divide-y divide-gray-100 py-1')}>
                {[top, ...FEATURES.filter((f) => f.parent === top.key)].map((f) => {
                  const on = featureOn(features, f.key)
                  const parentOff = f.parent ? !featureOn(features, f.parent) : false
                  return (
                    <li
                      key={f.key}
                      className={cn('flex items-center gap-3 py-2.5', f.parent && 'pl-4')}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            f.parent ? 'text-sm font-medium' : 'text-[15px] font-semibold',
                            parentOff ? 'text-gray-400' : 'text-gray-900',
                          )}
                        >
                          {f.label}
                        </p>
                        <p className="text-xs text-gray-500">{f.description}</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={on}
                        aria-label={f.label}
                        disabled={parentOff || save.isPending}
                        onClick={() => toggle(f.key, !on)}
                        className={cn(
                          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
                          on ? 'bg-brand-700' : 'bg-gray-300',
                        )}
                      >
                        <span
                          className={cn(
                            // left-0 matters: without it the knob starts where the button centres its content.
                            'absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                            on ? 'translate-x-5' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ))}
          </div>
        </section>
      )}

      {part === 'connections' && <SetupKeys />}

      {/* What setup cannot change yet: what to gather, and a prompt to copy. */}
      {part === 'customize' && <CustomizingGuide />}
    </div>
  )
}
