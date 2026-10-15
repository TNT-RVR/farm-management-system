/**
 * What is inside a zip, without writing it to disk.
 *
 * Written for John Deere's field-operation export. The link is called
 * `shapeFileAsync` and everything about the name says "ask for a job, poll for
 * a result" — so the first probe treated it as JSON, choked on
 * `Unexpected token 'P'`, and reported a failure. 'P' is the P of PK: the
 * endpoint answers synchronously with a zip. A whole pipeline was nearly
 * designed around an asynchronous export that does not exist.
 *
 * Deere ships ONE merged layer per operation rather than a layer per
 * measurement, so the question "is elevation in here" is not answered by the
 * file names — it is answered by the .dbf columns, and by the small metadata
 * JSON that rides along beside them. Hence readMember: the listing alone is not
 * enough, and inflating four kilobytes out of a buffer already in memory is
 * free where unpacking a four-gigabyte .dbf is not.
 *
 * The central directory is read by scanning for its signature rather than by
 * walking back from the EOCD record, so a zip with a trailing comment — or one
 * truncated by a byte cap — still lists what it can instead of refusing.
 */

export type ZipEntry = {
  name: string
  /** Bytes when decompressed. */
  size: number
  compressedSize: number
  /** 0 = stored, 8 = deflate. Anything else this cannot read. */
  method: number
  /** Where this member's local header sits in the file. */
  localOffset: number
}

/** Does this look like a zip at all? The first four bytes of any zip member. */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

const CENTRAL = [0x50, 0x4b, 0x01, 0x02] as const
/** A 32-bit field pegged at its maximum means "the real value is in ZIP64". */
const OVERFLOW = 0xffffffff

/**
 * Pull the true sizes and offset out of the ZIP64 extra field.
 *
 * Deere's harvest export needs this: one .dbf reported 4,294,967,295 bytes,
 * which is not a size but the 32-bit field giving up. Reading it literally
 * turns a four-gigabyte table into a suspiciously round number that looks like
 * a value and is not one.
 */
function zip64(
  view: DataView,
  extraStart: number,
  extraLen: number,
  size: number,
  compressedSize: number,
  localOffset: number,
): { size: number; compressedSize: number; localOffset: number } {
  let p = extraStart
  const end = extraStart + extraLen
  while (p + 4 <= end) {
    const id = view.getUint16(p, true)
    const len = view.getUint16(p + 2, true)
    if (id === 0x0001) {
      // Only the fields that overflowed are present, in this order.
      let q = p + 4
      if (size === OVERFLOW && q + 8 <= end) {
        size = Number(view.getBigUint64(q, true))
        q += 8
      }
      if (compressedSize === OVERFLOW && q + 8 <= end) {
        compressedSize = Number(view.getBigUint64(q, true))
        q += 8
      }
      if (localOffset === OVERFLOW && q + 8 <= end) {
        localOffset = Number(view.getBigUint64(q, true))
      }
      break
    }
    p += 4 + len
  }
  return { size, compressedSize, localOffset }
}

/** Every file named in the zip's central directory. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: ZipEntry[] = []

  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (
      bytes[i] !== CENTRAL[0] ||
      bytes[i + 1] !== CENTRAL[1] ||
      bytes[i + 2] !== CENTRAL[2] ||
      bytes[i + 3] !== CENTRAL[3]
    ) {
      continue
    }
    const method = view.getUint16(i + 10, true)
    const nameLen = view.getUint16(i + 28, true)
    const extraLen = view.getUint16(i + 30, true)
    const commentLen = view.getUint16(i + 32, true)
    const nameStart = i + 46
    if (nameStart + nameLen > bytes.length) break

    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen))
    const real = zip64(
      view,
      nameStart + nameLen,
      extraLen,
      view.getUint32(i + 24, true),
      view.getUint32(i + 20, true),
      view.getUint32(i + 42, true),
    )

    out.push({ name, method, ...real })
    // Jump the whole record rather than resuming the byte scan inside it, so a
    // filename that happens to contain the signature cannot invent an entry.
    i = nameStart + nameLen + extraLen + commentLen - 1
  }
  return out
}

/**
 * Decompress one member.
 *
 * Sizes come from the CENTRAL directory, never from the local header: a zip
 * written as a stream leaves the local sizes at zero and puts the real ones in
 * a descriptor after the data, which would read as an empty file.
 */
export async function readZipMember(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const o = entry.localOffset
  if (o + 30 > bytes.length || view.getUint32(o, true) !== 0x04034b50) {
    throw new Error(`No local header for ${entry.name}`)
  }
  const nameLen = view.getUint16(o + 26, true)
  const extraLen = view.getUint16(o + 28, true)
  const start = o + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error(`Compression ${entry.method} is not supported`)

  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The layers a shapefile bundle contains.
 *
 * A shapefile is four or five files sharing a stem — .shp, .dbf, .prj, .shx —
 * so the stems are what name the layers.
 */
export function shapefileLayers(entries: ZipEntry[]): string[] {
  const stems = new Set<string>()
  for (const e of entries) {
    const m = /([^/\\]+)\.shp$/i.exec(e.name)
    if (m) stems.add(m[1])
  }
  return [...stems].sort()
}

/**
 * How many points a shapefile holds, read off the .shx index.
 *
 * The index is a fixed eight bytes per record after a 100-byte header, so this
 * is exact and costs nothing — where counting the .shp itself would mean
 * decompressing a hundred megabytes to learn one number.
 */
export function pointCount(entries: ZipEntry[]): number | null {
  const shx = entries.find((e) => /\.shx$/i.test(e.name))
  if (!shx || shx.size < 100) return null
  return Math.floor((shx.size - 100) / 8)
}
