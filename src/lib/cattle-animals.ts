import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import {
  existingKey,
  parseSheet,
  planImport,
  ranchForBrand,
  sexFromStockClass,
  toAnimal,
  toSheetGrid,
  SHEET_ACTIONS,
  SHEET_HEADERS,
  STOCK_CLASSES,
  PREGNANCY_STATUSES,
  type ExportAnimal,
  type ParsedAnimal,
  type SheetAction,
} from '@/lib/eshepherd-animals'

/**
 * The eShepherd animal register: uploading a sheet, writing one back, and
 * what a wand read.
 *
 * The parsing lives in eshepherd-animals.ts and is pure; this is the part
 * that talks to the database. Two rules it keeps:
 *
 * - **Every sheet is kept.** Before an upload writes anything it records the
 *   file as read AND the rows it is about to overwrite, so a bad sheet can be
 *   put back without anybody reconstructing what used to be there.
 * - **An upload never empties a field.** eShepherd leaves most columns blank
 *   for most animals; if a blank overwrote what somebody typed here, one
 *   upload would wipe the herd's notes. A blank in the sheet means "eShepherd
 *   does not know", not "set this to nothing".
 */

export type AnimalUpload = {
  id: string
  filename: string
  uploaded_at: string
  uploaded_by: string | null
  row_count: number
  created_count: number
  updated_count: number
  skipped_count: number
  headers: string[]
  rows: Record<string, string>[]
  previous: StoredPrevious[]
  undone_at: string | null
  note: string | null
}

/** A row as it was before an upload touched it, for putting back. */
export type CattlePatch = Database['public']['Tables']['cattle']['Update']
export type StoredPrevious = { id: string; fields: CattlePatch } | { created: string }

export type CattleScan = {
  id: string
  eid: string
  cattle_id: string | null
  scanned_at: string
  source: string
  ranch_id: string | null
  note: string | null
}

/** The columns an upload writes. Everything else on the animal is the app's. */
const UPLOAD_FIELDS = [
  'eshepherd_animal_id',
  'eid',
  'vid',
  'neckband',
  'breed',
  'stock_class',
  'birth_date',
  'brand',
  'weight_kg',
  'weighed_on',
  'expected_gain_kg',
  'pregnancy_status',
  'eshepherd_note',
] as const

export function useAnimalUploads() {
  return useQuery({
    queryKey: ['cattle-uploads'],
    queryFn: async (): Promise<AnimalUpload[]> => {
      // The rows and previous blobs are big; the list does not need them.
      const { data, error } = await supabase
        .from('cattle_uploads')
        .select('id, filename, uploaded_at, uploaded_by, row_count, created_count, updated_count, skipped_count, undone_at, note')
        .order('uploaded_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as AnimalUpload[]
    },
  })
}

/** Which brand belongs to which ranch, as a map the parser can use. */
export function useBrandRanch() {
  return useQuery({
    queryKey: ['cattle-brand-ranch'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cattle_brand_ranch').select('brand, ranch_id, note')
      if (error) throw error
      const rows = (data ?? []) as unknown as { brand: string; ranch_id: string | null; note: string | null }[]
      return { rows, map: new Map(rows.map((r) => [r.brand.trim().toUpperCase(), r.ranch_id])) }
    },
  })
}

export function useSetBrandRanch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ brand, ranchId }: { brand: string; ranchId: string | null }) => {
      const { error } = await supabase
        .from('cattle_brand_ranch')
        .upsert({ brand: brand.trim().toUpperCase(), ranch_id: ranchId }, { onConflict: 'brand' })
      if (error) throw error
      if (!ranchId) return
      // The mapping on its own only sorts the NEXT upload. Saying where a
      // brand belongs has to place the animals already carrying it, or the
      // answer changes nothing on screen and the brand keeps asking.
      //
      // Only the ones with no ranch yet. A brand is a good guess and not
      // much more: brand 77 is Home Ranch's, and three of its bulls run at
      // East Ranch, placed by the mob they are in. Whatever put a ranch on
      // an animal knew more than its brand does.
      const { error: moved } = await supabase
        .from('cattle')
        .update({ ranch_id: ranchId })
        .eq('brand', brand)
        .is('ranch_id', null)
      if (moved) throw moved
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cattle-brand-ranch'] })
      void qc.invalidateQueries({ queryKey: ['cattle'] })
    },
  })
}

/** Read a spreadsheet file into a grid of cells, without trusting its shape. */
export async function readWorkbook(file: File): Promise<unknown[][]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('That file has no sheets in it.')
  const grid: unknown[][] = []
  // getRow/getCell on a 10,000-row template is slow enough to lock the tab;
  // eachRow walks only the rows that exist.
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const line: unknown[] = []
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      line[c - 1] = cell.value
    })
    grid[r - 1] = line
  })
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = []
  return grid
}

export type UploadResult = {
  uploadId: string
  created: number
  updated: number
  skipped: number
  /** Of the skipped, the spare neckbands — the usual reason a count looks big. */
  spareCollars: number
  problems: { row: ParsedAnimal; problems: string[] }[]
  unplacedBrands: { brand: string; count: number }[]
  unknownHeaders: string[]
}

/**
 * Take a sheet in: match it, write it, and keep the file.
 *
 * Nothing is written until the whole file has been read and planned, so a
 * sheet that falls over halfway does not leave the herd half updated.
 */
export function useUploadAnimalSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, brandMap }: { file: File; brandMap: Map<string, string | null> }): Promise<UploadResult> => {
      const grid = await readWorkbook(file)
      const parsed = parseSheet(grid)
      if (parsed.headerRow < 0) {
        throw new Error(
          'That does not look like an eShepherd animal sheet — no row of column headings with Action and EID was found.',
        )
      }
      const animals = parsed.rows.map(toAnimal)
      if (!animals.length) throw new Error('That sheet has no animals in it.')

      const { data: existingData, error: exErr } = await supabase
        .from('cattle')
        .select('id, eid, neckband, eshepherd_animal_id, vid, ' + UPLOAD_FIELDS.join(', '))
      if (exErr) throw exErr
      const existing = (existingData ?? []) as unknown as (Record<string, unknown> & { id: string })[]
      const plan = planImport(
        animals,
        existing.map((e) => ({
          id: e.id,
          eid: (e.eid as string) ?? null,
          neckband: (e.neckband as string) ?? null,
          eshepherd_animal_id: (e.eshepherd_animal_id as string) ?? null,
          vid: (e.vid as string) ?? null,
        })),
      )
      const byId = new Map<string, Record<string, unknown>>(existing.map((e) => [e.id, e as Record<string, unknown>]))

      // The archive row first, so the file is kept even if the write fails.
      const previous: StoredPrevious[] = plan.updates.map(({ id }) => {
        const was: Record<string, unknown> = byId.get(id) ?? {}
        const fields: Record<string, unknown> = {}
        for (const f of UPLOAD_FIELDS) fields[f] = was[f] ?? null
        return { id, fields: fields as CattlePatch }
      })
      const { data: up, error: upErr } = await supabase
        .from('cattle_uploads')
        .insert({
          filename: file.name,
          row_count: animals.length,
          created_count: plan.creates.length,
          updated_count: plan.updates.length,
          skipped_count: plan.skips.length,
          headers: parsed.headers,
          rows: parsed.rows,
          previous,
        })
        .select('id')
        .single()
      if (upErr) throw upErr
      const uploadId = (up as { id: string }).id

      const fieldsOf = (a: ParsedAnimal) => ({
        eshepherd_animal_id: a.eshepherd_animal_id,
        eid: a.eid,
        vid: a.vid,
        neckband: a.neckband,
        breed: a.breed,
        stock_class: a.stock_class,
        birth_date: a.birth_date,
        brand: a.brand,
        weight_kg: a.weight_kg,
        weighed_on: a.weighed_on,
        expected_gain_kg: a.expected_gain_kg,
        pregnancy_status: a.pregnancy_status,
        eshepherd_note: a.eshepherd_note,
        last_upload_id: uploadId,
      })

      // New animals: the ranch comes from the brand where somebody has placed
      // it, and is left null otherwise.
      if (plan.creates.length) {
        const rows = plan.creates.map((a) => ({
          ...fieldsOf(a),
          tag: a.vid ?? a.eid ?? a.neckband,
          sex: sexFromStockClass(a.stock_class),
          status: 'active' as const,
          ranch_id: ranchForBrand(a.brand, brandMap),
        }))
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from('cattle').insert(rows.slice(i, i + 500))
          if (error) throw error
        }
      }

      // Updates write only what the sheet actually says. A blank column is
      // eShepherd not knowing, not an instruction to clear the field.
      for (const { animal, id } of plan.updates) {
        const patch: Record<string, unknown> = { last_upload_id: uploadId }
        const f = fieldsOf(animal) as Record<string, unknown>
        for (const k of UPLOAD_FIELDS) if (f[k] != null && f[k] !== '') patch[k] = f[k]
        const was = byId.get(id)
        // Fill the ranch in when it is still blank and the brand now places it.
        if (was && was.ranch_id == null) {
          const r = ranchForBrand(animal.brand, brandMap)
          if (r) patch.ranch_id = r
        }
        const { error } = await supabase.from('cattle').update(patch as CattlePatch).eq('id', id)
        if (error) throw error
      }

      const unplaced = new Map<string, number>()
      for (const a of animals) {
        if (a.brand && !ranchForBrand(a.brand, brandMap)) unplaced.set(a.brand, (unplaced.get(a.brand) ?? 0) + 1)
      }

      return {
        uploadId,
        created: plan.creates.length,
        updated: plan.updates.length,
        skipped: plan.skips.length,
        spareCollars: plan.skips.filter((s) => s.why.includes('no animal fitted')).length,
        problems: animals.filter((a) => a.problems.length).map((a) => ({ row: a, problems: a.problems })),
        unplacedBrands: [...unplaced.entries()].map(([brand, count]) => ({ brand, count })).sort((x, y) => y.count - x.count),
        unknownHeaders: parsed.unknownHeaders,
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cattle'] })
      void qc.invalidateQueries({ queryKey: ['cattle-uploads'] })
    },
  })
}

/**
 * Put an upload back.
 *
 * The rows it changed go back to what they held, and the animals it created
 * are removed — but only those that no later upload has touched, so undoing an
 * old sheet cannot reach through a newer one.
 */
export function useUndoUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (uploadId: string) => {
      const { data, error } = await supabase
        .from('cattle_uploads')
        .select('id, previous, undone_at')
        .eq('id', uploadId)
        .single()
      if (error) throw error
      const row = data as unknown as { previous: StoredPrevious[]; undone_at: string | null }
      if (row.undone_at) throw new Error('That upload has already been put back.')

      for (const p of row.previous ?? []) {
        if (!('id' in p)) continue
        const { error: e } = await supabase.from('cattle').update(p.fields as CattlePatch).eq('id', p.id).eq('last_upload_id', uploadId)
        if (e) throw e
      }
      // Animals this upload created and nothing has touched since.
      const { error: delErr } = await supabase.from('cattle').delete().eq('last_upload_id', uploadId)
      if (delErr) throw delErr

      const { error: markErr } = await supabase
        .from('cattle_uploads')
        .update({ undone_at: new Date().toISOString() })
        .eq('id', uploadId)
      if (markErr) throw markErr
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cattle'] })
      void qc.invalidateQueries({ queryKey: ['cattle-uploads'] })
    },
  })
}

/** Set the mob, the ranch or both on a batch of animals at once. */
export function useBulkAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: Pick<CattlePatch, 'mob' | 'ranch_id'> }) => {
      if (!ids.length) return
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from('cattle').update(patch).in('id', ids.slice(i, i + 200))
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cattle'] }),
  })
}

/** The mob names the collars already use, so the app spells them the same. */
export function useMobNames() {
  return useQuery({
    queryKey: ['cattle-mob-names'],
    queryFn: async (): Promise<string[]> => {
      const [act, own] = await Promise.all([
        supabase.from('eshepherd_activations').select('mob'),
        supabase.from('cattle').select('mob').not('mob', 'is', null),
      ])
      if (act.error) throw act.error
      if (own.error) throw own.error
      const names = new Set<string>()
      for (const r of (act.data ?? []) as { mob: string | null }[]) if (r.mob?.trim()) names.add(r.mob.trim())
      for (const r of (own.data ?? []) as unknown as { mob: string | null }[]) if (r.mob?.trim()) names.add(r.mob.trim())
      return [...names].sort((a, b) => a.localeCompare(b))
    },
  })
}

/**
 * The ranch a mob name points at, by the prefix the collars already use —
 * "East Ranch Herd", "Home Ranch Bulls". A mob named for somebody else's
 * cattle ("Whitfields", "Johns Cattle") matches nothing and stays unplaced.
 */
export function ranchForMob(mob: string | null | undefined, ranches: { id: string; name: string }[]): string | null {
  const m = (mob ?? '').trim().toLowerCase()
  if (!m) return null
  const hit = ranches.find((r) => m.startsWith(r.name.trim().toLowerCase()))
  return hit?.id ?? null
}

/**
 * What filling mob and ranch from the collars did.
 *
 * Reported rather than summarised away: the counts that matter most are the
 * ones nothing could be done about, because those are the rows somebody still
 * has to look at.
 */
export type CollarFill = {
  /** Animals whose mob was written. */
  mobSet: number
  /** Animals that had no ranch and got one from their mob's name. */
  ranchFilled: number
  /** In the register but not in the collar data, so still unlabelled. */
  noMatch: number
  /** Matched, but the mob name points at no ranch of ours. */
  mobSaysNothing: { mob: string; count: number }[]
  /** Matched, already placed, and the two disagree. Left alone, listed here. */
  disagreed: { tag: string; mob: string; placedAt: string | null; mobSays: string | null }[]
}

/**
 * Label every animal with its mob and its ranch, from the collars.
 *
 * eShepherd will not export its animal list, so this register is built from
 * the Bulk Create sheet — and that sheet carries no mob. The pregnancy pull
 * does: `eshepherd_repro` holds one row per collared animal with the mob it
 * is in, which is why the Pregnancy tab can group by mob and this register
 * could not. This copies that across.
 *
 * Matched on `eshepherd_animal_id`, not the tag. The tag looks like the
 * obvious key and is not: a register row with no visual tag falls back to
 * carrying its EID in `tag`, so matching on tags found 307 of the 420 animals
 * the animal id finds.
 *
 * Two rules, both about not destroying what somebody already knows:
 *
 * - **Mob is overwritten.** The collars are the only source for it and the
 *   current mob is the whole point, so the last pull wins. "NO MOB" is
 *   eShepherd saying it does not know; it is stored as nothing rather than as
 *   those words.
 * - **Ranch is only filled in, never changed.** A ranch already set came from
 *   the animal's brand, which says who owns it; the mob says where it is
 *   standing. Those answer different questions, and today they agree on every
 *   animal that has both. Where they ever disagree this leaves the brand alone
 *   and reports the row, because quietly moving an animal between ranches is
 *   the kind of edit nobody finds again.
 */
export function useFillFromCollars(ranches: { id: string; name: string }[]) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<CollarFill> => {
      const [repro, herd] = await Promise.all([
        supabase.from('eshepherd_repro').select('animal_id, tag, mob'),
        supabase.from('cattle').select('id, tag, mob, ranch_id, eshepherd_animal_id'),
      ])
      if (repro.error) throw repro.error
      if (herd.error) throw herd.error

      const byAnimalId = new Map<string, { tag: string | null; mob: string | null }>()
      for (const r of (repro.data ?? []) as { animal_id: string | null; tag: string | null; mob: string | null }[]) {
        const key = r.animal_id?.trim()
        if (key) byAnimalId.set(key, { tag: r.tag, mob: r.mob })
      }
      const ranchName = new Map(ranches.map((r) => [r.id, r.name]))

      // Grouped by what they are being set to, so 420 animals go up as a
      // handful of batched updates instead of 420 round trips.
      const groups = new Map<string, { mob: string | null; ranch_id?: string | null; ids: string[] }>()
      const out: CollarFill = { mobSet: 0, ranchFilled: 0, noMatch: 0, mobSaysNothing: [], disagreed: [] }
      const nothingBy = new Map<string, number>()

      for (const a of (herd.data ?? []) as {
        id: string
        tag: string | null
        mob: string | null
        ranch_id: string | null
        eshepherd_animal_id: string | null
      }[]) {
        const hit = a.eshepherd_animal_id ? byAnimalId.get(a.eshepherd_animal_id.trim()) : undefined
        if (!hit) {
          out.noMatch += 1
          continue
        }
        const raw = hit.mob?.trim() ?? ''
        // eShepherd's own words for "this animal is not in a mob".
        const mob = raw && raw.toUpperCase() !== 'NO MOB' ? raw : null
        const mobRanchId = mob ? ranchForMob(mob, ranches) : null

        if (mob && !mobRanchId) nothingBy.set(mob, (nothingBy.get(mob) ?? 0) + 1)
        if (mobRanchId && a.ranch_id && a.ranch_id !== mobRanchId) {
          out.disagreed.push({
            tag: hit.tag ?? a.tag ?? '—',
            mob: mob ?? '—',
            placedAt: ranchName.get(a.ranch_id) ?? null,
            mobSays: ranchName.get(mobRanchId) ?? null,
          })
        }

        // Only where it is blank: see the note above.
        const fillRanch = mobRanchId && !a.ranch_id ? mobRanchId : null
        if (a.mob === mob && !fillRanch) continue

        const key = `${mob ?? ''}|${fillRanch ?? ''}`
        const g = groups.get(key) ?? { mob, ...(fillRanch ? { ranch_id: fillRanch } : {}), ids: [] }
        g.ids.push(a.id)
        groups.set(key, g)
        if (a.mob !== mob) out.mobSet += 1
        if (fillRanch) out.ranchFilled += 1
      }

      out.mobSaysNothing = [...nothingBy.entries()]
        .map(([mob, count]) => ({ mob, count }))
        .sort((x, y) => y.count - x.count)
      out.disagreed.sort((x, y) => x.tag.localeCompare(y.tag, 'en', { numeric: true }))

      for (const g of groups.values()) {
        const patch: Pick<CattlePatch, 'mob' | 'ranch_id'> = { mob: g.mob }
        if (g.ranch_id) patch.ranch_id = g.ranch_id
        for (let i = 0; i < g.ids.length; i += 200) {
          const { error } = await supabase.from('cattle').update(patch).in('id', g.ids.slice(i, i + 200))
          if (error) throw error
        }
      }
      return out
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cattle'] })
      void qc.invalidateQueries({ queryKey: ['cattle-mob-names'] })
    },
  })
}

/** Record what a wand read, matched to an animal where there is one. */
export function useRecordScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ eid, ranchId, source = 'wand' }: { eid: string; ranchId?: string | null; source?: string }) => {
      const clean = eid.trim()
      const { data: hit, error: findErr } = await supabase.from('cattle').select('*').eq('eid', clean).maybeSingle()
      if (findErr) throw findErr
      const animal = (hit as Record<string, unknown> | null) ?? null
      const { error } = await supabase.from('cattle_scans').insert({
        eid: clean,
        cattle_id: (animal?.id as string) ?? null,
        source,
        ranch_id: ranchId ?? null,
      })
      if (error) throw error
      return animal
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cattle-scans'] }),
  })
}

export function useRecentScans(limit = 25) {
  return useQuery({
    queryKey: ['cattle-scans', limit],
    queryFn: async (): Promise<CattleScan[]> => {
      const { data, error } = await supabase
        .from('cattle_scans')
        .select('id, eid, cattle_id, scanned_at, source, ranch_id, note')
        .order('scanned_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as unknown as CattleScan[]
    },
  })
}

/**
 * The animals as an eShepherd upload file.
 *
 * Built as a real workbook with the banner, the headers and the dropdowns the
 * template carries, so what comes out opens and behaves like the file that
 * went in. The Action column defaults to NO ACTION: a file that said EDIT on
 * every row would rewrite the whole herd the moment it was uploaded.
 */
export async function buildAnimalWorkbook(animals: ExportAnimal[], action: SheetAction = 'NO ACTION'): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet('Sheet1')
  const grid = toSheetGrid(animals, action)

  ws.addRow(grid[0])
  ws.mergeCells(1, 1, 1, SHEET_HEADERS.length)
  ws.getRow(1).height = 60
  ws.getCell(1, 1).alignment = { wrapText: true, vertical: 'top' }
  ws.getCell(1, 1).font = { bold: true }

  const header = ws.addRow(grid[1])
  header.font = { bold: true }
  for (const r of grid.slice(2)) ws.addRow(r)

  ws.columns = SHEET_HEADERS.map((h) => ({ width: Math.max(12, h.length + 4) }))

  // The dropdowns, so the file behaves like eShepherd's own in Excel.
  const last = Math.max(grid.length, 3)
  const list = (col: number, values: readonly string[]) => {
    for (let r = 3; r <= last; r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.join(',')}"`],
      }
    }
  }
  list(1, SHEET_ACTIONS)
  list(7, STOCK_CLASSES)
  list(13, PREGNANCY_STATUSES)

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** An animal row as the exporter wants it. */
export function toExportAnimal(a: Record<string, unknown>): ExportAnimal {
  const s = (k: string) => (a[k] == null ? null : String(a[k]))
  const n = (k: string) => (a[k] == null ? null : Number(a[k]))
  return {
    eshepherd_animal_id: s('eshepherd_animal_id'),
    eid: s('eid'),
    vid: s('vid'),
    neckband: s('neckband'),
    breed: s('breed'),
    stock_class: s('stock_class'),
    birth_date: s('birth_date'),
    brand: s('brand'),
    weight_kg: n('weight_kg'),
    weighed_on: s('weighed_on'),
    expected_gain_kg: n('expected_gain_kg'),
    pregnancy_status: s('pregnancy_status'),
    eshepherd_note: s('eshepherd_note'),
  }
}

export { existingKey }
