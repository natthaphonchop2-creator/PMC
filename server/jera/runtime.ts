import type { MiniAppSheetsPort } from '../pmc-mini-app/googleClient.js'
import { google } from 'googleapis'
import { createJeraReadClient } from './client.js'
import { readJeraConfig, type JeraConfig } from './config.js'
import { createJeraMiniAppApi, type JeraMiniAppApi, type JeraSchedulerIdentityPort } from './middleware.js'
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
    refreshIntervalMinutes: input.config.syncIntervalMinutes,
    staleAfterMs: input.config.syncIntervalMinutes * 2 * 60_000,
  })
  const schedulerIdentity = input.config.scheduler ? createGoogleSchedulerIdentity() : null
  const api = createJeraMiniAppApi({
    coordinator, store, defaultBranchUuid: input.config.defaultBranchUuid,
    ...(input.config.scheduler && schedulerIdentity ? {
      scheduler: {
        identity: schedulerIdentity,
        audience: input.config.scheduler.audience,
        serviceAccountEmail: input.config.scheduler.serviceAccountEmail,
      },
    } : {}),
  })
  return { config: input.config, coordinator, store, api }
}

function createGoogleSchedulerIdentity(): JeraSchedulerIdentityPort {
  const verifier = new google.auth.OAuth2()
  return {
    async verify(idToken, audience) {
      const ticket = await verifier.verifyIdToken({ idToken, audience })
      const payload = ticket.getPayload()
      if (!payload?.email) throw new Error('invalid scheduler identity')
      return { email: payload.email, emailVerified: payload.email_verified === true }
    },
  }
}
