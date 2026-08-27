import type { MiniAppSheetsPort } from '../pmc-mini-app/googleClient.js'
import { createJeraReadClient } from './client.js'
import { readJeraConfig, type JeraConfig } from './config.js'
import { createJeraMiniAppApi, type JeraMiniAppApi } from './middleware.js'
import { createGoogleJeraReportStore, type JeraReportStore } from './store.js'
import { createJeraSyncCoordinator, type JeraSyncCoordinator } from './syncCoordinator.js'
import { createJeraTokenClient } from './tokenClient.js'

export interface JeraRuntime {
  config: JeraConfig
  coordinator: JeraSyncCoordinator
  store: JeraReportStore
  api: JeraMiniAppApi
}

export type JeraRuntimeConstructor = (input: {
  config: JeraConfig
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}) => JeraRuntime

export function createJeraRuntime(
  env: NodeJS.ProcessEnv,
  google: { spreadsheetId: string; sheets: MiniAppSheetsPort },
  construct: JeraRuntimeConstructor = constructJeraRuntime,
): JeraRuntime | undefined {
  try {
    const config = readJeraConfig(env)
    if (!config) return undefined
    return construct({ config, spreadsheetId: google.spreadsheetId, sheets: google.sheets })
  } catch {
    return undefined
  }
}

function constructJeraRuntime(input: {
  config: JeraConfig
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): JeraRuntime {
  const tokens = createJeraTokenClient(input.config)
  const client = createJeraReadClient(input.config, tokens)
  const store = createGoogleJeraReportStore({ spreadsheetId: input.spreadsheetId, sheets: input.sheets })
  const coordinator = createJeraSyncCoordinator({
    client, store, manualRefreshSeconds: input.config.manualRefreshSeconds,
    staleAfterMs: input.config.syncIntervalMinutes * 2 * 60_000,
  })
  const api = createJeraMiniAppApi({
    coordinator, store, defaultBranchUuid: input.config.defaultBranchUuid,
  })
  return { config: input.config, coordinator, store, api }
}
