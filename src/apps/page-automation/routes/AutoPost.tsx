import { CheckCircle2, CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { cancelScheduledPostDraft, createPostDraft, schedulePostDraft } from '../api'
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
  PostDraft,
  PostDraftStatus,
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
  drafts: PostDraft[]
  messages: PageMessage[]
  onDraftsChanged: () => Promise<void> | void
  pages: ManagedPage[]
  summary: Summary
}

type PipelineItem = {
  detail: string
  id: string
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

export function AutoPost({ adsInsight, autoMode, drafts, messages, onDraftsChanged, pages, summary }: AutoPostProps) {
  const [draftIntentState, setDraftIntentState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draftIntentMessage, setDraftIntentMessage] = useState('')
  const [scheduleIntentState, setScheduleIntentState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [scheduleIntentMessage, setScheduleIntentMessage] = useState('')
  const [cancelIntentState, setCancelIntentState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [cancelIntentMessage, setCancelIntentMessage] = useState('')
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
  const pipelineColumns = buildPipelineColumns({ adsInsight, drafts, eligibility, messages, selectedPage })
  const readyDraft = drafts.find((draft) => draft.status === 'ready')
  const scheduledDraft = drafts.find((draft) => draft.status === 'scheduled')
  const canMarkEligible =
    autoMode === 'on' &&
    eligibility.state === 'auto_eligible' &&
    draftPolicy.approvalState === 'cleared'
  const draftCaption = adsInsight
    ? draftCaptionFromInsight(adsInsight, selectedPage)
    : 'รอ Ads AI insight และข้อมูลเพจก่อนสร้าง draft ที่พร้อมตรวจ'

  async function handleCreateDraft(status: Extract<PostDraftStatus, 'draft' | 'needs_review' | 'ready'>) {
    if (!selectedPage) return

    setDraftIntentState('saving')
    setDraftIntentMessage('')

    try {
      await createPostDraft(buildPostDraft({
        adsInsight,
        adsAiConfidence,
        autoEligible: canMarkEligible,
        caption: draftCaption,
        guardrailScore,
        page: selectedPage,
        status,
      }))
      await onDraftsChanged()
      setDraftIntentState('saved')
      setDraftIntentMessage(status === 'draft' ? 'บันทึกแบบร่างแล้ว ทีมสามารถกลับมาตรวจต่อได้' : 'ส่งรายการเข้าคิวให้ทีมอนุมัติแล้ว')
    } catch (error) {
      setDraftIntentState('error')
      setDraftIntentMessage(error instanceof Error ? error.message : 'บันทึกร่างโพสต์ไม่สำเร็จ')
    }
  }

  async function handleScheduleReadyDraft() {
    if (!readyDraft) return

    setScheduleIntentState('saving')
    setScheduleIntentMessage('')

    try {
      const result = await schedulePostDraft(readyDraft.id, defaultScheduleTime())
      await onDraftsChanged()
      setScheduleIntentState('saved')
      setScheduleIntentMessage(`ตั้งเวลา ${result.draft.title} ไว้ที่ ${formatDateTime(result.draft.scheduledAt ?? '')}`)
    } catch (error) {
      setScheduleIntentState('error')
      setScheduleIntentMessage(error instanceof Error ? error.message : 'ตั้งเวลาโพสต์ไม่สำเร็จ')
    }
  }

  async function handleCancelScheduledDraft() {
    if (!scheduledDraft) return

    setCancelIntentState('saving')
    setCancelIntentMessage('')

    try {
      await cancelScheduledPostDraft(scheduledDraft.id)
      await onDraftsChanged()
      setCancelIntentState('saved')
      setCancelIntentMessage('ยกเลิกเวลาที่ตั้งไว้แล้ว รายการกลับไปรอพร้อมตั้งเวลา')
    } catch (error) {
      setCancelIntentState('error')
      setCancelIntentMessage(error instanceof Error ? error.message : 'ยกเลิกเวลาที่ตั้งไว้ไม่สำเร็จ')
    }
  }

  return (
    <div className="pa-grid">
      <PageAutomationPanel
        className="pa-span-8"
        subtitle="ติดตามแบบร่าง รายการรออนุมัติ รายการตั้งเวลา และผลลัพธ์หลังเผยแพร่"
        title="โพสต์ที่กำลังเตรียม"
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
                    <article className={`pa-pipeline-card ${item.tone}`} key={`${column.title}-${item.id}`}>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <footer>{item.meta}</footer>
                    </article>
                  ))
                ) : (
                  <div className="pa-pipeline-empty">ยังไม่มีรายการ</div>
                )}
              </div>
            </section>
          ))}
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel
        className="pa-span-4"
        subtitle="Auto เปิดได้เฉพาะโพสต์ความเสี่ยงต่ำ รายการไม่ชัดเจนต้องให้ทีมอนุมัติ"
        title="กติกาก่อนโพสต์"
      >
        <div className="pa-guardrail-card">
          {eligibility.state === 'auto_eligible' ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
          <div>
            <strong>{eligibilityLabel(eligibility)}</strong>
            <p>{eligibility.reason}</p>
          </div>
        </div>

        <div className="pa-guardrail-list">
          <GuardrailRow label="สถานะ Auto" value={autoMode === 'on' ? 'เปิดเฉพาะความเสี่ยงต่ำ' : 'ปิด แนะนำเท่านั้น'} tone={autoMode === 'on' ? 'watch' : 'neutral'} />
          <GuardrailRow label="ช่องทางโพสต์" value="Facebook feed" tone="good" />
          <GuardrailRow label="ความมั่นใจจาก Ads" value={adsConfidenceLabel(adsInsight, draftPolicy)} tone={adsConfidenceTone(adsInsight, draftPolicy)} />
          <GuardrailRow label="คะแนนความปลอดภัย" value={`${guardrailScore}/100`} tone={guardrailScore >= 90 ? 'good' : 'watch'} />
          <GuardrailRow label="ข้อความรอตอบ" value={`${summary.unread} รายการ`} tone={summary.unread > 0 ? 'watch' : 'good'} />
        </div>

        <PageAutomationState
          detail="ระบบช่วยเตรียมโพสต์ได้ แต่รายการที่มีความเสี่ยงหรือข้อมูลไม่ครบต้องให้ทีมตรวจ"
          tone="neutral"
          title="ไม่มีการเผยแพร่รายการเสี่ยงเอง"
        />
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-7" subtitle="ทีมตรวจและแก้ข้อความก่อนส่งเข้าคิวอนุมัติหรือตั้งเวลา" title="ร่างโพสต์">
        <div className="pa-form-grid">
          <label className="pa-field">
            <span>เพจ</span>
            <input readOnly value={selectedPage ? `${selectedPage.name} (${selectedPage.handle})` : 'ยังไม่ได้เชื่อมต่อเพจ'} />
          </label>
          <label className="pa-field">
            <span>เป้าหมาย</span>
            <input readOnly value={adsInsight ? 'โพสต์ให้ความรู้จากข้อมูล Ads และเพจล่าสุด' : 'โพสต์ให้ความรู้สำหรับเพจ'} />
          </label>
          <label className="pa-field wide">
            <span>ข้อความร่าง</span>
            <textarea
              readOnly
              rows={5}
              value={draftCaption}
            />
          </label>
          <label className="pa-field">
            <span>CTA</span>
            <input readOnly value="ทักแชทเพื่อปรึกษา" />
          </label>
          <label className="pa-field">
            <span>ปลายทาง</span>
            <input readOnly value={selectedPage ? selectedPage.handle : 'เลือกเพจก่อน'} />
          </label>
        </div>

        <div className="pa-action-row">
          <button className="pa-button" disabled={!selectedPage || draftIntentState === 'saving'} onClick={() => void handleCreateDraft('draft')} type="button">
            บันทึกแบบร่าง
          </button>
          <button
            className="pa-button primary"
            disabled={eligibility.state === 'blocked' || !selectedPage || draftIntentState === 'saving'}
            onClick={() => void handleCreateDraft('needs_review')}
            type="button"
          >
            ส่งให้ทีมอนุมัติ
          </button>
          <button className="pa-button" disabled={!canMarkEligible || draftIntentState === 'saving'} onClick={() => void handleCreateDraft('ready')} type="button">
            ทำเครื่องหมายว่าพร้อมตั้งเวลา
          </button>
          <button className="pa-button" disabled={!readyDraft || scheduleIntentState === 'saving'} onClick={() => void handleScheduleReadyDraft()} type="button">
            ตั้งเวลาโพสต์ที่พร้อมแล้ว
          </button>
          <button
            className="pa-button"
            disabled={!scheduledDraft || draftIntentState === 'saving' || scheduleIntentState === 'saving' || cancelIntentState === 'saving'}
            onClick={() => void handleCancelScheduledDraft()}
            type="button"
          >
            ยกเลิกเวลาที่ตั้งไว้
          </button>
        </div>

        {draftIntentMessage ? (
          <PageAutomationState
            detail={draftIntentMessage}
            tone={draftIntentState === 'error' ? 'critical' : 'good'}
            title={draftIntentState === 'error' ? 'บันทึกร่างไม่สำเร็จ' : 'บันทึกร่างแล้ว'}
          />
        ) : null}

        {scheduleIntentMessage ? (
          <PageAutomationState
            detail={scheduleIntentMessage}
            tone={scheduleIntentState === 'error' ? 'critical' : 'good'}
            title={scheduleIntentState === 'error' ? 'ตั้งเวลาไม่สำเร็จ' : 'ตั้งเวลาแล้ว'}
          />
        ) : null}

        {cancelIntentMessage ? (
          <PageAutomationState
            detail={cancelIntentMessage}
            tone={cancelIntentState === 'error' ? 'critical' : 'good'}
            title={cancelIntentState === 'error' ? 'ยกเลิกเวลาไม่สำเร็จ' : 'ยกเลิกเวลาแล้ว'}
          />
        ) : null}
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-5" subtitle="ตรวจความสดของข้อมูล สิทธิ์เพจ และบริบทจาก Ads ก่อนสร้างโพสต์" title="ข้อมูลประกอบการตัดสินใจ">
        <div className="pa-list">
          <PageAutomationState
            detail={adsInsight ? `ตรวจล่าสุด ${formatDateTime(adsInsight.source.checkedAt)}` : 'ยังไม่มีข้อมูล Ads สำหรับเพจนี้'}
            tone={adsInsight ? 'good' : 'critical'}
            title="ข้อมูล Ads"
          />
          <PageAutomationState
            detail={selectedPage ? `อัปเดตล่าสุด ${formatDateTime(selectedPage.lastSyncedAt)}` : 'ยังไม่มีข้อมูลเพจ'}
            tone={selectedPage ? 'good' : 'watch'}
            title="ข้อมูลเพจ"
          />
          <PageAutomationState
            detail={permissionState.detail}
            tone={permissionState.tone}
            title="สิทธิ์ของเพจ"
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

function buildPostDraft({
  adsAiConfidence,
  adsInsight,
  autoEligible,
  caption,
  guardrailScore,
  page,
  status,
}: {
  adsAiConfidence: number
  adsInsight: SharedAdsInsightForPage | null
  autoEligible: boolean
  caption: string
  guardrailScore: number
  page: ManagedPage
  status: Extract<PostDraftStatus, 'draft' | 'needs_review' | 'ready'>
}): PostDraft {
  const now = new Date().toISOString()

  return {
    id: `page-auto-${page.id}-${Date.now()}`,
    pageId: page.id,
    pageName: page.name,
    channel: publishSurface,
    title: adsInsight ? 'โพสต์ให้ความรู้จากข้อมูล Ads และเพจ' : 'โพสต์ให้ความรู้จากข้อมูลเพจ',
    objective: adsInsight ? 'ให้ความรู้จากข้อมูล Ads และเพจ' : 'ให้ความรู้และชวนทักแชท',
    captionTh: caption,
    cta: 'ทักแชทเพื่อปรึกษา',
    destination: page.handle,
    status,
    autoEligible,
    guardrailScore,
    aiConfidence: adsAiConfidence,
    adsInsightId: adsInsight?.source.taskId,
    createdAt: now,
    updatedAt: now,
  }
}

function buildPipelineColumns({
  adsInsight,
  drafts,
  eligibility,
  messages,
  selectedPage,
}: {
  adsInsight: SharedAdsInsightForPage | null
  drafts: PostDraft[]
  eligibility: AutoEligibilityResult
  messages: PageMessage[]
  selectedPage?: ManagedPage
}) {
  const baseDraft: PipelineItem = {
    detail: selectedPage ? `โพสต์ให้ความรู้สำหรับ ${selectedPage.name} จากสุขภาพเพจและสัญญาณ Ads` : 'รอข้อมูลเพจที่เชื่อมต่อ',
    id: 'suggested-service-education',
    meta: adsInsight ? `ROAS ${adsInsight.metrics.roas.toFixed(2)}x` : 'ยังไม่มีบริบท Ads',
    title: 'ร่างโพสต์ให้ความรู้บริการ',
    tone: selectedPage ? 'neutral' : 'watch',
  }
  const inboxDraft: PipelineItem = {
    detail: `มีข้อความยังไม่ได้อ่าน ${messages.filter((message) => message.unread).length} รายการ คำตอบยังต้องให้ทีมตรวจ`,
    id: 'suggested-inbox-faq',
    meta: 'คำตอบจาก AI เป็นร่างเท่านั้น',
    title: 'แนวทางตอบคำถามจากแชท',
    tone: messages.some((message) => message.priority === 'high') ? 'watch' : 'neutral',
  }
  const eligibilityItem: PipelineItem = {
    detail: eligibility.reason,
    id: 'policy-facebook-feed-candidate',
    meta: eligibilityStateLabel(eligibility.state),
    title: 'โพสต์สำหรับ Facebook feed',
    tone: eligibility.state === 'auto_eligible' ? 'good' : eligibility.state === 'needs_approval' ? 'watch' : 'critical',
  }
  const draftColumnItems = [baseDraft, inboxDraft, ...pipelineItemsFromDraftStatus(drafts, ['draft'])]
  const readyItems = [
    ...pipelineItemsFromDraftStatus(drafts, ['ready']),
    ...(eligibility.state === 'auto_eligible' ? [eligibilityItem] : []),
  ]
  const reviewItems = [
    ...pipelineItemsFromDraftStatus(drafts, ['needs_review']),
    ...(eligibility.state === 'needs_approval' ? [eligibilityItem] : []),
  ]
  const failedItems = [
    ...pipelineItemsFromDraftStatus(drafts, ['failed', 'blocked']),
    ...(eligibility.state === 'blocked' ? [eligibilityItem] : []),
  ]

  return [
    { items: draftColumnItems, title: 'แบบร่าง' },
    { items: readyItems, title: 'พร้อมตั้งเวลา' },
    { items: reviewItems, title: 'รออนุมัติ' },
    { items: pipelineItemsFromDraftStatus(drafts, ['scheduled']), title: 'ตั้งเวลาแล้ว' },
    { items: pipelineItemsFromDraftStatus(drafts, ['posted']), title: 'เผยแพร่แล้ว' },
    { items: failedItems, title: 'ต้องแก้ไข' },
  ]
}

function pipelineItemsFromDraftStatus(drafts: PostDraft[], statuses: PostDraftStatus[]) {
  return drafts.filter((draft) => statuses.includes(draft.status)).map(pipelineItemFromDraft)
}

function pipelineItemFromDraft(draft: PostDraft): PipelineItem {
  return {
    detail: userFacingDraftText(draft.captionTh || draft.objective || draft.channel),
    id: draft.id,
    meta: draftStatusLabel(draft.status),
    title: userFacingDraftText(draft.title),
    tone: pipelineToneForDraft(draft),
  }
}

function pipelineToneForDraft(draft: PostDraft): PipelineItem['tone'] {
  if (draft.status === 'ready' || draft.status === 'posted') return 'good'
  if (draft.status === 'needs_review' || draft.status === 'scheduled') return 'watch'
  if (draft.status === 'failed' || draft.status === 'blocked') return 'critical'
  return 'neutral'
}

function defaultScheduleTime() {
  const scheduledAt = new Date()
  scheduledAt.setHours(scheduledAt.getHours() + 1, 0, 0, 0)
  return scheduledAt.toISOString()
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
  if (!adsInsight) return 'ยังไม่มีข้อมูล'
  if (!draftPolicy.hasExplicitAdsConfidence) return 'ยังไม่พอสำหรับ Auto'
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
  if (eligibility.state === 'auto_eligible') return 'พร้อมสำหรับ Auto ความเสี่ยงต่ำ'
  if (eligibility.state === 'needs_approval') return 'ต้องให้ทีมอนุมัติก่อน'
  return 'ต้องแก้ไขก่อนใช้งาน'
}

function draftCaptionFromInsight(adsInsight: SharedAdsInsightForPage, page?: ManagedPage) {
  const pageName = page?.name ?? adsInsight.scope.pageName ?? 'เพจ'
  const signal = adsInsight.creativeSignals[0]?.creative ?? adsInsight.recommendations[0]?.action ?? 'หัวข้อให้ความรู้'
  return `${pageName}: ${signal}\n\nโพสต์นี้เป็นแบบร่างสำหรับให้ทีมตรวจก่อนใช้งานจริง โดยอิงจากข้อมูล Ads และข้อมูลเพจล่าสุด`
}

function permissionStateFor(page: ManagedPage | undefined): PermissionStateSummary {
  if (!page) {
    return { detail: 'ยังไม่มีรายงานสิทธิ์ของเพจ', tone: 'neutral' }
  }

  if (!page.permissions.length) {
    return {
      detail: 'ยังตรวจสิทธิ์ของเพจไม่ได้ เพราะไม่มีรายงานสิทธิ์สำหรับเพจนี้',
      tone: 'watch',
    }
  }

  const missingStates = page.permissions.flatMap((report) => missingPermissionStates(report))
  const missing = missingStates.flatMap((state) => state.missing)

  if (!missing.length) {
    return { detail: 'สิทธิ์ที่จำเป็นพร้อมใช้งาน', tone: 'good' }
  }

  return {
    detail: `ยังขาดสิทธิ์ ${missing.length} รายการ: ${missing.slice(0, 3).join(', ')}`,
    tone: missingStates.some((state) => state.feature.includes('publishing')) ? 'critical' : 'watch',
  }
}

function draftStatusLabel(status: PostDraftStatus) {
  if (status === 'draft') return 'แบบร่าง'
  if (status === 'ready') return 'พร้อมตั้งเวลา'
  if (status === 'needs_review') return 'รออนุมัติ'
  if (status === 'scheduled') return 'ตั้งเวลาแล้ว'
  if (status === 'posted') return 'เผยแพร่แล้ว'
  if (status === 'failed') return 'ไม่สำเร็จ'
  return 'ถูกบล็อก'
}

function eligibilityStateLabel(state: AutoEligibilityResult['state']) {
  if (state === 'auto_eligible') return 'พร้อม Auto'
  if (state === 'needs_approval') return 'รออนุมัติ'
  return 'ต้องแก้ไข'
}

function userFacingDraftText(value: string) {
  if (value === 'Educational post from current Ads + Page signal') return 'โพสต์ให้ความรู้จากข้อมูล Ads และเพจ'
  if (value === 'Ads-informed page education') return 'ให้ความรู้จากข้อมูล Ads และเพจ'
  if (value === 'Page education draft') return 'โพสต์ให้ความรู้จากข้อมูลเพจ'
  if (value === 'Page education') return 'ให้ความรู้และชวนทักแชท'
  if (value === 'Inbox for consultation') return 'ทักแชทเพื่อปรึกษา'
  if (value === 'facebook_feed') return 'โพสต์บน Facebook feed'
  return value
}

function formatDateTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value || '-'

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(time))
}
