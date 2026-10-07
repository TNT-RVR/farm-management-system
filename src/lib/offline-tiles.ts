/**
 * The satellite imagery, saved for where the farm actually is.
 *
 * Field shapes already draw offline — the boundaries are GeoJSON in the cache —
 * but they draw on grey, and a boundary with no ground under it is close to
 * useless for the thing a map gets opened for in a field: working out which
 * corner you are standing in.
 *
 * The naive version saves the farm's bounding box, and the bounding box is
 * mostly other people's land: 6,048 tiles at zoom 16, about 106 MB, for 21
 * fields that between them occupy a few hundred of them. Enumerating per field
 * instead brings the same zoom down to 391 tiles and about 5 MB, which is a
 * different kind of feature — one you can run on a phone in the yard without
 * thinking about it. The whole farm to zoom 16, every level from 10 up, came to
 * 630 tiles and 8.4 MB when actually measured.
 */

export const TILE_CACHE = 'rvr-map-tiles'

/** Esri World Imagery, the basemap the app already draws. Note {z}/{y}/{x}. */
export const tileUrl = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`

export type Tile = { z: number; x: number; y: number }
export type Box = { w: number; s: number; e: number; n: number }

const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/**
 * Roughly 450 m around each field.
 *
 * Enough to hold the approach road, the pivot point and the corner you park in,
 * which is the ground you are looking at when you check where you are. Beyond
 * that it is somebody else's stubble.
 */
export const DEFAULT_BUFFER_DEG = 0.004

export function tilesForBoxes(
  boxes: Box[],
  minZoom: number,
  maxZoom: number,
  bufferDeg = DEFAULT_BUFFER_DEG,
): Tile[] {
  const seen = new Set<string>()
  const out: Tile[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    for (const b of boxes) {
      const x0 = lonToX(b.w - bufferDeg, z)
      const x1 = lonToX(b.e + bufferDeg, z)
      // y counts down from the north, so the north edge gives the low index.
      const y0 = latToY(b.n + bufferDeg, z)
      const y1 = latToY(b.s - bufferDeg, z)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${z}/${x}/${y}`
          // Fields overlap at low zoom — a whole township is one tile at z12 —
          // so the same tile is reached from several boxes.
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ z, x, y })
        }
      }
    }
  }
  return out
}

/**
 * 14 KB an aerial tile.
 *
 * Measured, not guessed — the first guess of 18 KB overstated a real 630-tile
 * download by three megabytes. An estimate shown next to a Download button is
 * the thing somebody decides on, so it is worth being the real number.
 */
export const TILE_BYTES = 14 * 1024

export const estimateBytes = (count: number) => count * TILE_BYTES

export type TileProgress = { done: number; total: number; failed: number }

/**
 * Fetch and store, a handful at a time.
 *
 * Six in flight rather than all of them: this runs on a phone on yard signal,
 * and firing four thousand requests at somebody else's tile server is both
 * slower and ruder than taking them steadily.
 */
export async function downloadTiles(
  tiles: Tile[],
  onProgress?: (p: TileProgress) => void,
  signal?: AbortSignal,
): Promise<TileProgress> {
  const cache = await caches.open(TILE_CACHE)
  let done = 0
  let failed = 0
  const CONCURRENCY = 6
  let cursor = 0

  const worker = async () => {
    while (cursor < tiles.length) {
      if (signal?.aborted) return
      const t = tiles[cursor++]
      const url = tileUrl(t.z, t.x, t.y)
      try {
        // Already saved from an earlier run, or from ordinary use of the map —
        // the service worker files every tile it fetches into the same cache.
        const hit = await cache.match(url)
        if (!hit) {
          const res = await fetch(url)
          if (!res.ok) throw new Error(String(res.status))
          await cache.put(url, res)
        }
      } catch {
        failed++
      }
      done++
      if (done % 10 === 0 || done === tiles.length) {
        onProgress?.({ done, total: tiles.length, failed })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, () => worker()),
  )
  const final = { done, total: tiles.length, failed }
  onProgress?.(final)
  return final
}

export async function cachedTileCount(): Promise<number> {
  if (!('caches' in globalThis)) return 0
  const cache = await caches.open(TILE_CACHE)
  return (await cache.keys()).length
}

export async function clearTiles(): Promise<void> {
  await caches.delete(TILE_CACHE)
}
