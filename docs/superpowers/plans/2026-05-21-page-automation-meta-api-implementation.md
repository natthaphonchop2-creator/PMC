# Page Automation Meta API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate Meta API-backed Page Automation app for Auto Post, Page Analysis, Messages, and Analytics that consumes Ads AI insights through a read-only bridge.

**Architecture:** Keep PMC Ads Agent at `/` and move Page Automation into `src/apps/page-automation`. Add `server/pageAutomationPlugin.ts` with its own `/api/page-automation/*` namespace, file-backed persistence under `knowledge-base/runtime/page-automation/`, a Meta permission/status layer, polling inbox endpoints, and a normalized Ads AI bridge. Frontend screens call only Page Automation endpoints and enforce `Auto OFF`/`Auto ON` policy from shared pure helpers.

**Tech Stack:** React 19, TypeScript, Vite, lucide-react, Recharts already in repo, Node HTTP middleware, Meta Graph/Marketing API via server-side `fetch`, JSON/JSONL file persistence, Vitest for pure policy/store tests.

---

## Spec Source

Implement against:

```txt
docs/superpowers/specs/2026-05-21-page-automation-meta-api-design.md
```

The approved visual reference is:

```txt
/Users/natthaphon/.codex/generated_images/019e473c-4edf-72f2-b19d-d3ad37116407/ig_05c0f289c81203fa016a0e252c59d88191aebcdfe171485f27.png
```

## File Map

Create:

```txt
src/apps/page-automation/PageAutomationApp.tsx
src/apps/page-automation/api.ts
src/apps/page-automation/components.tsx
src/apps/page-automation/constants.ts
src/apps/page-automation/policy.ts
src/apps/page-automation/routes/AnalyticsDashboard.tsx
src/apps/page-automation/routes/AutoPost.tsx
src/apps/page-automation/routes/Messages.tsx
src/apps/page-automation/routes/PageAnalysis.tsx
src/apps/page-automation/styles.css
src/apps/page-automation/types.ts
tests/page-automation/policy.test.ts
server/pageAutomationAdsBridge.ts
server/pageAutomationMetaApi.ts
server/pageAutomationPlugin.ts
server/pageAutomationStore.ts
server/pageAutomationTypes.ts
tests/page-automation/pageAutomationStore.test.ts
```

Modify:

```txt
package.json
src/App.tsx
vite.config.ts
server/productionServer.ts
```

Optional modify only if needed for strict type reuse:

```txt
server/metaApiPlugin.ts
server/openAiPlugin.ts
```

Do not modify unrelated files. Do not move PMC Ads Agent code in this plan except removing the existing inline Page Automation prototype from `src/App.tsx`.

## Task 1: Add Test Harness And Policy Tests

**Files:**
- Modify: `package.json`
- Create: `tests/page-automation/policy.test.ts`

- [ ] **Step 1: Add Vitest**

Run:

```bash
npm install -D vitest
```

Expected: `package.json` and `package-lock.json` gain `vitest`.

- [ ] **Step 2: Add a test script**

Edit `package.json` scripts to include:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Write failing policy tests**

Create `tests/page-automation/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyAutoEligibility, isAdsInsightStaleForAuto, missingPermissionStates } from '../../src/apps/page-automation/policy'
import type { AutoEligibilityInput, PageAutomationPermissionReport, SharedAdsInsightForPage } from '../../src/apps/page-automation/types'

const freshInsight: SharedAdsInsightForPage = {
  source: { datePreset: 'last_7d', checkedAt: new Date('2026-05-21T03:00:00.000Z').toISOString(), taskId: 'brain-1' },
  scope: { pageId: 'page-1', pageName: 'Fifth Clinic', campaignIds: ['cmp-1'], adSetIds: ['set-1'], adIds: ['ad-1'] },
  metrics: { spend: 12000, revenue: 54000, roas: 4.5, cpa: 320, ctr: 1.8, leads: 42, bookings: 11 },
  findings: [],
  recommendations: [],
  creativeSignals: [],
  outcomeSignals: { alerts: [], learnings: [], nextActions: [] },
  policy: { readOnly: true, noMetaWrites: true, noInventedMetrics: true, approvalRequired: true },
}

const baseInput: AutoEligibilityInput = {
  adsAiConfidence: 0.9,
  guardrailScore: 95,
  pageMapping: 'explicit',
  contentType: 'education',
  hasPii: false,
  hasSensitiveHealthDetail: false,
  assetState: 'approved',
  adsInsightCheckedAt: freshInsight.source.checkedAt,
  pageSyncedAt: new Date('2026-05-21T03:30:00.000Z').toISOString(),
  permissionsSyncedAt: new Date('2026-05-21T03:50:00.000Z').toISOString(),
  now: new Date('2026-05-21T04:00:00.000Z').toISOString(),
}

describe('Page Automation policy', () => {
  it('allows low-risk explicit mapped content when Auto is on', () => {
    expect(classifyAutoEligibility(baseInput)).toEqual({
      state: 'auto_eligible',
      reason: 'ผ่านทุก guardrail สำหรับ Auto ON',
    })
  })

  it('moves inferred page mapping to approval instead of auto publishing', () => {
    expect(classifyAutoEligibility({ ...baseInput, pageMapping: 'inferred' })).toEqual({
      state: 'needs_approval',
      reason: 'page-to-ads mapping เป็น inferred',
    })
  })

  it('blocks unredacted sensitive customer data', () => {
    expect(classifyAutoEligibility({ ...baseInput, hasPii: true })).toEqual({
      state: 'blocked',
      reason: 'มี PII หรือข้อมูลสุขภาพที่ยังไม่ redacted',
    })
  })

  it('treats Ads AI insight older than 6 hours as stale for Auto decisions', () => {
    expect(
      isAdsInsightStaleForAuto({
        checkedAt: '2026-05-20T21:59:00.000Z',
        now: '2026-05-21T04:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('reports missing permissions by feature', () => {
    const report: PageAutomationPermissionReport = {
      pageId: 'page-1',
      platform: 'facebook',
      granted: ['pages_show_list', 'pages_read_engagement'],
      missing: ['pages_manage_posts', 'pages_messaging'],
      checkedAt: '2026-05-21T04:00:00.000Z',
    }
    expect(missingPermissionStates(report)).toEqual([
      { feature: 'facebook_publishing', missing: ['pages_manage_posts'] },
      { feature: 'facebook_messages', missing: ['pages_messaging'] },
    ])
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
npm run test -- tests/page-automation/policy.test.ts
```

Expected: FAIL because `../policy` and `../types` do not exist yet.

- [ ] **Step 5: Commit test harness**

```bash
git add package.json package-lock.json tests/page-automation/policy.test.ts
git commit -m "test: add page automation policy tests"
```

## Task 2: Implement Shared Page Automation Types And Policy

**Files:**
- Create: `src/apps/page-automation/types.ts`
- Create: `src/apps/page-automation/policy.ts`
- Create: `src/apps/page-automation/constants.ts`
- Test: `tests/page-automation/policy.test.ts`

- [ ] **Step 1: Create shared types**

Create `src/apps/page-automation/types.ts`:

```ts
export type RiskLevel = 'Low' | 'Medium' | 'High'
export type PageAutomationPlatform = 'facebook' | 'instagram'
export type PageAutomationRouteId = 'dashboard' | 'auto-post' | 'pages' | 'messages' | 'analytics'
export type AutoMode = 'off' | 'on'
export type AutoEligibilityState = 'auto_eligible' | 'needs_approval' | 'blocked'
export type PageMappingState = 'explicit' | 'inferred' | 'missing' | 'conflicting'
export type PageAutomationFeature =
  | 'page_selection'
  | 'page_insights'
  | 'content_leaderboard'
  | 'facebook_publishing'
  | 'facebook_messages'
  | 'instagram_profile'
  | 'instagram_analytics'
  | 'instagram_publishing'
  | 'instagram_comments'
  | 'instagram_messages'
  | 'ads_ai_bridge'

export type PageAutomationPermission =
  | 'pages_show_list'
  | 'pages_read_engagement'
  | 'pages_read_user_content'
  | 'pages_manage_posts'
  | 'pages_manage_metadata'
  | 'pages_manage_engagement'
  | 'pages_messaging'
  | 'instagram_basic'
  | 'instagram_manage_insights'
  | 'instagram_content_publish'
  | 'instagram_manage_comments'
  | 'instagram_manage_messages'
  | 'ads_read'
  | 'business_management'
  | 'leads_retrieval'

export type PageAutomationPermissionReport = {
  pageId: string
  platform: PageAutomationPlatform
  granted: PageAutomationPermission[]
  missing: PageAutomationPermission[]
  checkedAt: string
}

export type ManagedPage = {
  id: string
  name: string
  handle: string
  platform: PageAutomationPlatform
  avatarUrl?: string
  followers: number
  followerDelta: number
  reach: number
  engagementRate: number
  unreadCount: number
  responseRate: number
  avgFirstResponseMins: number
  healthScore: number
  permissions: PageAutomationPermissionReport[]
  lastSyncedAt: string
}

export type PostDraftStatus = 'draft' | 'ready' | 'scheduled' | 'posted' | 'needs_review' | 'failed' | 'blocked'
export type PostDraftChannel = 'facebook_feed' | 'facebook_video' | 'instagram_feed' | 'instagram_reels' | 'story_preview' | 'ad_reference'

export type PostDraft = {
  id: string
  pageId: string
  pageName: string
  channel: PostDraftChannel
  title: string
  objective: string
  captionTh: string
  cta: string
  destination: string
  scheduledAt?: string
  status: PostDraftStatus
  autoEligible: boolean
  guardrailScore: number
  aiConfidence: number
  adsInsightId?: string
  platformPostId?: string
  publishError?: string
  createdAt: string
  updatedAt: string
}

export type PageMessageStatus = 'new' | 'open' | 'waiting_customer' | 'booked' | 'resolved' | 'spam' | 'escalated'
export type PageMessagePriority = 'high' | 'medium' | 'low'

export type PageMessage = {
  conversationId: string
  messageId: string
  pageId: string
  channel: 'facebook_message' | 'instagram_dm' | 'comment' | 'ad_comment' | 'mention' | 'review'
  customerDisplayName: string
  textExcerpt: string
  receivedAt: string
  unread: boolean
  priority: PageMessagePriority
  status: PageMessageStatus
  sentiment: 'positive' | 'neutral' | 'negative'
  intent: 'booking' | 'price' | 'review_request' | 'complaint' | 'general'
  slaDueAt: string
  privacyFlags: string[]
  aiSummary?: string
}

export type SharedAdsInsightForPage = {
  source: { workspaceId?: string; datePreset: string; checkedAt: string; taskId?: string }
  scope: { pageId?: string; pageName?: string; campaignIds: string[]; adSetIds: string[]; adIds: string[] }
  metrics: { spend: number; revenue: number; roas: number; cpa: number; ctr: number; leads?: number; bookings?: number }
  findings: Array<{ title: string; summary: string; evidence: string[]; risk: RiskLevel; confidence: number }>
  recommendations: Array<{ id: string; action: string; expectedImpact: string; guardrail: string; requiresApproval: true; risk: RiskLevel; confidence: number }>
  creativeSignals: Array<{ adId: string; campaignId: string; creative: string; score: number; ctr: number; roas: number; bookings: number }>
  outcomeSignals: { alerts: unknown[]; learnings: unknown[]; nextActions: string[] }
  policy: { readOnly: true; noMetaWrites: true; noInventedMetrics: true; approvalRequired: true }
}

export type AutoEligibilityInput = {
  adsAiConfidence: number
  guardrailScore: number
  pageMapping: PageMappingState
  contentType: 'education' | 'faq' | 'service_reminder' | 'awareness' | 'engagement' | 'soft_promotion' | 'winning_ad_angle' | 'price_mention' | 'medical_claim' | 'guarantee' | 'urgent_offer' | 'sensitive_before_after'
  hasPii: boolean
  hasSensitiveHealthDetail: boolean
  assetState: 'approved' | 'missing_optional_metadata' | 'missing_required_asset' | 'rejected'
  adsInsightCheckedAt: string
  pageSyncedAt: string
  permissionsSyncedAt: string
  now: string
}
```

- [ ] **Step 2: Create route and permission constants**

Create `src/apps/page-automation/constants.ts`:

```ts
import type { PageAutomationFeature, PageAutomationPermission, PageAutomationRouteId } from './types'

export const PAGE_AUTOMATION_ROUTES: Array<{ id: PageAutomationRouteId; href: string; label: string }> = [
  { id: 'dashboard', href: '/page-automation', label: 'Dashboard' },
  { id: 'auto-post', href: '/page-automation/auto-post', label: 'Ads Auto Post' },
  { id: 'pages', href: '/page-automation/pages', label: 'วิเคราะห์เพจ' },
  { id: 'messages', href: '/page-automation/messages', label: 'กล่องข้อความรวม' },
  { id: 'analytics', href: '/page-automation/analytics', label: 'Analytics' },
]

export const FEATURE_PERMISSION_REQUIREMENTS: Record<PageAutomationFeature, PageAutomationPermission[]> = {
  page_selection: ['pages_show_list'],
  page_insights: ['pages_read_engagement'],
  content_leaderboard: ['pages_read_user_content'],
  facebook_publishing: ['pages_manage_posts'],
  facebook_messages: ['pages_messaging'],
  instagram_profile: ['instagram_basic'],
  instagram_analytics: ['instagram_manage_insights'],
  instagram_publishing: ['instagram_content_publish'],
  instagram_comments: ['instagram_manage_comments'],
  instagram_messages: ['instagram_manage_messages'],
  ads_ai_bridge: ['ads_read'],
}

export const ADS_AI_AUTO_STALE_MS = 6 * 60 * 60 * 1000
export const ADS_AI_DASHBOARD_STALE_MS = 24 * 60 * 60 * 1000
export const PAGE_SYNC_AUTO_STALE_MS = 60 * 60 * 1000
export const PERMISSION_AUTO_STALE_MS = 15 * 60 * 1000
```

- [ ] **Step 3: Implement policy helpers**

Create `src/apps/page-automation/policy.ts`:

```ts
import { ADS_AI_AUTO_STALE_MS, FEATURE_PERMISSION_REQUIREMENTS, PAGE_SYNC_AUTO_STALE_MS, PERMISSION_AUTO_STALE_MS } from './constants'
import type { AutoEligibilityInput, PageAutomationFeature, PageAutomationPermissionReport } from './types'

export function isAdsInsightStaleForAuto({ checkedAt, now }: { checkedAt: string; now: string }) {
  return ageMs(checkedAt, now) > ADS_AI_AUTO_STALE_MS
}

export function classifyAutoEligibility(input: AutoEligibilityInput): { state: 'auto_eligible' | 'needs_approval' | 'blocked'; reason: string } {
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
  if (isAdsInsightStaleForAuto({ checkedAt: input.adsInsightCheckedAt, now: input.now })) {
    return { state: 'blocked', reason: 'Ads AI insight stale สำหรับ Auto ON' }
  }
  if (ageMs(input.pageSyncedAt, input.now) > PAGE_SYNC_AUTO_STALE_MS || ageMs(input.permissionsSyncedAt, input.now) > PERMISSION_AUTO_STALE_MS) {
    return { state: 'blocked', reason: 'ข้อมูลเพจหรือ permission stale สำหรับ Auto ON' }
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
  if (['soft_promotion', 'winning_ad_angle', 'price_mention'].includes(input.contentType)) {
    return { state: 'needs_approval', reason: 'content เป็น promotion หรือ ad angle ที่ต้องตรวจ' }
  }
  if (['medical_claim', 'guarantee', 'urgent_offer', 'sensitive_before_after'].includes(input.contentType)) {
    return { state: 'blocked', reason: 'content มี claim หรือ urgency ที่เสี่ยง' }
  }
  if (input.assetState === 'missing_optional_metadata') {
    return { state: 'needs_approval', reason: 'asset metadata ยังไม่ครบ' }
  }
  return { state: 'auto_eligible', reason: 'ผ่านทุก guardrail สำหรับ Auto ON' }
}

export function missingPermissionStates(report: PageAutomationPermissionReport) {
  const granted = new Set(report.granted)
  return Object.entries(FEATURE_PERMISSION_REQUIREMENTS)
    .map(([feature, permissions]) => ({
      feature: feature as PageAutomationFeature,
      missing: permissions.filter((permission) => !granted.has(permission)),
    }))
    .filter((item) => item.missing.length > 0)
}

function ageMs(checkedAt: string, now: string) {
  return Math.max(0, Date.parse(now) - Date.parse(checkedAt))
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test -- tests/page-automation/policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run type build**

Run:

```bash
npm run build:client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/apps/page-automation/types.ts src/apps/page-automation/policy.ts src/apps/page-automation/constants.ts
git commit -m "feat: add page automation policy model"
```

## Task 3: Add Persistent Page Automation Store

**Files:**
- Create: `server/pageAutomationTypes.ts`
- Create: `server/pageAutomationStore.ts`
- Create: `tests/page-automation/pageAutomationStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `tests/page-automation/pageAutomationStore.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendJsonlRecord, createPageAutomationStore, readJsonSnapshot, writeJsonSnapshot } from '../../server/pageAutomationStore'

let tempRoot = ''

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { force: true, recursive: true })
  tempRoot = ''
})

describe('pageAutomationStore', () => {
  it('writes snapshots atomically and reads them back', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'page-automation-'))
    const store = createPageAutomationStore(tempRoot)
    await writeJsonSnapshot(store.files.pages, [{ id: 'page-1', name: 'Fifth Clinic' }])
    await expect(readJsonSnapshot(store.files.pages, [])).resolves.toEqual([{ id: 'page-1', name: 'Fifth Clinic' }])
  })

  it('appends JSONL events without overwriting previous records', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'page-automation-'))
    const store = createPageAutomationStore(tempRoot)
    await appendJsonlRecord(store.files.auditLog, { id: 'audit-1', action: 'auto_off' })
    await appendJsonlRecord(store.files.auditLog, { id: 'audit-2', action: 'auto_on' })
    const content = await readFile(store.files.auditLog, 'utf-8')
    expect(content.trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      { id: 'audit-1', action: 'auto_off' },
      { id: 'audit-2', action: 'auto_on' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- tests/page-automation/pageAutomationStore.test.ts
```

Expected: FAIL because `server/pageAutomationStore.ts` does not exist.

- [ ] **Step 3: Create server types**

Create `server/pageAutomationTypes.ts`:

```ts
export type PageAutomationStatus = {
  ok: boolean
  autoMode: 'off' | 'on'
  storage: 'ready' | 'unavailable'
  checkedAt: string
}

export type PageAutomationAuditRecord = {
  id: string
  actor: 'system' | 'user'
  action: string
  target: string
  reason: string
  createdAt: string
}
```

- [ ] **Step 4: Implement store**

Create `server/pageAutomationStore.ts`:

```ts
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export type PageAutomationStore = ReturnType<typeof createPageAutomationStore>

export function createPageAutomationStore(root = resolve(process.cwd(), 'knowledge-base/runtime/page-automation')) {
  return {
    root,
    files: {
      pages: resolve(root, 'pages.json'),
      postDrafts: resolve(root, 'post-drafts.jsonl'),
      schedules: resolve(root, 'schedules.jsonl'),
      publishEvents: resolve(root, 'publish-events.jsonl'),
      messageCache: resolve(root, 'message-cache.jsonl'),
      auditLog: resolve(root, 'audit-log.jsonl'),
      pageAdsMapping: resolve(root, 'page-ads-mapping.json'),
    },
  }
}

export async function ensureStore(store: PageAutomationStore) {
  await mkdir(store.root, { recursive: true })
}

export async function readJsonSnapshot<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch (error) {
    if (isNotFound(error)) return fallback
    throw error
  }
}

export async function writeJsonSnapshot(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  await rename(tempPath, filePath)
}

export async function appendJsonlRecord(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- tests/page-automation/pageAutomationStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/pageAutomationTypes.ts server/pageAutomationStore.ts tests/page-automation/pageAutomationStore.test.ts
git commit -m "feat: add page automation persistent store"
```

## Task 4: Add Meta Permission And Page API Layer

**Files:**
- Create: `server/pageAutomationMetaApi.ts`
- Modify: `server/pageAutomationTypes.ts`

- [ ] **Step 1: Extend server types**

Append to `server/pageAutomationTypes.ts`:

```ts
export type PageAutomationPermission =
  | 'pages_show_list'
  | 'pages_read_engagement'
  | 'pages_read_user_content'
  | 'pages_manage_posts'
  | 'pages_manage_metadata'
  | 'pages_manage_engagement'
  | 'pages_messaging'
  | 'instagram_basic'
  | 'instagram_manage_insights'
  | 'instagram_content_publish'
  | 'instagram_manage_comments'
  | 'instagram_manage_messages'
  | 'ads_read'
  | 'business_management'
  | 'leads_retrieval'

export type PageAutomationPermissionReport = {
  pageId: string
  platform: 'facebook' | 'instagram'
  granted: PageAutomationPermission[]
  missing: PageAutomationPermission[]
  checkedAt: string
}

export type ManagedPageRecord = {
  id: string
  name: string
  handle: string
  platform: 'facebook' | 'instagram'
  followers: number
  followerDelta: number
  reach: number
  engagementRate: number
  unreadCount: number
  responseRate: number
  avgFirstResponseMins: number
  healthScore: number
  permissions: PageAutomationPermissionReport[]
  lastSyncedAt: string
}
```

- [ ] **Step 2: Implement Meta API helpers**

Create `server/pageAutomationMetaApi.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ManagedPageRecord, PageAutomationPermission, PageAutomationPermissionReport } from './pageAutomationTypes.js'

const GRAPH_HOST = 'https://graph.facebook.com'
const DEFAULT_GRAPH_VERSION = 'v21.0'

export type PageAutomationMetaConfig = {
  accessToken?: string
  graphVersion?: string
}

type PersistedMetaConfig = {
  accessToken?: string
  graphVersion?: string
}

const FACEBOOK_REQUIRED: PageAutomationPermission[] = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'pages_messaging',
]

export async function fetchPageAutomationPages(config: PageAutomationMetaConfig, fetchImpl: typeof fetch = fetch): Promise<ManagedPageRecord[]> {
  if (!config.accessToken) return []
  const graphVersion = config.graphVersion || DEFAULT_GRAPH_VERSION
  const data = await graphGet<{ data?: Array<{ id: string; name?: string; username?: string; followers_count?: number }> }>(
    `/${graphVersion}/me/accounts`,
    config.accessToken,
    fetchImpl,
    'fields=id,name,username,followers_count',
  )
  const now = new Date().toISOString()
  return (data.data ?? []).map((page) => ({
    id: page.id,
    name: page.name || `Page ${page.id}`,
    handle: page.username ? `@${page.username}` : page.id,
    platform: 'facebook',
    followers: Number(page.followers_count ?? 0),
    followerDelta: 0,
    reach: 0,
    engagementRate: 0,
    unreadCount: 0,
    responseRate: 0,
    avgFirstResponseMins: 0,
    healthScore: 50,
    permissions: [buildPermissionReport(page.id, 'facebook', FACEBOOK_REQUIRED, now)],
    lastSyncedAt: now,
  }))
}

export async function readPageAutomationMetaConfig(env: Record<string, string | undefined>): Promise<PageAutomationMetaConfig> {
  const localConfig = await readLocalMetaConfig()
  return {
    accessToken: localConfig?.accessToken || env.META_ACCESS_TOKEN,
    graphVersion: localConfig?.graphVersion || env.META_GRAPH_VERSION || env.VITE_META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
  }
}

export async function fetchPageInsights(config: PageAutomationMetaConfig, pageId: string, fetchImpl: typeof fetch = fetch) {
  if (!config.accessToken) return { reach: 0, engagementRate: 0 }
  const graphVersion = config.graphVersion || DEFAULT_GRAPH_VERSION
  const data = await graphGet<{ data?: Array<{ name: string; values?: Array<{ value?: number }> }> }>(
    `/${graphVersion}/${pageId}/insights`,
    config.accessToken,
    fetchImpl,
    'metric=page_impressions,page_post_engagements&period=day',
  )
  const reach = metricValue(data, 'page_impressions')
  const engagements = metricValue(data, 'page_post_engagements')
  return { reach, engagementRate: reach > 0 ? (engagements / reach) * 100 : 0 }
}

export function buildPermissionReport(
  pageId: string,
  platform: PageAutomationPermissionReport['platform'],
  granted: PageAutomationPermission[],
  checkedAt = new Date().toISOString(),
): PageAutomationPermissionReport {
  const required = platform === 'facebook' ? FACEBOOK_REQUIRED : ['instagram_basic', 'instagram_manage_insights', 'instagram_manage_messages']
  return {
    pageId,
    platform,
    granted,
    missing: required.filter((permission) => !granted.includes(permission as PageAutomationPermission)) as PageAutomationPermission[],
    checkedAt,
  }
}

async function graphGet<T>(path: string, accessToken: string, fetchImpl: typeof fetch, query = ''): Promise<T> {
  const url = new URL(`${GRAPH_HOST}${path}`)
  if (query) {
    for (const part of query.split('&')) {
      const [key, value = ''] = part.split('=')
      url.searchParams.set(key, value)
    }
  }
  url.searchParams.set('access_token', accessToken)
  const response = await fetchImpl(url)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error?.message === 'string' ? payload.error.message : `Meta API failed (${response.status})`)
  }
  return payload as T
}

function metricValue(payload: { data?: Array<{ name: string; values?: Array<{ value?: number }> }> }, metric: string) {
  return Number(payload.data?.find((row) => row.name === metric)?.values?.[0]?.value ?? 0)
}

async function readLocalMetaConfig(): Promise<PersistedMetaConfig | null> {
  try {
    return JSON.parse(await readFile(resolve(process.cwd(), '.meta-api.local.json'), 'utf-8')) as PersistedMetaConfig
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Run server build**

Run:

```bash
npm run build:server
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/pageAutomationTypes.ts server/pageAutomationMetaApi.ts
git commit -m "feat: add page automation Meta API layer"
```

## Task 5: Add Ads AI Bridge Normalizer

**Files:**
- Create: `server/pageAutomationAdsBridge.ts`
- Modify: `server/pageAutomationTypes.ts`

- [ ] **Step 1: Add bridge types**

Append to `server/pageAutomationTypes.ts`:

```ts
export type SharedAdsInsightForPageRecord = {
  source: { workspaceId?: string; datePreset: string; checkedAt: string; taskId?: string }
  scope: { pageId?: string; pageName?: string; campaignIds: string[]; adSetIds: string[]; adIds: string[] }
  metrics: { spend: number; revenue: number; roas: number; cpa: number; ctr: number; leads?: number; bookings?: number }
  findings: Array<{ title: string; summary: string; evidence: string[]; risk: 'Low' | 'Medium' | 'High'; confidence: number }>
  recommendations: Array<{ id: string; action: string; expectedImpact: string; guardrail: string; requiresApproval: true; risk: 'Low' | 'Medium' | 'High'; confidence: number }>
  creativeSignals: Array<{ adId: string; campaignId: string; creative: string; score: number; ctr: number; roas: number; bookings: number }>
  outcomeSignals: { alerts: unknown[]; learnings: unknown[]; nextActions: string[] }
  policy: { readOnly: true; noMetaWrites: true; noInventedMetrics: true; approvalRequired: true }
}
```

- [ ] **Step 2: Create normalizer**

Create `server/pageAutomationAdsBridge.ts`:

```ts
import type { WorkspaceData } from '../src/types'
import type { SharedAdsInsightForPageRecord } from './pageAutomationTypes.js'

export function normalizeAdsInsightForPage({
  datePreset,
  pageId,
  pageName,
  workspace,
}: {
  datePreset: string
  pageId?: string
  pageName?: string
  workspace: WorkspaceData | null
}): SharedAdsInsightForPageRecord {
  const campaigns = workspace?.campaigns ?? []
  const ads = workspace?.adInsights ?? []
  const spend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0)
  const revenue = campaigns.reduce((sum, campaign) => sum + campaign.revenue, 0)
  const conversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const ctr = campaigns.length ? campaigns.reduce((sum, campaign) => sum + campaign.ctr, 0) / campaigns.length : 0
  const leads = workspace?.channelPerformance.reduce((sum, channel) => sum + channel.leads, 0) ?? 0
  const bookings = workspace?.channelPerformance.reduce((sum, channel) => sum + channel.bookings, 0) ?? 0
  const roas = spend > 0 ? revenue / spend : 0
  const cpa = conversions > 0 ? spend / conversions : 0
  const topAds = [...ads].sort((a, b) => b.roas - a.roas).slice(0, 5)

  return {
    source: {
      workspaceId: workspace?.memoryItems.find((item) => item.id === 'meta-memory-account')?.title,
      datePreset,
      checkedAt: new Date().toISOString(),
      taskId: `page-automation-${Date.now()}`,
    },
    scope: {
      pageId,
      pageName,
      campaignIds: campaigns.map((campaign) => campaign.id),
      adSetIds: workspace?.adSets.map((adSet) => adSet.id) ?? [],
      adIds: ads.map((ad) => ad.id),
    },
    metrics: { spend, revenue, roas, cpa, ctr, leads, bookings },
    findings: campaigns.slice(0, 3).map((campaign) => ({
      title: campaign.name,
      summary: campaign.aiSummary || `ROAS ${campaign.roas.toFixed(2)}x, CPA ${Math.round(campaign.cpa).toLocaleString('th-TH')}`,
      evidence: [`Spend ${campaign.spend}`, `CTR ${campaign.ctr}`, `Conversions ${campaign.conversions}`],
      risk: campaign.aiStatus === 'critical' ? 'High' : campaign.aiStatus === 'watch' ? 'Medium' : 'Low',
      confidence: campaign.aiStatus === 'healthy' ? 88 : 74,
    })),
    recommendations: (workspace?.actions ?? []).slice(0, 5).map((action) => ({
      id: action.id,
      action: action.summary,
      expectedImpact: action.expectedImpact,
      guardrail: action.guardrail,
      requiresApproval: true,
      risk: action.risk,
      confidence: action.confidence,
    })),
    creativeSignals: topAds.map((ad) => ({
      adId: ad.id,
      campaignId: ad.campaignId,
      creative: ad.name,
      score: Math.round(Math.min(100, Math.max(0, ad.roas * 18 + ad.ctr * 2))),
      ctr: ad.ctr,
      roas: ad.roas,
      bookings: ad.bookings,
    })),
    outcomeSignals: { alerts: [], learnings: [], nextActions: [] },
    policy: { readOnly: true, noMetaWrites: true, noInventedMetrics: true, approvalRequired: true },
  }
}
```

- [ ] **Step 3: Run server build**

Run:

```bash
npm run build:server
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/pageAutomationTypes.ts server/pageAutomationAdsBridge.ts
git commit -m "feat: normalize ads insights for page automation"
```

## Task 6: Add Page Automation Backend Plugin

**Files:**
- Create: `server/pageAutomationPlugin.ts`
- Modify: `vite.config.ts`
- Modify: `server/productionServer.ts`

- [ ] **Step 1: Implement plugin**

Create `server/pageAutomationPlugin.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { normalizeAdsInsightForPage } from './pageAutomationAdsBridge.js'
import { fetchPageAutomationPages, fetchPageInsights, readPageAutomationMetaConfig } from './pageAutomationMetaApi.js'
import { appendJsonlRecord, createPageAutomationStore, ensureStore, readJsonSnapshot, writeJsonSnapshot } from './pageAutomationStore.js'
import type { ManagedPageRecord, PageAutomationStatus } from './pageAutomationTypes.js'

type PageAutomationEnv = { [key: string]: string | undefined }

export function createPageAutomationPlugin(env: PageAutomationEnv): Plugin {
  return {
    name: 'page-automation-api',
    configureServer(server) {
      server.middlewares.use(createPageAutomationMiddleware(env))
    },
  }
}

export function createPageAutomationMiddleware(env: PageAutomationEnv) {
  const store = createPageAutomationStore()

  return async function pageAutomationMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void = () => undefined) {
    if (!req.url?.startsWith('/api/page-automation/')) {
      next()
      return
    }
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    try {
      await ensureStore(store)
      const metaConfig = await readPageAutomationMetaConfig(env)

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/status') {
        return json(res, {
          ok: true,
          autoMode: 'off',
          storage: 'ready',
          checkedAt: new Date().toISOString(),
        } satisfies PageAutomationStatus)
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/pages') {
        const livePages = await fetchPageAutomationPages(metaConfig).catch(() => null)
        const pages = livePages ?? (await readJsonSnapshot<ManagedPageRecord[]>(store.files.pages, []))
        if (livePages) await writeJsonSnapshot(store.files.pages, livePages)
        return json(res, { pages, source: livePages ? 'meta' : 'cache' })
      }

      if (req.method === 'GET' && /^\/api\/page-automation\/pages\/[^/]+\/insights$/.test(requestUrl.pathname)) {
        const pageId = requestUrl.pathname.split('/')[4]
        const insights = await fetchPageInsights(metaConfig, pageId)
        return json(res, { pageId, insights, checkedAt: new Date().toISOString() })
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/post-drafts') {
        return json(res, { drafts: [] })
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/page-automation/post-drafts') {
        const body = await readJsonBody(req)
        await appendJsonlRecord(store.files.postDrafts, { ...body, createdAt: new Date().toISOString() })
        await appendJsonlRecord(store.files.auditLog, {
          id: `audit-${Date.now()}`,
          actor: 'user',
          action: 'create_post_draft',
          target: String(body.id ?? 'draft'),
          reason: 'created from Page Automation UI',
          createdAt: new Date().toISOString(),
        })
        return json(res, { ok: true })
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/messages') {
        return json(res, { messages: [], source: 'polling', checkedAt: new Date().toISOString() })
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/ads-insights') {
        return json(res, {
          insight: normalizeAdsInsightForPage({
            datePreset: requestUrl.searchParams.get('datePreset') || 'last_7d',
            pageId: requestUrl.searchParams.get('pageId') || undefined,
            pageName: requestUrl.searchParams.get('pageName') || undefined,
            workspace: null,
          }),
        })
      }

      res.statusCode = 404
      return json(res, { error: 'Page Automation endpoint not found' })
    } catch (error) {
      res.statusCode = 500
      return json(res, { error: error instanceof Error ? error.message : 'Page Automation API failed' })
    }
  }
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf-8')
  return raw ? JSON.parse(raw) : {}
}

function json(res: ServerResponse, payload: unknown) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}
```

- [ ] **Step 2: Wire Vite plugin**

Modify `vite.config.ts`:

```ts
import { createPageAutomationPlugin } from './server/pageAutomationPlugin'
```

Update plugin array:

```ts
plugins: [react(), createMetaApiPlugin(env), createOpenAiPlugin(env), createPageAutomationPlugin(env)],
```

- [ ] **Step 3: Wire production server**

Modify `server/productionServer.ts` imports:

```ts
import { createPageAutomationMiddleware } from './pageAutomationPlugin.js'
```

Add near existing API middleware setup:

```ts
const pageAutomationApi = createPageAutomationMiddleware(process.env)
```

Add route before static serving:

```ts
if (req.url?.startsWith('/api/page-automation/')) {
  await pageAutomationApi(req, res)
  return
}
```

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pageAutomationPlugin.ts vite.config.ts server/productionServer.ts
git commit -m "feat: add page automation API namespace"
```

## Task 7: Extract Page Automation Frontend Boundary

**Files:**
- Modify: `src/App.tsx`
- Create: `src/apps/page-automation/PageAutomationApp.tsx`
- Create: `src/apps/page-automation/api.ts`
- Create: `src/apps/page-automation/components.tsx`
- Create: `src/apps/page-automation/styles.css`

- [ ] **Step 1: Create API client**

Create `src/apps/page-automation/api.ts`:

```ts
import type { ManagedPage, PageMessage, PostDraft, SharedAdsInsightForPage } from './types'

export async function pageAutomationApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Page Automation API failed (${response.status})`)
  }
  return payload as T
}

export function fetchPageAutomationStatus() {
  return pageAutomationApiJson<{ ok: boolean; autoMode: 'off' | 'on'; storage: 'ready' | 'unavailable'; checkedAt: string }>('/api/page-automation/status')
}

export function fetchManagedPages() {
  return pageAutomationApiJson<{ pages: ManagedPage[]; source: 'meta' | 'cache' }>('/api/page-automation/pages')
}

export function fetchMessages() {
  return pageAutomationApiJson<{ messages: PageMessage[]; source: 'polling'; checkedAt: string }>('/api/page-automation/messages')
}

export function fetchAdsInsight(pageId: string, pageName: string) {
  const params = new URLSearchParams({ pageId, pageName, datePreset: 'last_7d' })
  return pageAutomationApiJson<{ insight: SharedAdsInsightForPage }>(`/api/page-automation/ads-insights?${params}`)
}

export function createPostDraft(draft: PostDraft) {
  return pageAutomationApiJson<{ ok: true }>('/api/page-automation/post-drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
}
```

- [ ] **Step 2: Create shared components**

Create `src/apps/page-automation/components.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function PageAutomationPanel({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <section className="pa-panel">
      <div className="pa-panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  )
}

export function PageAutomationMetric({ detail, icon: Icon, label, tone = 'neutral', value }: { detail: string; icon: LucideIcon; label: string; tone?: 'good' | 'watch' | 'critical' | 'neutral'; value: string }) {
  return (
    <article className={`pa-metric ${tone}`}>
      <span className="pa-metric-icon"><Icon size={18} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

export function PageAutomationState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="pa-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}
```

- [ ] **Step 3: Create app shell**

Create `src/apps/page-automation/PageAutomationApp.tsx`:

```tsx
import { BarChart3, CalendarClock, Inbox, Power, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PAGE_AUTOMATION_ROUTES } from './constants'
import { fetchAdsInsight, fetchManagedPages, fetchMessages, fetchPageAutomationStatus } from './api'
import { AnalyticsDashboard } from './routes/AnalyticsDashboard'
import { AutoPost } from './routes/AutoPost'
import { Messages } from './routes/Messages'
import { PageAnalysis } from './routes/PageAnalysis'
import type { AutoMode, ManagedPage, PageAutomationRouteId, PageMessage, SharedAdsInsightForPage } from './types'
import './styles.css'

export function PageAutomationApp() {
  const [route, setRoute] = useState<PageAutomationRouteId>(routeFromPath(window.location.pathname))
  const [autoMode, setAutoMode] = useState<AutoMode>('off')
  const [pages, setPages] = useState<ManagedPage[]>([])
  const [messages, setMessages] = useState<PageMessage[]>([])
  const [adsInsight, setAdsInsight] = useState<SharedAdsInsightForPage | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [status, pageResult, messageResult] = await Promise.all([
          fetchPageAutomationStatus(),
          fetchManagedPages(),
          fetchMessages(),
        ])
        if (!active) return
        setAutoMode(status.autoMode)
        setPages(pageResult.pages)
        setMessages(messageResult.messages)
        const firstPage = pageResult.pages[0]
        if (firstPage) {
          const insight = await fetchAdsInsight(firstPage.id, firstPage.name)
          if (active) setAdsInsight(insight.insight)
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'โหลด Page Automation ไม่สำเร็จ')
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const summary = useMemo(() => ({
    followers: pages.reduce((sum, page) => sum + page.followers, 0),
    unread: messages.filter((message) => message.unread).length,
    avgHealth: pages.length ? pages.reduce((sum, page) => sum + page.healthScore, 0) / pages.length : 0,
  }), [messages, pages])

  const routeProps = { adsInsight, autoMode, messages, pages, summary }

  return (
    <main className="pa-shell">
      <aside className="pa-dock" aria-label="Page Automation navigation">
        {PAGE_AUTOMATION_ROUTES.map((item) => (
          <a key={item.id} className={route === item.id ? 'active' : ''} href={item.href} onClick={(event) => {
            event.preventDefault()
            window.history.pushState(null, '', item.href)
            setRoute(item.id)
          }}>
            {item.id === 'auto-post' ? <CalendarClock size={18} /> : item.id === 'pages' ? <Search size={18} /> : item.id === 'messages' ? <Inbox size={18} /> : <BarChart3 size={18} />}
            <span>{item.label}</span>
          </a>
        ))}
      </aside>
      <section className="pa-main">
        <header className="pa-topbar">
          <div>
            <span className="pa-eyebrow">Separate Meta API program</span>
            <h1>Page Automation</h1>
            <p>Ads Auto Post, วิเคราะห์เพจ, กล่องข้อความรวม และ dashboard ที่ใช้ Ads AI ร่วมวิเคราะห์</p>
          </div>
          <button className={`pa-auto-toggle ${autoMode === 'on' ? 'on' : 'off'}`} type="button" onClick={() => setAutoMode(autoMode === 'on' ? 'off' : 'on')}>
            <Power size={16} />
            {autoMode === 'on' ? 'Auto ON' : 'Auto OFF'}
          </button>
        </header>
        {error ? <div className="pa-error" role="alert">{error}</div> : null}
        {route === 'auto-post' ? <AutoPost {...routeProps} /> : route === 'pages' ? <PageAnalysis {...routeProps} /> : route === 'messages' ? <Messages {...routeProps} /> : <AnalyticsDashboard {...routeProps} />}
      </section>
    </main>
  )
}

function routeFromPath(pathname: string): PageAutomationRouteId {
  if (pathname.includes('/auto-post')) return 'auto-post'
  if (pathname.includes('/pages')) return 'pages'
  if (pathname.includes('/messages')) return 'messages'
  if (pathname.includes('/analytics')) return 'analytics'
  return 'dashboard'
}
```

- [ ] **Step 4: Move route switch out of inline prototype**

Modify `src/App.tsx`:

```tsx
import { PageAutomationApp } from './apps/page-automation/PageAutomationApp'
```

Keep the top-level `App` function:

```tsx
function App() {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  if (pathname.startsWith('/page-automation')) return <PageAutomationApp />
  return <PmcAdsAgentApp />
}
```

Remove the old inline Page Automation types, mock arrays, `PageAutomationApp`, `PageAutomationKpi`, `PageAutomationBar`, `statusToneForPost`, and `priorityTone` from `src/App.tsx`.

- [ ] **Step 5: Add base styles**

Create `src/apps/page-automation/styles.css` with the graphite/off-white/coral/green system:

```css
.pa-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  background: #f6f5f1;
  color: #202124;
}

.pa-dock {
  background: #242424;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pa-dock a {
  min-height: 48px;
  border-radius: 8px;
  color: #f7f3ea;
  display: grid;
  place-items: center;
  text-decoration: none;
}

.pa-dock a span {
  display: none;
}

.pa-dock a.active {
  background: #d96c4f;
}

.pa-main {
  min-width: 0;
  padding: 22px;
}

.pa-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}

.pa-eyebrow {
  color: #5f6f64;
  font-size: 12px;
  font-weight: 800;
}

.pa-topbar h1,
.pa-panel h2 {
  margin: 0;
}

.pa-topbar p,
.pa-panel p {
  color: #66706a;
}

.pa-auto-toggle,
.pa-button {
  min-height: 38px;
  border: 1px solid #d8d3c9;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: #fffdf8;
  color: #242424;
  font-weight: 800;
}

.pa-auto-toggle.on {
  background: #2f7d62;
  color: #fff;
  border-color: #2f7d62;
}

.pa-auto-toggle.off {
  background: #fffdf8;
}

.pa-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 14px;
}

.pa-panel,
.pa-metric,
.pa-state {
  border: 1px solid #ded8cd;
  border-radius: 8px;
  background: #fffdf8;
  box-shadow: 0 10px 24px rgba(31, 31, 31, 0.05);
}

.pa-panel {
  padding: 16px;
}

.pa-panel-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.pa-error {
  border: 1px solid #d96c4f;
  border-radius: 8px;
  background: #fff1ec;
  color: #8b2d1f;
  padding: 10px 12px;
  margin-bottom: 12px;
}
```

- [ ] **Step 6: Run build**

Run:

```bash
npm run build:client
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/apps/page-automation
git commit -m "feat: extract page automation frontend app"
```

## Task 8: Implement Page Automation Route Screens

**Files:**
- Create: `src/apps/page-automation/routes/AnalyticsDashboard.tsx`
- Create: `src/apps/page-automation/routes/AutoPost.tsx`
- Create: `src/apps/page-automation/routes/Messages.tsx`
- Create: `src/apps/page-automation/routes/PageAnalysis.tsx`
- Modify: `src/apps/page-automation/styles.css`

- [ ] **Step 1: Create shared route props**

At the top of each route file, use this shared local type:

```ts
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type PageAutomationRouteProps = {
  autoMode: AutoMode
  pages: ManagedPage[]
  messages: PageMessage[]
  adsInsight: SharedAdsInsightForPage | null
  summary: { followers: number; unread: number; avgHealth: number }
}
```

- [ ] **Step 2: Implement Analytics Dashboard**

Create `src/apps/page-automation/routes/AnalyticsDashboard.tsx`:

```tsx
import { BarChart3, Inbox, Power, Users } from 'lucide-react'
import { PageAutomationMetric, PageAutomationPanel, PageAutomationState } from '../components'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type PageAutomationRouteProps = {
  autoMode: AutoMode
  pages: ManagedPage[]
  messages: PageMessage[]
  adsInsight: SharedAdsInsightForPage | null
  summary: { followers: number; unread: number; avgHealth: number }
}

export function AnalyticsDashboard({ adsInsight, autoMode, messages, pages, summary }: PageAutomationRouteProps) {
  return (
    <div className="pa-grid">
      <PageAutomationMetric icon={Power} label="Auto" value={autoMode === 'on' ? 'ON' : 'OFF'} detail={autoMode === 'on' ? 'low-risk เท่านั้น' : 'suggest only'} tone={autoMode === 'on' ? 'good' : 'neutral'} />
      <PageAutomationMetric icon={Users} label="ผู้ติดตามรวม" value={summary.followers.toLocaleString('th-TH')} detail={`${pages.length} pages`} />
      <PageAutomationMetric icon={Inbox} label="Unread" value={summary.unread.toLocaleString('th-TH')} detail={`${messages.length} conversations`} tone={summary.unread > 20 ? 'watch' : 'good'} />
      <PageAutomationMetric icon={BarChart3} label="Ads ROAS" value={adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x` : '-'} detail={adsInsight ? 'จาก Ads AI bridge' : 'รอ Ads AI bridge'} />
      <PageAutomationPanel title="Joint Ads + Page Insight" subtitle="ใช้ Ads AI ช่วยอธิบาย performance ของเพจ">
        {adsInsight ? (
          <div className="pa-list">
            {adsInsight.findings.slice(0, 4).map((finding) => (
              <article className="pa-row" key={finding.title}>
                <strong>{finding.title}</strong>
                <p>{finding.summary}</p>
                <small>{finding.risk} · {finding.confidence}% confidence</small>
              </article>
            ))}
          </div>
        ) : (
          <PageAutomationState title="Ads AI ยังไม่พร้อม" detail="ระบบจะแสดง insight เมื่อ bridge อ่านข้อมูล Ads workspace ได้" />
        )}
      </PageAutomationPanel>
    </div>
  )
}
```

- [ ] **Step 3: Implement Auto Post**

Create `src/apps/page-automation/routes/AutoPost.tsx`:

```tsx
import { Send } from 'lucide-react'
import { PageAutomationPanel, PageAutomationState } from '../components'
import { classifyAutoEligibility } from '../policy'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type PageAutomationRouteProps = {
  autoMode: AutoMode
  pages: ManagedPage[]
  messages: PageMessage[]
  adsInsight: SharedAdsInsightForPage | null
  summary: { followers: number; unread: number; avgHealth: number }
}

export function AutoPost({ adsInsight, autoMode, pages }: PageAutomationRouteProps) {
  const now = new Date().toISOString()
  const firstPage = pages[0]
  const eligibility = adsInsight && firstPage
    ? classifyAutoEligibility({
        adsAiConfidence: 0.9,
        guardrailScore: 95,
        pageMapping: 'explicit',
        contentType: 'education',
        hasPii: false,
        hasSensitiveHealthDetail: false,
        assetState: 'approved',
        adsInsightCheckedAt: adsInsight.source.checkedAt,
        pageSyncedAt: firstPage.lastSyncedAt,
        permissionsSyncedAt: firstPage.permissions[0]?.checkedAt ?? now,
        now,
      })
    : null

  return (
    <div className="pa-grid">
      <PageAutomationPanel title="Content Pipeline" subtitle="Draft, Ready, Scheduled, Posted, Needs Review">
        {firstPage ? (
          <div className="pa-pipeline">
            {['Draft', 'Ready', 'Scheduled', 'Posted', 'Needs Review'].map((column) => (
              <div className="pa-column" key={column}>
                <strong>{column}</strong>
                <article className="pa-card">
                  <span>{firstPage.name}</span>
                  <h3>โพสต์ความรู้ที่ต่อยอดจาก Ads winner</h3>
                  <p>{eligibility?.reason ?? 'รอ Ads AI bridge'}</p>
                  <small>{autoMode === 'on' && eligibility?.state === 'auto_eligible' ? 'Auto eligible' : 'Manual review'}</small>
                </article>
              </div>
            ))}
          </div>
        ) : (
          <PageAutomationState title="ยังไม่มีเพจ" detail="เชื่อมต่อ Meta Page ก่อนสร้าง pipeline" />
        )}
      </PageAutomationPanel>
      <PageAutomationPanel title="Draft Composer" subtitle="AI suggestion เป็น draft เท่านั้นจนกว่าจะ publish">
        <textarea className="pa-textarea" defaultValue="เขียนโพสต์แนวให้ความรู้ ใช้ insight จาก Ads AI แต่เลี่ยงคำ claim ผลลัพธ์เกินจริง" />
        <button className="pa-button" type="button"><Send size={16} /> สร้าง draft</button>
      </PageAutomationPanel>
    </div>
  )
}
```

- [ ] **Step 4: Implement Messages**

Create `src/apps/page-automation/routes/Messages.tsx`:

```tsx
import { MessageSquareText } from 'lucide-react'
import { PageAutomationPanel, PageAutomationState } from '../components'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type PageAutomationRouteProps = {
  autoMode: AutoMode
  pages: ManagedPage[]
  messages: PageMessage[]
  adsInsight: SharedAdsInsightForPage | null
  summary: { followers: number; unread: number; avgHealth: number }
}

export function Messages({ messages }: PageAutomationRouteProps) {
  return (
    <PageAutomationPanel title="กล่องข้อความรวม" subtitle="Polling ทุก 30 วินาทีเมื่อเปิดหน้านี้">
      {messages.length ? (
        <div className="pa-list">
          {messages.map((message) => (
            <article className="pa-row" key={message.messageId}>
              <MessageSquareText size={16} />
              <div>
                <strong>{message.customerDisplayName}</strong>
                <p>{message.textExcerpt}</p>
                <small>{message.priority} · {message.intent} · {message.status}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PageAutomationState title="ยังไม่มีข้อความจาก Meta API" detail="ระบบจะแสดง Facebook/Instagram messages เมื่อ permission ผ่านและ polling สำเร็จ" />
      )}
    </PageAutomationPanel>
  )
}
```

- [ ] **Step 5: Implement Page Analysis**

Create `src/apps/page-automation/routes/PageAnalysis.tsx`:

```tsx
import { PageAutomationPanel, PageAutomationState } from '../components'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type PageAutomationRouteProps = {
  autoMode: AutoMode
  pages: ManagedPage[]
  messages: PageMessage[]
  adsInsight: SharedAdsInsightForPage | null
  summary: { followers: number; unread: number; avgHealth: number }
}

export function PageAnalysis({ pages }: PageAutomationRouteProps) {
  return (
    <PageAutomationPanel title="วิเคราะห์ข้อมูล Page" subtitle="Page health, engagement, inbox backlog และ partial permission state">
      {pages.length ? (
        <div className="pa-list">
          {pages.map((page) => (
            <article className="pa-row" key={page.id}>
              <div>
                <strong>{page.name}</strong>
                <p>{page.handle}</p>
                <small>{page.followers.toLocaleString('th-TH')} followers · {page.engagementRate.toFixed(1)}% engagement · health {Math.round(page.healthScore)}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PageAutomationState title="ยังไม่มี Page data" detail="ต้องมี `pages_show_list` และ `pages_read_engagement` ก่อน" />
      )}
    </PageAutomationPanel>
  )
}
```

- [ ] **Step 6: Extend styles for routes**

Append to `src/apps/page-automation/styles.css`:

```css
.pa-metric {
  grid-column: span 3;
  min-height: 112px;
  padding: 14px;
  display: flex;
  gap: 12px;
}

.pa-panel {
  grid-column: span 12;
}

.pa-list,
.pa-pipeline {
  display: grid;
  gap: 10px;
}

.pa-pipeline {
  grid-template-columns: repeat(5, minmax(160px, 1fr));
  overflow-x: auto;
}

.pa-column {
  border: 1px solid #e4ded4;
  border-radius: 8px;
  padding: 10px;
  background: #f8f5ee;
}

.pa-card,
.pa-row {
  border: 1px solid #e4ded4;
  border-radius: 8px;
  background: #fffdf8;
  padding: 10px;
}

.pa-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.pa-textarea {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: 1px solid #d8d3c9;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
}

@media (max-width: 900px) {
  .pa-shell {
    grid-template-columns: 1fr;
  }

  .pa-dock {
    position: sticky;
    top: 0;
    z-index: 10;
    flex-direction: row;
    overflow-x: auto;
  }

  .pa-metric {
    grid-column: span 12;
  }
}
```

- [ ] **Step 7: Run build**

Run:

```bash
npm run build:client
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/apps/page-automation/routes src/apps/page-automation/styles.css
git commit -m "feat: add page automation route screens"
```

## Task 9: Verify End-To-End Locally

**Files:**
- Modify only if verification finds a scoped issue in files created above.

- [ ] **Step 1: Run full checks**

Run:

```bash
npm run test
npm run build
```

Expected: both PASS.

- [ ] **Step 2: Start dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 3: Verify app routes in browser**

Open:

```txt
http://127.0.0.1:5173/page-automation
http://127.0.0.1:5173/page-automation/auto-post
http://127.0.0.1:5173/page-automation/pages
http://127.0.0.1:5173/page-automation/messages
http://127.0.0.1:5173/page-automation/analytics
```

Expected:

- Page Automation renders with top nav and compact dock.
- Auto toggle is visible.
- `/` still renders PMC Ads Agent.
- Missing Meta permissions or missing token shows empty/partial states, not invented data.

- [ ] **Step 4: Verify API endpoints**

Run:

```bash
curl -s http://127.0.0.1:5173/api/page-automation/status
curl -s http://127.0.0.1:5173/api/page-automation/pages
curl -s http://127.0.0.1:5173/api/page-automation/messages
curl -s 'http://127.0.0.1:5173/api/page-automation/ads-insights?pageId=test&pageName=Test'
```

Expected:

- `status` returns JSON with `ok: true`.
- `pages` returns `{ "pages": [] }` or live Meta pages if token is configured.
- `messages` returns polling metadata and empty messages if permissions are unavailable.
- `ads-insights` returns normalized `insight.policy.readOnly: true`.

- [ ] **Step 5: Commit verification fixes if any**

If verification required code changes:

```bash
git add <changed-files>
git commit -m "fix: verify page automation integration"
```

If no code changes were required, do not create an empty commit.

## Task 10: Final Review And Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-05-21-page-automation-meta-api-implementation.md` only if execution notes need updates.

- [ ] **Step 1: Review spec coverage**

Confirm these requirements are implemented or visibly gated:

- Separate sibling app at `/page-automation/*`.
- Meta API-backed backend namespace.
- Meta permissions feature-gate matrix reflected in UI states.
- Polling v1 for Messages.
- Persistent server-side file store.
- Ads AI bridge normalized contract.
- Auto ON/OFF policy and low-risk matrix.
- No direct customer auto replies.
- No direct browser Meta token storage.

- [ ] **Step 2: Run final checks**

Run:

```bash
npm run test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Produce final implementation summary**

Include:

- Files changed.
- Endpoints added.
- How to run.
- What Meta permissions are needed for live data.
- Known gated surfaces.

## Execution Notes

Use subagent workstreams in this order:

1. Policy and types.
2. Store.
3. Meta API layer.
4. Ads AI bridge.
5. API plugin wiring.
6. Frontend boundary.
7. Route screens.
8. Verification.

Do not dispatch implementation agents in parallel against overlapping files. If parallelizing, split by disjoint file ownership:

- Backend agent: `server/pageAutomation*.ts`, `vite.config.ts`, `server/productionServer.ts`.
- Frontend agent: `src/apps/page-automation/**`, `src/App.tsx`.
- Review agent: read-only verification after both have completed.
