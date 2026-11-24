import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type DocumentRow = Database['public']['Tables']['documents']['Row']
export type DocumentArea = Database['public']['Tables']['document_areas']['Row']
export type DocumentLink = Database['public']['Tables']['document_links']['Row']

/** The library's own bucket. Mirrored rows name the bucket their screen used. */
export const DOCUMENTS_BUCKET = 'documents'

/** Everything but the search vector, which is big and never read on the client. */
const COLUMNS =
  'id, area, curated, doc_type, title, party, doc_date, crop_year, storage_bucket, storage_path, filename, mime, bytes, summary, tags, source, source_table, source_id, added_by, created_at, updated_at' as const

export type DocumentListItem = Omit<DocumentRow, 'fts' | 'text_content'>

export function useDocumentAreas() {
  return useQuery({
    queryKey: ['document_areas'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_areas')
        .select('key, label, icon, sort')
        .order('sort')
      if (error) throw error
      return data
    },
  })
}

/** How the list is ordered. Dates first, because that is how paper is found. */
export type DocumentSort = 'newest' | 'oldest' | 'title' | 'area' | 'added'

export type DocumentFilter = {
  area?: string | null
  docType?: string | null
  cropYear?: number | null
  q?: string
  sort?: DocumentSort
  limit?: number
}

export function useDocuments(filter: DocumentFilter = {}) {
  const { area, docType, cropYear, q, sort = 'newest', limit = 200 } = filter
  return useQuery({
    queryKey: ['documents', area ?? null, docType ?? null, cropYear ?? null, q ?? '', sort],
    queryFn: async () => {
      let query = supabase.from('documents').select(COLUMNS)
      if (area) query = query.eq('area', area)
      if (docType) query = query.eq('doc_type', docType)
      if (cropYear) query = query.eq('crop_year', cropYear)
      // websearch takes what a person types -- quoted phrases, OR, -word --
      // rather than making them learn tsquery punctuation.
      if (q && q.trim()) query = query.textSearch('fts', q.trim(), { type: 'websearch' })

      // A document with no date of its own falls back on when it arrived, so
      // an undated row is never stranded at the end of every list.
      if (sort === 'oldest') {
        query = query.order('doc_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })
      } else if (sort === 'title') {
        query = query.order('title', { ascending: true })
      } else if (sort === 'area') {
        query = query.order('area', { ascending: true }).order('doc_date', { ascending: false, nullsFirst: false })
      } else if (sort === 'added') {
        query = query.order('created_at', { ascending: false })
      } else {
        query = query.order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      }

      const { data, error } = await query.limit(limit)
      if (error) throw error
      return data as unknown as DocumentListItem[]
    },
  })
}

export type DocumentFilterOptions = {
  kinds: { kind: string; n: number }[]
  years: { year: number; n: number }[]
  sources: { source: string; n: number }[]
}

/**
 * What there is to filter by. Counted over the whole library rather than the
 * page on screen, which is capped: filtering by a kind that is only on page
 * three would otherwise be impossible to reach.
 */
export function useDocumentFilterOptions() {
  return useQuery({
    queryKey: ['document_filter_options'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('document_filter_options')
      if (error) throw error
      return (data ?? { kinds: [], years: [], sources: [] }) as unknown as DocumentFilterOptions
    },
  })
}

/**
 * One document by id, for a link that names it. The library's own list is
 * filtered and capped, so the row a link points at is often not in it.
 */
export function useDocument(id: string | null) {
  return useQuery({
    queryKey: ['document', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('documents').select(COLUMNS).eq('id', id!).single()
      if (error) throw error
      return data as unknown as DocumentListItem
    },
  })
}

/** How many documents sit in each area, for the folder list. */
export function useDocumentCounts() {
  return useQuery({
    queryKey: ['document_counts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('document_area_counts')
      if (error) throw error
      return (data ?? []) as { area: string; n: number }[]
    },
  })
}

/** The documents filed against one record -- a field, a contract, a claim. */
export function useDocumentsFor(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ['documents_for', entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_links')
        .select(`note, documents!inner(${COLUMNS})`)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId!)
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r.documents as unknown as DocumentListItem),
        note: r.note,
      }))
    },
  })
}

/**
 * A link to open the file with. Signed, and short-lived on purpose: the
 * buckets are private and the URL is the whole of the permission.
 */
export async function documentUrl(doc: Pick<DocumentListItem, 'storage_bucket' | 'storage_path'>) {
  const { data, error } = await supabase.storage
    .from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

/**
 * The signed link for one document, fetched when it is wanted rather than
 * held on the row: every bucket here is private, so a signed URL sitting in a
 * list is a link anyone with the page can follow. Re-fetched well inside the
 * hour it lasts.
 */
export function useDocumentUrl(doc: Pick<DocumentListItem, 'id' | 'storage_bucket' | 'storage_path'> | null) {
  return useQuery({
    queryKey: ['document_url', doc?.id ?? null],
    enabled: Boolean(doc),
    staleTime: 45 * 60_000,
    queryFn: () => documentUrl(doc!),
  })
}

export function useUploadDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      area,
      docType,
      title,
      party,
      docDate,
      cropYear,
      tags,
      text,
      links,
    }: {
      file: File
      area: string
      docType?: string | null
      title?: string | null
      party?: string | null
      docDate?: string | null
      cropYear?: number | null
      tags?: string[]
      /** The words inside the file, where they could be read. Searchable. */
      text?: string | null
      links?: { entity_type: string; entity_id: string }[]
    }) => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Not signed in')
      const safeName = file.name.replace(/[^\w.\- ()]/g, '_')
      const path = `${area}/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr
      const { data: row, error: rowErr } = await supabase
        .from('documents')
        .insert({
          area,
          doc_type: docType ?? null,
          title: title?.trim() || file.name,
          party: party ?? null,
          doc_date: docDate ?? null,
          crop_year: cropYear ?? null,
          storage_bucket: DOCUMENTS_BUCKET,
          storage_path: path,
          filename: file.name,
          mime: file.type || null,
          bytes: file.size,
          tags: tags ?? [],
          // The form already read the file to suggest an area; storing those
          // words is what makes the document findable by what is inside it
          // rather than only by what it was called.
          text_content: text?.trim() ? text : null,
          source: 'upload',
          // Added by hand means filed by hand.
          curated: true,
          added_by: auth.user.id,
        })
        .select('id')
        .single()
      if (rowErr) {
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
        throw rowErr
      }
      if (links?.length) {
        const { error: linkErr } = await supabase
          .from('document_links')
          .insert(links.map((l) => ({ ...l, document_id: row.id })))
        if (linkErr) throw linkErr
      }
      return row.id
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      void queryClient.invalidateQueries({ queryKey: ['document_counts'] })
      void queryClient.invalidateQueries({ queryKey: ['document_filter_options'] })
    },
  })
}

/**
 * Refiling a document by hand. `curated` goes true with it, which is what
 * stops the mirror putting a screen's guess back over the top.
 */
export function useUpdateDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<
      Pick<DocumentRow, 'area' | 'doc_type' | 'title' | 'party' | 'doc_date' | 'crop_year' | 'tags' | 'summary'>
    >) => {
      const { error } = await supabase
        .from('documents')
        .update({ ...patch, curated: true, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      void queryClient.invalidateQueries({ queryKey: ['document_counts'] })
      void queryClient.invalidateQueries({ queryKey: ['documents_for'] })
    },
  })
}

export function useLinkDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (link: { document_id: string; entity_type: string; entity_id: string; note?: string }) => {
      const { error } = await supabase.from('document_links').insert(link)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['documents_for'] }),
  })
}

export function useUnlinkDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ documentId, entityType, entityId }: { documentId: string; entityType: string; entityId: string }) => {
      const { error } = await supabase
        .from('document_links')
        .delete()
        .eq('document_id', documentId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['documents_for'] }),
  })
}

/**
 * Only a document the library itself holds can be deleted here. A mirrored
 * row belongs to the screen that made it: deleting the index row would leave
 * the file in place and the trigger would file it again on the next change.
 */
export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (doc: DocumentListItem) => {
      if (doc.source !== 'upload') {
        throw new Error(
          `This document came from ${doc.source_table ?? 'another screen'}. Delete it there and it will leave the library with it.`,
        )
      }
      const { error } = await supabase.from('documents').delete().eq('id', doc.id)
      if (error) throw error
      await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path])
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      void queryClient.invalidateQueries({ queryKey: ['document_counts'] })
    },
  })
}

/** What the file is, for the icon and for whether the viewer can show it. */
export function documentKind(doc: Pick<DocumentListItem, 'mime' | 'filename'>): 'pdf' | 'image' | 'other' {
  const mime = doc.mime ?? ''
  if (mime === 'application/pdf' || /\.pdf$/i.test(doc.filename)) return 'pdf'
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(doc.filename)) return 'image'
  return 'other'
}
