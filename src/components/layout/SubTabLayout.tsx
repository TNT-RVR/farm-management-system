import { Outlet } from 'react-router-dom'
import { PillNavTabs } from '@/components/PillTabs'

// A shared top tab bar for areas that combine a few related views under one nav
// item (Tasks, Calendar, Inventory). Each tab keeps its own route so deep links
// and detail pages still work; only the list routes share this bar.
export type SubTab = { to: string; label: string; end?: boolean }

export function SubTabLayout({ tabs }: { tabs: SubTab[] }) {
  return (
    <div>
      <div className="border-b border-gray-200 bg-white px-4 pt-3 md:px-6 print:hidden">
        <PillNavTabs tabs={tabs} className="border-b-0 pb-2" />
      </div>
      <Outlet />
    </div>
  )
}
