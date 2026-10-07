import { describe, expect, it } from 'vitest'
import {
  isZip,
  listZip,
  pointCount,
  readZipMember,
  shapefileLayers,
  type ZipEntry,
} from './zipListing'

/** A central-directory record, which is all listZip reads. */
function central(name: string, size: number, compressed = size, offset = 0): Uint8Array {
  const n = new TextEncoder().encode(name)
  const b = new Uint8Array(46 + n.length)
  const v = new DataView(b.buffer)
  b.set([0x50, 0x4b, 0x01, 0x02])
  v.setUint32(20, compressed, true)
  v.setUint32(24, size, true)
  v.setUint16(28, n.length, true)
  v.setUint32(42, offset, true)
  b.set(n, 46)
  return b
}

/** A central record whose sizes overflowed into a ZIP64 extra field. */
function central64(name: string, size: number, compressed: number): Uint8Array {
  const n = new TextEncoder().encode(name)
  const extra = 4 + 16
  const b = new Uint8Array(46 + n.length + extra)
  const v = new DataView(b.buffer)
  b.set([0x50, 0x4b, 0x01, 0x02])
  v.setUint32(20, 0xffffffff, true)
  v.setUint32(24, 0xffffffff, true)
  v.setUint16(28, n.length, true)
  v.setUint16(30, extra, true)
  b.set(n, 46)
  const e = 46 + n.length
  v.setUint16(e, 0x0001, true)
  v.setUint16(e + 2, 16, true)
  v.setBigUint64(e + 4, BigInt(size), true)
  v.setBigUint64(e + 12, BigInt(compressed), true)
  return b
}

function zip(...parts: Uint8Array[]): Uint8Array {
  const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0])
  const total = parts.reduce((n, p) => n + p.length, head.length)
  const out = new Uint8Array(total)
  out.set(head)
  let at = head.length
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('isZip', () => {
  // The exact bytes Deere answered with, which a JSON parser reported as
  // "Unexpected token 'P'" and I first read as a broken endpoint.
  it('recognises the PK header Deere sends', () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]))).toBe(true)
  })

  it('is not fooled by JSON or by something too short', () => {
    expect(isZip(new TextEncoder().encode('{"@type":"Errors"}'))).toBe(false)
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false)
  })
})

describe('listZip', () => {
  it('names every member and its size', () => {
    const entries = listZip(zip(central('Elevation.shp', 128000), central('Elevation.dbf', 64000)))
    expect(entries.map((e) => e.name)).toEqual(['Elevation.shp', 'Elevation.dbf'])
    expect(entries[0].size).toBe(128000)
  })

  // A scan for the signature would otherwise invent an entry from a filename
  // containing those four bytes, which is why each record is jumped whole.
  it('does not invent an entry from a name that contains the signature', () => {
    const entries = listZip(zip(central('PK\u0001\u0002weird.shp', 10), central('Yield.shp', 20)))
    expect(entries).toHaveLength(2)
    expect(entries[1].name).toBe('Yield.shp')
  })

  it('has nothing to say about a buffer with no central directory', () => {
    expect(listZip(new TextEncoder().encode('not a zip at all'))).toEqual([])
  })
})

describe('shapefileLayers', () => {
  it('reduces a bundle to the layers it carries', () => {
    const entries: ZipEntry[] = [
      { name: 'Elevation.shp', size: 1, compressedSize: 1, method: 8, localOffset: 0 },
      { name: 'Elevation.dbf', size: 1, compressedSize: 1, method: 8, localOffset: 0 },
      { name: 'Elevation.prj', size: 1, compressedSize: 1, method: 8, localOffset: 0 },
      { name: 'Yield.shp', size: 1, compressedSize: 1, method: 8, localOffset: 0 },
      { name: 'doc/readme.txt', size: 1, compressedSize: 1, method: 8, localOffset: 0 },
    ]
    expect(shapefileLayers(entries)).toEqual(['Elevation', 'Yield'])
  })

  it('reads a layer out of a folder inside the zip', () => {
    expect(
      shapefileLayers([
        {
          name: '2026 Harvest/Elevation.shp',
          size: 1,
          compressedSize: 1,
          method: 8,
          localOffset: 0,
        },
      ]),
    ).toEqual(['Elevation'])
  })
})

describe('ZIP64', () => {
  // Deere's harvest export reported a .dbf of 4,294,967,295 bytes. That is not
  // a size, it is the 32-bit field giving up — and read literally it turns a
  // four-gigabyte table into a number that looks plausible and is not.
  it('reads the real size out of the extra field instead of the overflow marker', () => {
    const [e] = listZip(zip(central64('big.dbf', 5_000_000_000, 900_000_000)))
    expect(e.size).toBe(5_000_000_000)
    expect(e.compressedSize).toBe(900_000_000)
  })
})

describe('readZipMember', () => {
  it('returns a stored member verbatim', async () => {
    // A minimal zip built by hand: local header, then the bytes, then central.
    const body = new TextEncoder().encode('{"measurements":["Elevation"]}')
    const local = new Uint8Array(30 + 4)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(26, 4, true)
    local.set(new TextEncoder().encode('a.js'), 30)
    const file = new Uint8Array(local.length + body.length)
    file.set(local)
    file.set(body, local.length)

    const entry = {
      name: 'a.js',
      size: body.length,
      compressedSize: body.length,
      method: 0,
      localOffset: 0,
    }
    expect(new TextDecoder().decode(await readZipMember(file, entry))).toBe(
      '{"measurements":["Elevation"]}',
    )
  })

  it('refuses a member it cannot find rather than returning nothing', async () => {
    const entry = { name: 'x', size: 1, compressedSize: 1, method: 0, localOffset: 0 }
    await expect(readZipMember(new Uint8Array(64), entry)).rejects.toThrow('No local header')
  })
})

describe('pointCount', () => {
  // The .shx is eight bytes a record after a 100-byte header, so the count is
  // exact and free — where counting the .shp means inflating 110 MB.
  it('counts records off the index', () => {
    expect(
      pointCount([
        { name: 'a.shx', size: 31_593_124, compressedSize: 1, method: 8, localOffset: 0 },
      ]),
    ).toBe(3_949_128)
  })

  it('has no answer without an index', () => {
    expect(
      pointCount([{ name: 'a.shp', size: 10, compressedSize: 1, method: 8, localOffset: 0 }]),
    ).toBeNull()
  })
})
