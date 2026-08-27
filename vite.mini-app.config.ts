import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'src/apps/pmc-mini-app'),
  base: '/mini-app/',
  plugins: [react()],
  build: {
    outDir: resolve(process.cwd(), 'dist/mini-app'),
    emptyOutDir: true,
  },
})
