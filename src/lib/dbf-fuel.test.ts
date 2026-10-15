import { describe, expect, it } from 'vitest'
import { dbfTimesAndSum } from '../../netlify/shared/dbf-stream'

/** A tiny .dbf: IsoTime (C 24), SECTIONID (N 4), FUEL (N 12). */
function dbf(rows: { t: string; s: number; fuel: string; deleted?: boolean }[], withFuel = true): Uint8Array {
  const cols: [string, string, number][] = [['IsoTime', 'C', 24], ['SECTIONID', 'N', 4]]
  if (withFuel) cols.push(['FUEL', 'N', 12])
  const headerLength = 32 + cols.length * 32 + 1
  const recordLength = 1 + cols.reduce((n, c) => n + c[2], 0)
  const buf = new Uint8Array(headerLength + rows.length * recordLength)
  const view = new DataView(buf.buffer)
  view.setUint32(4, rows.length, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)
  cols.forEach(([name, type, len], i) => {
    const at = 32 + i * 32
    buf.set(new TextEncoder().encode(name), at)
    buf[at + 11] = type.charCodeAt(0)
    buf[at + 16] = len
  })
  buf[headerLength - 1] = 0x0d
  rows.forEach((r, i) => {
    const at = headerLength + i * recordLength
    buf[at] = r.deleted ? 0x2a : 0x20
    const vals = [r.t.padEnd(24), String(r.s).padStart(4), r.fuel.padStart(12)]
    let p = at + 1
    cols.forEach((c, j) => {
      buf.set(new TextEncoder().encode(vals[j]), p)
      p += c[2]
    })
  })
  return buf
}

async function* chunks(b: Uint8Array, size = 37) {
  for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size)
}

describe('fuel off the per-point export', () => {
  it('sums FUEL over every section, not one per timestamp', async () => {
    // One instant, two sections sharing the burn in proportion to width.
    const b = dbf([
      { t: '2026-05-04T21:00:42.273Z', s: 435, fuel: '0.00012866' },
      { t: '2026-05-04T21:00:42.273Z', s: 437, fuel: '9.648E-05' },
      { t: '2026-05-04T21:00:42.472Z', s: 435, fuel: '0.00013042' },
      { t: '2026-05-04T21:00:42.472Z', s: 437, fuel: '0.5', deleted: true },
    ])
    const r = await dbfTimesAndSum(chunks(b), 'IsoTime', 'FUEL')
    expect(r.times).toEqual(['2026-05-04T21:00:42.273Z', '2026-05-04T21:00:42.472Z'])
    expect(r.summed).toBe(true)
    expect(r.sum).toBeCloseTo(0.00012866 + 0.00009648 + 0.00013042, 10)
  })

  it('says when there is no fuel column, rather than reporting zero', async () => {
    const r = await dbfTimesAndSum(chunks(dbf([{ t: '2026-05-04T21:00:42Z', s: 1, fuel: '' }], false)), 'IsoTime', 'FUEL')
    expect(r.summed).toBe(false)
    expect(r.times).toHaveLength(1)
  })
})
