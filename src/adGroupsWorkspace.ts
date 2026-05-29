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
