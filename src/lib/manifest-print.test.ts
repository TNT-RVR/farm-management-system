import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ManifestPrint } from '@/pages/cattle/ManifestPrint'
import type { ManifestWithLines } from './manifests'

/**
 * Rendered rather than eyeballed.
 *
 * A print layout is the one screen nobody looks at until it matters — it is
 * seen for the first time when somebody is standing at a truck with a driver
 * waiting. These assert the fields actually reach the page.
 *
 * createElement rather than JSX because the runner only collects .test.ts.
 */
const manifest = {
  id: 'm1',
  crop_year: 2026,
  manifest_no: 'A 123456',
  moved_on: '2026-10-04',
  owner_name: 'Prairie Creek Farm Ltd.',
  owner_phone: '403-555-0101',
  origin_address: 'East Ranch, AB T0K 0G0',
  origin_premises_id: 'AB0012345',
  brand: 'RV',
  brand_location: 'left rib',
  destination_name: 'Hillcrest Auction Services',
  destination_address: 'Lethbridge, AB',
  destination_phone: '403-555-0202',
  destination_premises_id: 'AB0099887',
  purpose: 'sale',
  transporter_name: 'Olsen Trucking',
  transporter_phone: '403-555-0303',
  licence_plate: 'BXK 447',
  driver_name: 'Darren',
  signed_by: 'Sam Hansen',
  signed_on: '2026-10-04',
  notes: 'Loaded at the home corrals.',
  lines: [
    {
      id: 'l1',
      animal_class: 'steers',
      head: 62,
      sex: 'S',
      colour: 'black',
      avg_weight_lb: 545,
      brand: 'RV',
      tag_range: '1240001234567',
    },
    {
      id: 'l2',
      animal_class: 'heifers',
      head: 38,
      sex: 'H',
      colour: 'black',
      avg_weight_lb: 510,
      brand: 'RV',
      tag_range: null,
    },
  ],
} as unknown as ManifestWithLines

const render = (m: ManifestWithLines) =>
  renderToStaticMarkup(createElement(ManifestPrint, { manifest: m }))

describe('ManifestPrint', () => {
  const html = render(manifest)

  it('carries every field a manifest is asked for', () => {
    for (const v of [
      'A 123456',
      '2026-10-04',
      'Prairie Creek Farm Ltd.',
      'AB0012345',
      'left rib',
      'Hillcrest Auction Services',
      'AB0099887',
      'Sale',
      'Olsen Trucking',
      'BXK 447',
      'Darren',
    ]) {
      expect(html, v).toContain(v)
    }
  })

  it('totals the head', () => {
    // 62 + 38 — the number a brand inspector counts against.
    expect(html).toContain('100 head')
  })

  it('leaves rows to write the last few in at the chute', () => {
    // Two lines recorded against a four-row minimum, so two blank rows of seven
    // cells. A form with nowhere to write gets written on the back.
    //
    // Counted as the character, not the entity: renderToStaticMarkup emits a
    // real U+00A0 rather than the "&nbsp;" written in the JSX.
    expect((html.match(/\u00a0/g) ?? []).length).toBeGreaterThanOrEqual(14)
  })

  it('says on its face that it is not the official LIS manifest', () => {
    expect(html).toContain('not the official Livestock Identification Services manifest')
  })

  it('prints a half-finished manifest without showing nulls', () => {
    const bare = { ...manifest, manifest_no: null, notes: null, signed_by: null, lines: [] }
    const out = render(bare as unknown as ManifestWithLines)
    expect(out).toContain('____________')
    expect(out).not.toContain('null')
    expect(out).not.toContain('undefined')
  })
})
