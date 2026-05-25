export type HomeStatusState = 'loading' | 'connected' | 'ready' | 'setup' | 'unavailable'

export type HomeToolId = 'ads' | 'page' | 'settings' | 'crm' | 'erp' | 'knowledge' | 'website' | 'reports'

export type HomeRouteState = 'enabled' | 'modal' | 'setup' | 'coming-soon'
export type HomeIconTone = 'sand' | 'coral' | 'lavender' | 'blue' | 'green' | 'gold' | 'purple' | 'neutral'
export type HomeRisk = 'สูง' | 'ปานกลาง' | 'ต่ำ'

export type HomeSystemStatus = {
  id: string
  label: string
  state: HomeStatusState
  value: string
}

export type HomePriority = {
  id: string
  actionLabel: 'Review' | 'Open'
  confidence: number
  href: string
  iconTone: 'blue' | 'green' | 'purple' | 'orange'
  risk: HomeRisk
  source: string
  sourceLabel: string
  title: string
}

export type HomeTool = {
  id: HomeToolId
  href: string
  iconTone: HomeIconTone
  routeState: HomeRouteState
  setupLabel?: string
  status: HomeStatusState
  statusText: string
  title: string
}

export type HomeActivity = {
  id: string
  label: string
  source: string
  time: string
}

export type HomeSnapshot = {
  activities: HomeActivity[]
  headerStatuses: HomeSystemStatus[]
  priorities: HomePriority[]
  systemStatuses: HomeSystemStatus[]
  tools: HomeTool[]
}
