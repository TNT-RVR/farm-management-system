import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'

// Reads the official PMRA label for a product and turns it into the numbers a
// sprayer operator needs: rate per crop, water volume, ground or aerial,
// rainfast, pre-harvest interval and re-cropping restrictions.
//
// None of this is in Health Canada's data extract, which stops at name, active
// ingredient, pests and registered sites. It exists only in the label PDF.
// The route to that PDF is an undocumented JSON API behind the registry site,
// verified against six real products on 2026-08-07.

import { CHUNK_THRESHOLD, chunkLabelText, mergeExtractions } from './label-chunks.ts'

const API = 'https://pest-control.canada.ca/pesticide-registry-api/api'
const UA = 'RVR-Management/1.0 (farm management app)'

export type LabelDoc = { docId: string; docCount: number }

/**
 * The English approved label's document id for a registration number.
 *
 * Returns null rather than throwing when a product simply has no English
 * approved label — some older registrations only have French, or none at all,
 * and that is a fact about the product, not a failure worth retrying.
 */
export async function findLabelDoc(reg: string): Promise<LabelDoc | null> {
  const res = await fetch(`${API}/search/product-labels/${encodeURIComponent(reg)}?lang=en`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`label search ${res.status}`)
  const body = (await res.json()) as { data?: { DOC_EPR_TYPE_E?: string; links?: string }[] }
  const rows = body.data ?? []
  const english = rows.find((r) => /APPROVED LABEL\s*-\s*English/i.test(r.DOC_EPR_TYPE_E ?? ''))
  if (!english) return null
  const m = /pdf\/inline\/en\/(\d+)/.exec(english.links ?? '')
  return m ? { docId: m[1], docCount: rows.length } : null
}

/** The label PDF as text. */
export async function fetchLabelText(docId: string): Promise<{ text: string; pages: number }> {
  const res = await fetch(`${API}/pdf/inline/en/${docId}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`label pdf ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  // The API answers 200 with a JSON error body for some documents, so check the
  // magic bytes rather than trusting the status.
  const magic = String.fromCharCode(...buf.subarray(0, 4))
  if (magic !== '%PDF') throw new Error('response was not a PDF')
  const pdf = await getDocumentProxy(buf)
  const { totalPages, text } = await extractText(pdf, { mergePages: true })
  return { text: String(text), pages: totalPages }
}

export type ExtractedCrop = {
  crop: string
  pest: string | null
  rate: string | null
  preharvest_interval_days: number | null
  replant_interval_days: number | null
  rotation_restriction: string | null
  /** Re-entry for THIS crop, where the label states it by crop. */
  reentry_hours: number | null
  reentry_field_hours: number | null
  quote: string | null
}

export type Extracted = {
  water_volume: string | null
  application_method: 'ground' | 'aerial' | 'both' | null
  rainfast_hours: number | null
  irrigation_hours: number | null
  reentry_hours: number | null
  reentry_field_hours: number | null
  reentry_note: string | null
  grazing_restriction: string | null
  evidence: Record<string, string>
  crops: ExtractedCrop[]
  notes: string | null
}

const PROMPT = `You are reading a Canadian PMRA pesticide product label. Extract ONLY what the label actually states. This drives spray decisions on a working farm: a wrong pre-harvest interval or plant-back interval can make a crop unsaleable or leave an illegal residue.

Rules:
- Use null for anything the label does not state. NEVER infer, average, or carry a value over from a similar product.
- Quote verbatim. Every value must be traceable to a sentence in the label.
- Rates and water volumes stay in the label's own units and wording (e.g. "0.67 L/ac", "100-200 L/ha"). Do not convert. If a rate is a range or depends on a condition, keep the range and the condition.
- application_method: "ground" if only ground/field sprayer application is permitted, "aerial" if only aerial, "both" if the label permits both. null if not stated.
- rainfast_hours / irrigation_hours: whole or decimal hours of dry weather the label requires after application. null if not stated.
- reentry_hours: the LONGEST Restricted Entry Interval (REI) stated anywhere on the label, whatever activity it applies to. Labels also call this "restricted-entry interval" or "do not enter". Give hours (1 day = 24). null if not stated.
- reentry_field_hours: the REI governing ordinary field activities on a broadacre grain, oilseed and pulse farm — walking the crop, SCOUTING, irrigation including hand-line and handset, and any work done from or around equipment. EXCLUDE intervals the label ties to crop-specific hand labour (hand harvesting, hand detasseling) or to settings that are not an open field (greenhouse, turf, sod farms, nurseries). Where the label states a single unconditional interval, this equals reentry_hours.
  Decide in this order. FIRST the setting: if an interval is tied to a place that is not an open field — a greenhouse, a nursery, turf, or a SOD FARM — it does not apply, whatever activity it names. The setting outranks the activity, so "for sod farms: 8 days for mowing, watering and irrigation activities and 12 hours for all other activities" gives reentry_field_hours 12, NOT 192, even though irrigation is otherwise field work. SECOND the activity: within an open field, an interval tied to hand labour on a crop (hand harvesting, hand detasseling, handset or hand-line irrigation) does not apply, so "20 days for hand detasseling in seed corn; 24 hours for all other activities" gives 24. THIRD, anything left that could plausibly be done in an open field IS field work — "6 days for scouting; 12 hrs for all other activities" gives 144, not 12, because scouting is field work.
  Never choose by which number is lower. The answer is sometimes the larger one, as the scouting case shows. If after the three steps above the label is genuinely ambiguous about which interval covers open-field work, take the longer.
- reentry_note: the label's own qualification of the REI where it has one, e.g. "48 h for hand-harvesting, 12 h for all other activities". null if the interval is unconditional. Fill this whenever reentry_field_hours and reentry_hours differ, so a person can see what the longer interval was for.
- crops[].reentry_hours / crops[].reentry_field_hours: where the label gives the re-entry interval PER CROP rather than once for the product, put each crop's figures on its own crops[] entry, under the same two rules as the product-level fields above. A table reading "Potatoes All tasks 4 days; Carrots Scouting 8 days, All other tasks 2 days; Celery Scouting 10 days" gives three crop rows with field hours 96, 192 and 240 — note the carrot figure is the SCOUTING one, because scouting is field work. Leave both null on a crop the label does not give an interval for; the product-level figure covers it.
- One crops[] entry per crop-and-pest combination that has its own rate or interval. If a crop has several pests at the same rate, one entry with pest null is fine.
- preharvest_interval_days / replant_interval_days: integer days. Convert weeks/months to days ONLY when the label expresses it that way (e.g. "10 months" -> 300 is WRONG; leave the wording in rotation_restriction and set the day field null unless the label gives days).
- rotation_restriction: what must not be planted afterwards and for how long, in the label's words.

Record your answer by calling the record_label tool. evidence maps each top-level field you filled to the verbatim label sentence it came from; omit keys you set to null. notes is for anything a sprayer operator must know that does not fit above, or null.`

// Forcing a tool call rather than asking for JSON in prose. The first version
// asked for a bare JSON object and failed on every product with "no JSON object
// in reply" — a free-text reply can preface, refuse, or wrap its answer, and
// there is no wording that reliably prevents it. A forced tool call cannot come
// back as anything but a validated object.
const RECORD_TOOL = {
  name: 'record_label',
  description: 'Record what the label states. Use null for anything it does not state.',
  input_schema: {
    type: 'object',
    properties: {
      water_volume: { type: ['string', 'null'] },
      application_method: { type: ['string', 'null'], enum: ['ground', 'aerial', 'both', null] },
      rainfast_hours: { type: ['number', 'null'] },
      irrigation_hours: { type: ['number', 'null'] },
      reentry_hours: {
        type: ['number', 'null'],
        description: 'The longest Restricted Entry Interval on the label, in hours',
      },
      reentry_field_hours: {
        type: ['number', 'null'],
        description:
          'The REI for ordinary field activities (scouting, irrigation, equipment work), in hours. A non-field SETTING (greenhouse, nursery, turf, sod farm) excludes an interval whatever activity it names; within a field, crop-specific hand labour is excluded. Not necessarily the smaller number.',
      },
      reentry_note: { type: ['string', 'null'] },
      grazing_restriction: { type: ['string', 'null'] },
      evidence: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'field name -> the verbatim label sentence it came from',
      },
      crops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            crop: { type: 'string' },
            pest: { type: ['string', 'null'] },
            rate: { type: ['string', 'null'] },
            preharvest_interval_days: { type: ['integer', 'null'] },
            replant_interval_days: { type: ['integer', 'null'] },
            rotation_restriction: { type: ['string', 'null'] },
            reentry_hours: {
              type: ['number', 'null'],
              description: 'Longest re-entry interval for THIS crop, in hours',
            },
            reentry_field_hours: {
              type: ['number', 'null'],
              description:
                'Re-entry for field work on THIS crop, in hours. Same rules as the product-level field: setting outranks activity, scouting is field work, not necessarily the smaller number.',
            },
            quote: { type: ['string', 'null'] },
          },
          required: ['crop'],
        },
      },
      notes: { type: ['string', 'null'] },
    },
    required: ['crops'],
  },
} as const

const asStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const asNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const asInt = (v: unknown) => {
  const n = asNum(v)
  return n == null ? null : Math.round(n)
}

/** Ask Claude to read the label. Validates and clamps whatever comes back. */
/**
 * Read a label, in sections when it is too long to read in one go.
 *
 * Pardner is 50 pages and Desica 34, and both were abandoned mid-read every
 * time: the invocation is killed before the answer comes back, so they were
 * never read at all. Asking about a few thousand words at a time turns one long
 * call into several short ones, each of which finishes.
 *
 * The sections are merged by mergeExtractions, which takes the longest of any
 * two intervals that disagree and declines to resolve a disagreement about what
 * is permitted.
 */
export async function extractFromLabel(
  text: string,
  apiKey: string,
  model: string,
): Promise<Extracted> {
  if (text.length > CHUNK_THRESHOLD) {
    const chunks = chunkLabelText(text)
    console.log(`[label] ${text.length} chars — reading in ${chunks.length} sections`)
    const parts: Extracted[] = []
    for (const [i, chunk] of chunks.entries()) {
      // Sequential on purpose. These run inside a worker with a time budget and
      // a rate limit; firing ten calls at once trades one kind of failure for
      // another, and a section that fails would take the whole label with it.
      parts.push(await extractOnce(chunk, apiKey, model))
      console.log(`[label] section ${i + 1}/${chunks.length} read`)
    }
    return mergeExtractions(parts)
  }
  try {
    return await extractOnce(text, apiKey, model)
  } catch (e) {
    // Short label, long answer: a glyphosate label is under the threshold but
    // its crop table alone overruns the reply. Roundup WeatherMax failed this
    // way every month. Read it in sections after all, smaller ones.
    if (!(e instanceof Error) || !e.message.startsWith('The label is too long')) throw e
    const chunks = chunkLabelText(text, 9_000)
    console.log(`[label] reply overran on ${text.length} chars — rereading in ${chunks.length} sections`)
    const parts: Extracted[] = []
    for (const chunk of chunks) parts.push(await extractOnce(chunk, apiKey, model))
    return mergeExtractions(parts)
  }
}

async function extractOnce(text: string, apiKey: string, model: string): Promise<Extracted> {
  // Labels run 20k-56k characters. The cap keeps a pathological document from
  // blowing the request; the directions-for-use sections are well before it.
  const body = text.length > 120_000 ? text.slice(0, 120_000) : text
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      // 4096 was too small: a 21-page label produced 22 crop rows and one real
      // product was rejected as "too long to summarise". It was lowered on a
      // hypothesis about why reads were failing that turned out to be wrong —
      // the actual cause was a database trigger rejecting every write.
      max_tokens: 8192,
      tools: [RECORD_TOOL],
      tool_choice: { type: 'tool', name: RECORD_TOOL.name },
      messages: [{ role: 'user', content: `${PROMPT}\n\n--- LABEL ---\n${body}` }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const payload = (await res.json()) as {
    content?: { type: string; text?: string; name?: string; input?: unknown }[]
    stop_reason?: string
  }
  // A truncated reply produces unparseable JSON, and "no JSON object in reply"
  // would send someone hunting the wrong problem.
  if (payload.stop_reason === 'max_tokens') {
    throw new Error('The label is too long to summarise in one reply — report this product.')
  }
  const call = (payload.content ?? []).find(
    (c) => c.type === 'tool_use' && c.name === RECORD_TOOL.name,
  )
  let raw: Record<string, unknown>
  if (call?.input && typeof call.input === 'object') {
    raw = call.input as Record<string, unknown>
  } else {
    // Falling back to prose keeps an older or differently-configured model
    // working, and the error carries what actually came back so a failure is
    // diagnosable rather than just "no JSON".
    const reply = (payload.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    if (start < 0 || end < 0) {
      const blocks = (payload.content ?? []).map((c) => c.type).join(',') || 'none'
      const preview = reply.trim().slice(0, 200) || '(empty)'
      throw new Error(`Model recorded nothing. blocks=[${blocks}] reply="${preview}"`)
    }
    raw = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
  }

  const method = asStr(raw.application_method)
  const evidence: Record<string, string> = {}
  if (raw.evidence && typeof raw.evidence === 'object') {
    for (const [k, v] of Object.entries(raw.evidence as Record<string, unknown>)) {
      const s = asStr(v)
      if (s) evidence[k] = s.slice(0, 600)
    }
  }

  const crops: ExtractedCrop[] = Array.isArray(raw.crops)
    ? (raw.crops as Record<string, unknown>[])
        .map((c) => ({
          crop: asStr(c.crop) ?? '',
          pest: asStr(c.pest),
          rate: asStr(c.rate),
          preharvest_interval_days: asInt(c.preharvest_interval_days),
          replant_interval_days: asInt(c.replant_interval_days),
          rotation_restriction: asStr(c.rotation_restriction),
          reentry_hours: asNum(c.reentry_hours),
          reentry_field_hours: asNum(c.reentry_field_hours),
          quote: asStr(c.quote),
        }))
        .filter((c) => c.crop)
    : []

  return {
    water_volume: asStr(raw.water_volume),
    application_method:
      method === 'ground' || method === 'aerial' || method === 'both' ? method : null,
    rainfast_hours: asNum(raw.rainfast_hours),
    irrigation_hours: asNum(raw.irrigation_hours),
    reentry_hours: asNum(raw.reentry_hours),
    reentry_field_hours: asNum(raw.reentry_field_hours),
    reentry_note: asStr(raw.reentry_note),
    grazing_restriction: asStr(raw.grazing_restriction),
    evidence,
    crops,
    notes: asStr(raw.notes),
  }
}

export type LabelSyncResult = {
  ok: boolean
  registration_number: string
  status: 'extracted' | 'unchanged' | 'no-label' | 'error'
  crops?: number
  detail: string
}

/**
 * Fetch, read and store one product's label.
 *
 * Skips the work when the label document has not changed since last time, which
 * is what keeps the monthly run cheap: one small JSON request per product, and
 * a full read only for labels PMRA has actually reissued.
 */
/**
 * How many times a label may be claimed and abandoned before it is called a
 * failure rather than retried. Four is enough to ride out a redeploy or a slow
 * afternoon at Health Canada, and few enough that a label which genuinely
 * cannot be read stops rather than occupying a worker slot indefinitely.
 */
const MAX_ABANDONED_READS = 4

/**
 * Is there anything to gain from reading this label again?
 *
 * Normally no, when Health Canada is still publishing the same document — the
 * answer would be identical and the call costs money. Two things override that,
 * and the second is the one that was missing: a caller asking directly, and the
 * ROW asking, which is how a change to what we extract reaches labels whose
 * document never changed. Without it, requeueing such a label is a silent
 * no-op that reports ok, and the field it was supposed to fill stays empty.
 */
export function shouldReadAgain(o: {
  forcedByCaller?: boolean
  forcedByRow?: boolean
  previousDocId?: string | null
  currentDocId: string
  extractedAt?: string | null
}): boolean {
  if (o.forcedByCaller || o.forcedByRow) return true
  if (!o.extractedAt) return true // never read
  return o.previousDocId !== o.currentDocId // reissued
}

/**
 * What to do with a label a worker claimed and never finished.
 *
 * Requeue it, but count it first. The read that strands a label is the
 * invocation being killed part way through, which runs no catch block, so this
 * is the only place the attempt can be counted at all — and until it is, the
 * cap never moves and the label cycles forever.
 */
export function abandonedReadOutcome(previousAttempts: number | null | undefined): {
  attempts: number
  status: 'queued' | 'error'
  error: string | null
} {
  const attempts = (previousAttempts ?? 0) + 1
  if (attempts < MAX_ABANDONED_READS) return { attempts, status: 'queued', error: null }
  return {
    attempts,
    status: 'error',
    error: `Abandoned mid-read ${attempts} times — the label is probably too long to finish inside one invocation.`,
  }
}

export async function syncOneLabel(
  sb: SupabaseClient,
  reg: string,
  apiKey: string,
  model: string,
  opts: { force?: boolean } = {},
): Promise<LabelSyncResult> {
  const base = { ok: true, registration_number: reg }
  // Read inside the try, needed inside the catch.
  let existingAttempts = 0

  // This runs in a background function, whose response reaches nobody — it
  // answers 202 before any work starts. So the outcome is written to the row as
  // it happens. Without this a failure is indistinguishable from slowness and
  // the page spins forever.
  const mark = async (patch: Record<string, unknown>) => {
    await sb
      .from('chemical_labels')
      .upsert(
        { registration_number: reg, updated_at: new Date().toISOString(), ...patch },
        { onConflict: 'registration_number' },
      )
  }

  try {
    await mark({
      extraction_status: 'reading',
      extraction_error: null,
      extraction_started_at: new Date().toISOString(),
    })

    const doc = await findLabelDoc(reg)
    if (!doc) {
      await mark({
        extraction_status: 'error',
        extraction_error: 'Health Canada publishes no English approved label for this product.',
      })
      return { ...base, status: 'no-label', detail: 'No English approved label published' }
    }

    const { data: existing } = await sb
      .from('chemical_labels')
      .select('label_doc_id, manual_fields, extracted_at, extraction_attempts, extraction_force')
      .eq('registration_number', reg)
      .maybeSingle()
    existingAttempts = (existing?.extraction_attempts as number | null) ?? 0

    const readAgain = shouldReadAgain({
      forcedByCaller: opts.force,
      forcedByRow: existing?.extraction_force === true,
      previousDocId: existing?.label_doc_id as string | null,
      currentDocId: doc.docId,
      extractedAt: existing?.extracted_at as string | null,
    })
    if (!readAgain) {
      // Clear the 'reading' marker set above, or the row stays mid-flight forever.
      await mark({ extraction_status: 'ok', extraction_error: null })
      return { ...base, status: 'unchanged', detail: 'Label unchanged since last read' }
    }

    const { text, pages } = await fetchLabelText(doc.docId)
    console.log(`[label ${reg}] doc ${doc.docId}: ${pages} pages, ${text.length} chars`)
    const got = await extractFromLabel(text, apiKey, model)
    console.log(`[label ${reg}] read ${got.crops.length} crop rows`)

    // A field someone corrected by hand wins over the extraction, every time.
    const manual = new Set((existing?.manual_fields as string[] | null) ?? [])
    const row: Record<string, unknown> = {
      registration_number: reg,
      label_doc_id: doc.docId,
      label_text: text,
      label_pages: pages,
      extracted_at: new Date().toISOString(),
      extraction_model: model,
      evidence: got.evidence,
      extraction_notes: got.notes,
      extraction_status: 'ok',
      extraction_error: null,
      // The read worked, so the run of failures ends here and the request for
      // a re-read has been satisfied. Leaving the flag set would re-read this
      // label on every pass forever.
      extraction_attempts: 0,
      extraction_force: false,
      updated_at: new Date().toISOString(),
    }
    const assign = (k: string, v: unknown) => {
      if (!manual.has(k)) row[k] = v
    }
    assign('water_volume', got.water_volume)
    assign('application_method', got.application_method)
    assign('rainfast_hours', got.rainfast_hours)
    assign('irrigation_hours', got.irrigation_hours)
    assign('reentry_hours', got.reentry_hours)
    assign('reentry_field_hours', got.reentry_field_hours)
    assign('reentry_note', got.reentry_note)
    assign('grazing_restriction', got.grazing_restriction)

    const { error } = await sb
      .from('chemical_labels')
      .upsert(row, { onConflict: 'registration_number' })
    if (error) throw new Error(error.message)

    // Replace only what a previous extraction wrote; hand-entered crop rows stay.
    await sb
      .from('chemical_label_crops')
      .delete()
      .eq('registration_number', reg)
      .eq('origin', 'claude')

    if (got.crops.length) {
      const rows = got.crops.map((c) => ({
        registration_number: reg,
        crop: c.crop.slice(0, 200),
        pest: c.pest,
        rate: c.rate,
        preharvest_interval_days: c.preharvest_interval_days,
        replant_interval_days: c.replant_interval_days,
        rotation_restriction: c.rotation_restriction,
        reentry_hours: c.reentry_hours,
        reentry_field_hours: c.reentry_field_hours,
        origin: 'claude',
        evidence: c.quote ? { quote: c.quote.slice(0, 600) } : null,
        updated_at: new Date().toISOString(),
      }))
      // A hand-entered row for the same crop+pest must not be clobbered.
      await sb.from('chemical_label_crops').upsert(rows, {
        onConflict: 'registration_number,crop,pest',
        ignoreDuplicates: true,
      })
    }

    return {
      ...base,
      status: 'extracted',
      crops: got.crops.length,
      detail: `${got.crops.length} crop rates from ${pages} pages`,
    }
  } catch (e) {
    const message = (e as Error).message.slice(0, 300)
    // A dropped connection or a 5xx from Health Canada says nothing about the
    // product; it should go back in the queue rather than stand as a verdict.
    // Attempts are capped so a product that always fails still stops.
    const transient = /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|\b5\d\d\b|\b429\b/i.test(message)
    const attempts = ((existingAttempts ?? 0) as number) + 1
    if (transient && attempts < 4) {
      console.warn(`[label ${reg}] attempt ${attempts} failed, requeueing: ${message}`)
      await mark({
        extraction_status: 'queued',
        extraction_error: null,
        extraction_attempts: attempts,
      }).catch(() => {})
      return { ok: false, registration_number: reg, status: 'error', detail: message }
    }
    // Both channels on purpose: the row is what the user sees, the log is what
    // survives when the row write is itself the thing that failed.
    console.error(`[label ${reg}] ${message}`)
    await mark({ extraction_status: 'error', extraction_error: message }).catch((err) => {
      console.error(`[label ${reg}] could not record the failure: ${String(err)}`)
    })
    return { ok: false, registration_number: reg, status: 'error', detail: message }
  }
}

/**
 * Registration numbers worth reading: the products actually applied on this
 * farm, newest first. Reading all 2,285 registered products would be wasteful
 * when about 60 turn up in the spray records.
 */
export async function registrationsInUse(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.rpc('chemical_registrations_in_use')
  if (Array.isArray(data) && data.length) {
    return (data as { registration_number: string }[]).map((r) => r.registration_number)
  }
  return []
}

/**
 * Put products in line to be read.
 *
 * A queued row exists with nothing in it but its status, so the page can say
 * "waiting to be read" rather than "not read yet", and the worker has a work
 * list that survives restarts.
 */
export async function queueLabels(
  sb: SupabaseClient,
  regs: string[],
  opts: { force?: boolean } = {},
): Promise<number> {
  if (!regs.length) return 0

  // force is for when the EXTRACTION changed rather than the document — a new
  // field to fill, a corrected instruction. Those labels have already been read
  // and their PDFs are identical, so without this they are skipped twice over:
  // once here for having an extracted_at, and again in the worker for having an
  // unchanged doc id. That is what made requeueing look like it worked.
  if (opts.force) {
    const { error } = await sb
      .from('chemical_labels')
      .update({
        extraction_status: 'queued',
        extraction_force: true,
        extraction_error: null,
        updated_at: new Date().toISOString(),
      })
      .in('registration_number', regs)
    if (error) throw new Error(error.message)
    return regs.length
  }

  // Anything already read stays read — re-reading is the monthly job's business,
  // driven by the label document actually changing.
  const { data: known } = await sb
    .from('chemical_labels')
    .select('registration_number, extracted_at')
    .in('registration_number', regs)
  const done = new Set(
    (known ?? []).filter((r) => r.extracted_at).map((r) => r.registration_number as string),
  )
  const rows = regs
    .filter((r) => !done.has(r))
    .map((registration_number) => ({ registration_number, extraction_status: 'queued' }))
  if (!rows.length) return 0
  const { error } = await sb
    .from('chemical_labels')
    .upsert(rows, { onConflict: 'registration_number', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  return rows.length
}

export type QueueResult = { processed: number; failed: number; remaining: number; detail: string }

/**
 * Work the queue for a while, then stop and leave the rest for the next run.
 *
 * Reading a label takes 15-40 seconds, so a few thousand products cannot be done
 * in one invocation whatever the platform limit is. The worker takes a time
 * budget instead of a fixed count: it stops cleanly before the function is
 * killed, which is what keeps a half-written row from being left behind.
 */
export async function runLabelQueue(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  opts: { budgetMs?: number; batch?: number } = {},
): Promise<QueueResult> {
  const budgetMs = opts.budgetMs ?? 8 * 60_000
  const startedAt = Date.now()
  let processed = 0
  let failed = 0

  // Anything a previous worker claimed and never finished. The queue only ever
  // selects 'queued', so a run killed mid-label — a bad API key, a timeout, a
  // redeploy — left that label in 'reading' where nothing would ever look at it
  // again. Eighteen sat like that for twenty-two days before anybody noticed.
  //
  // Half an hour is far longer than the 15-40 seconds a label takes, so this
  // cannot steal one from a worker that is still going.
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data: stale } = await sb
    .from('chemical_labels')
    .select('registration_number, extraction_attempts')
    .eq('extraction_status', 'reading')
    .lt('updated_at', staleBefore)

  // Count the abandoned read as an attempt. The worker's own catch cannot: the
  // failure that strands a label is the invocation being killed part way
  // through, which runs no catch block. Without counting it here the cap below
  // never moves and a label that can never be read inside one invocation
  // cycles forever, looking busy and finishing nothing.
  for (const row of stale ?? []) {
    const outcome = abandonedReadOutcome(row.extraction_attempts as number | null)
    await sb
      .from('chemical_labels')
      .update({
        extraction_attempts: outcome.attempts,
        extraction_status: outcome.status,
        extraction_error: outcome.error,
        updated_at: new Date().toISOString(),
      })
      .eq('registration_number', row.registration_number)
    if (outcome.status === 'error')
      console.error(
        `[labels] giving up on ${row.registration_number} after ${outcome.attempts} abandoned reads`,
      )
  }
  if (stale?.length) console.warn(`[labels] recovered ${stale.length} abandoned mid-read`)

  while (Date.now() - startedAt < budgetMs) {
    const { data: next } = await sb
      .from('chemical_labels')
      .select('registration_number')
      .eq('extraction_status', 'queued')
      .limit(opts.batch ?? 1)
    const item = next?.[0]?.registration_number as string | undefined
    if (!item) break

    const r = await syncOneLabel(sb, item, apiKey, model)
    if (r.status === 'error') failed++
    else processed++
  }

  const { count } = await sb
    .from('chemical_labels')
    .select('registration_number', { count: 'exact', head: true })
    .eq('extraction_status', 'queued')
  const remaining = count ?? 0

  const detail = `${processed} read, ${failed} failed, ${remaining} still queued`
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'chemical_labels',
    p_detail: detail,
    p_data_at: null,
  })
  return { processed, failed, remaining, detail }
}

export type LabelsSyncSummary = {
  ok: boolean
  checked: number
  extracted: number
  unchanged: number
  failed: number
  detail: string
}

/** The monthly pass over every product the farm uses. */
export async function runLabelsSync(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  opts: { limit?: number } = {},
): Promise<LabelsSyncSummary> {
  const regs = await registrationsInUse(sb)
  const slice = opts.limit ? regs.slice(0, opts.limit) : regs
  let extracted = 0
  let unchanged = 0
  let failed = 0
  const problems: string[] = []

  for (const reg of slice) {
    const r = await syncOneLabel(sb, reg, apiKey, model)
    if (r.status === 'extracted') extracted++
    else if (r.status === 'unchanged') unchanged++
    else {
      failed++
      problems.push(`${reg}: ${r.detail}`)
    }
  }

  const detail =
    `${extracted} labels read, ${unchanged} unchanged` +
    (failed ? ` · ${failed} could not be read (${problems.slice(0, 3).join('; ')})` : '')

  await sb.rpc('record_integration_heartbeat', {
    p_key: 'chemical_labels',
    p_detail: detail,
    p_data_at: null,
  })

  return { ok: failed < slice.length, checked: slice.length, extracted, unchanged, failed, detail }
}
