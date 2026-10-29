/**
 * The generic seed company forms, for any company that has no page of its own
 * in the app: a seed production report and a bin temperature monitoring
 * record. Both are laid out as the app's own branded report (table-report.ts)
 * rather than over a company's scanned page, so nothing here belongs to a
 * seed company and they print the same for anyone.
 *
 * Pure: the page, the Reports page and the tests share these.
 */
import type { Level } from '@/lib/bin-monitor'
import type { Cell, ReportSection, TableReport } from '@/lib/table-report'
import { kgText, longDate, sensorCell, sensorLabels, topPositions, type SeedReportForm } from './format'

/* ── Seed production report ────────────────────────────────────────────── */

export type GenericSeedReport = SeedReportForm & {
  company: string
  cropYear: number
  /** The field's name in the app. */
  fieldName: string
  signerName: string | null
  /** The signature picture's own size, so it is not squashed. */
  signatureSize: { width: number; height: number } | null
}

const METHOD: Record<NonNullable<SeedReportForm['method']>, string> = {
  platform: 'Platform scale',
  grain_cart: 'Grain cart scale',
  electronic: 'Electronic inventory system',
}

const STORAGE: Record<NonNullable<SeedReportForm['storage']>, string> = {
  home: 'Home farm location',
  same_qtr: 'Same quarter as the field',
  other: 'Other location',
}

const yesNo = (v: boolean | null | undefined) => (v == null ? '' : v ? 'Yes' : 'No')
const oneDp = (v: number | null) => (v == null ? '' : v.toFixed(1))

/** The report as the app's own layout: the facts in the panel, the bins, then the signature. */
export function seedReportTable(f: GenericSeedReport): TableReport {
  const storage = f.storage === 'other' ? [STORAGE.other, f.storageOther].filter(Boolean).join(': ') : f.storage ? STORAGE[f.storage] : ''
  const meta: [string, Cell][] = [
    ['Company', f.company],
    ['Crop year', String(f.cropYear)],
    ['Grower', f.grower ?? ''],
    ['Field', f.fieldName],
    ['Legal land', f.legal ?? ''],
    // The company's own references: only when it gave them.
    ...(f.fieldNumber ? [['Company field number', f.fieldNumber] as [string, Cell]] : []),
    ...(f.spinCode ? [['Company contract or lot code', f.spinCode] as [string, Cell]] : []),
    ['GPS acres', f.gpsAcres == null ? '' : f.gpsAcres.toFixed(2)],
    ['Harvest completed', longDate(f.harvestOn)],
    ['Weather at harvest', f.weather ?? ''],
    ['Weighed on', f.method ? METHOD[f.method] : ''],
    ['Scale certified', yesNo(f.certified)],
    ['Seed stored at', storage],
    ['Total seed harvested', f.totalKg == null ? '' : `${kgText(f.totalKg)} kg`],
    ['Company bin labels on the bins', f.acknowledged ? 'Yes' : 'No'],
  ]
  const bins: ReportSection = {
    title: 'Bins',
    head: ['Company bin ID', 'Grower bin', 'Seed (kg)', 'Moisture %', 'Seed temp °C', 'Temp cables', 'Moisture cables', 'Aeration', 'Bottom'],
    rows: f.bins.map((b) => [
      b.companyBinId ?? '',
      b.growerBin,
      kgText(b.kg),
      oneDp(b.moisturePct),
      oneDp(b.seedTempC),
      yesNo(b.tempCables),
      yesNo(b.moistureCables),
      yesNo(b.aeration),
      b.bottom === 'coned' ? 'Coned' : 'Flat',
    ]),
    align: [undefined, undefined, 'right', 'right', 'right'],
    empty: 'No bins on the report yet',
  }
  const signed: ReportSection = {
    title: 'Signed',
    head: ['Signature', 'Name', 'Date'],
    rows: [['', f.signerName ?? '', longDate(f.signedOn)]],
    // Blank answers print as lines to fill in by hand.
    answerColumns: [0, 1, 2],
    minRowHeight: 48,
    cellImages: f.signature && f.signatureSize ? [{ row: 0, col: 0, image: { dataUrl: f.signature, ...f.signatureSize } }] : undefined,
  }
  return {
    title: 'Seed production report',
    subtitle: `${f.company} · crop year ${f.cropYear} · ${f.fieldName}`,
    meta,
    sections: [bins, signed],
    orientation: 'portrait',
  }
}

/* ── Bin temperature monitoring record ─────────────────────────────────── */

export type BinTempReadingRow = { date: string; initials: string | null; levels: Level[]; aeration: boolean | null; notes: string | null }

export type BinTempRecord = {
  /** The bin's own name. */
  bin: string
  companyBin: string | null
  crop: string | null
  variety: string | null
  lot: string | null
  legal: string | null
  company: string | null
  readings: BinTempReadingRow[]
}

/** The most grain sensors any of a bin's readings had: the record's column count. */
export function sensorCount(readings: readonly { levels: Level[] }[]): number {
  return Math.max(1, ...readings.map((r) => topPositions(r.levels).length))
}

/** What a bin's table says under its heading: crop, lot, land, company. */
export function binTempNote(r: BinTempRecord): string {
  const crop = [r.crop, r.variety].filter(Boolean).join(', ')
  return [crop && `Crop: ${crop}`, r.lot && `Lot: ${r.lot}`, r.legal && `Legal land: ${r.legal}`, r.company && `Company: ${r.company}`].filter(Boolean).join('; ')
}

/**
 * One table a bin, a row a reading, oldest first: date, who read it, every
 * sensor in the grain (as many as the cable has), aeration and notes.
 */
export function binTempTable(records: BinTempRecord[], o: { cropYear: number; grower?: string | null }): TableReport {
  const sections: ReportSection[] = records.map((r) => {
    const n = sensorCount(r.readings)
    const readings = [...r.readings].sort((a, b) => a.date.localeCompare(b.date))
    return {
      title: r.companyBin ? `${r.bin} (company bin ${r.companyBin})` : r.bin,
      note: binTempNote(r) || undefined,
      head: ['Date', 'Read by', ...sensorLabels(n), 'Aeration on', 'Notes'],
      rows: readings.map((x) => {
        const p = topPositions(x.levels)
        return [x.date, x.initials ?? '', ...Array.from({ length: n }, (_, i) => sensorCell(p[i])), x.aeration ? 'Yes' : '', x.notes ?? '']
      }),
      align: ['left', 'left', ...Array<'center'>(n).fill('center')],
      empty: 'No readings yet',
    }
  })
  return {
    title: 'Bin temperature monitoring record',
    subtitle: `Crop year ${o.cropYear}`,
    meta: [
      ...(o.grower ? [['Grower', o.grower] as [string, Cell]] : []),
      ['Crop year', String(o.cropYear)],
      ['Bins', records.length],
      ['Sensor numbering', '1 is the top sensor in the grain, counting down to the bottom'],
    ],
    lead: [
      'Each sensor shows the temperature, then the grain moisture, or the relative humidity (marked RH) where that is what the cable read. Sensors in the air above the grain are left out.',
    ],
    sections,
  }
}
