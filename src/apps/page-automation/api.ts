import type { AutoMode, ManagedPage, PageMessage, PostDraft, SharedAdsInsightForPage } from './types'

export type PageAutomationStatusResponse = {
  ok: boolean
  autoMode: AutoMode
  storage: 'ready' | 'unavailable'
  checkedAt: string
}

export type ManagedPagesResponse = {
  pages: ManagedPage[]
  source: 'meta' | 'cache' | 'unavailable'
}

export type PageMessagesResponse = {
  messages: PageMessage[]
  source: 'polling' | 'cache' | 'unavailable'
  checkedAt: string
}

export type AdsInsightResponse = {
  insight: SharedAdsInsightForPage | null
  source: 'ads-workspace' | 'unavailable'
}

export type PostDraftsResponse = {
  drafts: PostDraft[]
  source: 'cache' | 'unavailable'
  checkedAt: string
}

export async function pageAutomationApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Page Automation API failed (${response.status})`)
  }

  return payload as T
}

export function fetchPageAutomationStatus() {
  return pageAutomationApiJson<PageAutomationStatusResponse>('/api/page-automation/status')
}

export function updatePageAutomationStatus(autoMode: AutoMode) {
  return pageAutomationApiJson<PageAutomationStatusResponse>('/api/page-automation/status', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ autoMode }),
  })
}

export function fetchManagedPages() {
  return pageAutomationApiJson<ManagedPagesResponse>('/api/page-automation/pages')
}

export function fetchMessages() {
  return pageAutomationApiJson<PageMessagesResponse>('/api/page-automation/messages')
}

export function fetchAdsInsight(pageId: string, pageName: string) {
  const params = new URLSearchParams({ pageId, pageName, datePreset: 'last_7d' })
  return pageAutomationApiJson<AdsInsightResponse>(`/api/page-automation/ads-insights?${params}`)
}

export function fetchPostDrafts() {
  return pageAutomationApiJson<PostDraftsResponse>('/api/page-automation/post-drafts')
}

export function createPostDraft(draft: PostDraft) {
  return pageAutomationApiJson<{ ok: true }>('/api/page-automation/post-drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
}
