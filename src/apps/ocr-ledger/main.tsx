import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { OcrReviewApp } from './OcrReviewApp'

createRoot(document.getElementById('root')!).render(<StrictMode><OcrReviewApp /></StrictMode>)
