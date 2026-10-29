import type { MdiFormId, MdiLand, MdiYear } from './afsc-mdi'
import { insuringCropType } from './afsc-mdi'

/**
 * Filling AFSC's own PDFs.
 *
 * Each form is a real AcroForm, so the app opens AFSC's file, sets the
 * fields and saves it: the result is the form itself, not a drawing of it,
 * and AFSC's branch staff see exactly the document they issued.
 *
 * Every field name below was read off the PDF — name, type, page and
 * position — rather than guessed from its label, because several of them
 * lie. The election's crop-type boxes are the clearest case: they are called
 * Check Box1 to Check Box4 and their labels are printed to the LEFT of each
 * box, so reading left to right pairs every one of them with the wrong crop.
 * scripts/afsc-field-map.md keeps the dump this was taken from.
 *
 * pdf-lib is loaded only when somebody makes a form; it is about 400 kB and
 * this page is opened once a winter.
 */

/** One box the app filled: what it is called on the form, and what went in. */
export type Written = { field: string; value: string }

export type MdiAnswers = {
  year: MdiYear
  land: MdiLand[]
  /** Does the business share or exchange work with another producer? */
  sharesWork: boolean
  sharesWorkDetails: string
  /** Wants the third-party representative authorisation form. */
  wantsRepresentative: boolean
}

// A type-only import is erased at build time, so the 400 kB stays behind the
// dynamic import below while the calls here are still type-checked.
import type { PDFForm } from 'pdf-lib'

const pdfLib = () => import('pdf-lib')

type Form = PDFForm

/**
 * Set a text field, ignoring one that is not on this year's form.
 *
 * Only a missing box is ignored. An earlier version swallowed every error,
 * which hid the real one: AFSC's identification-number boxes hold seven
 * characters because the 870 in front of them is printed on the form, so
 * every nine-digit number was rejected and the header came out blank while
 * the fill reported success.
 *
 * A value longer than the box is trimmed to fit. That is right for the
 * numbers these forms hold -- a township is three digits because townships
 * are -- but wrong for anything whose meaning a trim would change, which
 * goes through `exact` instead.
 */
function text(form: Form, name: string, value: string | number | null | undefined, log?: Written[]) {
  if (value == null || value === '') return
  let field
  try {
    field = form.getTextField(name)
  } catch {
    return // not on this year's form
  }
  const max = field.getMaxLength()
  const s = String(value)
  const written = max != null && s.length > max ? s.slice(0, max) : s
  field.setText(written)
  log?.push({ field: name, value: written })
}

/** Write it only if it fits whole: half a legal land part is a different place. */
function exact(form: Form, name: string, value: string | null | undefined, log?: Written[]) {
  if (!value) return
  let field
  try {
    field = form.getTextField(name)
  } catch {
    return
  }
  const max = field.getMaxLength()
  if (max != null && value.length > max) return
  field.setText(value)
  log?.push({ field: name, value })
}

/**
 * The digits that go in the identification-number box.
 *
 * Every AFSC number starts 870 and the forms print those three themselves,
 * leaving a box seven characters wide for the rest. Sam keeps the whole
 * number, so the prefix comes off here rather than being something he has to
 * remember not to type.
 */
export function afscIdDigits(id: string | null | undefined): string | null {
  const digits = (id ?? '').replace(/\D/g, '')
  if (!digits) return null
  const rest = digits.startsWith('870') ? digits.slice(3) : digits
  return rest.slice(0, 7) || null
}

function check(form: Form, name: string, on: boolean, log?: Written[]) {
  if (!on) return
  try {
    form.getCheckBox(name).check()
    log?.push({ field: name, value: 'ticked' })
  } catch {
    /* not on this year's form */
  }
}

/** A dropdown AFSC spells its own way: an option it does not hold is dropped. */
function choose(form: Form, name: string, value: string | null | undefined, log?: Written[]) {
  if (!value) return
  try {
    const field = form.getDropdown(name)
    if (!field.getOptions().includes(value)) return
    field.select(value)
    log?.push({ field: name, value })
  } catch {
    /* not on this year's form */
  }
}

async function open(file: string) {
  const res = await fetch(file)
  if (!res.ok) throw new Error(`Could not read ${file} (${res.status}).`)
  const { PDFDocument } = await pdfLib()
  const doc = await PDFDocument.load(await res.arrayBuffer())
  return { doc, form: doc.getForm() as Form }
}

/** The header every form carries: the identification number, the year, the name. */
function header(form: Form, a: MdiAnswers, suffixes: number[], log: Written[], nameField = 'BusinessName 1') {
  for (const n of suffixes) {
    text(form, `Identification Number ${n}`, afscIdDigits(a.year.identification_number), log)
    text(form, `Year ${n}`, a.year.crop_year, log)
  }
  text(form, nameField, a.year.business_name, log)
}

/**
 * The Election: which pasture types, which weather stations, which option.
 *
 * The four crop-type boxes are the ones whose labels sit to their left:
 * Check Box1 is Improved, 2 Bush, 3 Native, 4 Community. Checked against the
 * printed words' x positions, not their reading order.
 */
async function election(a: MdiAnswers, log: Written[]) {
  const { doc, form } = await open('/afsc/mdi-election.pdf')
  header(form, a, [1], log)
  check(form, 'Check Box1', a.year.insure_improved, log)
  check(form, 'Check Box2', a.year.insure_bush, log)
  check(form, 'Check Box3', a.year.insure_native, log)
  check(form, 'Check Box4', a.year.insure_community, log)
  text(form, 'lb', a.year.price_per_lb == null ? null : a.year.price_per_lb.toFixed(2), log)
  text(form, 'Option', a.year.coverage_option, log)
  text(form, '1', a.year.station_1, log)
  text(form, '2', a.year.station_2, log)
  text(form, '3', a.year.station_3, log)
  return doc.save()
}

/**
 * The Application for Contract of Insurance.
 *
 * Questions 1a to 1e are the eligibility ones, and for a farm that works its
 * own land the answer to all five is yes: it farms in Alberta, it has an
 * interest in the land, it makes the cropping decisions, it takes the
 * proceeds and it pays for the work. Question 2 — whether work or equipment
 * is shared with another producer — is the one only a person can answer, so
 * it comes from the dialog.
 *
 * The Yes buttons are named '0' to '5' and the No buttons 'Check Box1' to
 * 'Check Box6'; the pairing is by x position (Yes at 476, No at 524).
 */
async function contract(a: MdiAnswers, log: Written[]) {
  const { doc, form } = await open('/afsc/contract-of-insurance.pdf')
  header(form, a, [1, 2], log)
  for (const yes of ['0', '1', '2', '3', '4']) check(form, yes, true)
  check(form, a.sharesWork ? '5' : 'Check Box6', true, log)
  text(form, 'Provide names and the occupation', a.sharesWork ? a.sharesWorkDetails : null, log)
  check(form, 'Authorities check', a.wantsRepresentative, log)
  return doc.save()
}

/**
 * Complete land rows on page 1.
 *
 * The page draws fifteen, but AFSC's PDF has only fourteen Acres widgets --
 * the last line's acres box was never given one. Rather than write a row
 * whose acres silently vanish, the app fills fourteen and says a farm with
 * more parcels than that needs a second copy of the appendix, which AFSC
 * takes as a continuation sheet.
 */
export const APPENDIX_ROWS = 14

/**
 * The Land Information Appendix: a line per parcel.
 *
 * The tenure boxes are named for the wrong columns — 'Cash.i.1' sits under
 * Owned and 'Cash.i.0' under Cash — so they are set by what the header above
 * them says, not by what they are called.
 */
async function appendix(a: MdiAnswers, log: Written[]) {
  const { doc, form } = await open('/afsc/land-information-appendix.pdf')
  header(form, a, [1, 2], log, 'Business Name')
  a.land.slice(0, APPENDIX_ROWS).forEach((l, i) => {
    exact(form, `Part.${i}`, l.part, log)
    text(form, `Sec.${i}`, l.section, log)
    text(form, `Twp.${i}`, l.township, log)
    text(form, `Rge.${i}`, l.range, log)
    text(form, `Mer.${i}`, l.meridian, log)
    text(form, `If different Business.${i}`, l.title_name, log)
    choose(form, `Crop Type.${i}`, 'pasture', log)
    text(form, `Acres.${i}`, l.acres == null ? null : String(l.acres), log)
    choose(form, `insuring crop type.${i}`, insuringCropType(l.pasture_type), log)
    check(form, `Cash.${i}.1`, l.tenure === 'owned', log)
    check(form, `Cash.${i}.0`, l.tenure === 'cash', log)
    check(form, `Crop Share.${i}`, l.tenure === 'crop_share', log)
  })
  return doc.save()
}

/**
 * The Application for Identification Number, page 1.
 *
 * The applicant pages after it ask each person's legal name, date of birth
 * and SIN. Those are left blank on purpose: the app has no business holding
 * them and no business printing them.
 */
async function identification(a: MdiAnswers, log: Written[]) {
  const { doc, form } = await open('/afsc/identification-number.pdf')
  header(form, a, [1, 2], log)
  text(form, 'BusinessAddress 1', a.year.business_address, log)
  text(form, 'ContactPerson 1', a.year.contact_person, log)
  text(form, 'GST BIN 1', a.year.gst_bn, log)
  exact(form, 'Part 1', a.year.home_part, log)
  text(form, 'Section 1', a.year.home_section, log)
  text(form, 'Township 1', a.year.home_township, log)
  text(form, 'Range 1', a.year.home_range, log)
  text(form, 'Meridian 1', a.year.home_meridian, log)
  return doc.save()
}

const FILLERS: Record<string, (a: MdiAnswers, log: Written[]) => Promise<Uint8Array>> = {
  'mdi-election': election,
  'contract-of-insurance': contract,
  'land-information-appendix': appendix,
  'identification-number': identification,
}

/**
 * The filled form, and a note of every box that was filled.
 *
 * `written` is collected by the same helpers that set the fields, so the
 * check-sheet a report makes alongside the PDF is the fill itself rather
 * than a second description of it that could drift.
 */
export async function fillMdiForm(id: MdiFormId, answers: MdiAnswers): Promise<{ bytes: Uint8Array; written: Written[] }> {
  const fill = FILLERS[id]
  if (!fill) throw new Error(`${id} is not a form the app fills.`)
  const written: Written[] = []
  const bytes = await fill(answers, written)
  return { bytes, written }
}
