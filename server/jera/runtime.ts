import type { MiniAppSheetsPort } from '../pmc-mini-app/googleClient.js'
import { google } from 'googleapis'
import { createJeraReadClient } from './client.js'
import { readJeraConfig, type JeraConfig } from './config.js'
import { createJeraMiniAppApi, type JeraMiniAppApi, type JeraSchedulerIdentityPort } from './middleware.js'
import { createGoogleJeraReportStore, type JeraReportStore } from './store.js'
import { createJeraSyncCoordinator, type JeraSyncCoordinator } from './syncCoordinator.js'
import { createJeraTokenClient } from './tokenClient.js'
import { createGoogleJeraAllocationStore } from './allocationStore.js'
import { createGoogleJeraAllocationLeasePort } from './allocationLeaseStore.js'
import { createGoogleJeraAllocationTaskQueue } from './allocationTaskQueue.js'
import { createJeraAllocationWorker, type JeraAllocationWorker } from './allocationWorker.js'
import { createJeraFinanceService, type JeraFinanceService } from './financeService.js'

export interface JeraRuntime {
  config: JeraConfig
  coordinator: JeraSyncCoordinator
  store: JeraReportStore
  api: JeraMiniAppApi
  allocationWorker: JeraAllocationWorker | null
  financeService: JeraFinanceService | null
}

export type JeraRuntimeConstructor = (input: {
  config: JeraConfig
  spreadsheetId: string
  sheets: MiniAppSheetsPort
  categoryMoneyEnabled: boolean
}) => JeraRuntime

export function createJeraRuntime(
  env: NodeJS.ProcessEnv,
  google: { spreadsheetId: string; sheets: MiniAppSheetsPort },
  construct: JeraRuntimeConstructor = constructJeraRuntime,
): JeraRuntime | undefined {
  try {
    const config = readJeraConfig(env)
    if (!config) return undefined
    return construct({
      config, spreadsheetId: google.spreadsheetId, sheets: google.sheets,
      categoryMoneyEnabled: env.JERA_FINANCE_CATEGORY_MONEY_ENABLED === 'true',
    })
  } catch {
    return undefined
  }
}

function constructJeraRuntime(input: {
  config: JeraConfig
  spreadsheetId: string
  sheets: MiniAppSheetsPort
  categoryMoneyEnabled: boolean
}): JeraRuntime {
  const tokens = createJeraTokenClient(input.config)
  const client = createJeraReadClient(input.config, tokens)
  const store = createGoogleJeraReportStore({ spreadsheetId: input.spreadsheetId, sheets: input.sheets })
  const coordinator = createJeraSyncCoordinator({
    client, store, manualRefreshSeconds: input.config.manualRefreshSeconds,
    staleAfterMs: input.config.syncIntervalMinutes * 2 * 60_000,
  })
  const schedulerIdentity = input.config.scheduler ? createGoogleSchedulerIdentity() : null
  const allocationStore = input.config.allocation
    ? createGoogleJeraAllocationStore({ spreadsheetId: input.spreadsheetId, sheets: input.sheets })
    : null
  const allocationQueue = input.config.allocation ? createGoogleJeraAllocationTaskQueue({
    projectId: input.config.allocation.projectId,
    location: input.config.allocation.location,
    queueName: input.config.allocation.queueName,
    workerUrl: input.config.allocation.workerUrl,
    workerAudience: input.config.allocation.workerAudience,
    taskInvokerEmail: input.config.allocation.taskInvokerEmail,
  }) : null
  const allocationLease = input.config.allocation
    ? createGoogleJeraAllocationLeasePort({ bucketName: input.config.allocation.leaseBucket })
    : null
  const allocationWorker = input.config.allocation ? createJeraAllocationWorker({
    client: createJeraReadClient(input.config, tokens, { mode: 'INTERACTIVE', replayUnauthorized: false }),
    reportStore: store,
    allocationStore: allocationStore!,
    lease: allocationLease!,
    queue: allocationQueue!,
    maxDetailsPerRun: input.config.allocation.maxDetailsPerRun,
    continuationDelaySeconds: input.config.allocation.continuationDelaySeconds,
  }) : null
  const financeService = allocationStore && allocationQueue ? createJeraFinanceService({
    coordinator, allocationStore, allocationQueue, lease: allocationLease!, categoryMoneyEnabled: input.categoryMoneyEnabled,
  }) : null
  const allocationIdentity = allocationWorker ? createGoogleSchedulerIdentity() : null
  const api = createJeraMiniAppApi({
    coordinator, store, defaultBranchUuid: input.config.defaultBranchUuid,
    ...(input.config.scheduler && schedulerIdentity ? {
      scheduler: {
        identity: schedulerIdentity,
        audience: input.config.scheduler.audience,
        serviceAccountEmail: input.config.scheduler.serviceAccountEmail,
      },
    } : {}),
    ...(input.config.allocation && allocationWorker && allocationIdentity ? {
      allocation: {
        worker: allocationWorker,
        identity: allocationIdentity,
        audience: input.config.allocation.workerAudience,
        serviceAccountEmail: input.config.allocation.taskInvokerEmail,
      },
      ...(financeService ? {
        finance: {
          service: financeService,
          seed: {
            identity: allocationIdentity,
            audience: input.config.allocation.workerAudience,
            serviceAccountEmail: input.config.allocation.taskInvokerEmail,
            schedulerId: 'finance-daily-seed',
          },
        },
      } : {}),
    } : {}),
  })
  return { config: input.config, coordinator, store, api, allocationWorker, financeService }
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
