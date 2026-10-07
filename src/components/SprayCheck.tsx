import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { useRecropRules } from '@/lib/recrop'
import { carryover, cropKey, type CarryoverHit } from '@/lib/rotation-engine'
import { cn } from '@/lib/utils'

function useSprayableProducts() {
  return useQuery({
    queryKey: ['spray-check-products'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_products')
        .select('id, name, pmra_registration')
        .eq('category', 'chemical')
        .not('pmra_registration', 'is', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as { id: string; name: string; pmra_registration: string }[]
    },
  })
}

type Row = { fieldId: string; field: string; year: number; crop: string; hits: CarryoverHit[] }

/**
 * Before the tank is filled: what this product's label says about the crops
 * already planned on these fields for the next two years. Red is a crop the
 * label names and rules out; amber is a crop the label does not list, so it
 * needs a bioassay; green is clear.
 */
export function SprayCheck({ fieldId }: { fieldId?: string }) {
  const { cropYear } = useCropYear()
  const { data: products } = useSprayableProducts()
  const { data: recrop } = useRecropRules()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: plansA } = useCropPlans(cropYear + 1)
  const { data: plansB } = useCropPlans(cropYear + 2)
  const [productId, setProductId] = useState('')
  const [sprayOn, setSprayOn] = useState(new Date().toISOString().slice(0, 10))
  const [picked, setPicked] = useState<Set<string>>(new Set(fieldId ? [fieldId] : []))
  const [filter, setFilter] = useState('')

  const product = products?.find((p) => p.id === productId)
  const reg = product?.pmra_registration ?? null
  const labelRead = reg ? (recrop?.read.has(reg) ?? false) : false
  const activeFields = (fields ?? []).filter((f) => f.active !== false)

  const rows = useMemo<Row[]>(() => {
    if (!product || !reg || !recrop) return []
    const year0 = Number(sprayOn.slice(0, 4))
    const out: Row[] = []
    for (const fid of picked) {
      const field = activeFields.find((f) => f.id === fid)?.name ?? 'Field'
      for (const [y, plans] of [
        [cropYear + 1, plansA],
        [cropYear + 2, plansB],
      ] as const) {
        if (y <= year0) continue
        for (const p of (plans ?? []).filter((x) => x.field_id === fid)) {
          const crop = crops?.find((c) => c.id === p.crop_id)?.name ?? 'crop'
          const hits = carryover(cropKey(crop), [{ product: product.name, registration: reg, appliedOn: sprayOn }], recrop.byReg, `${y}-05-01`)
          out.push({ fieldId: fid, field, year: y, crop, hits })
        }
      }
    }
    return out
  }, [product, reg, recrop, picked, sprayOn, plansA, plansB, crops, cropYear, activeFields])

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const shown = (products ?? []).filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()))
  const noPlan = [...picked].filter((fid) => !rows.some((r) => r.fieldId === fid))

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <ShieldCheck className="h-4 w-4 text-brand-700" /> Before you spray: does it fit the rotation?
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Checks the product&apos;s label against the crops already planned for {cropYear + 1} and {cropYear + 2}. Planting taken as 1 May.
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="text-xs text-gray-600">
          Product
          <div className="mt-0.5 flex gap-1">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…" className="w-28 rounded border border-gray-300 px-1.5 py-1 text-sm" />
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-sm">
              <option value="">Pick a product…</option>
              {shown.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className="text-xs text-gray-600">
          Spraying on
          <input type="date" value={sprayOn} onChange={(e) => setSprayOn(e.target.value)} className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-sm" />
        </label>
      </div>

      {!fieldId && (
        <div className="mt-2">
          <span className="text-xs text-gray-600">Fields</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {activeFields.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className={cn('rounded-full border px-2 py-0.5 text-xs', picked.has(f.id) ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {product && !labelRead && (
        <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
          {product.name}&apos;s label has not been read for re-cropping yet — run &ldquo;Read re-cropping rules from the labels&rdquo; on the Rotation page.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.rotation()}>Rotation</SetupLink>
        </p>
      )}
      {product && labelRead && picked.size > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200 text-sm">
          {rows.map((r) => {
            const red = r.hits.find((h) => h.block)
            const amber = !red ? r.hits[0] : undefined
            return (
              <li key={`${r.fieldId}-${r.year}-${r.crop}`} className={cn('px-2 py-1.5', red ? 'bg-red-50' : amber ? 'bg-amber-50' : '')}>
                <span className="font-medium text-gray-900">{r.field}</span>
                <span className="text-gray-600">
                  {' '}
                  → {r.crop} in {r.year}:{' '}
                </span>
                {red ? (
                  <span className="font-semibold text-red-700">label rules it out</span>
                ) : amber ? (
                  <span className="font-semibold text-amber-800">needs a bioassay</span>
                ) : (
                  <span className="font-semibold text-green-700">fine</span>
                )}
                {(red ?? amber) && <span className="block text-xs text-gray-600">{(red ?? amber)!.message}</span>}
                {(red ?? amber)?.quote && <span className="block text-[11px] italic text-gray-400">&ldquo;{(red ?? amber)!.quote}&rdquo;</span>}
              </li>
            )
          })}
          {noPlan.map((fid) => (
            <li key={fid} className="px-2 py-1.5 text-gray-500">
              <span className="font-medium text-gray-700">{activeFields.find((f) => f.id === fid)?.name}</span>: nothing planned for {cropYear + 1}–{cropYear + 2} yet.
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
