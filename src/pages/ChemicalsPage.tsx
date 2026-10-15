import { useMemo, useState } from 'react'
import { SprayCheck } from '@/components/SprayCheck'
import { useCropYear } from '@/lib/crop-year'
import { useCropPlans, useCrops } from '@/lib/queries'
import { productName, readable } from '@/lib/chemical-display'
import { useTab } from '@/lib/useTab'
import {
  AlertTriangle,
  BookOpen,
  FlaskConical,
  RefreshCw,
  Search,
} from 'lucide-react'
import { ChemicalLabelDetail } from '@/components/ChemicalLabelDetail'
import { PillTabs } from '@/components/PillTabs'
import { HelpNote } from '@/components/HelpNote'
import { AdminOnly } from '@/components/TechnicalDetails'
import { InventoryTab } from '@/pages/chemicals/InventoryTab'
import { ProductPrices } from '@/components/ProductPrices'
import { ReentryPanel } from '@/components/ReentryWarning'
import { FieldEntryAlert } from '@/components/FieldEntryAlert'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  useChemicalCount,
  useChemicalSearch,
  useChemicalTypes,
  useSyncChemicals,
  useQueueLabels,
  useLabelProgress,
  SEARCH_FIELDS,
  type SearchField,
  type Chemical,
} from '@/lib/chemicals'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { localDate } from '@/lib/date-range'

const SEARCH_PLACEHOLDER: Record<SearchField, string> = {
  any: 'Product, active ingredient, pest or crop…',
  name: 'Product name or registration number…',
  pest: 'Pest — wild oats, sclerotinia, flea beetle…',
  crop: 'Crop — canola, durum wheat, potatoes…',
  ingredient: 'Active ingredient — glyphosate, prothioconazole…',
}

/** Cancelled or expired registration — the thing you must not miss. */
function registrationWarning(c: Chemical): string | null {
  const status = (c.registration_status ?? '').toLowerCase()
  if (status && !status.includes('full') && !status.includes('emergency')) {
    return `Registration status: ${c.registration_status}`
  }
  // As the calendar day it names. Parsed as UTC it is the previous evening
  // here, and a label read as expired a day early.
  if (c.expiry_date && localDate(c.expiry_date) < new Date()) {
    return `Registration expired ${localDate(c.expiry_date).toLocaleDateString('en-CA')}`
  }
  return null
}

/**
 * What this farm is growing, by crop name: this crop year's plans, or every
 * active crop when nothing is planned yet. The label opens on these first.
 */
function useFarmCrops(): string[] {
  const { cropYear } = useCropYear()
  const { data: plans } = useCropPlans(cropYear)
  const { data: crops } = useCrops()
  return useMemo(() => {
    const all = crops ?? []
    const planned = new Set((plans ?? []).map((p) => p.crop_id))
    const growing = planned.size > 0 ? all.filter((c) => planned.has(c.id)) : all.filter((c) => c.active)
    return growing.map((c) => c.name)
  }, [plans, crops])
}

/**
 * The results, a page at a time.
 *
 * Two hundred cards at once was twenty-four screens on a phone before any
 * search had been typed. Forty is a thumb's worth; the rest are a tap away, and
 * the count is remounted (keyed on the search) so a new search starts at the
 * top again.
 */
const PAGE = 40
function RegistryList({ rows, canEdit }: { rows: Chemical[]; canEdit: boolean }) {
  const [shown, setShown] = useState(PAGE)
  const farmCrops = useFarmCrops()
  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.slice(0, shown).map((c) => (
          <ChemicalCard key={c.id} c={c} canEdit={canEdit} farmCrops={farmCrops} />
        ))}
      </ul>
      {rows.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-3 w-full rounded-md border border-gray-200 bg-white py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Show {Math.min(PAGE, rows.length - shown)} more of {rows.length}
        </button>
      )}
      {rows.length === 200 && shown >= 200 && (
        <p className="mt-2 text-xs text-gray-500">
          Showing the first 200 matches — narrow the search to see the rest.
        </p>
      )}
    </>
  )
}

/**
 * The colour a product type is drawn in: a stripe down the card's edge and a
 * matching chip. Colour by what the product IS, so a long list can be scanned
 * for "the fungicides" without reading, and the card itself stays white —
 * an all-green list was tried and was harder to read, not easier.
 */
function typeColour(type: string | null | undefined): { stripe: string; chip: string } {
  const t = (type ?? '').toLowerCase()
  if (t.includes('herbicide')) return { stripe: 'border-l-amber-400', chip: 'bg-amber-50 text-amber-800' }
  if (t.includes('fungicide')) return { stripe: 'border-l-sky-400', chip: 'bg-sky-50 text-sky-800' }
  if (t.includes('insecticide') || t.includes('miticide'))
    return { stripe: 'border-l-rose-400', chip: 'bg-rose-50 text-rose-800' }
  if (t.includes('seed')) return { stripe: 'border-l-violet-400', chip: 'bg-violet-50 text-violet-800' }
  if (t.includes('growth') || t.includes('desiccant'))
    return { stripe: 'border-l-teal-400', chip: 'bg-teal-50 text-teal-800' }
  return { stripe: 'border-l-gray-300', chip: 'bg-gray-100 text-gray-700' }
}

/** One product: a white card with its type's colour down the edge. */
function ChemicalCard({ c, canEdit, farmCrops }: { c: Chemical; canEdit: boolean; farmCrops: string[] }) {
  const [open, setOpen] = useState(false)
  const warning = registrationWarning(c)
  const colour = typeColour(c.product_type)

  return (
    <li className={cn('overflow-hidden rounded-lg border border-l-4 border-gray-200 bg-white', colour.stripe)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-semibold text-gray-900">{productName(c.name)}</span>
          {c.product_type && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', colour.chip)}>
              {c.product_type.toLowerCase()}
            </span>
          )}
          <span className="ml-auto text-[11px] text-gray-400">Reg. {c.registration_number}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-500">{readable(c.active_ingredients) || '—'}</p>
        {warning && (
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {warning}
          </p>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-white px-3 py-3">
          <ChemicalLabelDetail chemical={c} canEdit={canEdit} farmCrops={farmCrops} />
        </div>
      )}
    </li>
  )
}

export function ChemicalsPage() {
  const { retailerName } = useFarmSettings()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [term, setTerm] = useState('')
  const [type, setType] = useState('')
  const [field, setField] = useState<SearchField>('any')
  const { data: rows, isLoading } = useChemicalSearch(term, type, field)
  const { data: types } = useChemicalTypes()
  const { data: count } = useChemicalCount()
  const sync = useSyncChemicals()
  const queue = useQueueLabels()
  const { data: progress } = useLabelProgress()

  // Two things live under Chemicals: the registry, and what we pay for the ones
  // we buy. Tabs rather than a second route — a price is a fact about a
  // chemical, and looking one up and looking up its price are the same errand.
  // 'pricing' was the Prices tab's key while it was called "Pricing settings";
  // saved links to it still land there.
  const [tab, setTab] = useTab(
    'chemicals',
    ['registry', 'inventory', 'prices', 'reentry', 'spraycheck'] as const,
    'registry',
    (asked) => (asked === 'pricing' ? 'prices' : undefined),
  )

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
            <FlaskConical className="h-5 w-5 text-brand-700" /> Chemicals
          </h1>
          <p className="text-xs text-gray-500">
            {tab === 'registry'
              ? `${count ?? '—'} agricultural products, from Health Canada's pesticide registry. Refreshed monthly.`
              : tab === 'inventory'
                ? `What is in the shed: bought on the ${retailerName} invoices, less what the sprayer put out, corrected by counts.`
                : tab === 'spraycheck'
                  ? 'Pick a product and the fields: see which planned crops its label rules out.'
                : 'What we pay, from the invoices. Each product takes its price from its most recent one.'}
          </p>
        </div>
        {tab === 'registry' && isManager && (
          <button
            onClick={() => queue.mutate({ scope: 'used' })}
            disabled={queue.isPending}
            title="Queue every product this farm has sprayed. The background reader works through them."
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <BookOpen className="h-4 w-4" /> Read our labels
          </button>
        )}
        {tab === 'registry' && isManager && (
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} /> Sync now
          </button>
        )}
      </div>

      <PillTabs
        tabs={[
          { key: 'registry', label: 'Registry' },
          { key: 'inventory', label: 'Inventory' },
          { key: 'prices', label: 'Prices' },
          { key: 'reentry', label: 'Recently sprayed' },
          { key: 'spraycheck', label: 'Before spraying' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-3"
      />

      {tab === 'spraycheck' ? (
        <SprayCheck />
      ) : tab === 'inventory' ? (
        <InventoryTab />
      ) : tab === 'reentry' ? (
        <>
          <div className="mb-3">
            <FieldEntryAlert />
          </div>
          <ReentryPanel />
        </>
      ) : tab === 'prices' ? (
        <ProductPrices category="chemical" />
      ) : (
        <>
          {/* Search-by comes first: "canola" against every column matches a hundred
          products by registered site and buries the one actually named that. */}
          <div className="mb-3 flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1 basis-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={SEARCH_PLACEHOLDER[field]}
                className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm"
              />
            </div>
            <Select
              value={field}
              ariaLabel="Search by"
              className="w-44"
              onChange={(v) => setField(v as SearchField)}
              options={Object.entries(SEARCH_FIELDS).map(([value, f]) => ({
                value,
                label: `Search: ${f.label.toLowerCase()}`,
              }))}
            />
            <Select
              value={type}
              ariaLabel="Product type"
              className="w-52"
              onChange={setType}
              options={[
                { value: '', label: 'All types' },
                ...(types ?? []).map((t) => ({ value: t, label: t.toLowerCase() })),
              ]}
            />
          </div>

          {/* The backlog is worked through in the background, so say where it is up
          to rather than leaving someone wondering whether anything is happening. */}
          {progress && (progress.queued > 0 || progress.reading > 0) && (
            <p className="mb-2 flex items-center gap-1.5 rounded-md bg-brand-50 px-2.5 py-1.5 text-xs text-brand-900">
              <BookOpen className="h-3.5 w-3.5" />
              Reading labels in the background: {progress.ok} done
              {progress.queued > 0 && `, ${progress.queued} to go`}
              {progress.error > 0 && `, ${progress.error} could not be read`}. You can carry on —
              they fill in as they finish.
            </p>
          )}
          {queue.isError && (
            <p className="mb-2 text-xs text-red-600">{(queue.error as Error).message}</p>
          )}
          {queue.isSuccess && (
            <p className="mb-2 text-xs text-green-700">
              Queued {(queue.data as { queued: number }).queued} labels to read.
            </p>
          )}
          {sync.isError && (
            <p className="mb-2 text-xs text-red-600">{(sync.error as Error).message}</p>
          )}
          {/* The sync's own report (row counts and the like) is for whoever
              maintains the app; everyone else needs to know it worked. */}
          {sync.isSuccess && (
            <p className="mb-2 text-xs text-green-700">
              Registry synced.
              <AdminOnly>
                <span className="ml-1 text-gray-500">{(sync.data as { detail: string }).detail}</span>
              </AdminOnly>
            </p>
          )}

          {isLoading ? (
            <p className="py-12 text-center text-sm text-gray-400">Searching…</p>
          ) : (rows ?? []).length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-400">
              {count === 0
                ? 'The registry has not been synced yet — a manager can press Sync now.'
                : 'Nothing matched that search.'}
            </p>
          ) : (
            <RegistryList key={`${term}|${type}|${field}`} rows={rows ?? []} canEdit={isManager} />
          )}
        </>
      )}

      {tab === 'registry' && (
        <HelpNote
          className="mt-4 border-t border-gray-100 pt-2"
          summary="From Health Canada’s registry. Always read the official label before applying."
          title="Where this comes from"
        >
          Source: Health Canada Pesticide Product Information Database (open data), filtered to
          current, purchasable products with an agricultural use site. Always read the official
          label before applying. This is not the Alberta Blue Book and carries none of its agronomic
          guidance — that is a separate copyrighted publication.
        </HelpNote>
      )}
    </div>
  )
}
