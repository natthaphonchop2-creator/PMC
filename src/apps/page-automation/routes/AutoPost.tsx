import { CheckCircle2, CircleAlert } from 'lucide-react'
import { PageAutomationPanel, PageAutomationState } from '../components'
import { classifyAutoEligibility, missingPermissionStates } from '../policy'
import type {
  AutoEligibilityAssetState,
  AutoEligibilityContentType,
  AutoEligibilityResult,
  AutoMode,
  ManagedPage,
  PageMessage,
  PageMappingState,
  PostDraftChannel,
  SharedAdsInsightForPage,
} from '../types'

type Summary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

type AutoPostProps = {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  messages: PageMessage[]
  pages: ManagedPage[]
  summary: Summary
}

type PipelineItem = {
  detail: string
  meta: string
  title: string
  tone: 'good' | 'watch' | 'critical' | 'neutral'
}

type DraftPolicyContext = {
  adsAiConfidence: number
  approvalState: 'cleared' | 'required' | 'unknown'
  assetState: AutoEligibilityAssetState
  contentType: AutoEligibilityContentType
  hasExplicitAdsConfidence: boolean
  hasPii: boolean
  hasSensitiveHealthDetail: boolean
}

type PermissionStateSummary = {
  detail: string
  tone: 'good' | 'watch' | 'critical' | 'neutral'
}

const publishSurface: PostDraftChannel = 'facebook_feed'
const unknownAdsConfidence = 0.7

export function AutoPost({ adsInsight, autoMode, messages, pages, summary }: AutoPostProps) {
  const selectedPage = pages[0]
  const permissionReports = selectedPage?.permissions ?? []
  const pageMapping = pageMappingFor(selectedPage, adsInsight)
  const draftPolicy = draftPolicyContextFor(adsInsight)
  const adsAiConfidence = draftPolicy.adsAiConfidence
  const permissionState = permissionStateFor(selectedPage)
  const now = new Date().toISOString()
  const guardrailScore = selectedPage ? Math.min(96, Math.max(78, Math.round(selectedPage.healthScore + 4))) : 70
  const eligibility = classifyAutoEligibility({
    adsAiConfidence,
    adsInsightCheckedAt: adsInsight?.source.checkedAt ?? '',
    assetState: draftPolicy.assetState,
    contentType: draftPolicy.contentType,
    guardrailScore,
    hasPii: draftPolicy.hasPii,
    hasSensitiveHealthDetail: draftPolicy.hasSensitiveHealthDetail,
    now,
    pageId: selectedPage?.id ?? '',
    pageMapping,
    pageSyncedAt: selectedPage?.lastSyncedAt ?? '',
    permissionReports,
    permissionsSyncedAt: latestPermissionSync(selectedPage),
    publishSurface,
  })
  const pipelineColumns = buildPipelineColumns({ adsInsight, eligibility, messages, selectedPage })
  const canMarkEligible =
    autoMode === 'on' &&
    eligibility.state === 'auto_eligible' &&
    draftPolicy.approvalState === 'cleared'

  return (
    <div className="pa-grid">
      <PageAutomationPanel
        className="pa-span-8"
        subtitle="Draft, review, scheduled, posted, and failed states for page-level content work."
        title="Content pipeline"
      >
        <div className="pa-pipeline-board">
          {pipelineColumns.map((column) => (
            <section className="pa-pipeline-column" key={column.title}>
              <div className="pa-pipeline-column-head">
                <strong>{column.title}</strong>
                <span className="pa-pipeline-count">{column.items.length}</span>
              </div>
              <div className="pa-pipeline-list">
                {column.items.length ? (
                  column.items.map((item) => (
                    <article className={`pa-pipeline-card ${item.tone}`} key={`${column.title}-${item.title}`}>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <footer>{item.meta}</footer>
                    </article>
                  ))
                ) : (
                  <div className="pa-pipeline-empty">No items</div>
                )}
              </div>
            </section>
          ))}
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel
        className="pa-span-4"
        subtitle="Auto ON remains limited to low-risk eligible page posts."
        title="Policy guardrail"
      >
        <div className="pa-guardrail-card">
          {eligibility.state === 'auto_eligible' ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
          <div>
            <strong>{eligibilityLabel(eligibility)}</strong>
            <p>{eligibility.reason}</p>
          </div>
        </div>

        <div className="pa-guardrail-list">
          <GuardrailRow label="Auto mode" value={autoMode === 'on' ? 'ON, low-risk only' : 'OFF, suggest-only'} tone={autoMode === 'on' ? 'watch' : 'neutral'} />
          <GuardrailRow label="Surface" value="Facebook feed v1" tone="good" />
          <GuardrailRow label="Ads confidence" value={adsConfidenceLabel(adsInsight, draftPolicy)} tone={adsConfidenceTone(adsInsight, draftPolicy)} />
          <GuardrailRow label="Guardrail score" value={`${guardrailScore}/100`} tone={guardrailScore >= 90 ? 'good' : 'watch'} />
          <GuardrailRow label="Unread inbox" value={`${summary.unread} pending`} tone={summary.unread > 0 ? 'watch' : 'good'} />
        </div>

        <PageAutomationState
          detail="Replies and Ads changes stay draft-only here. Meta write actions require the dedicated backend path and policy result."
          tone="neutral"
          title="No direct Meta write from this screen"
        />
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-7" subtitle="Operator-edited draft fields before any schedule or approval queue step." title="Draft composer">
        <div className="pa-form-grid">
          <label className="pa-field">
            <span>Page</span>
            <input readOnly value={selectedPage ? `${selectedPage.name} (${selectedPage.handle})` : 'No connected page'} />
          </label>
          <label className="pa-field">
            <span>Objective</span>
            <input readOnly value={adsInsight ? 'Educational post from current Ads + Page signal' : 'Page education draft'} />
          </label>
          <label className="pa-field wide">
            <span>Caption draft</span>
            <textarea
              readOnly
              rows={5}
              value={
                adsInsight
                  ? draftCaptionFromInsight(adsInsight, selectedPage)
                  : 'รอ Ads AI insight และข้อมูลเพจก่อนสร้าง draft ที่พร้อมตรวจ'
              }
            />
          </label>
          <label className="pa-field">
            <span>CTA</span>
            <input readOnly value="Inbox for consultation" />
          </label>
          <label className="pa-field">
            <span>Destination</span>
            <input readOnly value={selectedPage ? selectedPage.handle : 'Select page first'} />
          </label>
        </div>

        <div className="pa-action-row">
          <button className="pa-button" disabled={!selectedPage} type="button">
            Save draft
          </button>
          <button className="pa-button primary" disabled={eligibility.state === 'blocked'} type="button">
            Send to approval
          </button>
          <button className="pa-button" disabled={!canMarkEligible} type="button">
            Mark eligible
          </button>
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-5" subtitle="Freshness, permission, and source checks for the draft candidate." title="Decision context">
        <div className="pa-list">
          <PageAutomationState
            detail={adsInsight ? `checked ${formatDateTime(adsInsight.source.checkedAt)}` : 'Ads AI bridge not available'}
            tone={adsInsight ? 'good' : 'critical'}
            title="Ads AI source"
          />
          <PageAutomationState
            detail={selectedPage ? `page synced ${formatDateTime(selectedPage.lastSyncedAt)}` : 'No page record loaded'}
            tone={selectedPage ? 'good' : 'watch'}
            title="Page data"
          />
          <PageAutomationState
            detail={permissionState.detail}
            tone={permissionState.tone}
            title="Permission state"
          />
        </div>
      </PageAutomationPanel>
    </div>
  )
}

function GuardrailRow({
  label,
  tone,
  value,
}: {
  label: string
  tone: 'good' | 'watch' | 'critical' | 'neutral'
  value: string
}) {
  return (
    <div className={`pa-check-row ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function buildPipelineColumns({
  adsInsight,
  eligibility,
  messages,
  selectedPage,
}: {
  adsInsight: SharedAdsInsightForPage | null
  eligibility: AutoEligibilityResult
  messages: PageMessage[]
  selectedPage?: ManagedPage
}) {
  const baseDraft: PipelineItem = {
    detail: selectedPage ? `${selectedPage.name} education post from page health and Ads signal` : 'Waiting for connected page data',
    meta: adsInsight ? `ROAS ${adsInsight.metrics.roas.toFixed(2)}x` : 'No Ads scope',
    title: 'Service education draft',
    tone: selectedPage ? 'neutral' : 'watch',
  }
  const inboxDraft: PipelineItem = {
    detail: `${messages.filter((message) => message.unread).length} unread inbox items remain human-reply only`,
    meta: 'Reply suggestions are draft-only',
    title: 'Inbox FAQ angle',
    tone: messages.some((message) => message.priority === 'high') ? 'watch' : 'neutral',
  }
  const eligibilityItem: PipelineItem = {
    detail: eligibility.reason,
    meta: eligibility.state.replace('_', ' '),
    title: 'Facebook feed candidate',
    tone: eligibility.state === 'auto_eligible' ? 'good' : eligibility.state === 'needs_approval' ? 'watch' : 'critical',
  }

  return [
    { items: [baseDraft, inboxDraft], title: 'Draft' },
    { items: eligibility.state === 'auto_eligible' ? [eligibilityItem] : [], title: 'Ready' },
    { items: eligibility.state === 'needs_approval' ? [eligibilityItem] : [], title: 'Needs Review' },
    { items: [], title: 'Scheduled' },
    { items: [], title: 'Posted' },
    { items: eligibility.state === 'blocked' ? [eligibilityItem] : [], title: 'Failed' },
  ]
}

function pageMappingFor(page: ManagedPage | undefined, adsInsight: SharedAdsInsightForPage | null): PageMappingState {
  if (!page || !adsInsight) return 'missing'
  if (adsInsight.scope.pageId === page.id) return 'explicit'
  if (adsInsight.scope.pageName === page.name) return 'explicit'
  return 'inferred'
}

function draftPolicyContextFor(adsInsight: SharedAdsInsightForPage | null): DraftPolicyContext {
  const confidence = explicitConfidenceFromInsight(adsInsight)
  const sourceText = draftSourceText(adsInsight)
  const approvalRequired = Boolean(
    adsInsight?.policy.approvalRequired ||
      adsInsight?.recommendations.some((recommendation) => recommendation.requiresApproval) ||
      adsInsight?.creativeSignals.length,
  )
  const contentType = contentTypeFromDraftSource(adsInsight, sourceText)
  const hasSensitiveHealthDetail =
    contentType === 'medical_claim' || contentType === 'sensitive_before_after' || containsSensitiveHealthDetail(sourceText)

  return {
    adsAiConfidence: confidence ?? (adsInsight ? unknownAdsConfidence : 0),
    approvalState: adsInsight ? (approvalRequired ? 'required' : 'cleared') : 'unknown',
    assetState: assetStateFromDraftSource(adsInsight, approvalRequired),
    contentType,
    hasExplicitAdsConfidence: confidence !== null,
    hasPii: containsPii(sourceText),
    hasSensitiveHealthDetail,
  }
}

function explicitConfidenceFromInsight(adsInsight: SharedAdsInsightForPage | null) {
  if (!adsInsight) return null
  const confidences = [
    ...adsInsight.findings.map((finding) => finding.confidence),
    ...adsInsight.recommendations.map((recommendation) => recommendation.confidence),
  ].filter((confidence) => Number.isFinite(confidence))

  return confidences.length ? Math.max(...confidences) : null
}

function draftSourceText(adsInsight: SharedAdsInsightForPage | null) {
  if (!adsInsight) return ''

  return [
    ...adsInsight.creativeSignals.map((signal) => signal.creative),
    ...adsInsight.recommendations.flatMap((recommendation) => [
      recommendation.action,
      recommendation.expectedImpact,
      recommendation.guardrail,
    ]),
    ...adsInsight.findings.flatMap((finding) => [finding.title, finding.summary, ...finding.evidence]),
    ...adsInsight.outcomeSignals.nextActions,
  ].join(' ')
}

function contentTypeFromDraftSource(
  adsInsight: SharedAdsInsightForPage | null,
  sourceText: string,
): AutoEligibilityContentType {
  if (!adsInsight) return 'education'

  const normalized = sourceText.toLowerCase()

  if (/\bbefore\s*[-/]?\s*after\b/.test(normalized)) return 'sensitive_before_after'
  if (/\b(guarantee|guaranteed)\b/.test(normalized)) return 'guarantee'
  if (/\b(urgent|limited time|today only|last chance)\b/.test(normalized)) return 'urgent_offer'
  if (/\b(price|cost|discount|promo|promotion|offer)\b/.test(normalized)) return 'price_mention'
  if (/\b(cure|diagnos|medical claim|treats?)\b/.test(normalized)) return 'medical_claim'

  if (adsInsight.creativeSignals.length || adsInsight.recommendations.length) {
    return 'winning_ad_angle'
  }

  return adsInsight.policy.approvalRequired ? 'soft_promotion' : 'education'
}

function assetStateFromDraftSource(
  adsInsight: SharedAdsInsightForPage | null,
  approvalRequired: boolean,
): AutoEligibilityAssetState {
  if (!adsInsight) return 'approved'
  return approvalRequired ? 'missing_optional_metadata' : 'approved'
}

function containsPii(sourceText: string) {
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d/i.test(sourceText)
}

function containsSensitiveHealthDetail(sourceText: string) {
  return /\b(patient|symptom|diagnosis|condition|treatment plan|medical history)\b/i.test(sourceText)
}

function adsConfidenceLabel(adsInsight: SharedAdsInsightForPage | null, draftPolicy: DraftPolicyContext) {
  if (!adsInsight) return 'missing'
  if (!draftPolicy.hasExplicitAdsConfidence) return 'unknown, below auto threshold'
  return `${Math.round(draftPolicy.adsAiConfidence * 100)}%`
}

function adsConfidenceTone(
  adsInsight: SharedAdsInsightForPage | null,
  draftPolicy: DraftPolicyContext,
): 'good' | 'watch' | 'critical' {
  if (!adsInsight) return 'critical'
  if (!draftPolicy.hasExplicitAdsConfidence) return 'watch'
  if (draftPolicy.adsAiConfidence < 0.7) return 'critical'
  return draftPolicy.adsAiConfidence >= 0.85 ? 'good' : 'watch'
}

function latestPermissionSync(page: ManagedPage | undefined) {
  if (!page?.permissions.length) return ''
  return page.permissions
    .map((report) => report.checkedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

function eligibilityLabel(eligibility: AutoEligibilityResult) {
  if (eligibility.state === 'auto_eligible') return 'Eligible for low-risk Auto ON'
  if (eligibility.state === 'needs_approval') return 'Needs human approval'
  return 'Blocked until fixed'
}

function draftCaptionFromInsight(adsInsight: SharedAdsInsightForPage, page?: ManagedPage) {
  const pageName = page?.name ?? adsInsight.scope.pageName ?? 'เพจ'
  const signal = adsInsight.creativeSignals[0]?.creative ?? adsInsight.recommendations[0]?.action ?? 'หัวข้อให้ความรู้'
  return `${pageName}: ${signal}\n\nโพสต์นี้เป็น draft สำหรับตรวจจากทีมก่อนใช้งานจริง โดยอิงจาก Ads AI แบบ read-only และข้อมูลเพจล่าสุด`
}

function permissionStateFor(page: ManagedPage | undefined): PermissionStateSummary {
  if (!page) {
    return { detail: 'No page permission report loaded.', tone: 'neutral' }
  }

  if (!page.permissions.length) {
    return {
      detail: 'Permission state unknown: no permission report loaded for this page.',
      tone: 'watch',
    }
  }

  const missingStates = page.permissions.flatMap((report) => missingPermissionStates(report))
  const missing = missingStates.flatMap((state) => state.missing)

  if (!missing.length) {
    return { detail: 'All required permissions reported granted', tone: 'good' }
  }

  return {
    detail: `${missing.length} missing: ${missing.slice(0, 3).join(', ')}`,
    tone: missingStates.some((state) => state.feature.includes('publishing')) ? 'critical' : 'watch',
  }
}

function formatDateTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value || '-'

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(time))
}
