import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { SettingsRedirect } from '@/components/SettingsRedirect'
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
const WeighScalePage = lazy(() => import('@/pages/HarvestPage').then((m) => ({ default: m.WeighScalePage })))
const PreHarvestPage = lazy(() => import('@/pages/HarvestPage').then((m) => ({ default: m.PreHarvestPage })))
const HarvestReportsPage = lazy(() => import('@/pages/HarvestPage').then((m) => ({ default: m.HarvestReportsPage })))
const ContactsPage = lazy(() => import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })))
const GrantsPage = lazy(() => import('@/pages/GrantsPage').then((m) => ({ default: m.GrantsPage })))
const ScoutingPage = lazy(() => import('@/pages/ScoutingPage').then((m) => ({ default: m.ScoutingPage })))
const LeasesPage = lazy(() => import('@/pages/LeasesPage').then((m) => ({ default: m.LeasesPage })))
const EventsPage = lazy(() => import('@/pages/EventsPage').then((m) => ({ default: m.EventsPage })))
const ContractsPage = lazy(() => import('@/pages/ContractsPage').then((m) => ({ default: m.ContractsPage })))
const IrrigationPage = lazy(() => import('@/pages/IrrigationPage').then((m) => ({ default: m.IrrigationPage })))
const FieldProgressPage = lazy(() => import('@/pages/FieldProgressPage').then((m) => ({ default: m.FieldProgressPage })))
const FertilizerPage = lazy(() => import('@/pages/FertilizerPage').then((m) => ({ default: m.FertilizerPage })))
const FertilizerRedirect = lazy(() => import('@/pages/FertilizerPage').then((m) => ({ default: m.FertilizerRedirect })))
const HaulingRedirect = lazy(() => import('@/pages/FuelPage').then((m) => ({ default: m.HaulingRedirect })))
const TruckInspectionChecklistPage = lazy(() => import('@/pages/TruckInspectionChecklistPage').then((m) => ({ default: m.TruckInspectionChecklistPage })))
const TruckInspectionsRedirect = lazy(() => import('@/pages/TruckInspectionChecklistPage').then((m) => ({ default: m.TruckInspectionsRedirect })))
const CattlePage = lazy(() => import('@/pages/CattlePage').then((m) => ({ default: m.CattlePage })))
const CattleRedirect = lazy(() => import('@/pages/CattlePage').then((m) => ({ default: m.CattleRedirect })))
const CattleDetailPage = lazy(() => import('@/pages/CattleDetailPage').then((m) => ({ default: m.CattleDetailPage })))
const WeatherPage = lazy(() => import('@/pages/WeatherPage').then((m) => ({ default: m.WeatherPage })))
const HailReportsPage = lazy(() => import('@/pages/HailReportsPage').then((m) => ({ default: m.HailReportsPage })))
const CropComparePage = lazy(() => import('@/pages/CropComparePage').then((m) => ({ default: m.CropComparePage })))
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
const ChemicalsPage = lazy(() => import('@/pages/ChemicalsPage').then((m) => ({ default: m.ChemicalsPage })))
const CalculatorPage = lazy(() => import('@/pages/CalculatorPage').then((m) => ({ default: m.CalculatorPage })))
const SprayingPage = lazy(() => import('@/pages/SprayingPage').then((m) => ({ default: m.SprayingPage })))
const SeedPlanterPage = lazy(() => import('@/pages/SeedPlanterPage').then((m) => ({ default: m.SeedPlanterPage })))
const CanolaReportsPage = lazy(() => import('@/pages/CanolaReportsPage').then((m) => ({ default: m.CanolaReportsPage })))
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const MissingPage = lazy(() => import('@/pages/MissingPage').then((m) => ({ default: m.MissingPage })))
const MenuSectionPage = lazy(() => import('@/pages/MenuSectionPage').then((m) => ({ default: m.MenuSectionPage })))

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
        {/* A season-menu section's own page: its views, each with a line on what it is for. */}
        <Route path="/menu/:section" element={<MenuSectionPage />} />
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
        <Route path="/crop-compare" element={<CropComparePage />} />
        <Route path="/crops" element={<CropsPage />} />
        <Route path="/markets" element={<CropMarketsPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/crops/:id" element={<CropDetailPage />} />
        {/* No shared Tasks | Checklists or Calendar | Monthly bar (Sam, 24 Oct
            2026): the menu lists each of them, so the bar said it twice, and
            Checklists and Monthly have tabs of their own that made a second row. */}
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/checklists" element={<ChecklistsPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/daybook" element={<DaybookPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/notifications/:id" element={<NotificationDetailPage />} />
        <Route path="/checklists/templates/:id" element={<ChecklistTemplatePage />} />
        <Route path="/checklists/runs/:id" element={<ChecklistRunPage />} />
        <Route path="/checklists/truck-inspection" element={<TruckInspectionChecklistPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/monthly" element={<MonthlyPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/grants" element={<GrantsPage />} />
        <Route path="/canola-reports" element={<CanolaReportsPage />} />
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
        {/* Harvest's other views (Sam, 24 Oct 2026); old /harvest?tab= links redirect to them. */}
        <Route path="/weigh-scale" element={<WeighScalePage />} />
        <Route path="/pre-harvest" element={<PreHarvestPage />} />
        <Route path="/harvest-reports" element={<HarvestReportsPage />} />
        {/* Flat paths, not /irrigation/river — isViewDenied matches by prefix,
            so a nested child would be switched off the moment an admin denied
            AIMM, which is not what denying AIMM means. */}
        <Route path="/irrigation" element={<IrrigationPage section="aimm" />} />
        <Route path="/river" element={<IrrigationPage section="river" />} />
        <Route path="/irrigation-info" element={<IrrigationPage section="general" />} />
        {/* Fertilizer is five views since 24 Oct 2026; /fertilizer and every old
            ?tab= link land on the view and tab the tab moved to. */}
        <Route path="/fertilizer" element={<FertilizerRedirect />} />
        <Route path="/fertilizer/soil" element={<FertilizerPage view="soil" />} />
        <Route path="/fertilizer/plan" element={<FertilizerPage view="plan" />} />
        <Route path="/fertilizer/prices" element={<FertilizerPage view="prices" />} />
        <Route path="/fertilizer/manure" element={<FertilizerPage view="manure" />} />
        <Route path="/fertilizer/savings" element={<FertilizerPage view="savings" />} />
        {/* Travel & trucking is tabs of Fuel & trucking since 24 Oct 2026; old links land on the same tab. */}
        <Route path="/hauling" element={<HaulingRedirect />} />
        {/* Under Equipment service since 24 Oct 2026: the January reminder and old
            links land on the trucks, an old ?inspection= link on that inspection. */}
        <Route path="/truck-inspections" element={<TruckInspectionsRedirect />} />
        <Route path="/utilities" element={<UtilitiesPage />} />
        {/* The Solar page moved to Utilities (6 Oct 2026); old links land on its tab. */}
        <Route path="/solar" element={<Navigate to="/utilities?tab=solar" replace />} />
        <Route path="/field-progress" element={<FieldProgressPage />} />
        {/* Flat, and cattle-markets rather than markets: /markets is already
            crop prices, and /cattle/markets would be switched off the moment an
            admin denied the map. */}
        <Route path="/cattle" element={<CattlePage view="pastures" />} />
        <Route path="/herd" element={<CattlePage view="herd" />} />
        <Route path="/feed" element={<CattlePage view="feed" />} />
        <Route path="/cattle-markets" element={<CattlePage view="sales" />} />
        <Route path="/cattle-settings" element={<CattlePage view="settings" />} />
        <Route path="/cattle/:id" element={<CattleDetailPage />} />
        {/* Cattle went from twelve menu entries to five views with tabs (Sam,
            24 Oct 2026). The old addresses land on their tab, query kept. */}
        <Route path="/grazing" element={<CattleRedirect />} />
        <Route path="/grazing-restrictions" element={<CattleRedirect />} />
        <Route path="/pregnancy" element={<CattleRedirect />} />
        <Route path="/feed-records" element={<CattleRedirect />} />
        <Route path="/bale-checks" element={<CattleRedirect />} />
        <Route path="/manifests" element={<CattleRedirect />} />
        <Route path="/grazing-leases" element={<CattleRedirect />} />
        {/* Integrations is now Settings → Connections, but the /integrations
            route stays: the John Deere, FieldNET and QuickBooks OAuth callbacks
            redirect to /integrations?jd_connected=1 (and the health alerts link
            there), and must keep landing somewhere real. */}
        <Route path="/chemicals" element={<ChemicalsPage />} />
        {/* Spraying and Seed & planter split from Chemicals and Calculator (24 Oct 2026). */}
        <Route path="/spraying" element={<SprayingPage />} />
        <Route path="/planter" element={<SeedPlanterPage />} />
        <Route path="/quickbooks" element={<QuickBooksPage />} />
        <Route path="/fuel" element={<FuelPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        {/* What's missing: one checklist of the inputs nobody has entered (16 Oct 2026). */}
        <Route path="/missing" element={<MissingPage />} />
        <Route path="/integrations" element={<SettingsRedirect from="integrations" />} />
        {/* Settings: four views since 24 Oct 2026. /settings itself only
            forwards, mapping the old ?tab= / ?section= / ?part= links. */}
        <Route path="/settings" element={<SettingsRedirect />} />
        <Route path="/settings/account" element={<SettingsPage view="account" />} />
        <Route path="/settings/people" element={<SettingsPage view="people" />} />
        <Route path="/settings/connections" element={<SettingsPage view="connections" />} />
        <Route path="/settings/farm" element={<SettingsPage view="farm" />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
