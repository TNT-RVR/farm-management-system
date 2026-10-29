import { HelpNote } from '@/components/HelpNote'
import { CopyPrompt } from '@/pages/settings/CustomizingGuide'

/**
 * How a farm gets its own electricity provider's bills in, shown on the power
 * bills card in the public copy. The original farm's retailer has its own
 * reader there; nobody else's does, and any retailer's PDF can be read
 * already, so this says how to use what is here and how to add the rest.
 */
export function EnergyProviderNote() {
  const prompt = `Add a reader for my electricity provider's bills to this farm app.

My provider is: <name>. It gives me bills as: <PDFs by email / an account web page / a CSV or data download>.

Bills land in the power_bills table (one row per bill; source is 'upload',
'quickbooks' or 'portal') and power_bill_sites (one row per site: site ID,
meter number, period, kWh, demand, charges), and each site is matched to a pump
by its meter number (see netlify/functions/power-bills-background.mts and
src/lib/power-bills-core.ts). Then:
1. If my provider's PDFs read badly with the model reader, add a text parser for
   its layout in src/lib/power-bill-pdf.ts, with unit tests from a sample I attach.
2. If it has an account page or a data download instead, add an import on
   Utilities → Power (managers only) that writes power_bills rows with source
   'portal' and their sites, and never counts a month twice.
Run npx tsc -b and npx vitest run before you finish.`
  return (
    <HelpNote summary="Using your own electricity provider" className="mt-0.5">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Add your monthly power bill PDFs with Add bills. Any provider&apos;s bill can be read; each site&apos;s kWh, demand and charges come out.</li>
        <li>Or attach the PDFs to the power bills in QuickBooks and use Read the bills in QuickBooks.</li>
        <li>Put each pump&apos;s power meter number in its details (the Pumps list under Irrigation), so every site on a bill lands on its pump.</li>
        <li>If your provider has an account page or a data download rather than PDFs, your AI assistant can build an import for it:</li>
      </ol>
      <CopyPrompt text={prompt} />
    </HelpNote>
  )
}
