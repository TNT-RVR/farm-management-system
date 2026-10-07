import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { ProductResolver } from './applied'

export type JdProduct = Database['public']['Tables']['jd_products']['Row']
export type JdProductAlias = Database['public']['Tables']['jd_product_aliases']['Row']

/**
 * The price book, plus the alias table that maps every spelling an operator has
 * typed into Deere onto the product actually bought.
 */
export function useJdProducts() {
  return useQuery({
    queryKey: ['jd_products'],
    queryFn: async () => {
      const [products, aliases] = await Promise.all([
        supabase.from('jd_products').select('*').order('name'),
        supabase.from('jd_product_aliases').select('*').order('deere_name'),
      ])
      if (products.error) throw products.error
      if (aliases.error) throw aliases.error
      return { products: products.data, aliases: aliases.data }
    },
    staleTime: 60_000,
  })
}

/** Turns the price book into the resolver `appliedByProduct` expects. */
export function useProductResolver(): ProductResolver | undefined {
  const { data } = useJdProducts()
  return useMemo(() => {
    if (!data) return undefined
    const byId = new Map(data.products.map((p) => [p.id, p]))
    const byAlias = new Map<string, JdProduct>()
    for (const a of data.aliases) {
      if (a.ignored || !a.product_id) continue
      const product = byId.get(a.product_id)
      if (product) byAlias.set(a.deere_name.trim().toLowerCase(), product)
    }
    return (deereName: string) => {
      const p = byAlias.get(deereName.trim().toLowerCase())
      return p ? { name: p.name, pricePerUnit: p.price_per_unit } : null
    }
  }, [data])
}

export function useSaveProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { id: string } & Database['public']['Tables']['jd_products']['Update']) => {
      const { id, ...patch } = p
      const { error } = await supabase
        .from('jd_products')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jd_products'] })
      void qc.invalidateQueries({ queryKey: ['jd_field_operations'] })
    },
  })
}

/**
 * A fertilizer quoted before it was ever bought: made a product with the
 * quote as its price, so it shows on the price list and prices the field
 * costs until an invoice replaces it.
 */
export function useCreateQuotedProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { name: string; unit: 'kg' | 'L'; price_per_unit: number; on: string }) => {
      const { error } = await supabase.from('jd_products').insert({
        name: p.name,
        unit: p.unit,
        category: 'fertilizer',
        price_per_unit: p.price_per_unit,
        price_updated_on: p.on,
        price_source: `Quote ${p.on}`,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_products'] }),
  })
}

/**
 * A product typed onto the price list by hand (Sam, 7 Oct 2026: rows can be
 * added as well as edited). A null price date marks the price as hand-typed.
 */
export function useAddProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { name: string; unit: 'kg' | 'L'; price_per_unit: number | null; category: 'chemical' | 'fertilizer' }) => {
      const { data, error } = await supabase
        .from('jd_products')
        .insert({ ...p, name: p.name.trim(), price_source: 'Added by hand' })
        .select('id')
        .single()
      if (error) {
        if (error.code === '23505') throw new Error('There is already a product by that name.')
        throw error
      }
      return data.id as string
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_products'] }),
  })
}

/**
 * Remove a hand-added product. The caller checks it first (handAddedProduct):
 * one Deere, an invoice or the sprayer knows about would come back or lose
 * its history, so only those with none of the three go.
 */
export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('jd_products').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_products'] }),
  })
}

/** Point a Deere spelling at a different product, or mark it as not an input. */
export function useLinkAlias() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { deere_name: string; product_id?: string | null; ignored?: boolean }) => {
      const { deere_name, ...patch } = a
      const { error } = await supabase
        .from('jd_product_aliases')
        .update(patch)
        .eq('deere_name', deere_name)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_products'] }),
  })
}

/**
 * Fold one product into another. The database moves the aliases and invoice
 * lines, keeps the dropped name as an alias, re-reads the price, and refuses
 * a pair whose units, categories or registrations disagree.
 */
export function useMergeProducts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { keep: string; drop: string; force?: boolean }) => {
      // force: the two carry different registrations and the person has said
      // they are one product anyway; the kept one's registration survives.
      const { error } = await supabase.rpc('merge_jd_products', {
        p_keep: v.keep,
        p_drop: v.drop,
        p_force: v.force ?? false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      for (const k of ['jd_products', 'product_purchases', 'product_applications', 'jd_field_operations'])
        void qc.invalidateQueries({ queryKey: [k] })
    },
  })
}

/**
 * What was growing where a product went on: crop name by field and season.
 *
 * The price list shows the crops a product has ACTUALLY been sprayed on, not
 * the crops its label allows. That comes from the crop plans behind the
 * applications, which live across every season, so this reads them all once.
 */
export function useCropByFieldSeason() {
  return useQuery({
    queryKey: ['crop_by_field_season'],
    queryFn: async () => {
      const [plans, crops] = await Promise.all([
        supabase.from('crop_plans').select('field_id, crop_year, crop_id'),
        supabase.from('crops').select('id, name'),
      ])
      if (plans.error) throw plans.error
      if (crops.error) throw crops.error
      const cropName = new Map((crops.data ?? []).map((c) => [c.id, c.name]))
      const out = new Map<string, string>()
      for (const p of plans.data ?? []) {
        const name = cropName.get(p.crop_id)
        if (name) out.set(`${p.field_id}|${p.crop_year}`, name)
      }
      return out
    },
    staleTime: 10 * 60_000,
  })
}

/** Registry product type (herbicide, fungicide…) for each registration on the price list. */
export function useRegistrationTypes(registrations: string[]) {
  const regs = [...new Set(registrations.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['registration_types', regs],
    enabled: regs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chemicals')
        .select('registration_number, product_type')
        .in('registration_number', regs)
      if (error) throw error
      return new Map((data ?? []).map((c) => [c.registration_number, c.product_type]))
    },
    staleTime: 60 * 60_000,
  })
}

/**
 * A product's type in a word, for the price list.
 *
 * The registry's word where the product is registered; otherwise what the
 * no-label note says it is, since those are the adjuvants and fertilisers.
 */
export function productTypeLabel(
  registryType: string | null | undefined,
  labelNote: string | null | undefined,
): string | null {
  if (registryType) {
    // "CROP BACTERICIDE, FUNGICIDE" reads better as "Fungicide, bactericide".
    const words = registryType
      .split(',')
      .map((w) => w.trim().toLowerCase().replace(/^crop /, ''))
      .filter(Boolean)
    const order = ['herbicide', 'fungicide', 'insecticide']
    words.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    const text = words.join(', ')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
  const n = (labelNote ?? '').toLowerCase()
  if (!n) return null
  if (/biostimulant/.test(n)) return 'Biostimulant'
  if (/adjuvant|water condition|surfactant|drift/.test(n)) return 'Adjuvant'
  if (/fertili[sz]er|nitrogen|humic|foliar|stabili[sz]er/.test(n)) return 'Fertiliser'
  return null
}

export type ProductDocument = Database['public']['Tables']['product_documents']['Row']

/** The supplier sheets on file, by product, for the products the registry has never heard of. */
export function useProductDocuments() {
  return useQuery({
    queryKey: ['product_documents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_documents')
        .select('*')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      const byProduct = new Map<string, ProductDocument[]>()
      for (const row of data ?? []) {
        const list = byProduct.get(row.product_id) ?? []
        list.push(row)
        byProduct.set(row.product_id, list)
      }
      return { rows: data ?? [], byProduct }
    },
    staleTime: 5 * 60_000,
  })
}

const DOC_BUCKET = 'field-files'

/** A five-minute link to open a sheet in a new tab. */
export async function productDocumentUrl(doc: ProductDocument): Promise<string> {
  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(doc.storage_path, 300)
  if (error) throw error
  return data.signedUrl
}

/** Put a sheet in the bucket under the product and record it. */
export function useAttachProductDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { productId: string; file: File; title?: string; source?: string | null; summary?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Not signed in')
      const safeName = v.file.name.replace(/[^\w.\- ()]/g, '_')
      const path = `products/${v.productId}/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage.from(DOC_BUCKET).upload(path, v.file, {
        contentType: v.file.type || 'application/octet-stream',
        upsert: false,
      })
      if (upErr) throw upErr
      const { error } = await supabase.from('product_documents').insert({
        product_id: v.productId,
        title: v.title?.trim() || v.file.name,
        filename: v.file.name,
        storage_path: path,
        source: v.source ?? null,
        summary: v.summary ?? null,
        uploaded_by: auth.user.id,
      })
      if (error) {
        await supabase.storage.from(DOC_BUCKET).remove([path])
        throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product_documents'] }),
  })
}

export function useRemoveProductDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (doc: ProductDocument) => {
      const { error } = await supabase.from('product_documents').delete().eq('id', doc.id)
      if (error) throw error
      await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path])
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product_documents'] }),
  })
}

export type ProductApplication = Database['public']['Views']['product_applications']['Row']
export type ProductPurchase = Database['public']['Tables']['product_purchases']['Row']

/**
 * Every application of every product, indexed by product.
 *
 * One query for the whole table rather than one per product: it is a few
 * hundred rows covering three seasons, and a row-at-a-time fetch behind an
 * expander would make the pricing list feel like it was thinking.
 */
export function useProductApplications() {
  return useQuery({
    queryKey: ['product_applications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_applications')
        .select('*')
        .order('applied_on', { ascending: false })
      if (error) throw error
      const byProduct = new Map<string, ProductApplication[]>()
      for (const row of data ?? []) {
        if (!row.product_id) continue
        const list = byProduct.get(row.product_id) ?? []
        list.push(row)
        byProduct.set(row.product_id, list)
      }
      return { rows: data ?? [], byProduct }
    },
    staleTime: 5 * 60_000,
  })
}

/** The invoice lines behind each product's price, newest first. */
export function useProductPurchases() {
  return useQuery({
    queryKey: ['product_purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_purchases')
        .select('*')
        .order('invoice_date', { ascending: false })
      if (error) throw error
      const byProduct = new Map<string, ProductPurchase[]>()
      for (const row of data ?? []) {
        if (!row.product_id) continue
        const list = byProduct.get(row.product_id) ?? []
        list.push(row)
        byProduct.set(row.product_id, list)
      }
      return { rows: data ?? [], byProduct }
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * A short-lived link to one invoice PDF.
 *
 * The bucket is private — an invoice carries the ranch's account number and
 * what it pays — so the file is reached through a signed URL that expires
 * rather than by a public path.
 */
export function useInvoiceUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ['invoice_url', storagePath],
    enabled: !!storagePath,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('invoices')
        .createSignedUrl(storagePath as string, 60 * 60)
      if (error) throw error
      return data.signedUrl
    },
    staleTime: 50 * 60_000,
  })
}
