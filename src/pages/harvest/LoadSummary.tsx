import { Pencil } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { ExportButton } from '@/components/ExportButton'
import { useCrops, useFields, useUsers } from '@/lib/queries'
import { useBins } from '@/lib/bins'
import { isOpenLoad, useDeliverySites, useScalePhotoUrl, type BinLoad } from '@/lib/bin-loads'
import { downloadBlob, tableReportToCsv, tableReportToPdf } from '@/lib/table-report'
import { DeleteLoadButton } from '@/pages/bins/WeighIn'
import { useFieldCleanYield } from '@/lib/clean-out'
import { useAllCropPrices } from '@/lib/forecast-data'
import { UNITS_HEAD, netRows as ticketNetRows, num, photoDataUrl, singleTicketReport, ticketFacts } from '@/lib/scale-ticket-report'

function Photo({ url, loading, label }: { url: string | undefined; loading: boolean; label: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-medium text-gray-500">{label}</figcaption>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} className="aspect-[4/3] w-full rounded-md border border-gray-200 bg-gray-50 object-contain" />
        </a>
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
          {loading ? 'Loading…' : 'No photo'}
        </div>
      )}
    </figure>
  )
}

/**
 * A scale ticket at a glance (Sam, 2 Nov 2026): the weights in and out and
 * the net in kg, lb, tonnes and bushels, both scale photos, when and by whom
 * each weight went in, the driver, truck and trailer, the field it came from
 * and the bin it went to. Export at the top; Edit and Delete at the bottom.
 *
 * The weights show pre-cleaned and after clean-out, with what the load is
 * worth at the crop's price: the clean-out is the crop's estimate until the
 * field's yield after clean-out is entered, then the field's actual, so every
 * load from that field revalues by itself.
 */
export function LoadSummary({ load: l, onEdit, onClose }: { load: BinLoad; onEdit: () => void; onClose: () => void }) {
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: bins } = useBins()
  const { data: sites } = useDeliverySites()
  const { data: users } = useUsers()
  const fullPhoto = useScalePhotoUrl(l.full_photo)
  const emptyPhoto = useScalePhotoUrl(l.empty_photo)

  const { data: cleanYield } = useFieldCleanYield(l.field_id, l.crop_id, l.crop_year)
  const { data: allPrices } = useAllCropPrices()
  const t = ticketFacts(l, {
    fields: fields ?? [],
    crops: crops ?? [],
    bins: bins ?? [],
    sites: sites ?? [],
    users: users ?? [],
    prices: allPrices ?? [],
    cleanYield: () => cleanYield,
  })
  const { field, cropText, wentTo, driver, net, value, valueText, priceText } = t
  const netRows = ticketNetRows(t)
  const kgText = (v: number | null) => (v == null ? '—' : `${num(v)} kg`)

  const report = async (withPhotos: boolean) =>
    singleTicketReport(
      t,
      withPhotos
        ? await Promise.all([fullPhoto.data ? photoDataUrl(fullPhoto.data) : null, emptyPhoto.data ? photoDataUrl(emptyPhoto.data) : null])
        : [null, null],
    )
  const fileName = `Scale ticket ${l.loaded_on} ${field}`

  const row = (label: string, value: string | null | undefined) => (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value || '—'}</dd>
    </div>
  )

  return (
    <Modal
      wide
      title="Scale ticket"
      onClose={onClose}
      actions={
        <ExportButton
          label="Export this ticket"
          onExport={async (f) => {
            if (f === 'CSV') downloadBlob(new Blob([tableReportToCsv(await report(false))], { type: 'text/csv' }), `${fileName}.csv`)
            else downloadBlob(await tableReportToPdf(await report(true)), `${fileName}.pdf`)
          }}
        />
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-brand-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-800">Net</p>
            {net != null && (
              <div className="text-right">
                <p>
                  <span className="text-xs text-gray-500">Estimated value </span>
                  <span className={value != null ? 'text-lg font-semibold tabular-nums text-gray-900' : 'text-xs text-amber-700'}>{valueText}</span>
                </p>
                {priceText && <p className="text-[11px] text-gray-500">{priceText}</p>}
              </div>
            )}
          </div>
          {net == null ? (
            <p className="mt-1 text-amber-700">Not weighed out yet</p>
          ) : (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500">
                    {UNITS_HEAD.map((h) => (
                      <th key={h} className={h ? 'px-2 py-1 text-right font-normal' : 'py-1 pr-2 text-left font-normal'}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {netRows.map(([label, ...cells], i) => (
                    <tr key={label} className={i ? 'border-t border-brand-100' : undefined}>
                      <th className="py-1 pr-2 text-left text-xs font-medium text-gray-700">{label}</th>
                      {cells.length === 1 ? (
                        <td colSpan={4} className="px-2 py-1 text-right text-xs text-amber-700">
                          {cells[0]}
                        </td>
                      ) : (
                        cells.map((c, j) => (
                          <td key={j} className="whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums text-gray-900">
                            {c}
                          </td>
                        ))
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['Weighed in', l.gross_kg, t.inWhen, t.inBy, fullPhoto],
              ['Weighed out', l.tare_kg, t.outWhen, t.outBy, emptyPhoto],
            ] as const
          ).map(([label, w, when, by, photo]) => (
            <section key={label} className="rounded-lg border border-gray-200 p-3">
              <h3 className="font-semibold text-gray-900">{label}</h3>
              <p className="text-lg font-semibold tabular-nums text-gray-900">{kgText(w == null ? null : Number(w))}</p>
              <dl className="mb-2 text-xs">
                {row('When', when)}
                {row('Entered by', by)}
              </dl>
              <Photo url={photo.data} loading={photo.isLoading} label={`${label} photo`} />
            </section>
          ))}
        </div>

        <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-3">
          {row('Field', field)}
          {row('Crop', cropText)}
          {row(t.delivered ? 'Delivered to' : 'Bin', wentTo)}
          {row('Driver', driver)}
          {row('Truck', l.truck?.trim())}
          {row('Trailer', l.trailer?.trim())}
          {l.moisture_pct != null && row('Moisture', `${l.moisture_pct}%`)}
          {l.note && row('Note', l.note)}
        </dl>

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <DeleteLoadButton load={l} onDeleted={onClose} withText />
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            <Pencil className="h-4 w-4" /> {isOpenLoad(l) ? 'Finish or edit' : 'Edit'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
