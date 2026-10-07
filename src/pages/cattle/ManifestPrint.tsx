import { PURPOSES, totalHead, type ManifestWithLines } from '@/lib/manifests'
import { farmName } from '@/lib/farm-context'

/** Blank rows so the rest can be written in at the chute. */
const BLANK_ROWS = 4

const Box = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className="flex gap-2 border-b border-gray-300 py-[3px]">
    <span className="w-28 shrink-0 text-[9px] uppercase tracking-wide text-gray-500">{label}</span>
    <span className="min-w-0 flex-1 text-[11px] text-black">{value || ' '}</span>
  </div>
)

const SignatureLine = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="flex-1">
    <div className="h-7 border-b border-black">
      <span className="text-[11px]">{value || ''}</span>
    </div>
    <span className="text-[9px] uppercase tracking-wide text-gray-500">{label}</span>
  </div>
)

/**
 * A manifest on paper.
 *
 * Laid out to be filled in and handed over, not to be read on a screen: boxed
 * fields in the order they are asked for, the livestock table with spare rows
 * because the last few head are counted at the chute, and signature lines at
 * the bottom.
 *
 * It says on its face that it is the farm's record rather than the numbered LIS
 * manifest. Printing something that could be mistaken for the official document
 * would be the wrong thing to hand a brand inspector, and the manifest number
 * box is there to tie this to the real one.
 */
export function ManifestPrint({ manifest: m }: { manifest: ManifestWithLines }) {
  const purpose = PURPOSES.find((p) => p.value === m.purpose)?.label ?? ''
  const blanks = Array.from({ length: Math.max(0, BLANK_ROWS - m.lines.length) })

  return (
    <div className="mx-auto max-w-[7.5in] p-2 text-black">
      <div className="flex items-start justify-between border-b-2 border-black pb-1">
        <div>
          <h1 className="text-base font-bold uppercase tracking-wide">Livestock Manifest</h1>
          <p className="text-[9px] text-gray-600">
            Farm record — not the official Livestock Identification Services manifest
          </p>
        </div>
        <div className="text-right text-[11px]">
          <p>
            <span className="text-[9px] uppercase text-gray-500">Manifest no.</span>{' '}
            <span className="font-semibold">{m.manifest_no || '____________'}</span>
          </p>
          <p>
            <span className="text-[9px] uppercase text-gray-500">Date moved</span>{' '}
            <span className="font-semibold">{m.moved_on}</span>
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <h2 className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">
            Consignor — cattle left from
          </h2>
          <Box label="Owner" value={m.owner_name} />
          <Box label="Phone" value={m.owner_phone} />
          <Box label="Address" value={m.origin_address} />
          <Box label="Premises ID" value={m.origin_premises_id} />
          <Box label="Brand" value={[m.brand, m.brand_location].filter(Boolean).join('  —  ')} />
        </div>
        <div>
          <h2 className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">
            Consignee — going to
          </h2>
          <Box label="Destination" value={m.destination_name} />
          <Box label="Phone" value={m.destination_phone} />
          <Box label="Address" value={m.destination_address} />
          <Box label="Premises ID" value={m.destination_premises_id} />
          <Box label="Purpose" value={purpose} />
        </div>
      </div>

      <h2 className="mb-0.5 mt-3 text-[10px] font-bold uppercase tracking-wide">
        Livestock — {totalHead(m.lines)} head
      </h2>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-gray-100 text-left">
            {['Class', 'Head', 'Sex', 'Colour', 'Avg lb', 'Brand', 'Tag numbers'].map((h, i) => (
              <th
                key={h}
                className={`border border-gray-400 px-1 py-0.5 text-[9px] uppercase tracking-wide ${
                  i === 1 || i === 4 ? 'text-right' : ''
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l) => (
            <tr key={l.id}>
              <td className="border border-gray-400 px-1 py-[3px] capitalize">
                {l.animal_class ?? ''}
              </td>
              <td className="border border-gray-400 px-1 py-[3px] text-right font-semibold">
                {l.head ?? ''}
              </td>
              <td className="border border-gray-400 px-1 py-[3px]">{l.sex ?? ''}</td>
              <td className="border border-gray-400 px-1 py-[3px]">{l.colour ?? ''}</td>
              <td className="border border-gray-400 px-1 py-[3px] text-right">
                {l.avg_weight_lb ?? ''}
              </td>
              <td className="border border-gray-400 px-1 py-[3px]">{l.brand ?? ''}</td>
              <td className="border border-gray-400 px-1 py-[3px]">{l.tag_range ?? ''}</td>
            </tr>
          ))}
          {/* Spare rows: the last few head get counted at the chute, and a
              manifest with nowhere to write them gets written on the back. */}
          {blanks.map((_, i) => (
            <tr key={`blank-${i}`}>
              {Array.from({ length: 7 }).map((__, j) => (
                <td key={j} className="border border-gray-400 px-1 py-[7px]">
                  &nbsp;
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="border border-gray-400 px-1 py-[3px] text-[9px] uppercase tracking-wide">
              Total
            </td>
            <td className="border border-gray-400 px-1 py-[3px] text-right font-bold">
              {totalHead(m.lines) || ''}
            </td>
            <td className="border border-gray-400" colSpan={5} />
          </tr>
        </tbody>
      </table>

      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <h2 className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">Hauled by</h2>
          <Box label="Transporter" value={m.transporter_name} />
          <Box label="Driver" value={m.driver_name} />
          <Box label="Licence plate" value={m.licence_plate} />
          <Box label="Phone" value={m.transporter_phone} />
        </div>
        <div>
          <h2 className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">Notes</h2>
          <div className="min-h-[4.5rem] border-b border-gray-300 text-[11px]">{m.notes ?? ''}</div>
        </div>
      </div>

      <p className="mt-3 text-[9px] leading-snug text-gray-700">
        I declare that the livestock described above are owned by the consignor named, that the
        brands shown are correct, and that this movement is for the purpose stated.
      </p>

      <div className="mt-3 flex gap-6">
        <SignatureLine label="Owner or agent" value={m.signed_by} />
        <SignatureLine label="Date" value={m.signed_on} />
        <SignatureLine label="Driver" />
      </div>

      <p className="mt-3 text-[8px] text-gray-400">
        {farmName()} · printed {new Date().toISOString().slice(0, 10)} · this is the farm&rsquo;s
        copy
      </p>
    </div>
  )
}
