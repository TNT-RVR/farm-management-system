/**
 * Text fixes shared by the two scripts that write research_paper_chunks.
 */

/**
 * Drop half a character.
 *
 * A character outside the basic plane -- an emoji, some maths symbols, the odd
 * CJK glyph -- is two JavaScript string units. Cutting a string at a chosen
 * length can land between them, and the half left behind is not valid UTF-8.
 * PostgREST then refuses the whole request with "invalid input syntax for type
 * json", which is reported against the paper as though its PDF were broken.
 *
 * One paper failed this way for months. Its text was perfectly clean -- every
 * page inserted on its own without complaint. The fault was the chunker's own
 * slice, so checking the source text for bad characters found nothing.
 *
 * Takes the pairs it can and drops the halves it cannot.
 */
export function dropLoneSurrogates(s) {
  // The common case: nothing to do, and no copy made.
  if (!/[\uD800-\uDFFF]/.test(s)) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1]
        i++
      }
      // else: a high surrogate with nothing after it. Drop it.
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // A low surrogate with nothing before it. Drop it.
    } else {
      out += s[i]
    }
  }
  return out
}
