import { supabase } from '@/lib/supabase'
import { MDI_FORMS, missingAnswers, type MdiFormId, type MdiLand, type MdiYear } from '@/lib/afsc-mdi'
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
 * insurance tab fills in. A report made before those are answered would be a
 * form with holes in it, which is worse than no form, so the gather stops and
 * says which answers are missing and where to put them.
 *
 * docs/afsc-mdi-forms.md has the field maps and the two defects in AFSC's
 * files that had to be repaired before any of this worked.
 */

async function answersFor(cropYear: number) {
  const [y, l] = await Promise.all([
    supabase.from('afsc_mdi_year').select('*').eq('crop_year', cropYear).maybeSingle(),
    supabase.from('afsc_mdi_land').select('*').order('sort'),
  ])
  if (y.error) throw y.error
  if (l.error) throw l.error
  return { year: (y.data as MdiYear | null) ?? null, land: ((l.data ?? []) as MdiLand[]) }
}

/** One form, filled. Throws a plain sentence when it would come out with holes. */
export async function gatherMdiForm(id: MdiFormId, p: ParamValues, ctx: GatherContext): Promise<Made> {
  const cropYear = yearParam(p, ctx)
  const form = MDI_FORMS.find((f) => f.id === id)
  if (!form) throw new Error(`${id} is not one of AFSC's forms.`)

  const { year, land } = await answersFor(cropYear)
  const missing = missingAnswers(year, land)
  if (missing.length) {
    throw new Error(
      `${cropYear}'s pasture insurance still needs ${missing.join(', ')}. Answer them on Cattle → Sales & paperwork → Pasture insurance.`,
    )
  }

  const { fillMdiForm } = await import('@/lib/afsc-mdi-pdf')
  const { bytes, written } = await fillMdiForm(id, {
    year: year as MdiYear,
    land,
    sharesWork: false,
    sharesWorkDetails: '',
    wantsRepresentative: false,
  })

  if (ctx.format === 'PDF') return fileOf(bytes, `${form.name} ${cropYear}.pdf`, 'application/pdf')

  // CSV is the check-sheet: every box the app filled and what went in it, so
  // the application can be read through before it is signed and sent. It is
  // collected by the same helpers that set the fields, so it cannot describe
  // a form other than the one that came out.
  return {
    title: form.name,
    subtitle: `Crop year ${cropYear} · what the app put on the form`,
    meta: [
      ['Form', form.name],
      ['Boxes filled', written.length],
      ['Parcels', land.length],
    ],
    summary: [
      'PDF is AFSC’s own form with these values in it. This list is the same values as a table, to read through before signing.',
      'A SIN, a date of birth and a signature are never filled from here.',
    ],
    columns: [{ label: 'Box on the form' }, { label: 'What went in it' }],
    groups: [{ title: '', rows: written.map((w) => [w.field, w.value]) }],
    filename: `${form.name} ${cropYear} — what was filled`,
  }
}

export const gatherMdiElection = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('mdi-election', p, ctx)
export const gatherMdiContract = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('contract-of-insurance', p, ctx)
export const gatherMdiLand = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('land-information-appendix', p, ctx)
export const gatherMdiIdentification = (p: ParamValues, ctx: GatherContext) => gatherMdiForm('identification-number', p, ctx)
