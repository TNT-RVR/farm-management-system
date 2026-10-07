import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'

/**
 * SMRID's irrigation rate per assessed acre, read from the district's Policy
 * Book each year (Sam, 7 Oct 2026: "apply it and have it update each year
 * with the new costs").
 *
 * The Policy & Procedure Manual's "Schedule of Rates and Fees" opens with the
 * year's rates in the same words every year:
 *
 *   2026 Rates
 *   Irrigation Acre Water Rate $38.00/acre
 *   (Minimum 20 X Rate) $760/annually
 *
 * SMRID uploads a new copy to its WordPress media library when it changes
 * (January, with the new rate), so the newest Policy Book PDF there is read.
 * The rate is also posted as an image, which nothing here reads.
 */

export type SmridRate = { year: number; ratePerAcre: number; minPerParcel: number | null }

const money = (s: string) => Number(s.replace(/[$,]/g, ''))

/** The year's irrigation acre rate and parcel minimum from the Policy Book's text. */
export function parsePolicyBookRates(text: string): SmridRate | null {
  const m = /\b(20\d{2})\s+Rates\s+Irrigation Acre Water Rate\s+\$([\d,]+(?:\.\d+)?)\s*\/\s*acre(?:\s+\(Minimum[^)]*\)\s+\$([\d,]+(?:\.\d+)?))?/i.exec(text)
  if (!m) return null
  const rate = money(m[2])
  if (!(rate > 0 && rate < 1000)) return null
  return { year: Number(m[1]), ratePerAcre: rate, minPerParcel: m[3] ? money(m[3]) : null }
}

type Media = { date: string; source_url: string; mime_type: string; title?: { rendered?: string } }

/** The newest Policy Book PDF in SMRID's media library. */
export async function latestPolicyBook(): Promise<{ url: string; date: string } | null> {
  const r = await fetch('https://smrid.com/wp-json/wp/v2/media?search=policy&per_page=50&orderby=date&order=desc&_fields=date,source_url,mime_type,title', {
    headers: { 'user-agent': 'RVR-Management/1.0 (SMRID rates)' },
  })
  if (!r.ok) throw new Error(`${r.status} from smrid.com`)
  const media = (await r.json()) as Media[]
  const book = media
    .filter((m) => m.mime_type === 'application/pdf' && /policy[-_ ]?book|policy[-_ ]?(and|&)?[-_ ]?procedure/i.test(m.source_url))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  return book ? { url: book.source_url, date: book.date.slice(0, 10) } : null
}

/** Write the year's rate beside its allotment, and tell the managers when it changes. */
export async function syncSmridRates(sb: SupabaseClient, managerIds: () => Promise<string[]>): Promise<{ changed: string | null; seen: string }> {
  const book = await latestPolicyBook()
  if (!book) throw new Error('No Policy Book PDF found in SMRID’s media library')
  const res = await fetch(book.url, { headers: { 'user-agent': 'RVR-Management/1.0 (SMRID rates)' } })
  if (!res.ok) throw new Error(`${res.status} fetching the Policy Book`)
  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))
  const text = String((await extractText(pdf, { mergePages: true })).text)
  const rate = parsePolicyBookRates(text)
  if (!rate) throw new Error(`The Policy Book of ${book.date} has no "Irrigation Acre Water Rate" line`)

  const note = `SMRID Policy Book (${book.date}), Schedule of Rates and Fees: ${rate.year} irrigation acre rate $${rate.ratePerAcre.toFixed(2)}/acre${rate.minPerParcel != null ? `, minimum $${rate.minPerParcel.toFixed(0)} a parcel` : ''}, before GST.`
  const { data: row } = await sb.from('water_allotments').select('id, rate_per_acre').eq('year', rate.year).eq('source', 'smrid').maybeSingle()
  const before = row?.rate_per_acre != null ? Number(row.rate_per_acre) : null
  if (row) {
    const { error } = await sb
      .from('water_allotments')
      .update({ rate_per_acre: rate.ratePerAcre, min_per_parcel: rate.minPerParcel, rate_note: note, rate_source_url: book.url })
      .eq('id', row.id)
    if (error) throw error
  } else {
    // A new year's rate comes out in January, before any allotment: the
    // allotment starts at the year before's contract figure until SMRID's
    // first notice (smrid-allotment-cron) sets it.
    const { data: last } = await sb.from('water_allotments').select('contract_inches').eq('source', 'smrid').order('year', { ascending: false }).limit(1).maybeSingle()
    const contract = last?.contract_inches != null ? Number(last.contract_inches) : 18
    const { error } = await sb.from('water_allotments').insert({
      year: rate.year,
      source: 'smrid',
      inches: contract,
      contract_inches: contract,
      note: `No allotment announced for ${rate.year} yet: the contract ${contract} in stands in until SMRID's first notice.`,
      rate_per_acre: rate.ratePerAcre,
      min_per_parcel: rate.minPerParcel,
      rate_note: note,
      rate_source_url: book.url,
    })
    if (error) throw error
  }
  const changed = before === rate.ratePerAcre ? null : `${rate.year}: ${before != null ? `$${before} → ` : ''}$${rate.ratePerAcre}/acre`
  if (changed) {
    const ids = await managerIds()
    if (ids.length)
      await sb.from('notifications').insert(
        ids.map((user_id) => ({
          user_id,
          kind: 'smrid_rate',
          title: `SMRID rate ${rate.year}: $${rate.ratePerAcre.toFixed(2)} an acre${before != null ? ` (was $${before.toFixed(2)})` : ''}`,
          body: note,
          link: '/irrigation?view=allocation',
        })),
      )
  }
  return { changed, seen: `${rate.year} $${rate.ratePerAcre}/acre (Policy Book ${book.date})` }
}
