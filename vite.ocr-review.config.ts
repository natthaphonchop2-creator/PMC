import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'src/apps/ocr-ledger'),
  base: '/ocr-review/',
  plugins: [react()],
  build: { outDir: resolve(process.cwd(), 'dist/ocr-review'), emptyOutDir: true },
})
