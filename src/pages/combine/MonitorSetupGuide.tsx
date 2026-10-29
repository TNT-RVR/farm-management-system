import { useState } from 'react'
import { Usb } from 'lucide-react'
import { CopyPrompt } from '@/pages/settings/CustomizingGuide'
import { DISPLAY_BRANDS, monitorExporterPrompt } from '@/lib/combine-monitor-guide'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * Combines → Monitor files in the public copy (PUBLIC_COPY): the exporter was
 * built for one make of combine display, so this asks which combine the farm
 * has and gives a prompt for their AI assistant to set it up for that one
 * (lib/combine-monitor-guide.ts).
 */
export function MonitorSetupGuide() {
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [display, setDisplay] = useState('')
  const [version, setVersion] = useState('')
  const hint = DISPLAY_BRANDS.find((b) => b.key === brand)?.displays

  const input = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'
  return (
    <section className="overflow-hidden max-w-2xl rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
        <Usb className="h-4 w-4 text-white" /> Field boundaries for your combine’s display
      </h2>
      <div className="p-4">
      <p className="mt-1 text-sm text-gray-600">
        Each make of combine display takes its own files, so this is set up for your combine first. Fill in what you know and give the prompt to your AI assistant.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-700">
          Make
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className={input}>
            <option value="">Choose…</option>
            {DISPLAY_BRANDS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700">
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. S790, Lexion 8800" className={input} />
        </label>
        <label className="text-xs font-medium text-gray-700">
          Display in the cab
          <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder={hint ? `e.g. ${hint}` : 'Its name, if you know it'} className={input} />
        </label>
        <label className="text-xs font-medium text-gray-700">
          Display software version
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="On its About or Version screen" className={input} />
        </label>
      </div>

      <CopyPrompt text={monitorExporterPrompt({ brand, model, display, version })} />

      </div>
    </section>
  )
}
