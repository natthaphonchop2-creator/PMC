import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PmcMiniApp } from './PmcMiniApp'
import { createPreviewMiniAppApi, PREVIEW_CONFIG, PREVIEW_SESSION } from './preview'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('Mini App root element is missing')

const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1'

createRoot(root).render(
  <StrictMode>
    <PmcMiniApp
      {...(preview ? { initialSession: PREVIEW_SESSION, initialConfig: PREVIEW_CONFIG, api: createPreviewMiniAppApi() } : {})}
    />
  </StrictMode>,
)
