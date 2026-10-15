/**
 * One column out of the .dbf inside a Deere export, without holding the .dbf.
 *
 * A sprayer logs a row per section per second, and a harvest is 3.9 million
 * rows and a 3.4 GB .dbf. Inflating that into memory to read one column is
 * how the first version of the session reader used its whole gigabyte in
 * eleven seconds. So the zip is walked for the entry, the entry is inflated
 * as a stream, and records are parsed as the bytes arrive: the header first,
 * then fixed-width records off a rolling buffer, keeping only the one field.
 */
import { createInflateRaw } from 'node:zlib'
import { Readable } from 'node:stream'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

/**
 * Sizes and offsets a ZIP64 archive keeps in the extra field.
 *
 * A 32-bit size of 0xFFFFFFFF means "look in the extra field", where the
 * 64-bit values appear in a fixed order, but only the ones that overflowed.
 */
function zip64(extra: Uint8Array, want: { comp: boolean; uncomp: boolean; offset: boolean }) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength)
  let p = 0
  while (p + 4 <= extra.length) {
    const id = view.getUint16(p, true)
    const size = view.getUint16(p + 2, true)
    if (id === 0x0001) {
      let q = p + 4
      const out: { uncomp?: number; comp?: number; offset?: number } = {}
      if (want.uncomp && q + 8 <= p + 4 + size) {
        out.uncomp = Number(view.getBigUint64(q, true))
        q += 8
      }
      if (want.comp && q + 8 <= p + 4 + size) {
        out.comp = Number(view.getBigUint64(q, true))
        q += 8
      }
      if (want.offset && q + 8 <= p + 4 + size) out.offset = Number(view.getBigUint64(q, true))
      return out
    }
    p += 4 + size
  }
  return {}
}

/** The decompressed bytes of the first entry whose name passes `pick`, as chunks. */
export async function* zipEntryChunks(
  buf: ArrayBuffer,
  pick: (name: string) => boolean,
): AsyncGenerator<Uint8Array> {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65536); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file')
  const count = view.getUint16(eocd + 10, true)
  let pos = view.getUint32(eocd + 16, true)
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== CENTRAL_SIG) throw new Error('Corrupt ZIP central directory')
    const method = view.getUint16(pos + 10, true)
    let compSize = view.getUint32(pos + 20, true)
    const uncompSize = view.getUint32(pos + 24, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    let localOffset = view.getUint32(pos + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen))
    const extra = bytes.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen)
    pos += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || !pick(name)) continue
    const big = zip64(extra, {
      uncomp: uncompSize === 0xffffffff,
      comp: compSize === 0xffffffff,
      offset: localOffset === 0xffffffff,
    })
    if (big.comp != null) compSize = big.comp
    if (big.offset != null) localOffset = big.offset
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error(`Corrupt ZIP local header for ${name}`)
    const lNameLen = view.getUint16(localOffset + 26, true)
    const lExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    // To the end of the file if the size is not to be trusted: an inflater
    // stops at the end of its own stream regardless.
    const dataEnd = compSize > 0 && dataStart + compSize <= bytes.length ? dataStart + compSize : bytes.length
    const raw = bytes.subarray(dataStart, dataEnd)
    if (method === 0) {
      yield raw
      return
    }
    if (method !== 8) throw new Error(`Unsupported ZIP compression method ${method} for ${name}`)
    // Node's inflater rather than DecompressionStream: the latter refuses
    // any byte after the deflate stream ends, and Deere's zips carry some.
    const inflater = createInflateRaw()
    Readable.from([Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)]).pipe(inflater)
    for await (const chunk of inflater) yield chunk as Uint8Array
    return
  }
  throw new Error('No matching entry in the export')
}

type Layout = { headerLength: number; recordLength: number; offset: number; length: number }

function layoutFor(header: Uint8Array, column: string): Layout {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const headerLength = view.getUint16(8, true)
  const recordLength = view.getUint16(10, true)
  const dec = new TextDecoder('latin1')
  let pos = 32
  let offset = 1
  while (pos + 32 <= headerLength && header[pos] !== 0x0d) {
    let end = pos
    while (end < pos + 11 && header[end] !== 0) end++
    const name = dec.decode(header.subarray(pos, end))
    const length = header[pos + 16]
    if (name.toLowerCase() === column.toLowerCase()) return { headerLength, recordLength, offset, length }
    offset += length
    pos += 32
  }
  throw new Error(`No "${column}" column in the export`)
}

/** Where a column sits in each record, or null when the export has no such column. */
function columnAt(header: Uint8Array, column: string): { offset: number; length: number } | null {
  try {
    const l = layoutFor(header, column)
    return { offset: l.offset, length: l.length }
  } catch {
    return null
  }
}

/**
 * The distinct timestamps AND the sum of one numeric column, in one pass.
 *
 * For fuel: Deere's FUEL column is US gallons burned since the previous point,
 * already split across the sections in proportion to their width (a 14.7 ft
 * section carries 4/3 of an 11 ft one at the same instant). So the pass's fuel
 * is the plain sum over EVERY record — de-duplicating by timestamp, as the
 * sessions do, would throw away all but one section's share. Checked against
 * a 9-section seeding: 24.2 gal summed, 7.6 gal de-duplicated, and the summed
 * figure is the one that matches an air drill's burn per acre.
 *
 * `summed` is false when the export has no such column (a few early seeding
 * files have no FUEL), which is "unknown", not zero.
 */
export async function dbfTimesAndSum(
  chunks: AsyncIterable<Uint8Array>,
  timeColumn: string,
  sumColumn: string,
  cap = 2_000_000,
): Promise<{ times: string[]; sum: number; summed: boolean }> {
  const dec = new TextDecoder('latin1')
  const times: string[] = []
  const seen = new Set<string>()
  let sum = 0
  let carry = new Uint8Array(0)
  let layout: Layout | null = null
  let sumAt: { offset: number; length: number } | null = null
  let consumedHeader = false
  for await (const chunk of chunks) {
    const buf = new Uint8Array(carry.length + chunk.length)
    buf.set(carry)
    buf.set(chunk, carry.length)
    let at = 0
    if (!consumedHeader) {
      if (buf.length < 12) {
        carry = buf
        continue
      }
      const headerLength = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(8, true)
      if (buf.length < headerLength) {
        carry = buf
        continue
      }
      const header = buf.subarray(0, headerLength)
      layout = layoutFor(header, timeColumn)
      sumAt = columnAt(header, sumColumn)
      at = headerLength
      consumedHeader = true
    }
    const { recordLength, offset, length } = layout!
    while (at + recordLength <= buf.length) {
      if (buf[at] !== 0x2a) {
        const t = dec.decode(buf.subarray(at + offset, at + offset + length)).trim()
        if (t && !seen.has(t) && times.length < cap) {
          seen.add(t)
          times.push(t)
        }
        if (sumAt) {
          const v = Number(dec.decode(buf.subarray(at + sumAt.offset, at + sumAt.offset + sumAt.length)).trim())
          if (Number.isFinite(v) && v > 0) sum += v
        }
      }
      at += recordLength
    }
    carry = buf.subarray(at)
  }
  return { times, sum, summed: sumAt != null }
}

/**
 * Every distinct value of `column`, in file order, deleted records skipped.
 *
 * Distinct because a sprayer writes the same second for every section, and
 * the sessions only need one point per second.
 */
export async function dbfDistinctColumn(
  chunks: AsyncIterable<Uint8Array>,
  column: string,
  cap = 2_000_000,
): Promise<string[]> {
  const dec = new TextDecoder('latin1')
  const out: string[] = []
  const seen = new Set<string>()
  let carry = new Uint8Array(0)
  let layout: Layout | null = null
  let consumedHeader = false
  for await (const chunk of chunks) {
    // Join with whatever was left over. Small: at most one record plus one chunk.
    const buf = new Uint8Array(carry.length + chunk.length)
    buf.set(carry)
    buf.set(chunk, carry.length)
    let at = 0
    if (!consumedHeader) {
      if (buf.length < 12) {
        carry = buf
        continue
      }
      const headerLength = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(8, true)
      if (buf.length < headerLength) {
        carry = buf
        continue
      }
      layout = layoutFor(buf.subarray(0, headerLength), column)
      at = headerLength
      consumedHeader = true
    }
    const { recordLength, offset, length } = layout!
    while (at + recordLength <= buf.length) {
      if (buf[at] !== 0x2a) {
        const v = dec.decode(buf.subarray(at + offset, at + offset + length)).trim()
        if (v && !seen.has(v)) {
          seen.add(v)
          out.push(v)
          if (out.length >= cap) return out
        }
      }
      at += recordLength
    }
    carry = buf.subarray(at)
  }
  return out
}
