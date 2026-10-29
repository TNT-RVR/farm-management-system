/**
 * Form styles: which company's form a seed report and its bin records print
 * on, and the few things that differ between them — the labels, how the legal
 * land is written, how the cable's sensors are numbered, and the PDF.
 *
 * A company with its own pages in the app (on the farm's own copy) has a
 * style of its own; every other company gets the generic form, laid out
 * as the app's own report. The page asks formStyleFor(company) and draws
 * whatever comes back, so a new company's pages are one more style here.
 */
import type { Level } from '@/lib/bin-monitor'
import type { MonitorRow } from '@/lib/bin-monitor-data'
import { supabase } from '@/lib/supabase'
import { farmBrand } from '@/lib/farm-setup'
import { tableReportToPdf } from '@/lib/table-report'
import { fullLegal, growerBinLabel, levelsFromTop, sensorCell, sensorLabels, topPositions, type Position } from './format'
import { reportForm, type SeedReport, type SeedReportBin } from './data'
import { binTempTable, seedReportTable, type BinTempRecord } from './generic'

/** What a report's PDF is made from. */
export type SeedFormInput = {
  report: SeedReport
  bins: SeedReportBin[]
  binName: (id: string | null) => string
  fieldName: string
  signerName: string | null
}

/** What the bins' temperature records are made from: the bins chosen and their readings. */
export type BinTempInput = SeedFormInput & {
  readings: MonitorRow[]
  cropName: (id: string | null) => string | null
}

export type FormStyle = {
  key: string
  /** The companies (lower case) whose own form this is; empty for the generic one. */
  companies: string[]
  reportTitle: string
  binTempTitle: string
  /** File names start with it: "<company> seed report - …". */
  fileLabel: (company: string) => string
  fieldNumber: { label: string; placeholder: string }
  spinCode: { label: string; placeholder: string }
  companyBin: (company: string) => string
  acknowledge: (company: string) => string
  /** Cables, aeration and the bin's bottom asked a bin; a company's own form may print them fixed. */
  asksBinKit: boolean
  legal: (lld: string | null | undefined) => string | null
  defaultGrower: () => Promise<string | null>
  sensors: {
    /** The form's columns from a reading's levels, in the form's own order. */
    read: (levels: readonly Level[]) => Position[]
    write: (positions: readonly Position[]) => Level[]
    /** A fixed number of columns (a company's own form), or null to follow the cable. */
    fixedCount: number | null
    /** Column i of n: "1 (bottom)", "1 (top)". */
    label: (i: number, n: number) => string
    /** Column 1 is the top sensor: drawn first in the dialog, rather than last. */
    topFirst: boolean
    cell: (p: Position | undefined) => string
    /** A reading the form would lose something by retyping (off a screenshot, humidity, a long cable). */
    readOnly: (r: MonitorRow) => boolean
  }
  reportPdf: (i: SeedFormInput) => Promise<Blob>
  binTempPdf: (i: BinTempInput) => Promise<Blob>
}

/** A picture's own size, read by the browser. */
async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  return { width: img.naturalWidth, height: img.naturalHeight }
}

/** A seed report bin's readings as the generic record wants them. */
export function binTempRecord(i: BinTempInput, b: SeedReportBin): BinTempRecord {
  const rows = i.readings.filter((x) => x.bin_id === b.bin_id && x.crop_year === i.report.crop_year && (!b.shipped_on || x.read_on <= b.shipped_on))
  const latest = [...rows].reverse()
  return {
    bin: growerBinLabel(i.binName(b.bin_id)) || 'Bin',
    companyBin: b.company_bin_id,
    crop: i.cropName(rows[0]?.crop_id ?? null),
    variety: null,
    lot: latest.find((x) => x.lot_number)?.lot_number ?? b.company_bin_id,
    legal: i.report.legal_land,
    company: i.report.company,
    readings: rows.map((x) => ({ date: x.read_on, initials: x.initials, levels: x.levels, aeration: x.aeration_on, notes: x.notes })),
  }
}

export const GENERIC_STYLE: FormStyle = {
  key: 'generic',
  companies: [],
  reportTitle: 'Seed production report',
  binTempTitle: 'Bin temperature monitoring records',
  fileLabel: (company) => company,
  fieldNumber: { label: 'Company field number', placeholder: 'If the company gave one' },
  spinCode: { label: 'Company contract or lot code', placeholder: 'If the company gave one' },
  companyBin: (company) => `${company} bin ID`,
  acknowledge: (company) => `${company}'s bin labels are on the bins`,
  asksBinKit: true,
  legal: fullLegal,
  // The grower last written on any report, else the farm's own name.
  defaultGrower: async () => {
    const { data } = await supabase.from('seed_reports').select('grower_name').not('grower_name', 'is', null).order('updated_at', { ascending: false }).limit(1)
    return data?.[0]?.grower_name ?? farmBrand().farmName ?? null
  },
  sensors: {
    read: topPositions,
    write: levelsFromTop,
    fixedCount: null,
    label: (i, n) => sensorLabels(n)[i] ?? String(i + 1),
    topFirst: true,
    cell: (p) => sensorCell(p) || '—',
    readOnly: (r) => r.source !== 'manual' || r.levels.some((l) => l.air || l.rh_pct != null),
  },
  reportPdf: async (i) => {
    const f = reportForm(i.report, i.bins, i.binName)
    const size = f.signature ? await imageSize(f.signature) : null
    const table = seedReportTable({ ...f, company: i.report.company, cropYear: i.report.crop_year, fieldName: i.fieldName, signerName: i.signerName, signatureSize: size })
    return tableReportToPdf(table)
  },
  binTempPdf: async (i) => tableReportToPdf(binTempTable(i.bins.map((b) => binTempRecord(i, b)), { cropYear: i.report.crop_year, grower: i.report.grower_name })),
}

/** Every style, the companies' own first; the generic form is the last word. */
export const FORM_STYLES: FormStyle[] = [
  GENERIC_STYLE,
]

/** The form a company's reports print on: its own when the app has it, else the generic one. */
export function formStyleFor(company: string | null | undefined, styles: FormStyle[] = FORM_STYLES): FormStyle {
  const want = company?.trim().toLowerCase()
  return (want && styles.find((s) => s.companies.includes(want))) || GENERIC_STYLE
}
