import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Page } from '@/components/Page'
import { Select } from '@/components/Select'
import { PillTabs } from '@/components/PillTabs'
import { Dot, SummaryLine } from '@/components/RowCards'
import { RowList } from '@/components/RowList'
import { DocumentViewer } from '@/components/DocumentViewer'
import { HelpNote } from '@/components/HelpNote'
import { useTab } from '@/lib/useTab'
import { fmtMoney } from '@/lib/applied'
import type { DocumentListItem } from '@/lib/documents'
import {
  CLAIM_KIND,
  kgToBu,
  useClaims,
  useCoverage,
  useInsuredLand,
  useInsuredProduction,
  usePolicies,
} from '@/lib/insurance'

const TABS = ['claims', 'coverage', 'land', 'production'] as const
type Tab = (typeof TABS)[number]

const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: digits })

/** The quarter as AFSC writes it, which is not how the farm writes it. */
function Land({ location, field }: { location: string | null; field: { id: string; name: string } | null }) {
  if (!location) return <span className="text-gray-400">—</span>
  return (
    <>
      <span className="tabular-nums">{location}</span>
      {field ? (
        <>
          {' '}
          <Link to={`/fields/${field.id}`} className="text-green-700 underline-offset-2 hover:underline">
            {field.name}
          </Link>
        </>
      ) : (
        <span className="text-amber-700"> · no field in the app</span>
      )}
    </>
  )
}

export function InsurancePage() {
  const [tab, setTab] = useTab<Tab>('insurance', TABS)
  const { data: policies } = usePolicies()
  const [year, setYear] = useState<number | null>(null)
  const [openDoc, setOpenDoc] = useState<DocumentListItem | null>(null)

  const years = useMemo(() => [...new Set((policies ?? []).map((p) => p.crop_year))].sort((a, b) => b - a), [policies])
  const chosen = year ?? years[0] ?? null
  const policy = (policies ?? []).find((p) => p.crop_year === chosen) ?? null

  const { data: coverage } = useCoverage(policy?.id)
  const { data: land } = useInsuredLand(policy?.id)
  const { data: production } = useInsuredProduction(policy?.id)
  const { data: claims } = useClaims(chosen)
  return (
    <Page
      title="Crop insurance"
      info={
        policy
          ? `AFSC policy ${policy.policy_no ?? '—'}, client ${policy.client_id_no ?? '—'}, out of the ${policy.branch ?? '—'} branch. ` +
            `${policy.coverage_level ? `${policy.coverage_level}% coverage. ` : ''}` +
            `${policy.declared_acres ? `${num(policy.declared_acres)} declared acres. ` : ''}` +
            `What is here is what AFSC was told and what AFSC decided — the farm's own yields and acres live on their own screens.`
          : 'What AFSC was told and what AFSC decided, kept beside the farm’s own records rather than on top of them.'
      }
      actions={
        <Select
          value={String(chosen ?? '')}
          ariaLabel="Crop year"
          className="w-28"
          onChange={(v) => setYear(Number(v))}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
        />
      }
      tabs={
        <PillTabs
          tabs={[
            { key: 'claims', label: 'Claims' },
            { key: 'coverage', label: 'What is covered' },
            { key: 'land', label: 'Land report' },
            { key: 'production', label: 'What came off' },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {!policy ? (
        <p className="text-sm text-gray-500">No policy on file for {chosen}.</p>
      ) : tab === 'claims' ? (
        <>
          {!claims?.length ? (
            <p className="text-sm text-gray-500">No statements of loss for {chosen}.</p>
          ) : (
            <div className="space-y-4">
              {claims.map((c) => {
                const doc = c.documents
                return (
                  <div key={c.id} className="rounded-lg border border-gray-200 bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900">
                          {CLAIM_KIND[c.kind] ?? c.kind}
                          {c.resolved_on && <span className="ml-2 font-normal text-gray-500">{c.resolved_on}</span>}
                        </div>
                        <SummaryLine>
                          {c.inspection_no && <span>Inspection {c.inspection_no}</span>}
                          {c.assessment_no && (
                            <>
                              {c.inspection_no && <Dot />}
                              <span>Assessment {c.assessment_no}</span>
                            </>
                          )}
                          {c.version_no && (
                            <>
                              <Dot />
                              <span>v{c.version_no}</span>
                            </>
                          )}
                        </SummaryLine>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums text-gray-900">
                            {c.net_award == null ? '—' : fmtMoney(Number(c.net_award))}
                          </div>
                          <div className="text-xs text-gray-500">
                            {c.total_award != null && c.previous_award != null && Number(c.previous_award) > 0
                              ? `${fmtMoney(Number(c.total_award))} less ${fmtMoney(Number(c.previous_award))} paid`
                              : 'net award'}
                          </div>
                        </div>
                        {doc && (
                          <button
                            onClick={() => setOpenDoc(doc)}
                            title="Open the statement"
                            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Statement
                          </button>
                        )}
                      </div>
                    </div>

                    {c.notes && <p className="px-3 py-2 text-xs text-gray-600">{c.notes}</p>}

                    {c.insurance_claim_lines.length > 0 && (
                      <RowList>
                        {c.insurance_claim_lines.map((l) => (
                          <li key={l.id} className="px-3 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 text-sm text-gray-900">
                                <span className="font-medium">{l.crop_label}</span>{' '}
                                <Land location={l.land_location} field={l.fields} />
                              </div>
                              <div className="shrink-0 text-sm tabular-nums">
                                {l.award == null ? '—' : fmtMoney(Number(l.award))}
                              </div>
                            </div>
                            <SummaryLine>
                              {l.acres != null && <span className="tabular-nums">{num(l.acres)} ac</span>}
                              {l.damage_pct != null && (
                                <>
                                  <Dot />
                                  <span className="tabular-nums">{num(l.damage_pct)}% damage</span>
                                </>
                              )}
                              {l.yield_short_kg != null && (
                                <>
                                  <Dot />
                                  <span className="tabular-nums">
                                    {num(l.yield_short_kg)} kg short
                                    {kgToBu(Number(l.yield_short_kg), l.crop_label) != null &&
                                      ` (${num(kgToBu(Number(l.yield_short_kg), l.crop_label), 0)} bu)`}
                                  </span>
                                </>
                              )}
                              {l.total_coverage != null && (
                                <>
                                  <Dot />
                                  <span className="tabular-nums">{fmtMoney(Number(l.total_coverage))} cover</span>
                                </>
                              )}
                            </SummaryLine>
                          </li>
                        ))}
                      </RowList>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : tab === 'coverage' ? (
        <RowList className="rounded-lg border border-gray-200 bg-white">
          {(coverage ?? []).map((c) => (
            <li key={c.id} className="px-3 py-2">
              <div className="text-sm font-medium text-gray-900">{c.crop_label}</div>
              <SummaryLine>
                <span>{c.ag_input}</span>
                <Dot />
                <span>{c.end_use}</span>
                {c.coverage_level != null && (
                  <>
                    <Dot />
                    <span className="tabular-nums">{num(c.coverage_level)}%</span>
                  </>
                )}
                {c.hail_endorsement && (
                  <>
                    <Dot />
                    <span>hail endorsement</span>
                  </>
                )}
              </SummaryLine>
            </li>
          ))}
        </RowList>
      ) : tab === 'land' ? (
        <>
          <HelpNote>
            What we told AFSC we seeded, quarter by quarter. A quarter with no field beside it is insured but has no
            record in the app.
          </HelpNote>
          <RowList className="rounded-lg border border-gray-200 bg-white">
            {(land ?? []).map((l) => (
              <li key={l.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm text-gray-900">
                    <Land location={l.land_location} field={l.fields} />
                    {l.nickname && <span className="text-gray-500"> · {l.nickname}</span>}
                  </div>
                  <div className="shrink-0 text-sm tabular-nums">{num(l.acres)} ac</div>
                </div>
                <SummaryLine>
                  <span>{l.crop_label}</span>
                  {l.variety && l.variety !== l.crop_label && (
                    <>
                      <Dot />
                      <span>{l.variety}</span>
                    </>
                  )}
                  {l.seeding_date && (
                    <>
                      <Dot />
                      <span className="tabular-nums">seeded {l.seeding_date}</span>
                    </>
                  )}
                  {l.tenure && (
                    <>
                      <Dot />
                      <span>{l.tenure}</span>
                    </>
                  )}
                </SummaryLine>
                {l.comments && <p className="mt-1 text-xs text-amber-800">{l.comments}</p>}
              </li>
            ))}
          </RowList>
        </>
      ) : (
        <>
          <HelpNote>
            The harvested production report: what we told AFSC came off each quarter. Stored and sold are reported per
            crop, not per field, so they sit on the crop line.
          </HelpNote>
          <div className="space-y-4">
            {(production?.totals ?? []).map((t) => {
              const rows = (production?.rows ?? []).filter(
                (r) => r.crop_label === t.crop_label && r.ag_input === t.ag_input,
              )
              return (
                <div key={t.id} className="rounded-lg border border-gray-200 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {t.crop_label} <span className="font-normal text-gray-500">{t.ag_input}</span>
                      </div>
                      <SummaryLine>
                        <span className="tabular-nums">{num(t.production_kg)} kg</span>
                        {kgToBu(Number(t.production_kg), t.crop_label) != null && (
                          <>
                            <Dot />
                            <span className="tabular-nums">{num(kgToBu(Number(t.production_kg), t.crop_label))} bu</span>
                          </>
                        )}
                        {t.harvest_completed && (
                          <>
                            <Dot />
                            <span className="tabular-nums">finished {t.harvest_completed}</span>
                          </>
                        )}
                      </SummaryLine>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <div className="tabular-nums">{num(t.stored_fed_kg)} kg stored or fed</div>
                      <div className="tabular-nums">{num(t.sold_kg)} kg sold</div>
                    </div>
                  </div>
                  {t.comments && <p className="px-3 py-2 text-xs text-amber-800">{t.comments}</p>}
                  <RowList>
                    {rows.map((r) => (
                      <li key={r.id} className="px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 text-sm text-gray-900">
                            <Land location={r.land_location} field={r.fields} />
                          </div>
                          <div className="shrink-0 text-sm tabular-nums">{num(r.production_kg)} kg</div>
                        </div>
                        <SummaryLine>
                          <span className="tabular-nums">
                            {num(r.reported_acres)} of {num(r.insured_acres)} ac
                          </span>
                          {r.variety && r.variety !== r.crop_label && (
                            <>
                              <Dot />
                              <span>{r.variety}</span>
                            </>
                          )}
                          {r.yield_kg_per_acre != null && (
                            <>
                              <Dot />
                              <span className="tabular-nums">{num(r.yield_kg_per_acre, 1)} kg/ac</span>
                            </>
                          )}
                          {r.what_you_did && (
                            <>
                              <Dot />
                              <span>{r.what_you_did}</span>
                            </>
                          )}
                        </SummaryLine>
                      </li>
                    ))}
                  </RowList>
                </div>
              )
            })}
          </div>
        </>
      )}

      {openDoc && <DocumentViewer doc={openDoc} onClose={() => setOpenDoc(null)} />}
    </Page>
  )
}
