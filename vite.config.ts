import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { createMetaApiPlugin } from './server/metaApiPlugin'
import { createOpenAiPlugin } from './server/openAiPlugin'
import { createPageAutomationPlugin } from './server/pageAutomationPlugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), createMetaApiPlugin(env), createOpenAiPlugin(env), createPageAutomationPlugin(env)],
    test: {
      exclude: [...configDefaults.exclude, '**/.worktrees/**', '**/browserAcceptance.spec.ts'],
    },
  }
})
