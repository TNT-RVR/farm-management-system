/** Minimal ZIP reader (stored + deflate entries) built on DecompressionStream — no dependency. */

export type ZipEntry = { name: string; data: Uint8Array }

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

export async function readZip(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  // EOCD: scan backwards (comment can pad the end)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65536); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (end-of-central-directory not found)')

  const count = view.getUint16(eocd + 10, true)
  let pos = view.getUint32(eocd + 16, true)

  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== CENTRAL_SIG) {
      throw new Error('Corrupt ZIP central directory')
    }
    const method = view.getUint16(pos + 10, true)
    const compSize = view.getUint32(pos + 20, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen))
    pos += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory

    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`Corrupt ZIP local header for ${name}`)
    }
    const lNameLen = view.getUint16(localOffset + 26, true)
    const lExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(dataStart, dataStart + compSize)

    let data: Uint8Array
    if (method === 0) {
      data = raw.slice()
    } else if (method === 8) {
      const stream = new Blob([raw.slice()]).stream().pipeThrough(
        new DecompressionStream('deflate-raw'),
      )
      data = new Uint8Array(await new Response(stream).arrayBuffer())
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`)
    }
    entries.push({ name, data })
  }
  return entries
}
