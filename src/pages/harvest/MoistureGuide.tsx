import { FileText } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { CHARTS, chartPdfUrl } from '@/lib/moisture'

/**
 * How to take a reading on the Model 919, in the order it is done.
 *
 * From the Canadian Grain Commission's own procedure for the 919/3.5" cell, not
 * from memory — the steps that look like fussiness are the ones that decide
 * whether the number means anything, and they are the first ones to get skipped
 * by somebody who has done it a hundred times.
 *
 * The one copy of the procedure. It was written out three times — here, in the
 * phone walk-through and in the tester — and the copies had started to say it
 * differently. The walk-through now reads its one-liners from `brief` below.
 */

type Step = {
  key: 'sample' | 'temp' | 'calibrate' | 'weigh' | 'read' | 'three' | 'convert'
  title: string
  body: string
  /** The warning, in one line. */
  warn?: string
  /** The warning in full, behind ⓘ. */
  why?: string
  /** What the phone walk-through says at this step, in one line. */
  brief?: string
}

export const MOISTURE_STEPS: Step[] = [
  {
    key: 'sample',
    title: 'Get the sample right first',
    body: 'Clean the dockage out of it — chaff and green material read as moisture. Check the thermometer is working while you are at it.',
    warn: 'Wet on the outside? Seal it at room temperature until it soaks in.',
    why: 'If there is moisture you can see on the outside of the kernels, seal the sample in a container at room temperature until it has soaked in. Testing a wet-skinned sample reads high.',
  },
  {
    key: 'temp',
    title: 'Bring the grain into range',
    body: 'The meter is only valid with the grain between 11 °C and 30 °C. Out of range, leave the sample in an airtight container until it comes in.',
    warn: 'Airtight, not spread out to warm up.',
    why: 'Airtight, and not spread out to warm up. Grain left open changes its moisture while it changes its temperature, and then you are measuring the shop.',
    brief: 'Only good between 11 °C and 30 °C. Outside that, keep it sealed — not spread out — until it comes in.',
  },
  {
    key: 'calibrate',
    title: 'Calibrate',
    body: 'ON-OFF switch to ON, function knob to CAL. Turn the big knob on the right until 53 sits under the hairline, then the small knob on the left until the needle is as low as it will go.',
    warn: 'Before every sample, or every ten minutes on a run of them.',
    why: 'Calibrate before every sample if you are testing now and then, or every ten minutes if you are going through loads of them. Sunflower, safflower and hemp calibrate at 73 instead of 53 — nothing we grow does.',
  },
  {
    key: 'weigh',
    title: 'Weigh the sample',
    body: 'Each crop has its own weight and the chart says which. The meter measures the resistance of a fixed mass, so the wrong weight is not a slightly wrong answer, it is a reading of nothing.',
    warn: 'Most crops are 250 g. Barley and soybeans are 225 g, oats 200 g, high-moisture corn 175 g.',
    brief: 'The wrong weight is not a slightly wrong answer — it is a reading of nothing.',
  },
  {
    key: 'read',
    title: 'Take the reading',
    body: 'Function knob to OP. Write down the grain temperature. Sit the loaded dump cylinder on the cell and press the release to drop the sample in. Turn the big knob until the needle is at its lowest, and read the dial to the nearest half division.',
    warn: 'Grain touching the cone on the centre post? The sample is probably light.',
    why: 'If grain is touching the cone on the centre post, the sample is probably light — it will not read true.',
  },
  {
    key: 'three',
    title: 'Do it three times',
    body: 'Three separate fills, and average the three dial readings. One dump of a cell is noisier than the half division you are reading it to.',
    brief: 'Three separate fills, read to the nearest half division.',
  },
  {
    key: 'convert',
    title: 'Convert it',
    body: 'Put the temperature and the averaged dial reading into the calculator on the Moisture tab. It reads the crop’s CGC table straight off, and will tell you rather than guess if the reading is off the end of the chart.',
  },
]

/** The walk-through's one line for a step. */
export const stepBrief = (key: Step['key']) => MOISTURE_STEPS.find((s) => s.key === key)?.brief

/**
 * `compact` is the copy behind the Moisture tab's "How to test" ⓘ: the same
 * steps and charts sized for a popover, each warning in full because there is
 * no second ⓘ to put it behind inside a popover. The full-width copy is what
 * an old "How to test" link opens on.
 */
export function MoistureGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <p className="text-xs text-gray-500">
        The Canadian Grain Commission&rsquo;s procedure for the 919/3.5&Prime; cell. The meter
        reads out a dial number, not a percentage — the temperature is half the answer, which is
        why it is written down at the same moment.
      </p>

      <ol className="space-y-2">
        {MOISTURE_STEPS.map((s, i) => (
          <li
            key={s.key}
            className={compact ? 'flex gap-2' : 'flex gap-3 rounded-lg border border-gray-200 bg-white p-4'}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">{s.title}</h3>
              <p className={compact ? 'mt-0.5 text-xs text-gray-700' : 'mt-0.5 text-sm text-gray-700'}>
                {s.body}
              </p>
              {s.warn && (
                <div className="mt-1.5 flex items-start gap-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                  {compact ? (
                    <span>{s.why ?? s.warn}</span>
                  ) : (
                    <>
                      <span>{s.warn}</span>
                      {s.why && (
                        <InfoPopover title={s.title} width={320}>
                          <p>{s.why}</p>
                        </InfoPopover>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className={compact ? '' : 'rounded-lg border border-gray-200 bg-white p-4'}>
        <h2 className="text-sm font-semibold text-gray-700">The charts</h2>
        <p className="mt-1 text-xs text-gray-500">
          Published by the Canadian Grain Commission and supplied free by Dimo&rsquo;s Labtronics at
          919.ca. These are the ones for what we grow; the calculator reads the numbers straight out
          of them.
        </p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {CHARTS.map((c) => (
            <li key={c.key}>
              <a
                href={chartPdfUrl(c.key)}
                target="_blank"
                rel="noreferrer"
                className="flex items-baseline gap-1.5 text-sm text-gray-700 hover:text-brand-700"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-gray-400" />
                <span className="underline">{c.crop}</span>
                <span className="text-xs text-gray-400">
                  {c.sample_weight_g} g · table {c.table_no}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {/* The tables work offline because they ship with the app; the PDFs are
            fetched, so say so rather than let somebody find out in the shop. */}
        <p className="mt-3 text-xs text-gray-400">
          The calculator works with no signal. Opening a chart PDF needs one.
        </p>
      </div>
    </div>
  )
}
