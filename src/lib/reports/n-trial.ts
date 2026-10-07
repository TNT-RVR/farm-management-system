import { supabase } from '@/lib/supabase'
import { UREA_N, trialPrescriptionZip, trialRxName, type TrialStrip } from '@/lib/fert-savings/trial-rx'
import { fieldLabel, fileOf, num, type Cell, type GatherContext, type Made, type ParamValues, type ReportData } from './framework'

/**
 * One N-rate trial: the prescription shapefile (ZIP, the file the Savings tab
 * makes) or its strips and rates as a table — strip, rep, the N and urea
 * rates, acres, the pounds each takes, and the yield once it is entered.
 */

export type TrialLite = {
  id: string
  crop_year: number
  field_id: string
  crop_id: string | null
  name: string | null
  rates: unknown
  reps: number | null
  status: string | null
  base_rate: unknown
  strip_width_m: unknown
  results: unknown
  yield_unit: string | null
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** The table: a row a strip, in strip order, with the pounds it takes and its yield. */
export function trialStripRows(strips: TrialStrip[], results: unknown): { rows: Cell[][]; totals: Cell[] } {
  const yields = new Map(((Array.isArray(results) ? results : []) as { strip: number; yield: number | null }[]).map((r) => [Number(r.strip), r.yield == null ? null : Number(r.yield)]))
  const sorted = [...strips].sort((a, b) => a.strip - b.strip)
  const rows = sorted.map((s) => {
    const rate = Number(s.rate)
    const acres = Number(s.acres)
    return [s.strip, s.rep, rate, Math.round(rate / UREA_N), acres, round1(rate * acres), Math.round((rate / UREA_N) * acres), yields.get(s.strip) ?? null]
  })
  const sum = (i: number) => rows.reduce((t, r) => t + (Number(r[i]) || 0), 0)
  return { rows, totals: ['Total', null, null, null, sum(4), sum(5), sum(6), null] }
}

export async function gatherNTrial(p: ParamValues, ctx: GatherContext): Promise<Made> {
  if (!p.trial) throw new Error('Choose a trial. They are laid out under Fertilizer → Savings → On-farm N-rate trials.')
  const { data: trial, error } = await supabase.from('n_trials').select('id, crop_year, field_id, crop_id, name, rates, reps, status, base_rate, strip_width_m, results, yield_unit').eq('id', p.trial).maybeSingle()
  if (error) throw new Error(error.message)
  if (!trial) throw new Error('That trial is not there any more.')
  const t = trial as TrialLite
  const [field, crop, strips] = await Promise.all([
    supabase.from('fields').select('name').eq('id', t.field_id).maybeSingle(),
    t.crop_id ? supabase.from('crops').select('name').eq('id', t.crop_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.rpc('n_trial_strips', { p_trial: t.id }),
  ])
  if (strips.error) throw new Error(strips.error.message)
  const list = (strips.data ?? []) as TrialStrip[]
  if (!list.length) throw new Error('This trial has no strips: the field needs a boundary for them to be laid out.')
  const fieldName = field.data?.name ?? null
  const name = trialRxName(fieldName, t.crop_year)

  if (ctx.format === 'ZIP') return fileOf(trialPrescriptionZip(fieldName, t.crop_year, list), `${name}.zip`, 'application/zip')

  const { rows, totals } = trialStripRows(list, t.results)
  const rates = (Array.isArray(t.rates) ? t.rates : []).map(Number)
  const report: ReportData = {
    title: 'N-rate trial prescription',
    subtitle: `${fieldName ? fieldLabel(fieldName) : 'Field'} · crop year ${t.crop_year}${t.name ? ` · ${t.name}` : ''}`,
    meta: [
      ['Crop', crop.data?.name ?? 'not set'],
      ['Rates (lb N/ac)', rates.join(' / ')],
      ['Reps', t.reps],
      ['Strips', list.length],
      ['Strip width', num(t.strip_width_m) == null ? null : `${num(t.strip_width_m)} m`],
      ['Rest of field', num(t.base_rate) == null ? null : `${num(t.base_rate)} lb N/ac`],
      ['Status', t.status],
    ],
    summary: [
      'Each strip’s N rate, and the urea (46-0-0) that carries it. The ZIP download is the same prescription as a shapefile for Operations Center (STRIP, REP, N_LB_AC and UREA_LB on each strip).',
    ],
    columns: [
      { label: 'Strip', decimals: 0 },
      { label: 'Rep', decimals: 0 },
      { label: 'N (lb/ac)', upTo: 1 },
      { label: 'Urea (lb/ac)', decimals: 0 },
      { label: 'Acres', decimals: 1 },
      { label: 'N (lb)', decimals: 0 },
      { label: 'Urea (lb)', decimals: 0 },
      { label: `Yield (${t.yield_unit ?? 'per ac'})`, upTo: 1 },
    ],
    groups: [{ title: '', rows }],
    totals,
    filename: name,
  }
  return report
}
