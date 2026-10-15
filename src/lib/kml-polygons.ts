// The polygons in a Google My Maps KML export, by layer — enough to keep the
// app's pastures in step with the map they are drawn on. No DOM: a My Maps
// export is plain, regular KML (Folder > Placemark > Polygon or MultiGeometry),
// so the Netlify function reads it without an XML library. No imports, so the
// browser and the function share it.

export type KmlPolygon = {
  /** The My Maps layer it sits in. */
  folder: string
  name: string
  /** GeoJSON MultiPolygon coordinates: polygons → rings → [lon, lat]. */
  coordinates: number[][][][]
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .trim()

/** "lon,lat[,alt] lon,lat[,alt] …" → [[lon, lat], …]. */
function ring(text: string): number[][] {
  return text
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]])
}

function polygonsIn(placemark: string): number[][][][] {
  const out: number[][][][] = []
  for (const poly of placemark.match(/<Polygon[\s\S]*?<\/Polygon>/g) ?? []) {
    const outer = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(poly)
    if (!outer) continue
    const rings = [ring(outer[1])]
    for (const inner of poly.matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) rings.push(ring(inner[1]))
    if (rings[0].length >= 4) out.push(rings)
  }
  return out
}

/** Every named placemark with at least one polygon, with the layer it is in. */
export function kmlPolygons(kml: string): KmlPolygon[] {
  const out: KmlPolygon[] = []
  for (const folder of kml.match(/<Folder>[\s\S]*?<\/Folder>/g) ?? []) {
    const folderName = decode(/<Folder>\s*<name>([\s\S]*?)<\/name>/.exec(folder)?.[1] ?? '')
    for (const pm of folder.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? []) {
      const name = decode(/<name>([\s\S]*?)<\/name>/.exec(pm)?.[1] ?? '')
      const coordinates = polygonsIn(pm)
      if (name && coordinates.length) out.push({ folder: folderName, name, coordinates })
    }
  }
  return out
}

/**
 * The shapes that are pastures: in a pasture/paddock/fence layer, and named
 * "Pasture …" or "Paddock …". The same layer holds the yard, the house and the
 * solar sites, which are not grazed and must not be counted as grass.
 */
export function pastureShapes(polys: KmlPolygon[]): KmlPolygon[] {
  return polys.filter((p) => /pasture|paddock|fence/i.test(p.folder) && /^(pasture|paddock)\b/i.test(p.name))
}
