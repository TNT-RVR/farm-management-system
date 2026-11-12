import { supabase } from '@/lib/supabase'
import { MDI_FORMS, mergeKnown, missingForForm, type MdiFormId, type MdiLand, type MdiYear } from '@/lib/afsc-mdi'
import { fileOf, yearParam, type GatherContext, type Made, type ParamValues } from './framework'

/**
 * AFSC's four pasture-insurance forms, as reports.
 *
 * Every other report here is a table the app draws. These are not: each one
 * is AFSC's own fillable PDF with its fields set, so what comes out is the
 * form itself. That is what ReportFile is for (framework.ts) — the gather
 * returns the bytes and the page hands them over as the download.
 *
 * The answers come from afsc_mdi_year and afsc_mdi_land, which the Pasture
 * insurance tab fills in, over what the app already holds about the business
 * (afsc-mdi.ts, mergeKnown). A report made before the rest are answered would
 * be a form with holes in it, which is worse than no form, so the gather
 * stops and says which answers are missing and where to put them.
 *
 * One subscription per ranch, as on the page: the Ranch parameter says which,
 * and with none given it is the farm's main ranch.
 *
 * docs/afsc-mdi-forms.md has the field maps and the two defects in AFSC's
 * files that had to be repaired before any of this worked.
 */

/** The ranch asked for, or the farm's main one — never a mix of the two. */
async function ranchFor(p: ParamValues): Promise<{ id: string; name: string; address: string | null; owner_name: string | null; owner_phone: string | null }> {
  const { data, error } = await supabase.from('ranches').select('id, name, address, owner_name, owner_phone').order('sort_order')
  if (error) throw error
  const list = (data ?? []) as { id: string; name: string; address: string | null; owner_name: string | null; owner_phone: string | null }[]
  if (!list.length) throw new Error('This farm has no ranches yet, so there is no pasture to insure.')
  if (p.ranch) {
    const picked = list.find((r) => r.id === p.ranch)
    if (picked) return picked
  }
  const { data: setup } = await supabase.from('farm_setup').select('main_ranch_id').eq('singleton', true).maybeSingle()
  const main = (setup as { main_ranch_id: string | null } | null)?.main_ranch_id
  return list.find((r) => r.id === main) ?? list[0]
}

async function answersFor(cropYear: number, ranchId: string) {
  const [y, l] = await Promise.all([
    supabase.from('afsc_mdi_year').select('*').eq('crop_year', cropYear).eq('ranch_id', ranchId).maybeSingle(),
    supabase.from('afsc_mdi_land').select('*').eq('ranch_id', ranchId).order('sort'),
  ])
  if (y.error) throw y.error
  if (l.error) throw l.error
  return { saved: (y.data as MdiYear | null) ?? null, land: ((l.data ?? []) as unknown as MdiLand[]) }
}

/** One form, filled. Throws a plain sentence when it would come out with holes. */
export async function gatherMdiForm(id: MdiFormId, p: ParamValues, ctx: GatherContext): Promise<Made> {
  const cropYear = yearParam(p, ctx)
  const form = MDI_FORMS.find((f) => f.id === id)
  if (!form) throw new Error(`${id} is not one of AFSC's forms.`)

  const ranch = await ranchFor(p)
  const { saved, land } = await answersFor(cropYear, ranch.id)
  const { data: setup } = await supabase.from('farm_setup').select('farm_name').eq('singleton', true).maybeSingle()
  const year = mergeKnown(
    saved,
    { farmName: (setup as { farm_name: string | null } | null)?.farm_name?.trim() || null, ranch },
    cropYear,
    ranch.id,
  )

  // Only the answers this form actually asks for: the Election has no use for
  // the home quarter, and refusing to make it over a missing one was wrong.
  const missing = missingForForm(id, year, land)
  if (missing.length) {
    throw new Error(
      `${ranch.name}'s ${cropYear} pasture insurance still needs ${missing.join(', ')}. Answer them on Cattle → Sales & paperwork → Pasture insurance.`,
    )
  }

  const { fillMdiForm } = await import('@/lib/afsc-mdi-pdf')
  const { bytes, written } = await fillMdiForm(id, {
    year,
    land,
    sharesWork: false,
    sharesWorkDetails: '',
    wantsRepresentative: false,
  })

  if (ctx.format === 'PDF') return fileOf(bytes, `${form.name} - ${ranch.name} ${cropYear}.pdf`, 'application/pdf')

  // CSV is the check-sheet: every box the app filled and what went in it, so
  // the application can be read through before it is signed and sent. It is
  // collected by the same helpers that set the fields, so it cannot describe
  // a form other than the one that came out.
  return {
    title: form.name,
    subtitle: `${ranch.name} · crop year ${cropYear} · what the app put on the form`,
    meta: [
      ['Form', form.name],
      ['Ranch', ranch.name],
      ['Boxes filled', written.length],
      ['Parcels', land.length],
    ],
    summary: [
      'PDF is AFSC’s own form with these values in it. This list is the same values as a table, to read through before signing.',
      'A SIN, a date of birth and a signature are never filled from here.',
    ],
    columns: [{ label: 'Box on the form' }, { label: 'What went in it' }],
    groups: [{ title: '', rows: written.map((w) => [w.field, w.value]) }],
    filename: `${form.name} ${ranch.name} ${cropYear} — what was filled`,
  }
}

export const gatherMdiElection = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('mdi-election', p, ctx)
export const gatherMdiContract = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('contract-of-insurance', p, ctx)
export const gatherMdiLand = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('land-information-appendix', p, ctx)
export const gatherMdiIdentification = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('identification-number', p, ctx)
