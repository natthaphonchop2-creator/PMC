import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createMetaApiPlugin } from './server/metaApiPlugin'
import { createOpenAiPlugin } from './server/openAiPlugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), createMetaApiPlugin(env), createOpenAiPlugin(env)],
  }
})
