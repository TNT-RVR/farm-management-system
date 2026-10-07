import { describe, expect, it } from 'vitest'
import { kmlPolygons, pastureShapes } from './kml-polygons'

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Farm</name>
<Folder><name>Pastures/Fence Lines</name>
  <Placemark><name>Pasture 1</name><Polygon><outerBoundaryIs><LinearRing><tessellate>1</tessellate><coordinates>
    -108.40,52.44,0 -108.39,52.44,0 -108.39,52.45,0 -108.40,52.45,0 -108.40,52.44,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><name><![CDATA[Hay Yard]]></name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -108.7,52.4 -108.69,52.4 -108.69,52.41 -108.7,52.4
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Paddock North &amp; East</name><MultiGeometry>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>0.2,0.1 0.3,0.1 0.3,0.2 0.2,0.1</coordinates></LinearRing></innerBoundaryIs></Polygon>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>2,2 3,2 3,3 2,2</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </MultiGeometry></Placemark>
</Folder>
<Folder><name>Gates</name><Placemark><name>A1</name><Point><coordinates>-108.7,52.4,0</coordinates></Point></Placemark></Folder>
<Folder><name>Lease Land</name><Placemark><name>Pasture lease</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>
</Document></kml>`

describe('kmlPolygons', () => {
  it('reads named polygons with their layer, holes and multi-parts', () => {
    const polys = kmlPolygons(KML)
    expect(polys.map((p) => p.name)).toEqual(['Pasture 1', 'Hay Yard', 'Paddock North & East', 'Pasture lease'])
    expect(polys[0].folder).toBe('Pastures/Fence Lines')
    expect(polys[0].coordinates[0][0]).toHaveLength(5)
    expect(polys[0].coordinates[0][0][0]).toEqual([-108.4, 52.44])
    expect(polys[2].coordinates).toHaveLength(2)
    expect(polys[2].coordinates[0]).toHaveLength(2)
  })
  it('keeps only pastures from the pasture layer', () => {
    expect(pastureShapes(kmlPolygons(KML)).map((p) => p.name)).toEqual(['Pasture 1', 'Paddock North & East'])
  })
})
