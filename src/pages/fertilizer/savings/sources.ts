import type { Source } from './ui'
import { farmRetailer } from '@/lib/farm-context'

/**
 * The pages and outside documents the savings tools read, named once so
 * every card links to the same place for the same data.
 */
export const S = {
  // Labels and links follow the five Fertilizer views (Sam, 24 Oct 2026):
  // view → tab. The retailer's name is the farm's own (Farm setup).
  market: { label: 'Fertilizer prices → Market (DTN weekly)', to: '/fertilizer/prices?tab=market' },
  pricing: { get label() { return `Fertilizer prices → Pricing (${farmRetailer()} invoices)` }, to: '/fertilizer/prices?tab=pricing' },
  ici: { get label() { return `Fertilizer prices → ${farmRetailer()}` }, to: '/fertilizer/prices?tab=retailer' },
  requirements: { label: 'Fertility plan → Requirements', to: '/fertilizer/plan?tab=requirements' },
  soil: { label: 'Soil tests', to: '/fertilizer/soil?tab=tests' },
  manure: { label: 'Manure', to: '/fertilizer/manure' },
  tissue: { label: 'Soil tests → Tissue tests', to: '/fertilizer/soil?tab=tissue' },
  rx: { label: 'Fertility plan → Prescriptions', to: '/fertilizer/plan?tab=rx' },
  zones: { label: 'Fertility plan → Productivity zones', to: '/fertilizer/plan?tab=zones' },
  plan: { label: 'Crop plan', to: '/plan' },
  crops: { label: 'Crop prices (each crop’s page)', to: '/crops' },
  fields: { label: 'Fields (history, soil, work)', to: '/fields' },
  bins: { label: 'Harvest → Bins', to: '/harvest?tab=bins' },
  pivots: { label: 'Pivots', to: '/irrigation-info' },
  grants: { label: 'Grants tracker', to: '/grants' },
  weather: { label: 'Weather page', to: '/weather' },
  statcanIndex: { label: 'Statistics Canada 18-10-0258 (farm input price index)', href: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810025801' },
  boc: { label: 'Bank of Canada exchange rate', href: 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/' },
  abSurvey: { label: 'Alberta Farm Input Prices (monthly survey)', href: 'https://open.alberta.ca/dataset?q=%22Alberta+farm+input+prices%22' },
  dtnAuthor: { label: 'DTN fertilizer articles', href: 'https://www.dtnpf.com/agriculture/web/ag/news/author?authorFullName=Russ++Quinn' },
  ofcaf: { label: 'RDAR On-Farm Climate Action Fund', href: 'https://rdar.ca/funding-opportunities/ofcaf' },
  ofcafNitrogen: {
    label: 'OFCAF nitrogen soil testing & mapping form (2026)',
    href: 'https://a-us.storyblok.com/f/1016551/x/a8e35b9fa9/nitrogen-management-soil-testing-mapping-2026-fillable.pdf',
  },
  ofcafPause: { label: 'OFCAF intake paused, May 2026', href: 'https://www.albertafarmexpress.ca/crops/rdar-ofcaf-pause-may-2026-program-changes/' },
  sustainableCap: { label: 'Alberta Sustainable CAP programs', href: 'https://www.alberta.ca/sustainable-cap-programs' },
  nerp: { label: 'Alberta NERP protocol', href: 'https://open.alberta.ca/publications/nitrous-oxide-emission-reduction-protocol-nerp' },
  offsets: { label: 'Alberta agricultural carbon offsets', href: 'https://www.alberta.ca/agricultural-carbon-offsets-all-protocols-update' },
  fert4r: { label: 'Fertilizer Canada 4R in Alberta', href: 'https://fertilizercanada.ca/our-focus/stewardship/4rs-across-canada/alberta/' },
  openMeteo: { label: 'Open-Meteo forecast', href: 'https://open-meteo.com/' },
  ureaMsu: { label: 'Montana State: urea volatilization', href: 'https://landresources.montana.edu/ureavolatilization/learned.html' },
  ureaMb: { label: 'Manitoba: losses from surface N', href: 'https://www.gov.mb.ca/agriculture/crops/soil-fertility/volatilization-losses-from-surface-applied-nitrogen.html' },
} satisfies Record<string, Source>
