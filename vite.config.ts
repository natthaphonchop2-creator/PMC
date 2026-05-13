import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createMetaApiPlugin } from './server/metaApiPlugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), createMetaApiPlugin(env)],
  }
})
