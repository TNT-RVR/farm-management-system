/**
 * Points and their attributes out of a Deere export, a record at a time.
 *
 * dbf-stream.ts reads one column for the session clock. The Profit/Loss Map
 * needs WHERE each point is as well as what it logged, which lives in two
 * files: the position in the .shp, the rate and swath in the .dbf, matched by
 * record number. Both are inflated as streams and walked in lockstep, so a
 * 3.4 GB harvest .dbf costs a few hundred kilobytes of memory, not 3.4 GB.
 *
 * Deleted .dbf records still have a .shp record, so they are yielded as null
 * rather than skipped. Skipping them would put every later rate on the wrong
 * point.
 */

/** Joins a carried remainder with the next chunk. Small: one record plus one chunk. */
function join(carry: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (!carry.length) return chunk
  const buf = new Uint8Array(carry.length + chunk.length)
  buf.set(carry)
  buf.set(chunk, carry.length)
  return buf
}

/**
 * [x, y] for each record, in file order. Null for a null shape.
 *
 * Handles Point, PointZ and PointM: all three start with x then y, and each
 * record says its own length, so the Z and M tails are simply stepped over.
 */
export async function* shpPoints(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<[number, number] | null> {
  let carry: Uint8Array = new Uint8Array(0)
  let headerDone = false
  for await (const chunk of chunks) {
    const buf = join(carry, chunk)
    let at = 0
    if (!headerDone) {
      if (buf.length < 100) {
        carry = buf
        continue
      }
      at = 100
      headerDone = true
    }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    while (at + 8 <= buf.length) {
      // Content length is in 16-bit words, big-endian, not counting the header.
      const len = view.getInt32(at + 4, false) * 2
      if (at + 8 + len > buf.length) break
      const type = len >= 4 ? view.getInt32(at + 8, true) : 0
      if (type === 0 || len < 20) yield null
      else yield [view.getFloat64(at + 12, true), view.getFloat64(at + 20, true)]
      at += 8 + len
    }
    carry = buf.subarray(at)
  }
}

export type DbfColumn = { name: string; offset: number; length: number }

export function dbfColumns(header: Uint8Array): { headerLength: number; recordLength: number; columns: DbfColumn[] } {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const headerLength = view.getUint16(8, true)
  const recordLength = view.getUint16(10, true)
  const dec = new TextDecoder('latin1')
  const columns: DbfColumn[] = []
  let pos = 32
  let offset = 1 // byte 0 of a record is the deletion flag
  while (pos + 32 <= headerLength && header[pos] !== 0x0d) {
    let end = pos
    while (end < pos + 11 && header[end] !== 0) end++
    const length = header[pos + 16]
    columns.push({ name: dec.decode(header.subarray(pos, end)), offset, length })
    offset += length
    pos += 32
  }
  return { headerLength, recordLength, columns }
}

/**
 * The values of the chosen columns for every record, in file order.
 *
 * `choose` is handed every column name once the header is read and returns the
 * ones wanted, so the caller can pick by what the export actually contains —
 * Deere names the yield column differently by machine. A name that is not in
 * the file reads as undefined in every record rather than failing.
 */
export async function* dbfRecords(
  chunks: AsyncIterable<Uint8Array>,
  choose: (names: string[]) => string[],
): AsyncGenerator<Record<string, string> | null> {
  const dec = new TextDecoder('latin1')
  let carry: Uint8Array = new Uint8Array(0)
  let layout: { recordLength: number; picked: DbfColumn[] } | null = null
  for await (const chunk of chunks) {
    const buf = join(carry, chunk)
    let at = 0
    if (!layout) {
      if (buf.length < 12) {
        carry = buf
        continue
      }
      const headerLength = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(8, true)
      if (buf.length < headerLength) {
        carry = buf
        continue
      }
      const { recordLength, columns } = dbfColumns(buf.subarray(0, headerLength))
      const wanted = new Set(choose(columns.map((c) => c.name)).map((n) => n.toLowerCase()))
      layout = { recordLength, picked: columns.filter((c) => wanted.has(c.name.toLowerCase())) }
      at = headerLength
    }
    const { recordLength, picked } = layout
    while (at + recordLength <= buf.length) {
      if (buf[at] === 0x1a) return // end-of-file marker
      if (buf[at] === 0x2a) {
        yield null
      } else {
        const rec: Record<string, string> = {}
        for (const c of picked) rec[c.name] = dec.decode(buf.subarray(at + c.offset, at + c.offset + c.length)).trim()
        yield rec
      }
      at += recordLength
    }
    carry = buf.subarray(at)
  }
}

/** Walks two record streams side by side, stopping when either runs out. */
export async function* zipRecords<A, B>(a: AsyncIterator<A>, b: AsyncIterator<B>): AsyncGenerator<[A, B]> {
  for (;;) {
    const [x, y] = await Promise.all([a.next(), b.next()])
    if (x.done || y.done) return
    yield [x.value, y.value]
  }
}
