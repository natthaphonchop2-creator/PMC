# Ad Groups Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new Ad Groups workspace as a dedicated Ad Set operations page with Split Inspector layout and approval-gated Meta writes.

**Architecture:** Keep the existing Ads Agent shell and toolbar, but split the `ads` tab rendering by `activeToolbarKey`: Campaigns keeps the current Campaign manager, while Ad Groups renders a new `AdGroupsPage`. Add pure helper functions for Ad Set row derivation, filtering, grouping, validation, and approval-command creation so tests can cover behavior before UI wiring. UI state stays local to `AdGroupsPage` for phase 1.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing `src/App.tsx` shell/components, new pure helper module under `src/adGroupsWorkspace.ts`, styles in `src/App.css`.

---

## File Structure

- Modify: `src/App.tsx`
  - Route `activeToolbarKey === 'ad-groups'` to a new `AdGroupsPage`.
  - Add/export `AdGroupsPage` near the current ads manager code.
  - Keep existing `AdsManagerPage` for Campaigns.
  - Add the Ad Groups approval modal and action handlers.
- Create: `src/adGroupsWorkspace.ts`
  - Pure types and helpers for rows, filters, grouping, edit validation, and approval commands.
- Modify: `src/App.css`
  - Split Inspector layout, table rows, filter controls, inspector, approval preview, and responsive states.
- Modify: `tests/homeApp.test.tsx`
  - Component/source-level tests for routing, static rendering, and old Campaigns UI separation.
- Create: `tests/adGroupsWorkspace.test.ts`
  - Pure helper tests for filtering, grouping, validation, and approval command creation.
- Modify: `docs/PROJECT_UPDATES.md`
  - Add the implementation-plan entry.
- Modify: `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`
  - Add current implementation-plan status.

---

### Task 1: Route Ad Groups Separately From Campaigns

**Files:**
- Modify: `tests/homeApp.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing routing/source test**

Add this test near the existing Ads Agent shell tests in `tests/homeApp.test.tsx`:

```tsx
it('routes the Ad Groups toolbar item to a dedicated AdGroupsPage', () => {
  const source = readText('../src/App.tsx')
  const routeSource = source.slice(source.indexOf("{activeTab === 'ads'"), source.indexOf("{activeTab === 'marketer'"))

  expect(routeSource).toContain("activeToolbarKey === 'ad-groups'")
  expect(routeSource).toContain('<AdGroupsPage')
  expect(routeSource).toContain('<AdsManagerPage')
  expect(routeSource.indexOf('<AdGroupsPage')).toBeLessThan(routeSource.indexOf('<AdsManagerPage'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because the `ads` tab currently renders only `AdsManagerPage` and does not branch on `activeToolbarKey === 'ad-groups'`.

- [ ] **Step 3: Add the routing branch and temporary skeleton component**

In `src/App.tsx`, replace the current single `activeTab === 'ads'` block with this shape:

```tsx
          {activeTab === 'ads' && activeToolbarKey === 'ad-groups' && (
            <AdGroupsPage
              adSets={visibleWorkspace?.adSets ?? []}
              ads={visibleWorkspace?.adInsights ?? []}
              campaigns={displayCampaigns}
              onMutationComplete={() => refreshWorkspace('execution')}
            />
          )}
          {activeTab === 'ads' && activeToolbarKey !== 'ad-groups' && (
            <AdsManagerPage
              adSets={visibleWorkspace?.adSets ?? []}
              ads={visibleWorkspace?.adInsights ?? []}
              campaigns={displayCampaigns}
              onMutationComplete={() => refreshWorkspace('execution')}
              onSelectCampaign={setSelectedCampaignId}
              searchQuery={searchQuery}
              selectedCampaign={displayCampaigns.find((campaign) => campaign.id === effectiveSelectedCampaignId) ?? displayCampaigns[0]}
              setSearchQuery={setSearchQuery}
            />
          )}
```

Add this temporary skeleton before `function AdsManagerPage`:

```tsx
export function AdGroupsPage({
  adSets,
  ads,
  campaigns,
  onMutationComplete,
}: {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  campaigns: Campaign[]
  onMutationComplete: () => Promise<void>
}) {
  void onMutationComplete

  return (
    <TwoColumnPage aside={<StatePanel state="Ad Groups" detail={`${adSets.length} ชุดโฆษณา · ${ads.length} โฆษณา`} tone="info" />}>
      <SectionCard title="Ad Groups" subtitle={`${campaigns.length} แคมเปญที่เกี่ยวข้อง`}>
        <p>กำลังเตรียม workspace สำหรับจัดการ Ad Set</p>
      </SectionCard>
    </TwoColumnPage>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS for the new routing test. Existing tests may still expose unrelated dirty-worktree failures; fix only failures caused by this task.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/homeApp.test.tsx
git commit -m "feat: route ad groups workspace separately"
```

---

### Task 2: Add Ad Groups Pure Data Helpers

**Files:**
- Create: `src/adGroupsWorkspace.ts`
- Create: `tests/adGroupsWorkspace.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/adGroupsWorkspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildAdGroupRows,
  filterAdGroupRows,
  groupAdGroupRowsByCampaign,
  type AdGroupStatusFilter,
} from '../src/adGroupsWorkspace'
import type { WorkspaceData } from '../src/types'

const campaigns = [
  { id: 'cmp-1', name: 'Lead Botox', budget: 1000, spend: 400, roas: 2.1, conversions: 12, cpa: 33, ctr: 2.4, deliveryStatus: 'active' as const, status: 'Active', tone: 'good' as const, aiTag: 'ดี' },
  { id: 'cmp-2', name: 'Filler Review', budget: 2000, spend: 900, roas: 0.8, conversions: 5, cpa: 180, ctr: 1.2, deliveryStatus: 'paused' as const, status: 'Paused', tone: 'watch' as const, aiTag: 'เฝ้าดู' },
]

const adSets: WorkspaceData['adSets'] = [
  { id: 'set-1', campaignId: 'cmp-1', name: 'Bangkok Core', audience: 'Bangkok', deliveryStatus: 'active', budget: 700, spend: 350, bookings: 10, cpa: 35, roas: 2.2, status: 'healthy' },
  { id: 'set-2', campaignId: 'cmp-1', name: 'Lookalike High Intent', audience: 'Thailand', deliveryStatus: 'paused', budget: 500, spend: 120, bookings: 2, cpa: 60, roas: 0.9, status: 'watch' },
  { id: 'set-3', campaignId: 'cmp-2', name: 'Filler Warm Audience', audience: 'Chiang Mai', deliveryStatus: 'active', budget: 800, spend: 420, bookings: 4, cpa: 105, roas: 0.7, status: 'critical' },
]

const ads: WorkspaceData['adInsights'] = [
  { id: 'ad-1', campaignId: 'cmp-1', adSetId: 'set-1', name: 'Botox A', creative: 'Image', status: 'active', spend: 200, impressions: 2000, clicks: 80, leads: 12, bookings: 6, showRate: 50, ctr: 4, cpc: 2.5, roas: 2.5, score: 80 },
  { id: 'ad-2', campaignId: 'cmp-1', adSetId: 'set-1', name: 'Botox B', creative: 'Video', status: 'paused', spend: 150, impressions: 1200, clicks: 30, leads: 4, bookings: 2, showRate: 50, ctr: 2.5, cpc: 5, roas: 1.2, score: 50 },
  { id: 'ad-3', campaignId: 'cmp-2', adSetId: 'set-3', name: 'Filler A', creative: 'Image', status: 'active', spend: 420, impressions: 3000, clicks: 45, leads: 5, bookings: 2, showRate: 40, ctr: 1.5, cpc: 9.33, roas: 0.7, score: 35 },
]

describe('adGroupsWorkspace helpers', () => {
  it('builds operation-first Ad Set rows with campaign and Ads counts', () => {
    const rows = buildAdGroupRows({ adSets, ads, campaigns })

    expect(rows[0]).toEqual(expect.objectContaining({
      id: 'set-1',
      name: 'Bangkok Core',
      campaignName: 'Lead Botox',
      adsCount: 2,
      activeAdsCount: 1,
      pausedAdsCount: 1,
      budgetDisplay: '฿700',
    }))
  })

  it('filters rows by status and text query', () => {
    const rows = buildAdGroupRows({ adSets, ads, campaigns })
    const filters: { searchQuery: string; statusFilter: AdGroupStatusFilter; campaignId: string } = {
      campaignId: '',
      searchQuery: 'filler',
      statusFilter: 'active',
    }

    expect(filterAdGroupRows(rows, filters).map((row) => row.id)).toEqual(['set-3'])
  })

  it('groups filtered rows by campaign while preserving row actions', () => {
    const rows = buildAdGroupRows({ adSets, ads, campaigns })
    const groups = groupAdGroupRowsByCampaign(rows)

    expect(groups).toEqual([
      expect.objectContaining({ campaignId: 'cmp-1', campaignName: 'Lead Botox', rows: expect.arrayContaining([expect.objectContaining({ id: 'set-1' })]) }),
      expect.objectContaining({ campaignId: 'cmp-2', campaignName: 'Filler Review', rows: [expect.objectContaining({ id: 'set-3' })] }),
    ])
  })
})
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
npm run test -- tests/adGroupsWorkspace.test.ts
```

Expected: FAIL because `src/adGroupsWorkspace.ts` does not exist.

- [ ] **Step 3: Implement the helper module**

Create `src/adGroupsWorkspace.ts`:

```ts
import type { WorkspaceData } from './types'

export type AdGroupStatusFilter = 'all' | 'active' | 'paused' | 'pending'
export type AdGroupViewMode = 'flat' | 'groupedByCampaign'

export type AdGroupRow = {
  id: string
  name: string
  campaignId: string
  campaignName: string
  deliveryStatus: WorkspaceData['adSets'][number]['deliveryStatus']
  budget: number
  budgetDisplay: string
  spend: number
  bookings: number
  cpa: number
  roas: number
  adsCount: number
  activeAdsCount: number
  pausedAdsCount: number
  audience: string
  lastSyncedAt: string
  hasPendingCommand: boolean
}

export type AdGroupRowGroup = {
  campaignId: string
  campaignName: string
  rows: AdGroupRow[]
}

export type BuildAdGroupRowsInput = {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  campaigns: Array<{ id: string; name: string }>
  pendingCommandTargetIds?: string[]
  lastSyncedAt?: string
}

export function buildAdGroupRows({
  adSets,
  ads,
  campaigns,
  lastSyncedAt = '',
  pendingCommandTargetIds = [],
}: BuildAdGroupRowsInput): AdGroupRow[] {
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))
  const pendingIds = new Set(pendingCommandTargetIds)

  return adSets.map((adSet) => {
    const adSetAds = ads.filter((ad) => ad.adSetId === adSet.id)
    const activeAdsCount = adSetAds.filter((ad) => ad.status === 'active').length
    const pausedAdsCount = adSetAds.filter((ad) => ad.status === 'paused').length

    return {
      id: adSet.id,
      name: adSet.name,
      campaignId: adSet.campaignId,
      campaignName: campaignNames.get(adSet.campaignId) ?? 'ไม่พบ Campaign แม่',
      deliveryStatus: adSet.deliveryStatus,
      budget: adSet.budget,
      budgetDisplay: formatAdGroupMoney(adSet.budget),
      spend: adSet.spend,
      bookings: adSet.bookings,
      cpa: adSet.cpa,
      roas: adSet.roas,
      adsCount: adSetAds.length,
      activeAdsCount,
      pausedAdsCount,
      audience: adSet.audience,
      lastSyncedAt,
      hasPendingCommand: pendingIds.has(adSet.id),
    }
  })
}

export function filterAdGroupRows(
  rows: AdGroupRow[],
  filters: { searchQuery: string; statusFilter: AdGroupStatusFilter; campaignId: string },
): AdGroupRow[] {
  const query = filters.searchQuery.trim().toLowerCase()

  return rows.filter((row) => {
    const statusMatches =
      filters.statusFilter === 'all' ||
      (filters.statusFilter === 'pending' ? row.hasPendingCommand : row.deliveryStatus === filters.statusFilter)
    const campaignMatches = !filters.campaignId || row.campaignId === filters.campaignId
    const queryMatches = !query || `${row.id} ${row.name} ${row.campaignName} ${row.audience}`.toLowerCase().includes(query)
    return statusMatches && campaignMatches && queryMatches
  })
}

export function groupAdGroupRowsByCampaign(rows: AdGroupRow[]): AdGroupRowGroup[] {
  const groups = new Map<string, AdGroupRowGroup>()

  for (const row of rows) {
    const group = groups.get(row.campaignId) ?? { campaignId: row.campaignId, campaignName: row.campaignName, rows: [] }
    group.rows.push(row)
    groups.set(row.campaignId, group)
  }

  return Array.from(groups.values())
}

function formatAdGroupMoney(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0, style: 'currency', currency: 'THB' }).format(value)
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```bash
npm run test -- tests/adGroupsWorkspace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adGroupsWorkspace.ts tests/adGroupsWorkspace.test.ts
git commit -m "feat: add ad groups data helpers"
```

---

### Task 3: Add Approval Command Helpers

**Files:**
- Modify: `src/adGroupsWorkspace.ts`
- Modify: `tests/adGroupsWorkspace.test.ts`

- [ ] **Step 1: Write failing approval tests**

Append these tests inside the existing helper test suite in `tests/adGroupsWorkspace.test.ts`:

```ts
it('creates a pending approval command for status changes without a Meta request', () => {
  const rows = buildAdGroupRows({ adSets, ads, campaigns })
  const command = createAdGroupApprovalCommand({
    operation: 'pause_adset',
    proposedValue: 'PAUSED',
    row: rows[0],
  })

  expect(command).toEqual(expect.objectContaining({
    operation: 'pause_adset',
    status: 'pending_approval',
    targetId: 'set-1',
    targetName: 'Bangkok Core',
    parentCampaignName: 'Lead Botox',
    currentValue: 'active',
    proposedValue: 'PAUSED',
  }))
})

it('validates name and budget edits before creating commands', () => {
  expect(validateAdGroupEditDraft({ budgetText: '0', currentBudget: 700, currentName: 'Bangkok Core', nameText: 'Bangkok Core' })).toEqual({
    error: 'งบประมาณต้องมากกว่า 0 บาท',
    params: {},
  })

  expect(validateAdGroupEditDraft({ budgetText: '900', currentBudget: 700, currentName: 'Bangkok Core', nameText: 'Bangkok New' })).toEqual({
    error: '',
    params: { daily_budget: 90000, name: 'Bangkok New' },
  })
})

it('maps an approved command to the Meta request only after approval', () => {
  const row = buildAdGroupRows({ adSets, ads, campaigns })[0]
  const command = createAdGroupApprovalCommand({ operation: 'update_budget', proposedValue: { daily_budget: 90000 }, row })

  expect(adGroupApprovalCommandToMetaRequest(command)).toEqual({
    body: {
      objectId: 'set-1',
      objectType: 'adset',
      operation: 'update',
      params: { daily_budget: 90000 },
    },
    endpoint: '/api/meta/object',
  })
})
```

Update the import:

```ts
import {
  adGroupApprovalCommandToMetaRequest,
  buildAdGroupRows,
  createAdGroupApprovalCommand,
  filterAdGroupRows,
  groupAdGroupRowsByCampaign,
  validateAdGroupEditDraft,
  type AdGroupStatusFilter,
} from '../src/adGroupsWorkspace'
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- tests/adGroupsWorkspace.test.ts
```

Expected: FAIL because approval helper functions do not exist.

- [ ] **Step 3: Implement approval helpers**

Add to `src/adGroupsWorkspace.ts`:

```ts
export type AdGroupApprovalOperation = 'pause_adset' | 'resume_adset' | 'rename_adset' | 'update_budget'
export type AdGroupApprovalStatus = 'pending_approval' | 'sending' | 'synced' | 'failed' | 'cancelled'

export type AdGroupApprovalCommand = {
  id: string
  targetType: 'adset'
  targetId: string
  targetName: string
  parentCampaignId: string
  parentCampaignName: string
  operation: AdGroupApprovalOperation
  currentValue: string | number | Record<string, string | number>
  proposedValue: string | number | Record<string, string | number>
  status: AdGroupApprovalStatus
  createdAt: string
  errorMessage: string
}

export function createAdGroupApprovalCommand({
  operation,
  proposedValue,
  row,
}: {
  operation: AdGroupApprovalOperation
  proposedValue: string | number | Record<string, string | number>
  row: AdGroupRow
}): AdGroupApprovalCommand {
  return {
    id: `${operation}-${row.id}-${Date.now()}`,
    targetType: 'adset',
    targetId: row.id,
    targetName: row.name,
    parentCampaignId: row.campaignId,
    parentCampaignName: row.campaignName,
    operation,
    currentValue: operation === 'update_budget' ? row.budget : operation === 'rename_adset' ? row.name : row.deliveryStatus,
    proposedValue,
    status: 'pending_approval',
    createdAt: new Date().toISOString(),
    errorMessage: '',
  }
}

export function validateAdGroupEditDraft({
  budgetText,
  currentBudget,
  currentName,
  nameText,
}: {
  budgetText: string
  currentBudget: number
  currentName: string
  nameText: string
}): { error: string; params: Record<string, string | number> } {
  const params: Record<string, string | number> = {}
  const nextName = nameText.trim()

  if (!nextName) return { error: 'ชื่อต้องไม่ว่าง', params: {} }
  if (nextName !== currentName) params.name = nextName

  if (budgetText.trim()) {
    const budgetValue = Number(budgetText)
    if (!Number.isFinite(budgetValue) || budgetValue <= 0) return { error: 'งบประมาณต้องมากกว่า 0 บาท', params: {} }
    if (Math.round(budgetValue) !== Math.round(currentBudget)) params.daily_budget = Math.round(budgetValue * 100)
  }

  if (Object.keys(params).length === 0) return { error: 'ยังไม่มีรายการเปลี่ยนแปลงให้บันทึก', params: {} }
  return { error: '', params }
}

export function adGroupApprovalCommandToMetaRequest(command: AdGroupApprovalCommand): {
  endpoint: '/api/meta/object-status' | '/api/meta/object'
  body: Record<string, unknown>
} {
  if (command.operation === 'pause_adset' || command.operation === 'resume_adset') {
    return {
      endpoint: '/api/meta/object-status',
      body: {
        objectType: 'adset',
        objectId: command.targetId,
        status: command.proposedValue,
      },
    }
  }

  return {
    endpoint: '/api/meta/object',
    body: {
      operation: 'update',
      objectType: 'adset',
      objectId: command.targetId,
      params: command.proposedValue,
    },
  }
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm run test -- tests/adGroupsWorkspace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adGroupsWorkspace.ts tests/adGroupsWorkspace.test.ts
git commit -m "feat: add ad groups approval helpers"
```

---

### Task 4: Render The Ad Groups Split Inspector Workspace

**Files:**
- Modify: `tests/homeApp.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write failing static-render test**

Update the import in `tests/homeApp.test.tsx`:

```tsx
import App, { AdGroupsPage, AnalyticsPage, AutomationAdsPage, ReportsPage } from '../src/App'
```

Add this test near Ads Agent UI tests:

```tsx
it('renders Ad Groups as a flat Ad Set workspace with a readable inspector', () => {
  const html = renderToStaticMarkup(
    <AdGroupsPage
      adSets={[
        {
          audience: 'Bangkok',
          bookings: 10,
          budget: 700,
          campaignId: 'cmp-1',
          cpa: 35,
          deliveryStatus: 'active',
          id: 'set-1',
          name: 'Bangkok Core',
          roas: 2.2,
          spend: 350,
          status: 'healthy',
        },
      ]}
      ads={[
        { adSetId: 'set-1', bookings: 6, campaignId: 'cmp-1', clicks: 80, cpc: 2.5, creative: 'Image', ctr: 4, id: 'ad-1', impressions: 2000, leads: 12, name: 'Botox A', roas: 2.5, score: 80, showRate: 50, spend: 200, status: 'active' },
        { adSetId: 'set-1', bookings: 2, campaignId: 'cmp-1', clicks: 30, cpc: 5, creative: 'Video', ctr: 2.5, id: 'ad-2', impressions: 1200, leads: 4, name: 'Botox B', roas: 1.2, score: 50, showRate: 50, spend: 150, status: 'paused' },
      ]}
      campaigns={[{ aiTag: 'ดี', budget: 1000, conversions: 12, cpa: 33, ctr: 2.4, deliveryStatus: 'active', id: 'cmp-1', name: 'Lead Botox', revenue: 840, roas: 2.1, spend: 400, status: 'Active', tone: 'good' }]}
      onMutationComplete={async () => undefined}
    />,
  )
  const text = visibleText(html)

  expect(html).toContain('ad-groups-workspace')
  expect(text).toContain('Ad Groups')
  expect(text).toContain('ค้นหา Ad Set หรือ Campaign')
  expect(text).toContain('จัดกลุ่มตาม Campaign')
  expect(text).toContain('Bangkok Core')
  expect(text).toContain('Lead Botox')
  expect(text).toContain('2 Ads')
  expect(text).toContain('ตรวจคำสั่งก่อนส่ง Meta')
  expect(text).not.toContain('ตัวจัดการโฆษณา')
  expect(text).not.toContain('แคมเปญที่เลือก')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because the temporary skeleton page does not render the full Ad Groups workspace.

- [ ] **Step 3: Implement the static workspace**

In `src/App.tsx`, import helpers:

```tsx
import {
  buildAdGroupRows,
  filterAdGroupRows,
  groupAdGroupRowsByCampaign,
  type AdGroupRow,
  type AdGroupStatusFilter,
  type AdGroupViewMode,
} from './adGroupsWorkspace'
```

Replace the temporary skeleton `AdGroupsPage` with:

```tsx
export function AdGroupsPage({
  adSets,
  ads,
  campaigns,
  onMutationComplete,
}: {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  campaigns: Campaign[]
  onMutationComplete: () => Promise<void>
}) {
  void onMutationComplete
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdGroupStatusFilter>('all')
  const [campaignFilter, setCampaignFilter] = useState('')
  const [viewMode, setViewMode] = useState<AdGroupViewMode>('flat')
  const [selectedAdSetId, setSelectedAdSetId] = useState(adSets[0]?.id ?? '')

  const rows = useMemo(() => buildAdGroupRows({ adSets, ads, campaigns }), [adSets, ads, campaigns])
  const visibleRows = useMemo(
    () => filterAdGroupRows(rows, { campaignId: campaignFilter, searchQuery, statusFilter }),
    [campaignFilter, rows, searchQuery, statusFilter],
  )
  const groupedRows = useMemo(() => groupAdGroupRowsByCampaign(visibleRows), [visibleRows])
  const selectedRow = rows.find((row) => row.id === selectedAdSetId) ?? visibleRows[0] ?? rows[0]
  const selectedAds = selectedRow ? ads.filter((ad) => ad.adSetId === selectedRow.id) : []
  const activeCount = rows.filter((row) => row.deliveryStatus === 'active').length

  return (
    <div className="ad-groups-workspace">
      <div className="ad-groups-header">
        <div>
          <StatusBadge label="Ad Set Operations" tone="info" />
          <h2>Ad Groups</h2>
          <p>จัดการ Ad Set แบบมี approval ก่อนส่งคำสั่งไป Meta</p>
        </div>
        <div className="ad-groups-header-stats">
          <MetricLine label="Ad Set ทั้งหมด" value={`${rows.length}`} />
          <MetricLine label="เปิดอยู่" value={`${activeCount}/${rows.length}`} />
          <MetricLine label="โฆษณา" value={`${ads.length}`} />
        </div>
      </div>

      <div className="ad-groups-controls">
        <label className="search-box ad-groups-search">
          <span className="sr-only">ค้นหา Ad Set หรือ Campaign</span>
          <Search size={15} />
          <input aria-label="ค้นหา Ad Set หรือ Campaign" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        </label>
        <select aria-label="กรอง Campaign" value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}>
          <option value="">ทุก Campaign</option>
          {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select>
        <select aria-label="กรองสถานะ" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AdGroupStatusFilter)}>
          <option value="all">ทั้งหมด</option>
          <option value="active">กำลังเปิด</option>
          <option value="paused">หยุดอยู่</option>
          <option value="pending">รออนุมัติ</option>
        </select>
        <div className="segmented-control" aria-label="รูปแบบการแสดง Ad Groups">
          <button className={viewMode === 'flat' ? 'active' : ''} type="button" onClick={() => setViewMode('flat')}>รายการรวม</button>
          <button className={viewMode === 'groupedByCampaign' ? 'active' : ''} type="button" onClick={() => setViewMode('groupedByCampaign')}>จัดกลุ่มตาม Campaign</button>
        </div>
      </div>

      <div className="ad-groups-split">
        <section className="ad-groups-table-panel" aria-label="รายการ Ad Set">
          {viewMode === 'flat' ? (
            <AdGroupRows rows={visibleRows} selectedId={selectedRow?.id ?? ''} onSelect={setSelectedAdSetId} />
          ) : (
            groupedRows.map((group) => (
              <div className="ad-groups-campaign-group" key={group.campaignId}>
                <h3>{group.campaignName}</h3>
                <AdGroupRows rows={group.rows} selectedId={selectedRow?.id ?? ''} onSelect={setSelectedAdSetId} />
              </div>
            ))
          )}
        </section>
        <AdGroupInspector row={selectedRow} ads={selectedAds} />
      </div>
    </div>
  )
}
```

Add these helpers below `AdGroupsPage`:

```tsx
function AdGroupRows({ onSelect, rows, selectedId }: { onSelect: (id: string) => void; rows: AdGroupRow[]; selectedId: string }) {
  if (rows.length === 0) return <EmptyState title="ไม่พบ Ad Set" detail="ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองเพื่อดู Ad Set อีกครั้ง" />

  return (
    <div className="ad-groups-table">
      {rows.map((row) => (
        <button className={`ad-groups-row ${selectedId === row.id ? 'selected' : ''}`} key={row.id} type="button" onClick={() => onSelect(row.id)}>
          <span><StatusBadge label={deliveryLabel(row.deliveryStatus)} tone={deliveryTone(row.deliveryStatus)} /></span>
          <span><strong>{row.name}</strong><small>{row.campaignName}</small></span>
          <span>{row.budgetDisplay}</span>
          <span>{row.adsCount} Ads</span>
          <span>{fmtMoney(row.spend)} ใช้จ่าย</span>
          <span>{row.roas.toFixed(2)}x ROAS</span>
        </button>
      ))}
    </div>
  )
}

function AdGroupInspector({ ads, row }: { ads: WorkspaceData['adInsights']; row?: AdGroupRow }) {
  if (!row) return <aside className="ad-groups-inspector"><EmptyState title="ยังไม่มี Ad Set" detail="เชื่อมต่อข้อมูลหรือเปลี่ยนตัวกรองเพื่อดูรายละเอียด" /></aside>

  return (
    <aside className="ad-groups-inspector" aria-label="รายละเอียด Ad Set">
      <StatusBadge label="ตรวจคำสั่งก่อนส่ง Meta" tone="watch" />
      <h3>{row.name}</h3>
      <MetricLine label="Campaign แม่" value={row.campaignName} />
      <MetricLine label="สถานะ" value={deliveryLabel(row.deliveryStatus)} />
      <MetricLine label="งบประมาณ" value={row.budgetDisplay} />
      <MetricLine label="ใช้จ่าย" value={fmtMoney(row.spend)} />
      <MetricLine label="ผลลัพธ์" value={fmtNum(row.bookings)} />
      <MetricLine label="ROAS" value={`${row.roas.toFixed(2)}x`} />
      <div className="ad-groups-ads-summary">
        <strong>{row.adsCount} Ads</strong>
        <span>{row.activeAdsCount} เปิดอยู่ · {row.pausedAdsCount} หยุดอยู่</span>
        {ads.slice(0, 4).map((ad) => <small key={ad.id}>{ad.name} · {deliveryLabel(ad.status)}</small>)}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Add focused CSS**

Add to `src/App.css`:

```css
.ad-groups-workspace {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ad-groups-header,
.ad-groups-controls,
.ad-groups-split,
.ad-groups-inspector,
.ad-groups-table-panel {
  min-width: 0;
}

.ad-groups-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
}

.ad-groups-header-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
}

.ad-groups-controls {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(160px, auto) minmax(130px, auto) auto;
  gap: 10px;
  align-items: center;
}

.ad-groups-controls select {
  min-height: 38px;
  border: 1px solid rgba(129, 103, 72, 0.18);
  border-radius: 10px;
  background: rgba(255, 253, 249, 0.92);
  color: var(--text);
  padding: 0 12px;
}

.ad-groups-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 14px;
  align-items: start;
}

.ad-groups-table-panel,
.ad-groups-inspector {
  border: 1px solid rgba(129, 103, 72, 0.14);
  border-radius: 14px;
  background: rgba(255, 253, 249, 0.88);
  padding: 12px;
}

.ad-groups-table {
  display: grid;
  gap: 8px;
}

.ad-groups-row {
  display: grid;
  grid-template-columns: 90px minmax(180px, 1fr) 100px 80px 110px 90px;
  gap: 10px;
  align-items: center;
  width: 100%;
  min-height: 64px;
  border: 1px solid rgba(129, 103, 72, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
  color: inherit;
  padding: 10px;
  text-align: left;
}

.ad-groups-row.selected {
  border-color: rgba(180, 127, 69, 0.5);
  box-shadow: inset 3px 0 0 rgba(180, 127, 69, 0.86);
}

.ad-groups-row small,
.ad-groups-ads-summary small {
  display: block;
  color: var(--muted);
}

.ad-groups-inspector {
  position: sticky;
  top: 14px;
  display: grid;
  gap: 10px;
}

.ad-groups-ads-summary {
  display: grid;
  gap: 6px;
  border-top: 1px solid rgba(129, 103, 72, 0.12);
  padding-top: 10px;
}

@media (max-width: 980px) {
  .ad-groups-header,
  .ad-groups-controls,
  .ad-groups-split {
    grid-template-columns: 1fr;
  }

  .ad-groups-header {
    flex-direction: column;
  }

  .ad-groups-row {
    grid-template-columns: 1fr 1fr;
  }

  .ad-groups-inspector {
    position: static;
  }
}
```

- [ ] **Step 5: Run the render test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css tests/homeApp.test.tsx
git commit -m "feat: render ad groups split inspector"
```

---

### Task 5: Wire Approval-Gated Ad Set Actions

**Files:**
- Modify: `tests/homeApp.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write failing source/render tests for approval actions**

Add to `tests/homeApp.test.tsx`:

```tsx
it('keeps Ad Groups Meta writes behind approval commands', () => {
  const source = readText('../src/App.tsx')
  const adGroupsSource = source.slice(source.indexOf('export function AdGroupsPage'), source.indexOf('function AdsManagerPage'))

  expect(adGroupsSource).toContain('pendingApprovalCommand')
  expect(adGroupsSource).toContain('createAdGroupApprovalCommand')
  expect(adGroupsSource).toContain('AdGroupApprovalModal')
  expect(adGroupsSource).toContain('adGroupApprovalCommandToMetaRequest')
  expect(adGroupsSource).not.toContain('requestDelete')
})
```

Update the static-render test from Task 4 with these expectations:

```tsx
  expect(text).toContain('เปิด Ad Set')
  expect(text).toContain('ปิด Ad Set')
  expect(text).toContain('แก้งบ')
  expect(text).toContain('แก้ชื่อ')
  expect(text).toContain('ดู Ads')
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because the actions and modal are not wired.

- [ ] **Step 3: Implement local action handlers and modal**

In `src/App.tsx`, extend helper imports:

```tsx
  adGroupApprovalCommandToMetaRequest,
  createAdGroupApprovalCommand,
  validateAdGroupEditDraft,
  type AdGroupApprovalCommand,
```

Add state and handlers inside `AdGroupsPage`:

```tsx
  const [pendingApprovalCommand, setPendingApprovalCommand] = useState<AdGroupApprovalCommand | null>(null)
  const [editRow, setEditRow] = useState<AdGroupRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editBudget, setEditBudget] = useState('')
  const [approvalError, setApprovalError] = useState('')
  const [isSendingApproval, setIsSendingApproval] = useState(false)

  const openEditRow = (row: AdGroupRow) => {
    setEditRow(row)
    setEditName(row.name)
    setEditBudget(String(Math.round(row.budget)))
    setApprovalError('')
  }

  const queueStatusCommand = (row: AdGroupRow) => {
    const operation = row.deliveryStatus === 'active' ? 'pause_adset' : 'resume_adset'
    const proposedValue = row.deliveryStatus === 'active' ? 'PAUSED' : 'ACTIVE'
    setPendingApprovalCommand(createAdGroupApprovalCommand({ operation, proposedValue, row }))
  }

  const queueEditCommand = () => {
    if (!editRow) return
    const validation = validateAdGroupEditDraft({ budgetText: editBudget, currentBudget: editRow.budget, currentName: editRow.name, nameText: editName })
    if (validation.error) {
      setApprovalError(validation.error)
      return
    }

    const operation = validation.params.name && Object.keys(validation.params).length === 1 ? 'rename_adset' : 'update_budget'
    setPendingApprovalCommand(createAdGroupApprovalCommand({ operation, proposedValue: validation.params, row: editRow }))
    setEditRow(null)
  }

  const approveCommand = async () => {
    if (!pendingApprovalCommand || isSendingApproval) return
    setIsSendingApproval(true)
    setApprovalError('')

    try {
      const request = adGroupApprovalCommandToMetaRequest(pendingApprovalCommand)
      await apiJson(request.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      await onMutationComplete()
      setPendingApprovalCommand(null)
    } catch (error) {
      setApprovalError(error instanceof Error ? formatApiMessage(error.message) : 'ส่งคำสั่งไป Meta ไม่สำเร็จ')
    } finally {
      setIsSendingApproval(false)
    }
  }
```

Pass action props into `AdGroupInspector`:

```tsx
        <AdGroupInspector ads={selectedAds} row={selectedRow} onEdit={openEditRow} onStatusChange={queueStatusCommand} />
```

Update `AdGroupInspector` signature and action block:

```tsx
function AdGroupInspector({
  ads,
  onEdit,
  onStatusChange,
  row,
}: {
  ads: WorkspaceData['adInsights']
  onEdit: (row: AdGroupRow) => void
  onStatusChange: (row: AdGroupRow) => void
  row?: AdGroupRow
}) {
```

Inside the inspector after Ads summary:

```tsx
      <div className="ad-groups-action-grid">
        <button className={row.deliveryStatus === 'active' ? 'danger-button' : 'primary-button'} type="button" onClick={() => onStatusChange(row)}>
          <Power size={14} />
          {row.deliveryStatus === 'active' ? 'ปิด Ad Set' : 'เปิด Ad Set'}
        </button>
        <button className="outline-button" type="button" onClick={() => onEdit(row)}>
          <Pencil size={14} />
          แก้งบ / แก้ชื่อ
        </button>
        <button className="outline-button" type="button">
          ดู Ads
        </button>
      </div>
```

Add modals before closing `</div>` in `AdGroupsPage`:

```tsx
      {editRow ? (
        <AdGroupEditModal
          budget={editBudget}
          error={approvalError}
          name={editName}
          onCancel={() => setEditRow(null)}
          onQueue={queueEditCommand}
          row={editRow}
          setBudget={setEditBudget}
          setName={setEditName}
        />
      ) : null}
      {pendingApprovalCommand ? (
        <AdGroupApprovalModal
          command={pendingApprovalCommand}
          error={approvalError}
          isSending={isSendingApproval}
          onApprove={approveCommand}
          onCancel={() => setPendingApprovalCommand(null)}
        />
      ) : null}
```

Add modal components:

```tsx
function AdGroupEditModal({
  budget,
  error,
  name,
  onCancel,
  onQueue,
  row,
  setBudget,
  setName,
}: {
  budget: string
  error: string
  name: string
  onCancel: () => void
  onQueue: () => void
  row: AdGroupRow
  setBudget: (value: string) => void
  setName: (value: string) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ad-group-edit-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดหน้าแก้ไข"><X size={18} /></button>
        <StatusBadge label="เตรียมคำสั่ง" tone="watch" />
        <h2 id="ad-group-edit-title">แก้ไข Ad Set</h2>
        <p>การแก้ไขจะยังไม่ส่ง Meta จนกว่าจะตรวจและอนุมัติคำสั่ง</p>
        <div className="ads-edit-form">
          <label><span>ชื่อ</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>งบรายวัน (THB)</span><input inputMode="numeric" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
        </div>
        <MetricLine label="Campaign แม่" value={row.campaignName} />
        {error ? <div className="ads-operation-message">{error}</div> : null}
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel}>ยกเลิก</button>
          <button className="primary-button" type="button" onClick={onQueue}>สร้างคำสั่งรออนุมัติ</button>
        </div>
      </section>
    </div>
  )
}

function AdGroupApprovalModal({
  command,
  error,
  isSending,
  onApprove,
  onCancel,
}: {
  command: AdGroupApprovalCommand
  error: string
  isSending: boolean
  onApprove: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ad-group-approval-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการอนุมัติ" disabled={isSending}><X size={18} /></button>
        <StatusBadge label="ต้องอนุมัติก่อนส่ง Meta" tone="critical" />
        <h2 id="ad-group-approval-title">ตรวจคำสั่งก่อนส่ง Meta</h2>
        <p>คำสั่งนี้จะเปลี่ยน Ad Set จริงหลังจากกดอนุมัติเท่านั้น</p>
        <div className="confirm-grid">
          <MetricLine label="Ad Set" value={command.targetName} />
          <MetricLine label="Campaign แม่" value={command.parentCampaignName} />
          <MetricLine label="คำสั่ง" value={command.operation} />
          <MetricLine label="ค่าใหม่" value={typeof command.proposedValue === 'object' ? JSON.stringify(command.proposedValue) : String(command.proposedValue)} />
        </div>
        {error ? <div className="ads-operation-message">{error}</div> : null}
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSending}>ยกเลิก</button>
          <button className="danger-button" type="button" onClick={onApprove} disabled={isSending}>{isSending ? 'กำลังส่งคำสั่ง' : 'อนุมัติและส่ง Meta'}</button>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Add action CSS**

Add to `src/App.css`:

```css
.ad-groups-action-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.ad-groups-action-grid button {
  justify-content: center;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- tests/adGroupsWorkspace.test.ts tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css tests/homeApp.test.tsx
git commit -m "feat: gate ad groups actions behind approval"
```

---

### Task 6: Final QA, Update Logs, And Browser Verification

**Files:**
- Modify: `docs/PROJECT_UPDATES.md`
- Modify: `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test -- tests/adGroupsWorkspace.test.ts tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full checks**

Run:

```bash
npm run test
npm run lint
npm run build
```

Expected: all pass. The build may keep the existing Vite chunk-size warning; do not treat that warning as a failure.

- [ ] **Step 3: Browser QA**

Open:

```text
http://127.0.0.1:5176/ads-agent
```

Manual checks:

- Click `Ad Groups`.
- Verify the page shows `Ad Groups`, search/filter controls, flat Ad Set rows, and right Inspector.
- Verify Campaigns still opens the existing Campaign manager and does not show the new Ad Groups page.
- Verify the Inspector shows Ads count plus read-only Ads details.
- Verify action buttons open approval/edit flows and do not send Meta before approval.
- Check desktop and mobile widths for no horizontal overflow or text overlap.

- [ ] **Step 4: Update project logs**

Add this line under `2026-05-29` in `docs/PROJECT_UPDATES.md`:

```md
- Implemented the Ad Groups workspace as a dedicated Split Inspector page with Ad Set filters, read-only Ads details, and approval-gated Meta actions.
```

Add this line under `2026-05-29` in `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`:

```md
- Ad Groups implementation completed: dedicated Split Inspector workspace, Ad Set filters, read-only Ads detail summary, and approval-gated Meta actions verified locally.
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.css src/adGroupsWorkspace.ts tests/adGroupsWorkspace.test.ts tests/homeApp.test.tsx docs/PROJECT_UPDATES.md
git commit -m "feat: complete ad groups workspace"
```

---

## Self-Review

- Spec coverage: covered dedicated Ad Groups workspace, flat table, group by Campaign, search/status/campaign filters, right Inspector, Ads count/detail button area, status/name/budget actions, approval-gated Meta writes, and responsive/browser QA.
- Scope check: this plan does not implement Insights or Automation Ads.
- Type consistency: `AdGroupRow`, `AdGroupApprovalCommand`, `AdGroupStatusFilter`, and `AdGroupViewMode` are defined in `src/adGroupsWorkspace.ts` before `src/App.tsx` imports them.
- TDD check: each production-code task starts with a failing Vitest test and an expected failure.
