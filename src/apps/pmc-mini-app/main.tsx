import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PmcMiniApp } from './PmcMiniApp'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('Mini App root element is missing')

createRoot(root).render(
  <StrictMode>
    <PmcMiniApp />
  </StrictMode>,
)
