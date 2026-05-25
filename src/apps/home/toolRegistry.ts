import type { HomeIconTone, HomeStatusState, HomeTool, HomeToolId } from './types'

type HomeToolDefinition = {
  id: HomeToolId
  href: string
  iconTone: HomeIconTone
  routeState: HomeTool['routeState']
  setupLabel?: string
  title: string
}

export const homeToolDefinitions: HomeToolDefinition[] = [
  { id: 'ads', href: '/ads-agent', iconTone: 'sand', routeState: 'enabled', title: 'Ads Agent' },
  { id: 'page', href: '/page-automation', iconTone: 'coral', routeState: 'enabled', title: 'Page Auto' },
  { id: 'settings', href: '#settings', iconTone: 'neutral', routeState: 'modal', title: 'Settings' },
  { id: 'crm', href: '#crm', iconTone: 'lavender', routeState: 'setup', setupLabel: 'ยังไม่ได้เชื่อมต่อระบบ CRM', title: 'CRM' },
  { id: 'erp', href: '#erp', iconTone: 'blue', routeState: 'coming-soon', setupLabel: 'กำลังเตรียมโมดูล ERP', title: 'ERP' },
  { id: 'knowledge', href: '#knowledge', iconTone: 'green', routeState: 'setup', setupLabel: 'รอตั้งค่าฐานความรู้', title: 'Knowledge' },
  { id: 'website', href: '#website-insight', iconTone: 'gold', routeState: 'coming-soon', setupLabel: 'กำลังเตรียมข้อมูลเว็บไซต์', title: 'Website' },
  { id: 'reports', href: '#reports', iconTone: 'purple', routeState: 'coming-soon', setupLabel: 'กำลังเตรียมรายงานรวม', title: 'Reports' },
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
