import { StrictMode, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { PmcMiniApp } from './PmcMiniApp'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('Mini App root element is missing')

async function previewProps(): Promise<ComponentProps<typeof PmcMiniApp>> {
  if (!import.meta.env.DEV) return {}
  const previewMode = new URLSearchParams(window.location.search).get('preview')
  if (previewMode !== '1' && previewMode !== 'unknown') return {}
  const previewModulePath = ['./preview', '.ts'].join('')
  const preview = await import(/* @vite-ignore */ previewModulePath)
  if (previewMode === 'unknown') return { api: preview.createPreviewMiniAppApi({ staffAllowed: false }) }
  const search = new URLSearchParams(window.location.search)
  const reportingEnabled = search.get('reports') === 'enabled'
  const financeReportsEnabled = search.get('finance') === 'enabled'
  const financeUiPreviewEnabled = search.get('finance-preview') === 'enabled'
  const stockEnabled = search.get('stock') === 'enabled'
  const canManageStock = search.get('role') === 'manager'
  const expenseCaptureEnabled = search.get('expense') === 'enabled'
  const financeReadsEnabled = search.get('finance-reads') === 'enabled'
  const role = search.get('role')
  const canViewFinance = role === 'finance' || role === 'manager'
  const canSubmitExpense = expenseCaptureEnabled && (role === 'staff' || role === 'finance' || role === 'manager')
  const canManageExpense = role === 'manager'
  const expenseScenario = search.get('expense-scenario') === 'lost-first-submit'
    ? 'lost-first-submit' as const
    : undefined
  return {
    initialSession: preview.PREVIEW_SESSION,
    initialConfig: preview.createPreviewMiniAppConfig({
      reportingEnabled, financeReportsEnabled, financeUiPreviewEnabled, canViewFinance, stockEnabled, canManageStock,
      expenseCaptureEnabled, financeReadsEnabled, canSubmitExpense, canManageExpense,
    }),
    api: preview.createPreviewMiniAppApi({
      reportingEnabled, financeReportsEnabled, financeUiPreviewEnabled, canViewFinance, stockEnabled, canManageStock,
      expenseCaptureEnabled, financeReadsEnabled, canSubmitExpense, canManageExpense, expenseScenario,
    }),
  }
}

void previewProps().then((props) => {
  createRoot(root).render(
    <StrictMode>
      <PmcMiniApp {...props} />
    </StrictMode>,
  )
})
