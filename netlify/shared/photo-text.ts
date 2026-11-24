/**
 * Reading the writing in a photograph.
 *
 * The document library can find a PDF by what is inside it, because a PDF
 * carries its own words. A photograph carries none: a scale ticket somebody
 * snapped on their knee, a motor's nameplate, a sprinkler chart gone soft in
 * a pocket. Those hold more findable detail than most of the PDFs do — a
 * ticket number, a serial number, a flow rate — and none of it was reachable.
 *
 * So the photo is shown to Claude and what it reads goes on the row. Two
 * things come back and they are kept apart on purpose:
 *
 *   text     what is WRITTEN in the picture, copied out
 *   caption  one sentence on what the picture SHOWS
 *
 * because a photo of a pump in a pit has nothing written in it at all, and
 * ought still to be findable by someone looking for the pump in the pit.
 *
 * The thing to be afraid of here is a confident wrong read. A guessed serial
 * number is worse than a missing one: somebody searches for it, finds this
 * machine, and orders the wrong part. So the prompt says, more than once, to
 * copy only what is legible and to mark what is not — and `unsure` comes back
 * on a photo whose writing is faded or creased, which is the only honest
 * signal available without a person checking every one.
 */

/** What one photo gave up. */
export type PhotoRead = {
  /** The writing in the picture, as copied. Empty when there is none to read. */
  text: string
  /** One sentence on what the picture shows. Empty when the model gave none. */
  caption: string
  kind: 'document' | 'nameplate' | 'scene' | 'other'
  /** The writing was faded, blurred or angled enough that some may be wrong. */
  unsure: boolean
}

export const PHOTO_PROMPT = `This is a photograph kept in a farm's document library. It may be a photo of a PIECE OF PAPER (a scale ticket, a sprinkler chart, an invoice, a handwritten note), a photo of a NAMEPLATE or label on a machine, or a photo of something on the farm with little or no writing in it at all.

Your job is to make it findable months later by somebody searching the library.

1. "text" — copy out every piece of writing you can actually READ in the picture: printed, handwritten, stamped, stencilled, on a sign, on a label, on a screen. Keep it in the order and the lines it appears in.
   - Serial numbers, model numbers, ticket numbers, dates, phone numbers and amounts go down EXACTLY as written, character for character.
   - Copy only what you can see. Put "?" where a single character is unreadable and [unreadable] where a stretch is. NEVER complete a word, a number or a form field from what it probably says: a guessed serial number is worse than a missing one, because somebody will search for it and be sent to the wrong machine.
   - A form's printed labels are writing too; copy the label with whatever is filled into it, as "VARIETY: GN".
   - Leave out writing that tells you nothing about this thing: a brand on somebody's jacket, a road sign in the distance, a logo on a passing truck.
   - If there is no writing you can read, "".
   - A long table -- a sprinkler chart, a parts list -- is copied heading row first, then its rows; stop after about sixty rows and write [more rows not copied] rather than running past the length limit, which would lose the lot.

2. "caption" — one plain sentence saying what the photo shows, so a photo with no writing in it can still be found. Name the thing and its state: "a centrifugal pump and motor in a concrete pit, suction pipe disconnected", not "a photo of farm equipment". About 25 words at most. Describe only what is in the picture; do not work out what it is for, or whether it is a problem.

3. "kind" — "document" (a photo of paper or a screen), "nameplate" (a plate or label fixed to a machine), "scene" (a thing or a place), or "other".

4. "unsure" — true if the writing is faded, blurred, creased or angled enough that some of what you copied could be wrong.

Return ONLY JSON, no prose:
{"text": string, "caption": string, "kind": string, "unsure": boolean}`

const KINDS = new Set(['document', 'nameplate', 'scene', 'other'])

/**
 * The media types the Messages API will take. Anything else — a HEIC straight
 * off an iPhone, a TIFF off a scanner — is not readable here at all, and the
 * caller marks it read-with-nothing rather than fetching it again every night.
 */
export const PHOTO_MEDIA: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** The media type to send, from what the row says and what the name ends in. */
export function photoMediaType(mime: string | null, filename: string | null, path: string): string | null {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase()
  if (Object.values(PHOTO_MEDIA).includes(m)) return m
  const ext = /\.([a-z0-9]+)$/i.exec(filename ?? path)?.[1]?.toLowerCase()
  return (ext && PHOTO_MEDIA[ext]) || null
}

/**
 * Pull the read out of the model's reply. Anything that is not the shape asked
 * for comes back null, so a reply that went sideways is a failure to be
 * retried rather than an empty row that looks like a photo with no writing.
 */
export function parsePhotoRead(replyText: string): PhotoRead | null {
  const start = replyText.indexOf('{')
  const end = replyText.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let p: Record<string, unknown>
  try {
    p = JSON.parse(replyText.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof p.text !== 'string' && typeof p.caption !== 'string') return null
  const kind = typeof p.kind === 'string' && KINDS.has(p.kind) ? (p.kind as PhotoRead['kind']) : 'other'
  return {
    text: typeof p.text === 'string' ? p.text.trim() : '',
    caption: typeof p.caption === 'string' ? p.caption.trim() : '',
    kind,
    unsure: p.unsure === true,
  }
}
