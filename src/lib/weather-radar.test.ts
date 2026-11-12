import { describe, expect, it } from 'vitest'
import {
  buildFrames,
  forecastFrameTimes,
  frameRelative,
  isoDurationMinutes,
  legendUrl,
  liveIndex,
  parseTimeDimension,
  radarFrameTimes,
  wmsTiles,
} from './weather-radar'

/** The real shape of what GeoMet answered on 6 Nov 2026. */
const RADAR_XML =
  '<Layer queryable="1"><Name>RADAR_1KM_RRAI</Name><Dimension name="time" units="ISO8601" default="2026-11-06T16:48:00Z" nearestValue="0">2026-11-06T13:48:00Z/2026-11-06T16:48:00Z/PT6M</Dimension></Layer>'
const HRDPS_XML =
  '<Layer><Name>HRDPS.CONTINENTAL_RT</Name><Dimension name="time" units="ISO8601" default="2026-11-06T17:00:00Z" nearestValue="0">2026-11-06T13:00:00Z/2026-11-08T12:00:00Z/PT1H</Dimension><Dimension name="reference_time" units="ISO8601" default="2026-11-06T12:00:00Z">2026-11-05T06:00:00Z/2026-11-06T12:00:00Z/PT6H</Dimension></Layer>'

describe('isoDurationMinutes', () => {
  it('reads the steps GeoMet uses', () => {
    expect(isoDurationMinutes('PT6M')).toBe(6)
    expect(isoDurationMinutes('PT1H')).toBe(60)
    expect(isoDurationMinutes('PT1H30M')).toBe(90)
    expect(isoDurationMinutes('P1D')).toBe(1440)
  })

  it('gives nothing for something it cannot read', () => {
    expect(isoDurationMinutes('')).toBe(0)
    expect(isoDurationMinutes('every 6 min')).toBe(0)
  })
})

describe('parseTimeDimension', () => {
  it('reads the radar interval', () => {
    expect(parseTimeDimension(RADAR_XML)).toEqual({
      start: '2026-11-06T13:48:00Z',
      end: '2026-11-06T16:48:00Z',
      stepMin: 6,
    })
  })

  // reference_time comes second in the document and must not be mistaken for it.
  it('takes the time dimension, not the run time', () => {
    expect(parseTimeDimension(HRDPS_XML)?.stepMin).toBe(60)
    expect(parseTimeDimension(HRDPS_XML)?.end).toBe('2026-11-08T12:00:00Z')
  })

  it('reads a plain list of instants', () => {
    const xml = '<Dimension name="time" units="ISO8601">2026-11-06T13:00:00Z,2026-11-06T14:00:00Z,2026-11-06T15:00:00Z</Dimension>'
    expect(parseTimeDimension(xml)).toEqual({
      start: '2026-11-06T13:00:00Z',
      end: '2026-11-06T15:00:00Z',
      stepMin: 60,
    })
  })

  it('says nothing when the document has no time at all', () => {
    expect(parseTimeDimension('<Layer><Name>X</Name></Layer>')).toBeNull()
    expect(parseTimeDimension('')).toBeNull()
  })
})

describe('radarFrameTimes', () => {
  const dim = { start: '2026-11-06T13:48:00Z', end: '2026-11-06T16:48:00Z', stepMin: 6 }

  it('ends on the newest image and steps back 12 minutes', () => {
    const t = radarFrameTimes(dim)
    expect(t[t.length - 1]).toBe('2026-11-06T16:48:00Z')
    expect(t[t.length - 2]).toBe('2026-11-06T16:36:00Z')
    expect(t).toHaveLength(13)
  })

  it('is in order, oldest first', () => {
    const t = radarFrameTimes(dim)
    expect([...t].sort()).toEqual(t)
  })

  // Asking for more history than the service kept must not invent frames it
  // would answer with an error image.
  it('never runs off the front of what is kept', () => {
    const t = radarFrameTimes(dim, 40)
    expect(Date.parse(t[0])).toBeGreaterThanOrEqual(Date.parse(dim.start))
    expect(t).toHaveLength(16)
  })
})

describe('forecastFrameTimes', () => {
  const dim = { start: '2026-11-06T13:00:00Z', end: '2026-11-08T12:00:00Z', stepMin: 60 }

  it('starts after the last radar image, not at the run start', () => {
    const t = forecastFrameTimes(dim, '2026-11-06T16:48:00Z')
    expect(t[0]).toBe('2026-11-06T17:00:00Z')
  })

  it('stops at the hours asked for', () => {
    expect(forecastFrameTimes(dim, '2026-11-06T16:48:00Z', 6)).toEqual([
      '2026-11-06T17:00:00Z',
      '2026-11-06T18:00:00Z',
      '2026-11-06T19:00:00Z',
      '2026-11-06T20:00:00Z',
      '2026-11-06T21:00:00Z',
      '2026-11-06T22:00:00Z',
    ])
  })

  it('stops where the model stops, however many hours were asked for', () => {
    const t = forecastFrameTimes(dim, '2026-11-06T16:48:00Z', 48)
    expect(t[t.length - 1]).toBe('2026-11-08T12:00:00Z')
  })
})

describe('buildFrames', () => {
  const radar = parseTimeDimension(RADAR_XML)
  const forecast = parseTimeDimension(HRDPS_XML)

  it('puts what fell before what is predicted, with no gap and no overlap', () => {
    const frames = buildFrames(radar, forecast)
    const kinds = frames.map((f) => f.kind)
    expect(kinds.indexOf('forecast')).toBe(kinds.lastIndexOf('radar') + 1)
    expect(frames.map((f) => f.time)).toEqual([...frames.map((f) => f.time)].sort())
    expect(frames).toHaveLength(13 + 24)
  })

  it('opens on the newest radar image', () => {
    const frames = buildFrames(radar, forecast)
    expect(frames[liveIndex(frames)]).toEqual({ time: '2026-11-06T16:48:00Z', kind: 'radar' })
  })

  it('still shows the radar when the model is unreachable', () => {
    const frames = buildFrames(radar, null)
    expect(frames).toHaveLength(13)
    expect(frames.every((f) => f.kind === 'radar')).toBe(true)
  })

  it('shows nothing at all rather than a forecast with no present', () => {
    expect(buildFrames(null, forecast)).toEqual([])
    expect(liveIndex([])).toBe(0)
  })
})

describe('frameRelative', () => {
  const now = Date.parse('2026-11-06T16:48:00Z')

  it('calls the newest image now', () => {
    expect(frameRelative('2026-11-06T16:48:00Z', now)).toBe('now')
    expect(frameRelative('2026-11-06T16:44:00Z', now)).toBe('now')
  })

  it('counts back in minutes, then hours', () => {
    expect(frameRelative('2026-11-06T16:24:00Z', now)).toBe('24 min ago')
    expect(frameRelative('2026-11-06T14:48:00Z', now)).toBe('2 h ago')
  })

  it('counts forward the same way', () => {
    expect(frameRelative('2026-11-06T17:30:00Z', now)).toBe('in 42 min')
    expect(frameRelative('2026-11-07T04:48:00Z', now)).toBe('in 12 h')
  })
})

describe('the tile and legend URLs', () => {
  // MapLibre fills this in per tile; escaping the braces would have asked
  // GeoMet for a box called "{bbox-epsg-3857}" on every tile.
  it('leaves MapLibre its own placeholder unescaped', () => {
    const u = wmsTiles('RADAR_1KM_RRAI', 'Radar-Rain_14colors', '2026-11-06T16:48:00Z')
    expect(u).toContain('&BBOX={bbox-epsg-3857}')
    expect(u).not.toContain('%7B')
  })

  it('asks for a transparent PNG of the right frame in web mercator', () => {
    const u = wmsTiles('RADAR_1KM_RRAI', 'Radar-Rain_14colors', '2026-11-06T16:48:00Z')
    expect(u).toContain('TIME=2026-11-06T16%3A48%3A00Z')
    expect(u).toContain('TRANSPARENT=true')
    expect(u).toContain('CRS=EPSG%3A3857')
    expect(u).toContain('WIDTH=512')
  })

  it('points at ECCC for the colour scale', () => {
    expect(legendUrl('RADAR_1KM_RRAI', 'Radar-Rain_14colors')).toContain('request=GetLegendGraphic')
    expect(legendUrl('RADAR_1KM_RRAI', 'Radar-Rain_14colors')).toContain('layer=RADAR_1KM_RRAI')
  })
})
