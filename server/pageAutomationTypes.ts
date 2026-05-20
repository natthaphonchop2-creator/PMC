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
