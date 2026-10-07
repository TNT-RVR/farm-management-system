import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useChemicalSearch } from '@/lib/chemicals'

/**
 * Choosing which registered product this one actually is.
 *
 * Only reached for the ones the automatic match would not decide: a name that
 * is several registered products ("Roundup" is four, "Liberty" five), or one
 * the registry has never heard of. Everything unambiguous is linked on the way
 * in by a trigger, so this is the exception rather than the routine.
 *
 * Saving a registration also queues its label, which is the entire point —
 * the registration is only a route to the re-entry interval.
 */
export function RegistrationPicker({
  productId,
  productName,
  current,
  onClose,
}: {
  productId: string
  productName: string
  current: string | null
  onClose: () => void
}) {
  // Seeded with the product's own name, because that is nearly always the
  // search somebody was about to type.
  const [term, setTerm] = useState(productName)
  const { data: matches, isLoading } = useChemicalSearch(term, '', 'name')
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async (registration: string | null) => {
      const { error } = await supabase
        .from('jd_products')
        .update({ pmra_registration: registration, updated_at: new Date().toISOString() })
        .eq('id', productId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jd_products'] })
      void queryClient.invalidateQueries({ queryKey: ['reentry_applications'] })
      onClose()
    },
  })

  return (
    <Modal title={`Which product is “${productName}”?`} onClose={onClose}>
      <div className="space-y-2.5 text-sm">
        <p className="text-xs text-gray-500">
          Linking this to its Health Canada registration is what lets the app read the label and
          learn the re-entry interval. Pick the wrong one and the wrong safety interval follows it
          onto every field this was sprayed on, so leave it unset rather than guess.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Product name or registration number"
            className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm"
            autoFocus
          />
        </div>

        {isLoading ? (
          <p className="text-xs text-gray-500">Searching…</p>
        ) : !matches?.length ? (
          <p className="rounded-md bg-gray-50 px-3 py-4 text-xs text-gray-500">
            Nothing in the registry matches that. Adjuvants and surfactants — MSO, Interlock and the
            like — are often not registered pesticides at all, and have no label to read.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
            {matches.slice(0, 40).map((c) => (
              <li key={c.registration_number}>
                <button
                  type="button"
                  onClick={() => save.mutate(c.registration_number)}
                  disabled={save.isPending}
                  className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-brand-50 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">{c.name}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {c.registrant ?? '—'} · {c.active_ingredients ?? 'no ingredients listed'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                    {c.registration_number}
                    {c.registration_number === current && (
                      <span className="ml-1 font-medium text-brand-700">current</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {save.isError && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}

        <div className="flex justify-between pt-1">
          {current ? (
            <button
              onClick={() => save.mutate(null)}
              disabled={save.isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Unlink
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
