import type { HomeStatusState, HomeTool, HomeToolId } from './types'

type HomeToolDefinition = {
  id: HomeToolId
  href: string
  iconTone: HomeTool['iconTone']
  routeState: HomeTool['routeState']
  setupLabel?: string
  title: string
}

export const homeToolDefinitions: HomeToolDefinition[] = [
  { id: 'ads', href: '/ads-agent', iconTone: 'blue', routeState: 'enabled', title: 'Ads Agent' },
  { id: 'page', href: '/page-automation', iconTone: 'green', routeState: 'enabled', title: 'Page Automation' },
  { id: 'erp', href: '#erp', iconTone: 'orange', routeState: 'setup', setupLabel: 'ยังไม่มี ERP connector', title: 'ERP' },
  { id: 'crm', href: '#crm', iconTone: 'purple', routeState: 'setup', setupLabel: 'ยังไม่มี CRM connector', title: 'CRM' },
  { id: 'website', href: '#website-insight', iconTone: 'blue', routeState: 'setup', setupLabel: 'ยังไม่มี Website Insight connector', title: 'Website Insight' },
  { id: 'knowledge', href: '#knowledge', iconTone: 'green', routeState: 'setup', setupLabel: 'รอออกแบบ RAG workflow', title: 'Knowledge' },
]

export function buildHomeTool(definition: HomeToolDefinition, state: HomeStatusState, statusText: string): HomeTool {
  return {
    id: definition.id,
    href: definition.href,
    iconTone: definition.iconTone,
    routeState: definition.routeState,
    setupLabel: definition.setupLabel,
    status: state,
    statusText,
    title: definition.title,
  }
}
