import { describe, expect, it } from 'vitest'
import {
  buildAdGroupRows,
  adGroupApprovalCommandToMetaRequest,
  createAdGroupApprovalCommand,
  filterAdGroupRows,
  groupAdGroupRowsByCampaign,
  validateAdGroupEditDraft,
  type AdGroupApprovalCommand,
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

  it('creates pending approval commands for Ad Set operations', () => {
    const [row] = buildAdGroupRows({ adSets, ads, campaigns })

    expect(createAdGroupApprovalCommand({ operation: 'pause_adset', proposedValue: 'PAUSED', row })).toEqual(expect.objectContaining({
      operation: 'pause_adset',
      status: 'pending_approval',
      targetId: 'set-1',
      targetType: 'adset',
      targetName: 'Bangkok Core',
      parentCampaignId: 'cmp-1',
      parentCampaignName: 'Lead Botox',
      currentValue: 'active',
      proposedValue: 'PAUSED',
      errorMessage: '',
    }))
  })

  it('validates Ad Set edit drafts into Meta params', () => {
    expect(validateAdGroupEditDraft({
      budgetText: '0',
      currentBudget: 700,
      currentName: 'Bangkok Core',
      nameText: 'Bangkok Core',
    })).toEqual({ error: 'งบประมาณต้องมากกว่า 0 บาท', params: {} })

    expect(validateAdGroupEditDraft({
      budgetText: '900',
      currentBudget: 700,
      currentName: 'Bangkok Core',
      nameText: 'Bangkok New',
    })).toEqual({ error: '', params: { daily_budget: 90000, name: 'Bangkok New' } })

    expect(validateAdGroupEditDraft({
      budgetText: '0.004',
      currentBudget: 700,
      currentName: 'Bangkok Core',
      nameText: 'Bangkok Core',
    })).toEqual({ error: 'งบประมาณต้องมากกว่า 0 บาท', params: {} })
  })

  it('validates Ad Set edit draft edge cases', () => {
    expect(validateAdGroupEditDraft({
      budgetText: '900',
      currentBudget: 700,
      currentName: 'Bangkok Core',
      nameText: '   ',
    })).toEqual({ error: 'ชื่อต้องไม่ว่าง', params: {} })

    expect(validateAdGroupEditDraft({
      budgetText: '',
      currentBudget: 700,
      currentName: 'Bangkok Core',
      nameText: 'Bangkok Core',
    })).toEqual({ error: 'ยังไม่มีรายการเปลี่ยนแปลงให้บันทึก', params: {} })

    expect(validateAdGroupEditDraft({
      budgetText: '   ',
      currentBudget: 700,
      currentName: 'Bangkok Core',
      nameText: 'Bangkok New',
    })).toEqual({ error: '', params: { name: 'Bangkok New' } })
  })

  it('converts approval commands to Meta object requests', () => {
    const [row] = buildAdGroupRows({ adSets, ads, campaigns })
    const command = createAdGroupApprovalCommand({ operation: 'update_budget', proposedValue: { daily_budget: 90000 }, row })

    expect(adGroupApprovalCommandToMetaRequest(command)).toEqual({
      endpoint: '/api/meta/object',
      body: {
        objectId: 'set-1',
        objectType: 'adset',
        operation: 'update',
        params: { daily_budget: 90000 },
      },
    })
  })

  it('converts pause and resume commands to Meta status requests', () => {
    const rows = buildAdGroupRows({ adSets, ads, campaigns })
    const pauseCommand = createAdGroupApprovalCommand({ operation: 'pause_adset', proposedValue: 'PAUSED', row: rows[0] })
    const resumeCommand = createAdGroupApprovalCommand({ operation: 'resume_adset', proposedValue: 'ACTIVE', row: rows[1] })

    expect(adGroupApprovalCommandToMetaRequest(pauseCommand)).toEqual({
      endpoint: '/api/meta/object-status',
      body: {
        objectId: 'set-1',
        objectType: 'adset',
        status: 'PAUSED',
      },
    })
    expect(adGroupApprovalCommandToMetaRequest(resumeCommand)).toEqual({
      endpoint: '/api/meta/object-status',
      body: {
        objectId: 'set-2',
        objectType: 'adset',
        status: 'ACTIVE',
      },
    })
  })

  it('keeps approval command proposed values operation-safe', () => {
    expect(statusProposedValue).toBe('PAUSED')
    expect(renameProposedValue).toEqual({ name: 'Bangkok New' })
    expect(updateBudgetProposedValue).toEqual({ daily_budget: 90000, name: 'Bangkok New' })
  })
})

type PauseCommand = Extract<AdGroupApprovalCommand, { operation: 'pause_adset' }>
type ResumeCommand = Extract<AdGroupApprovalCommand, { operation: 'resume_adset' }>
type RenameCommand = Extract<AdGroupApprovalCommand, { operation: 'rename_adset' }>
type UpdateBudgetCommand = Extract<AdGroupApprovalCommand, { operation: 'update_budget' }>

const statusProposedValue: PauseCommand['proposedValue'] = 'PAUSED'
const resumeStatusProposedValue: ResumeCommand['proposedValue'] = 'ACTIVE'
const renameProposedValue: RenameCommand['proposedValue'] = { name: 'Bangkok New' }
const updateBudgetProposedValue: UpdateBudgetCommand['proposedValue'] = { daily_budget: 90000, name: 'Bangkok New' }

// @ts-expect-error pause commands must only propose PAUSED
const invalidPauseStatusProposedValue: PauseCommand['proposedValue'] = 'ACTIVE'
// @ts-expect-error resume commands must only propose ACTIVE
const invalidResumeStatusProposedValue: ResumeCommand['proposedValue'] = 'PAUSED'
// @ts-expect-error status commands must not accept params objects
const invalidStatusProposedValue: PauseCommand['proposedValue'] = { status: 'PAUSED' }
// @ts-expect-error rename commands must not accept a raw string
const invalidRenameProposedValue: RenameCommand['proposedValue'] = 'Bangkok New'
// @ts-expect-error update-budget commands must not accept a raw number
const invalidUpdateBudgetProposedValue: UpdateBudgetCommand['proposedValue'] = 90000

void invalidStatusProposedValue
void resumeStatusProposedValue
void invalidPauseStatusProposedValue
void invalidResumeStatusProposedValue
void invalidRenameProposedValue
void invalidUpdateBudgetProposedValue
