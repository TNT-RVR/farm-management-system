import type { SupabaseClient } from '@supabase/supabase-js'
import { leaseAlerts, type LeaseLike, type PaymentLike } from '../../src/lib/leases.ts'
import { farmDistrict, farmFeatureOn, farmTz } from '../../src/lib/farm-context.ts'
import { stockReturnReminder } from '../../src/lib/grazing-leases.ts'

/**
 * Daily: tell managers about a lease notice date coming up (30 days out) and
 * rent coming due (14 days out) or overdue. Each notice date and each payment
 * is pushed once; the page keeps showing them until they are dealt with.
 */
export async function runLeaseReminders(sb: SupabaseClient): Promise<{ alerts: number; sent: number }> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })
  const [l, p] = await Promise.all([
    sb.from('land_leases').select('*').eq('active', true),
    sb.from('land_lease_payments').select('*'),
  ])
  if (l.error) throw l.error
  if (p.error) throw p.error
  const leases = (l.data ?? []) as (LeaseLike & { renewal_reminded_for: string | null })[]
  const payments = (p.data ?? []) as (PaymentLike & { reminded_at: string | null })[]
  const alerts = leaseAlerts(leases, payments, today)

  const fresh = alerts.filter((a) =>
    a.kind === 'renewal'
      ? leases.find((x) => x.id === a.leaseId)?.renewal_reminded_for !== a.date
      : !payments.find((x) => x.lease_id === a.leaseId && x.due_on === a.paymentDue)?.reminded_at,
  )

  let sent = 0
  if (fresh.length) {
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'lease',
      p_title: fresh.length === 1 ? 'Lease reminder' : `${fresh.length} lease reminders`,
      p_body: fresh.map((a) => a.text).join('\n'),
      p_link: '/leases',
    })
    if (error) throw new Error('notify failed: ' + error.message)
    sent = fresh.length
    const now = new Date().toISOString()
    for (const a of fresh) {
      if (a.kind === 'renewal') await sb.from('land_leases').update({ renewal_reminded_for: a.date }).eq('id', a.leaseId)
      else {
        const lease = leases.find((x) => x.id === a.leaseId)!
        const existing = payments.find((x) => x.lease_id === a.leaseId && x.due_on === a.paymentDue)
        if (existing) await sb.from('land_lease_payments').update({ reminded_at: now }).eq('lease_id', a.leaseId).eq('due_on', a.paymentDue!)
        else await sb.from('land_lease_payments').insert({ lease_id: lease.id, due_on: a.paymentDue, amount: a.amount ?? null, reminded_at: now })
      }
    }
  }
  const allotment = await remindWaterAllotment(sb, today)
  const wq = await remindWaterQualityRequest(sb, today)
  const stock = await remindStockReturns(sb, today)
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'lease_reminders',
    p_detail: `${alerts.length} open, ${sent} sent${allotment ? ` · ${allotment}` : ''}${wq ? ` · ${wq}` : ''}${stock ? ` · ${stock}` : ''}`,
    p_data_at: null,
  })
  return { alerts: alerts.length, sent }
}

/**
 * End of April: SMRID sets its allotment for the season (18 in on contract,
 * 10–14 in the dry years), and every SMRID pivot is judged against it. From
 * 25 April until it is entered, managers get one reminder a year.
 */
async function remindWaterAllotment(sb: SupabaseClient, today: string): Promise<string | null> {
  const year = Number(today.slice(0, 4))
  const md = today.slice(5)
  if (md < '04-25' || md > '07-31') return null
  const { data: set } = await sb.from('water_allotments').select('id').eq('year', year).eq('source', 'smrid').maybeSingle()
  if (set) return null
  const key = `smrid_allotment_${year}`
  const { data: done } = await sb.from('reminder_log').select('key').eq('key', key).maybeSingle()
  if (done) return 'allotment reminder already sent'
  const { error } = await sb.rpc('fn_notify_managers', {
    p_kind: 'water_allotment',
    p_title: `Set the ${year} ${farmDistrict()} allotment`,
    p_body: `${farmDistrict()}'s allotment for ${year} isn't in the app yet, so pivots are being judged on last year's. Enter it on Irrigation → Allocation.`,
    p_link: '/irrigation?view=allocation',
  })
  if (error) return `allotment reminder failed: ${error.message}`
  await sb.from('reminder_log').insert({ key })
  return 'allotment reminder sent'
}

/**
 * The canal's water chemistry reaches the public portal a year or more late;
 * until then the province's water quality specialist sends a season's results
 * on request (Janelle Villeneuve, Alberta Agriculture and Irrigation, 1 Oct
 * 2026: general chemistry within two weeks of each monthly sample, pesticides
 * in one batch the following winter). Two asks a year, each only while the
 * results are still missing:
 *  - from 15 October, after the September sample: this season's results;
 *  - from 15 February: last season's pesticide results.
 * Load what comes back with scripts/import-water-quality-file.mjs.
 */
async function remindWaterQualityRequest(sb: SupabaseClient, today: string): Promise<string | null> {
  const year = Number(today.slice(0, 4))
  const md = today.slice(5)
  const ask =
    md >= '10-15' && md <= '12-15'
      ? { season: year, what: 'season' as const }
      : md >= '02-15' && md <= '04-15'
        ? { season: year - 1, what: 'pesticides' as const }
        : null
  if (!ask) return null
  const key = `water_quality_request_${ask.what}_${ask.season}`
  const { data: done } = await sb.from('reminder_log').select('key').eq('key', key).maybeSingle()
  if (done) return null

  // Still missing? The canal stations the farm draws on, for that season.
  const { data: st } = await sb.from('water_quality_stations').select('station_id').eq('source', 'idwq').not('water_source', 'is', null)
  const stations = (st ?? []).map((s) => s.station_id as string)
  if (!stations.length) return null
  let q = sb
    .from('water_quality_samples')
    .select('parameter')
    .in('station_id', stations)
    .gte('sampled_at', `${ask.season}-01-01`)
    .lt('sampled_at', `${ask.season + 1}-01-01`)
  q = ask.what === 'pesticides' ? q.like('parameter', 'p\\_%') : q.neq('parameter', 'so4_mg_l')
  const { data: have } = await q.limit(1)
  if (have?.length) return null

  const title =
    ask.what === 'season' ? `Ask for the ${ask.season} canal water results` : `Ask for the ${ask.season} canal pesticide results`
  const body =
    ask.what === 'season'
      ? `The province hasn't published this summer's ${farmDistrict()} canal samples yet. Its water quality specialist can send them now — general chemistry, nutrients, metals and E. coli.`
      : `Last summer's pesticide results for the ${farmDistrict()} canal come in one batch over the winter and aren't in the app yet. Ask the province's water quality specialist for them.`
  const { data: admins } = await sb.from('users').select('id').eq('role', 'admin').eq('active', true)
  for (const a of admins ?? []) {
    await sb.rpc('fn_notify', {
      p_user: a.id,
      p_kind: 'water_quality_request',
      p_title: title,
      p_body: body,
      p_link: '/river',
      p_details: {
        contact: 'Janelle Villeneuve, Water Quality Specialist, Alberta Agriculture and Irrigation, Lethbridge — user-eaff@gov.ab.ca, 403-381-5867',
        ask_for: ask.what === 'season' ? `${ask.season} results for the canal sites the farm draws on (SMC-S1, SMC-S2, SMC-S3), all parameters` : `${ask.season} pesticide results for SMC-S1, SMC-S2 and SMC-S3`,
        load_with: 'node scripts/import-water-quality-file.mjs "<the spreadsheet>" --dry, then without --dry',
      },
    })
  }
  await sb.from('reminder_log').insert({ key })
  return `${ask.what} request reminder sent`
}

/**
 * Early January: every provincial grazing lease files a Stewardship Stock
 * Return for the year just ended, due 31 January. Once a year, from 2
 * January, managers are told which leases have no filed return yet (the
 * page's "Mark filed"). Nothing when they are all filed or there are none.
 */
async function remindStockReturns(sb: SupabaseClient, today: string): Promise<string | null> {
  const md = today.slice(5)
  if (md < '01-02' || md > '01-31' || !farmFeatureOn('grazing_leases')) return null
  const year = Number(today.slice(0, 4)) - 1
  const key = `stock_return_${year}`
  const { data: done } = await sb.from('reminder_log').select('key').eq('key', key).maybeSingle()
  if (done) return null
  const [d, r] = await Promise.all([
    sb.from('grazing_dispositions').select('id, disposition_no, active'),
    sb.from('grazing_disposition_returns').select('disposition_id, year, status').eq('year', year),
  ])
  if (d.error) return `stock return reminder failed: ${d.error.message}`
  if (r.error) return `stock return reminder failed: ${r.error.message}`
  const plan = stockReturnReminder(today, d.data ?? [], r.data ?? [])
  if (!plan) return null
  const { error } = await sb.rpc('fn_notify_managers', {
    p_kind: 'stock_return',
    p_title: plan.title,
    p_body: plan.body,
    p_link: '/grazing-leases',
  })
  if (error) return `stock return reminder failed: ${error.message}`
  await sb.from('reminder_log').insert({ key: plan.key })
  return `stock return reminder sent (${plan.pending.length})`
}
