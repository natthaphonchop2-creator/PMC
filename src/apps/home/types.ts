export type HomeStatusState = 'loading' | 'connected' | 'ready' | 'setup' | 'unavailable'

export type HomeToolId = 'ads' | 'page' | 'erp' | 'crm' | 'website' | 'knowledge'

export type HomeRouteState = 'enabled' | 'setup' | 'disabled'

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
  iconTone: 'blue' | 'green' | 'purple' | 'orange'
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
