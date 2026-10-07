/**
 * Turning a watched web source into text a person can compare, and the
 * comparison itself. Used by the AIMM source watch; general enough for any
 * page or file an app wants to be told about when it changes.
 *
 * Raw HTML is the wrong thing to fingerprint: pages carry session tokens,
 * analytics ids and build hashes that differ on every load, so a hash of the
 * raw page says "changed" when nothing a person would read has moved. The
 * readable text — plus the documents a page links to, since a new manual is
 * usually just a new link — is what is compared.
 */

const DOC_LINK = /href\s*=\s*["']([^"']+\.(?:pdf|csv|txt|exe|msi|zip|xlsx?)(?:\?[^"']*)?)["']/gi

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/** The page's title, or null. */
export function htmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : null
}

/** A page that answered but is a "not found" page all the same. */
export function looksGone(status: number, html: string | null): boolean {
  if (status >= 400) return true
  const t = html ? htmlTitle(html) : null
  return t != null && /page not found|\b404\b|not found|no longer available/i.test(t)
}

/**
 * Readable text for a source, or null for a binary file (compared by its
 * bytes instead). One line per visible block; linked documents listed at the
 * end; JSON re-serialised with sorted keys so key order never reads as change.
 */
export function readableText(body: string, contentType: string): string | null {
  const ct = contentType.toLowerCase()
  if (/pdf|octet-stream|zip|msword|excel|spreadsheet|image\//.test(ct)) return null
  if (ct.includes('json')) {
    try {
      return stableJson(JSON.parse(body))
    } catch {
      return body.trim()
    }
  }
  if (!ct.includes('html')) return body.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim()
  const links = [...new Set([...body.matchAll(DOC_LINK)].map((m) => decode(m[1])))].sort()
  const text = decode(
    body
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|p|div|li|tr|h[1-6]|section|article|header|footer|td|th|dt|dd)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return [...lines, ...links.map((l) => `LINK ${l}`)].join('\n')
}

function stableJson(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]))
        : x
  return JSON.stringify(sort(v), null, 1)
}

/**
 * What changed between two versions, line by line: lines that are new and
 * lines that went, each at most `limit`. Order-insensitive on purpose — a
 * paragraph moving down the page is not news.
 */
export function lineDiff(prev: string, next: string, limit = 40): { added: string[]; removed: string[]; more: number } {
  const count = (s: string) => {
    const m = new Map<string, number>()
    for (const l of s.split('\n')) m.set(l, (m.get(l) ?? 0) + 1)
    return m
  }
  const a = count(prev)
  const b = count(next)
  const added: string[] = []
  const removed: string[] = []
  for (const [l, n] of b) for (let i = 0; i < n - (a.get(l) ?? 0); i++) added.push(l)
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) ?? 0); i++) removed.push(l)
  const more = Math.max(0, added.length - limit) + Math.max(0, removed.length - limit)
  return { added: added.slice(0, limit), removed: removed.slice(0, limit), more }
}
