import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { SubTabLayout } from '@/components/layout/SubTabLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/Login'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
// The dashboard is the landing page and light (tile links), so it stays eager.
import { HomePage } from '@/pages/HomePage'

// Every page below loads when it is first opened, not with the app. Imported
// statically they made one 4 MB entry chunk — the map engine and the charts
// included — that a phone had to download and parse before showing the login
// screen, and every deploy changed it, so every deploy re-sent all of it.
// The service worker still precaches each chunk, so pages open offline.
// AppShell holds the Suspense boundary, so the shell stays up while one loads.
const MapSection = lazy(() => import('@/pages/MapSection').then((m) => ({ default: m.MapSection })))
const FieldsPage = lazy(() => import('@/pages/FieldsPage').then((m) => ({ default: m.FieldsPage })))
const FieldDetailPage = lazy(() => import('@/pages/FieldDetailPage').then((m) => ({ default: m.FieldDetailPage })))
const GrazingRestrictionsPage = lazy(() => import('@/pages/GrazingRestrictionsPage').then((m) => ({ default: m.GrazingRestrictionsPage })))
const DaybookPage = lazy(() => import('@/pages/DaybookPage').then((m) => ({ default: m.DaybookPage })))
const FieldWorkPage = lazy(() => import('@/pages/FieldWorkPage').then((m) => ({ default: m.FieldWorkPage })))
const CamerasPage = lazy(() => import('@/pages/CamerasPage').then((m) => ({ default: m.CamerasPage })))
const CombinePage = lazy(() => import('@/pages/CombinePage').then((m) => ({ default: m.CombinePage })))
const EquipmentPage = lazy(() => import('@/pages/EquipmentPage').then((m) => ({ default: m.EquipmentPage })))
const EquipmentDetailPage = lazy(() => import('@/pages/EquipmentDetailPage').then((m) => ({ default: m.EquipmentDetailPage })))
const ImportBoundariesPage = lazy(() => import('@/pages/ImportBoundariesPage').then((m) => ({ default: m.ImportBoundariesPage })))
const CropsPage = lazy(() => import('@/pages/CropsPage').then((m) => ({ default: m.CropsPage })))
const CropDetailPage = lazy(() => import('@/pages/CropDetailPage').then((m) => ({ default: m.CropDetailPage })))
const PlannerPage = lazy(() => import('@/pages/PlannerPage').then((m) => ({ default: m.PlannerPage })))
const TasksPage = lazy(() => import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })))
const TaskDetailPage = lazy(() => import('@/pages/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const NotificationDetailPage = lazy(() => import('@/pages/NotificationDetailPage').then((m) => ({ default: m.NotificationDetailPage })))
const ChecklistsPage = lazy(() => import('@/pages/ChecklistsPage').then((m) => ({ default: m.ChecklistsPage })))
const ChecklistTemplatePage = lazy(() => import('@/pages/ChecklistTemplatePage').then((m) => ({ default: m.ChecklistTemplatePage })))
const ChecklistRunPage = lazy(() => import('@/pages/ChecklistRunPage').then((m) => ({ default: m.ChecklistRunPage })))
const CalendarPage = lazy(() => import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const MonthlyPage = lazy(() => import('@/pages/MonthlyPage').then((m) => ({ default: m.MonthlyPage })))
const BinsRedirect = lazy(() => import('@/pages/HarvestPage').then((m) => ({ default: m.BinsRedirect })))
const HarvestPage = lazy(() => import('@/pages/HarvestPage').then((m) => ({ default: m.HarvestPage })))
const ContactsPage = lazy(() => import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })))
const GrantsPage = lazy(() => import('@/pages/GrantsPage').then((m) => ({ default: m.GrantsPage })))
const ScoutingPage = lazy(() => import('@/pages/ScoutingPage').then((m) => ({ default: m.ScoutingPage })))
const LeasesPage = lazy(() => import('@/pages/LeasesPage').then((m) => ({ default: m.LeasesPage })))
const EventsPage = lazy(() => import('@/pages/EventsPage').then((m) => ({ default: m.EventsPage })))
const ContractsPage = lazy(() => import('@/pages/ContractsPage').then((m) => ({ default: m.ContractsPage })))
const IrrigationPage = lazy(() => import('@/pages/IrrigationPage').then((m) => ({ default: m.IrrigationPage })))
const FieldProgressPage = lazy(() => import('@/pages/FieldProgressPage').then((m) => ({ default: m.FieldProgressPage })))
const FertilizerPage = lazy(() => import('@/pages/FertilizerPage').then((m) => ({ default: m.FertilizerPage })))
const HaulingPage = lazy(() => import('@/pages/HaulingPage').then((m) => ({ default: m.HaulingPage })))
const CattlePage = lazy(() => import('@/pages/CattlePage').then((m) => ({ default: m.CattlePage })))
const CattleDetailPage = lazy(() => import('@/pages/CattleDetailPage').then((m) => ({ default: m.CattleDetailPage })))
const WeatherPage = lazy(() => import('@/pages/WeatherPage').then((m) => ({ default: m.WeatherPage })))
const HailReportsPage = lazy(() => import('@/pages/HailReportsPage').then((m) => ({ default: m.HailReportsPage })))
const RotationPage = lazy(() => import('@/pages/RotationPage').then((m) => ({ default: m.RotationPage })))
const CropMarketsPage = lazy(() => import('@/pages/CropMarketsPage').then((m) => ({ default: m.CropMarketsPage })))
const FieldActivityPage = lazy(() => import('@/pages/FieldActivityPage').then((m) => ({ default: m.FieldActivityPage })))
const MeetingPage = lazy(() => import('@/pages/MeetingPage').then((m) => ({ default: m.MeetingPage })))
const SearchPage = lazy(() => import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const UtilitiesPage = lazy(() => import('@/pages/UtilitiesPage').then((m) => ({ default: m.UtilitiesPage })))
const FuelPage = lazy(() => import('@/pages/FuelPage').then((m) => ({ default: m.FuelPage })))
const PrivacyPage = lazy(() => import('@/pages/LegalPage').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('@/pages/LegalPage').then((m) => ({ default: m.TermsPage })))
const QuickBooksPage = lazy(() => import('@/pages/QuickBooksPage').then((m) => ({ default: m.QuickBooksPage })))
const BaleChecksPage = lazy(() => import('@/pages/BaleChecksPage').then((m) => ({ default: m.BaleChecksPage })))
const ChemicalsPage = lazy(() => import('@/pages/ChemicalsPage').then((m) => ({ default: m.ChemicalsPage })))
const CalculatorPage = lazy(() => import('@/pages/CalculatorPage').then((m) => ({ default: m.CalculatorPage })))
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Public, no sign-in: Intuit reviews these, and so does anyone deciding
          whether to connect their books. Filled in from Farm setup. */}
      <Route path="/legal/privacy" element={<Suspense fallback={null}><PrivacyPage /></Suspense>} />
      <Route path="/legal/terms" element={<Suspense fallback={null}><TermsPage /></Suspense>} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* The dashboard is the tile grid. /home was its address for a day and
            still works, so a bookmark or a saved tile does not break. */}
        <Route path="/dashboard" element={<HomePage />} />
        <Route path="/home" element={<Navigate to="/dashboard" replace />} />
        <Route path="/weather" element={<WeatherPage />} />
        <Route path="/hail" element={<HailReportsPage />} />
        <Route path="/meeting" element={<MeetingPage />} />
        {/* What's new is a tab of the Monday meeting since 7 Oct 2026. */}
        <Route path="/whats-new" element={<Navigate to="/meeting?tab=whats-new" replace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/map" element={<MapSection />} />
        <Route path="/topography" element={<Navigate to="/map?tab=topography" replace />} />
        <Route path="/fields" element={<FieldsPage />} />
        <Route path="/fields/import" element={<ImportBoundariesPage />} />
        {/* One field, a section at a time. Sections are routes rather than
            component state, so a tab is a place somebody can link to, come back
            to, and open on a phone. */}
        <Route path="/fields/:id" element={<FieldDetailPage />} />
        <Route path="/fields/:id/inputs" element={<FieldDetailPage section="inputs" />} />
        <Route path="/fields/:id/irrigation" element={<FieldDetailPage section="irrigation" />} />
        <Route path="/fields/:id/soil" element={<FieldDetailPage section="soil" />} />
        <Route path="/fields/:id/history" element={<FieldDetailPage section="history" />} />
        <Route path="/fields/:id/notes" element={<FieldDetailPage section="notes" />} />
        <Route path="/fields/:id/scouting" element={<FieldDetailPage section="scouting" />} />
        <Route path="/fields/:id/settings" element={<FieldDetailPage section="settings" />} />
        <Route path="/fields/:id/work" element={<FieldWorkPage />} />
        <Route path="/fields/:id/activity" element={<FieldActivityPage />} />
        <Route path="/cameras" element={<CamerasPage />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/combine" element={<CombinePage />} />
        <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
        {/* No shared tab bar any more: Crops in the sidebar IS that navigation,
            and two rows of tabs stacked on one another was the reason this
            needed rearranging. */}
        <Route path="/plan" element={<PlannerPage />} />
        <Route path="/rotation" element={<RotationPage />} />
        <Route path="/crops" element={<CropsPage />} />
        <Route path="/markets" element={<CropMarketsPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/crops/:id" element={<CropDetailPage />} />
        <Route
          element={
            <SubTabLayout
              tabs={[
                { to: '/tasks', label: 'Tasks', end: true },
                { to: '/checklists', label: 'Checklists' },
              ]}
            />
          }
        >
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/checklists" element={<ChecklistsPage />} />
        </Route>
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/daybook" element={<DaybookPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/notifications/:id" element={<NotificationDetailPage />} />
        <Route path="/checklists/templates/:id" element={<ChecklistTemplatePage />} />
        <Route path="/checklists/runs/:id" element={<ChecklistRunPage />} />
        <Route
          element={
            <SubTabLayout
              tabs={[
                { to: '/calendar', label: 'Calendar', end: true },
                { to: '/monthly', label: 'Monthly' },
              ]}
            />
          }
        >
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/monthly" element={<MonthlyPage />} />
        </Route>
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/grants" element={<GrantsPage />} />
        <Route path="/scouting" element={<ScoutingPage />} />
        <Route path="/leases" element={<LeasesPage />} />
        {/* No SubTabLayout here. "Inventory" and "Bins" were a tab bar across
            the top repeating the two sidebar entries directly beside them —
            the same two words twice on one screen. The tabs that belong at the
            top of these pages are their own sub-views, which BinsPage renders
            itself: Estimator, Bins & allocations, Map. */}
        {/* Inventory folded into Storage; the old address still lands there. */}
        <Route path="/inventory" element={<Navigate to="/harvest?tab=bins" replace />} />
        {/* Storage is part of Harvest now; old links and tiles land on its tab. */}
        <Route path="/bins" element={<BinsRedirect />} />
        <Route path="/harvest" element={<HarvestPage />} />
        {/* Flat paths, not /irrigation/river — isViewDenied matches by prefix,
            so a nested child would be switched off the moment an admin denied
            AIMM, which is not what denying AIMM means. */}
        <Route path="/irrigation" element={<IrrigationPage section="aimm" />} />
        <Route path="/river" element={<IrrigationPage section="river" />} />
        <Route path="/turbines" element={<IrrigationPage section="turbine" />} />
        <Route path="/irrigation-info" element={<IrrigationPage section="general" />} />
        <Route path="/fertilizer" element={<FertilizerPage />} />
        <Route path="/hauling" element={<HaulingPage />} />
        <Route path="/utilities" element={<UtilitiesPage />} />
        {/* The Solar page moved to Utilities (6 Oct 2026); old links land on its tab. */}
        <Route path="/solar" element={<Navigate to="/utilities?tab=solar" replace />} />
        <Route path="/field-progress" element={<FieldProgressPage />} />
        {/* Flat, and cattle-markets rather than markets: /markets is already
            crop prices, and /cattle/markets would be switched off the moment an
            admin denied the map. */}
        <Route path="/cattle" element={<CattlePage section="map" />} />
        <Route path="/herd" element={<CattlePage section="herd" />} />
        <Route path="/grazing" element={<CattlePage section="grazing" />} />
        <Route path="/feed" element={<CattlePage section="feed" />} />
        <Route path="/feed-records" element={<CattlePage section="records" />} />
        <Route path="/cattle-markets" element={<CattlePage section="markets" />} />
        <Route path="/manifests" element={<CattlePage section="manifests" />} />
        <Route path="/grazing-leases" element={<CattlePage section="leases" />} />
        <Route path="/pregnancy" element={<CattlePage section="pregnancy" />} />
        <Route path="/cattle-settings" element={<CattlePage section="settings" />} />
        <Route path="/cattle/:id" element={<CattleDetailPage />} />
        <Route path="/grazing-restrictions" element={<GrazingRestrictionsPage />} />
        {/* Integrations now lives as a tab on Users & Settings, but the route
            stays: the John Deere and FieldNET OAuth callbacks redirect to
            /integrations?jd_connected=1 and must keep landing somewhere real. */}
        <Route path="/chemicals" element={<ChemicalsPage />} />
        <Route path="/bale-checks" element={<BaleChecksPage />} />
        <Route path="/quickbooks" element={<QuickBooksPage />} />
        <Route path="/fuel" element={<FuelPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/integrations" element={<SettingsPage initialTab="Integrations" />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
