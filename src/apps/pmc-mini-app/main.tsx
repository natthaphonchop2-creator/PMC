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
  return {
    initialSession: preview.PREVIEW_SESSION,
    initialConfig: preview.PREVIEW_CONFIG,
    api: preview.createPreviewMiniAppApi(),
  }
}

void previewProps().then((props) => {
  createRoot(root).render(
    <StrictMode>
      <PmcMiniApp {...props} />
    </StrictMode>,
  )
})
