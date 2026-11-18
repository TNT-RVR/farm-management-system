import { InfoPopover } from '@/components/InfoPopover'

/**
 * A column header's one-line explanation, as a ⓘ beside its name.
 *
 * These lines used to be the header's `title`, which only a mouse ever shows:
 * on the phone and the tablet in the truck they did not exist (design review,
 * Nov 2026). The same words, now behind a tap, and still on hover for a mouse.
 * For a column that needs ranges or a worked example, use ColumnHelp.
 */
export function HeadTip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <InfoPopover title={title} width={260} hover className="ml-1">
      <span className="font-normal">{children}</span>
    </InfoPopover>
  )
}
