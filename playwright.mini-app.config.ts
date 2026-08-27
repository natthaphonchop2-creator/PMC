import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/pmc-mini-app',
  testMatch: 'browserAcceptance.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  webServer: {
    command: 'node tests/pmc-mini-app/localServer.mjs',
    url: 'http://127.0.0.1:4187/mini-app/?preview=1',
    timeout: 30_000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:4187',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
