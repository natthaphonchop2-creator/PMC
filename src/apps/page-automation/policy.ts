import {
  ADS_AI_AUTO_STALE_MS,
  AUTO_PUBLISH_SURFACE_REQUIRED_FEATURES,
  AUTO_SUPPORTED_V1_PUBLISH_SURFACES,
  FEATURE_PERMISSION_REQUIREMENTS,
  PAGE_SYNC_AUTO_STALE_MS,
  PERMISSION_AUTO_STALE_MS,
  PLATFORM_PERMISSION_FEATURES,
} from './constants'
import type {
  AutoEligibilityContentType,
  AutoEligibilityInput,
  AutoEligibilityResult,
  MissingPermissionState,
  PageAutomationPermissionReport,
  PostDraftChannel,
} from './types'

const NEEDS_APPROVAL_CONTENT_TYPES: AutoEligibilityContentType[] = [
  'soft_promotion',
  'winning_ad_angle',
  'price_mention',
]

const BLOCKED_CONTENT_TYPES: AutoEligibilityContentType[] = [
  'medical_claim',
  'guarantee',
  'urgent_offer',
  'sensitive_before_after',
]

export function isAdsInsightStaleForAuto({ checkedAt, now }: { checkedAt: string; now: string }) {
  return ageMs(checkedAt, now) > ADS_AI_AUTO_STALE_MS
}

export function classifyAutoEligibility(input: AutoEligibilityInput): AutoEligibilityResult {
  if (input.hasPii || input.hasSensitiveHealthDetail) {
    return { state: 'blocked', reason: 'มี PII หรือข้อมูลสุขภาพที่ยังไม่ redacted' }
  }

  if (input.assetState === 'missing_required_asset' || input.assetState === 'rejected') {
    return { state: 'blocked', reason: 'asset ไม่พร้อมสำหรับ publish' }
  }

  if (input.pageMapping === 'missing' || input.pageMapping === 'conflicting') {
    return { state: 'blocked', reason: 'page-to-ads mapping ไม่ชัดเจน' }
  }

  if (input.adsAiConfidence < 0.7) {
    return { state: 'blocked', reason: 'Ads AI confidence ต่ำกว่า 0.70' }
  }

  if (input.guardrailScore < 75) {
    return { state: 'blocked', reason: 'guardrail score ต่ำกว่า 75' }
  }

  if (BLOCKED_CONTENT_TYPES.includes(input.contentType)) {
    return { state: 'blocked', reason: 'content มี claim หรือ urgency ที่เสี่ยง' }
  }

  if (isAdsInsightStaleForAuto({ checkedAt: input.adsInsightCheckedAt, now: input.now })) {
    return { state: 'blocked', reason: 'Ads AI insight stale สำหรับ Auto ON' }
  }

  if (
    ageMs(input.pageSyncedAt, input.now) > PAGE_SYNC_AUTO_STALE_MS ||
    ageMs(input.permissionsSyncedAt, input.now) > PERMISSION_AUTO_STALE_MS
  ) {
    return { state: 'blocked', reason: 'ข้อมูลเพจหรือ permission stale สำหรับ Auto ON' }
  }

  if (!AUTO_SUPPORTED_V1_PUBLISH_SURFACES.has(input.publishSurface)) {
    return { state: 'needs_approval', reason: 'publishing surface ยังไม่รองรับ Auto ON v1' }
  }

  if (missingAutoPublishPermissions(input).length > 0) {
    return { state: 'blocked', reason: 'permission ไม่ครบสำหรับ Auto ON publishing surface' }
  }

  if (input.pageMapping === 'inferred') {
    return { state: 'needs_approval', reason: 'page-to-ads mapping เป็น inferred' }
  }

  if (input.adsAiConfidence < 0.85) {
    return { state: 'needs_approval', reason: 'Ads AI confidence ยังไม่ถึง 0.85' }
  }

  if (input.guardrailScore < 90) {
    return { state: 'needs_approval', reason: 'guardrail score ยังไม่ถึง 90' }
  }

  if (NEEDS_APPROVAL_CONTENT_TYPES.includes(input.contentType)) {
    return { state: 'needs_approval', reason: 'content เป็น promotion หรือ ad angle ที่ต้องตรวจ' }
  }

  if (input.assetState === 'missing_optional_metadata') {
    return { state: 'needs_approval', reason: 'asset metadata ยังไม่ครบ' }
  }

  return { state: 'auto_eligible', reason: 'ผ่านทุก guardrail สำหรับ Auto ON' }
}

export function missingPermissionStates(report: PageAutomationPermissionReport): MissingPermissionState[] {
  const granted = new Set(report.granted)
  const features = PLATFORM_PERMISSION_FEATURES[report.platform]

  return features
    .map((feature) => ({
      feature,
      missing: FEATURE_PERMISSION_REQUIREMENTS[feature].filter((permission) => !granted.has(permission)),
    }))
    .filter((item) => item.missing.length > 0) as MissingPermissionState[]
}

function missingAutoPublishPermissions(input: AutoEligibilityInput) {
  const requiredFeature = AUTO_PUBLISH_SURFACE_REQUIRED_FEATURES[input.publishSurface]

  if (!requiredFeature) {
    return []
  }

  const requiredPlatform = platformForPublishSurface(input.publishSurface)
  const granted = new Set(
    input.permissionReports
      .filter((report) => report.pageId === input.pageId && report.platform === requiredPlatform)
      .flatMap((report) => report.granted),
  )

  return FEATURE_PERMISSION_REQUIREMENTS[requiredFeature].filter((permission) => !granted.has(permission))
}

function platformForPublishSurface(publishSurface: PostDraftChannel) {
  if (publishSurface.startsWith('facebook_')) {
    return 'facebook'
  }

  return 'instagram'
}

function ageMs(checkedAt: string, now: string) {
  const checkedAtTime = Date.parse(checkedAt)
  const nowTime = Date.parse(now)

  if (!Number.isFinite(checkedAtTime) || !Number.isFinite(nowTime)) {
    return Number.POSITIVE_INFINITY
  }

  return Math.max(0, nowTime - checkedAtTime)
}
