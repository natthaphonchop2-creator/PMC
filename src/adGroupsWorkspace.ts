import type { WorkspaceData } from './types'

export type AdGroupStatusFilter = 'all' | 'active' | 'paused' | 'pending'
export type AdGroupViewMode = 'flat' | 'groupedByCampaign'
export type AdGroupApprovalOperation = 'pause_adset' | 'resume_adset' | 'rename_adset' | 'update_budget'
export type AdGroupApprovalStatus = 'pending_approval' | 'sending' | 'synced' | 'failed' | 'cancelled'
export type AdGroupStatusProposedValue = 'PAUSED' | 'ACTIVE'
type PauseAdGroupStatusProposedValue = 'PAUSED'
type ResumeAdGroupStatusProposedValue = 'ACTIVE'
export type AdGroupUpdateParams = {
  daily_budget?: number
  name?: string
}

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

type AdGroupApprovalCommandBase = {
  id: string
  status: AdGroupApprovalStatus
  targetId: string
  targetType: 'adset'
  targetName: string
  parentCampaignId: string
  parentCampaignName: string
  currentValue: string | number
  errorMessage: string
  createdAt: string
}

export type AdGroupApprovalCommand =
  | (AdGroupApprovalCommandBase & { operation: 'pause_adset'; proposedValue: PauseAdGroupStatusProposedValue })
  | (AdGroupApprovalCommandBase & { operation: 'resume_adset'; proposedValue: ResumeAdGroupStatusProposedValue })
  | (AdGroupApprovalCommandBase & { operation: 'rename_adset'; proposedValue: { name: string } })
  | (AdGroupApprovalCommandBase & { operation: 'update_budget'; proposedValue: AdGroupUpdateParams })

export type CreateAdGroupApprovalCommandInput =
  | { operation: 'pause_adset'; proposedValue: PauseAdGroupStatusProposedValue; row: AdGroupRow }
  | { operation: 'resume_adset'; proposedValue: ResumeAdGroupStatusProposedValue; row: AdGroupRow }
  | { operation: 'rename_adset'; proposedValue: { name: string }; row: AdGroupRow }
  | { operation: 'update_budget'; proposedValue: AdGroupUpdateParams; row: AdGroupRow }

type PauseAdGroupApprovalCommand = Extract<AdGroupApprovalCommand, { operation: 'pause_adset' }>
type ResumeAdGroupApprovalCommand = Extract<AdGroupApprovalCommand, { operation: 'resume_adset' }>
type AssertAssignable<AssignedValue extends TargetValue, TargetValue> = AssignedValue

// @ts-expect-error pause commands must only propose PAUSED
type InvalidPauseAdGroupStatusProposedValue = AssertAssignable<'ACTIVE', PauseAdGroupApprovalCommand['proposedValue']>
// @ts-expect-error resume commands must only propose ACTIVE
type InvalidResumeAdGroupStatusProposedValue = AssertAssignable<'PAUSED', ResumeAdGroupApprovalCommand['proposedValue']>

export type AdGroupApprovalCommandCompileTimeChecks = [
  InvalidPauseAdGroupStatusProposedValue,
  InvalidResumeAdGroupStatusProposedValue,
]

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

export function createAdGroupApprovalCommand({
  operation,
  proposedValue,
  row,
}: CreateAdGroupApprovalCommandInput): AdGroupApprovalCommand {
  const base: Omit<AdGroupApprovalCommandBase, 'currentValue'> = {
    id: createApprovalCommandId(),
    status: 'pending_approval',
    targetId: row.id,
    targetType: 'adset',
    targetName: row.name,
    parentCampaignId: row.campaignId,
    parentCampaignName: row.campaignName,
    errorMessage: '',
    createdAt: new Date().toISOString(),
  }

  if (operation === 'rename_adset') {
    return { ...base, operation, currentValue: row.name, proposedValue }
  }

  if (operation === 'update_budget') {
    return { ...base, operation, currentValue: row.budget, proposedValue }
  }

  if (operation === 'pause_adset') {
    return { ...base, operation, currentValue: row.deliveryStatus, proposedValue }
  }

  return { ...base, operation, currentValue: row.deliveryStatus, proposedValue }
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
}): { error: string; params: { daily_budget?: number; name?: string } } {
  const params: { daily_budget?: number; name?: string } = {}
  const name = nameText.trim()

  if (!name) {
    return { error: 'ชื่อต้องไม่ว่าง', params: {} }
  }

  const trimmedBudgetText = budgetText.trim()
  if (trimmedBudgetText) {
    const budget = Number(trimmedBudgetText)

    if (!Number.isFinite(budget) || budget <= 0) {
      return { error: 'งบประมาณต้องมากกว่า 0 บาท', params: {} }
    }

    if (budget !== currentBudget) {
      const dailyBudget = Math.round(budget * 100)
      if (dailyBudget < 100) {
        return { error: 'งบประมาณต้องมากกว่า 0 บาท', params: {} }
      }

      params.daily_budget = dailyBudget
    }
  }

  if (name !== currentName) {
    params.name = name
  }

  if (Object.keys(params).length === 0) {
    return { error: 'ยังไม่มีรายการเปลี่ยนแปลงให้บันทึก', params: {} }
  }

  return { error: '', params }
}

export function adGroupApprovalCommandToMetaRequest(command: AdGroupApprovalCommand): {
  endpoint: '/api/meta/object' | '/api/meta/object-status'
  body:
    | { objectId: string; objectType: 'adset'; operation: 'update'; params: AdGroupUpdateParams }
    | { objectId: string; objectType: 'adset'; status: AdGroupStatusProposedValue }
} {
  if (command.operation === 'pause_adset' || command.operation === 'resume_adset') {
    return {
      endpoint: '/api/meta/object-status',
      body: {
        objectId: command.targetId,
        objectType: 'adset',
        status: command.proposedValue,
      },
    }
  }

  return {
    endpoint: '/api/meta/object',
    body: {
      objectId: command.targetId,
      objectType: 'adset',
      operation: 'update',
      params: adGroupApprovalCommandToMetaParams(command),
    },
  }
}

function formatAdGroupMoney(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0, style: 'currency', currency: 'THB' }).format(value)
}

function createApprovalCommandId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `adgroup-command-${Date.now()}`
}

function adGroupApprovalCommandToMetaParams(
  command: Extract<AdGroupApprovalCommand, { operation: 'rename_adset' | 'update_budget' }>,
): AdGroupUpdateParams {
  return command.proposedValue
}
