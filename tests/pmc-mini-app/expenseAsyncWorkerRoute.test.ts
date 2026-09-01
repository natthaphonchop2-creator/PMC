import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { FinanceServerDependencies } from '../../server/pmc-mini-app/contracts'
import { ExpenseAsyncWorkerError, type ExpenseAsyncWorker } from '../../server/pmc-mini-app/finance/asyncWorker'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppStore } from '../../server/pmc-mini-app/store'

const ROUTE = '/internal/mini-app/finalize-expense'
const BODY = { rootRequestId: 'expense-root-1', fingerprint: 'a'.repeat(64) }

describe('expense async worker route', () => {
  it('authenticates the private worker identity before parsing task input', async () => {
    const deps = dependencies()
    vi.mocked(deps.finance.async!.identity.verify).mockRejectedValueOnce(new Error('private detail'))

    const response = await invoke(createPmcMiniAppMiddleware(deps), {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token', 'content-type': 'text/plain' },
      body: 'not-json',
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 401, body: { error: 'EXPENSE_ASYNC_WORKER_UNAUTHORIZED' },
    })
    expect(deps.finance.async!.worker.finalize).not.toHaveBeenCalled()
  })

  it.each([
    ['missing retry count', undefined, BODY, 400, 'EXPENSE_ASYNC_WORKER_INVALID_RETRY_COUNT'],
    ['malformed body', '0', '{', 400, 'EXPENSE_ASYNC_WORKER_INVALID_JSON'],
    ['extra field', '0', { ...BODY, amountSatang: 10_000 }, 400, 'EXPENSE_ASYNC_WORKER_INVALID_BODY'],
    ['bad fingerprint', '0', { ...BODY, fingerprint: 'bad' }, 400, 'EXPENSE_ASYNC_WORKER_INVALID_BODY'],
  ] as const)('rejects %s without finalizing', async (_case, retryCount, body, status, error) => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-worker-token',
        'content-type': 'application/json',
        ...(retryCount === undefined ? {} : { 'x-cloudtasks-taskretrycount': retryCount }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

    expect({ status: response.status, body: await response.json() }).toEqual({ status, body: { error } })
    expect(deps.finance.async!.worker.finalize).not.toHaveBeenCalled()
  })

  it('returns 503 for a retryable worker outcome', async () => {
    const deps = dependencies()
    vi.mocked(deps.finance.async!.worker.finalize).mockRejectedValueOnce(
      new ExpenseAsyncWorkerError('EXPENSE_ASYNC_WORKER_RETRY'),
    )

    const response = await invoke(createPmcMiniAppMiddleware(deps), workerRequest('3'))

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 503, body: { error: 'EXPENSE_ASYNC_WORKER_FAILED' },
    })
    expect(deps.finance.async!.worker.finalize).toHaveBeenCalledWith({ ...BODY, attempt: 3 })
  })

  it.each(['COMMITTED', 'FAILED', 'NEEDS_REVIEW'] as const)(
    'returns 200 for terminal %s only', async (state) => {
      const deps = dependencies()
      vi.mocked(deps.finance.async!.worker.finalize).mockResolvedValueOnce({
        rootRequestId: BODY.rootRequestId, state,
      })

      const response = await invoke(createPmcMiniAppMiddleware(deps), workerRequest('7'))

      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200, body: { rootRequestId: BODY.rootRequestId, state },
      })
    },
  )
})

function dependencies(): {
  config: PmcMiniAppServerConfig
  identity: { verify: ReturnType<typeof vi.fn> }
  store: MiniAppStore
  finance: FinanceServerDependencies
} {
  const worker: ExpenseAsyncWorker = {
    finalize: vi.fn(async () => ({ rootRequestId: BODY.rootRequestId, state: 'COMMITTED' as const })),
  }
  return {
    config: config(),
    identity: { verify: vi.fn(async () => { throw new Error('LINE identity must not run') }) },
    store: { getActiveStaffByLineUserId: vi.fn(async () => { throw new Error('store must not run') }) } as unknown as MiniAppStore,
    finance: {
      signingSecret: 'signing-secret',
      async: {
        config: {
          enabled: true,
          projectId: 'project-2099d92f-51c8-4d2b-a8c',
          location: 'asia-southeast1',
          jobBucketName: 'pmc-expense-async-jobs',
          queueName: 'pmc-expense-finalize',
          workerUrl: 'https://pmc.example/internal/mini-app/finalize-expense',
          workerAudience: 'https://pmc.example',
          taskInvokerEmail: 'task-invoker@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com',
          pilotStaffIds: new Set(['SUBMIT_01']),
        },
        jobs: {} as never,
        queue: {} as never,
        worker,
        identity: {
          verify: vi.fn(async (token: string) => {
            if (token !== 'valid-worker-token') throw new Error('unauthorized')
            return { email: 'task-invoker@example.test', subject: 'subject-1' }
          }),
        },
      },
    },
  }
}

function workerRequest(retryCount: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-worker-token',
      'content-type': 'application/json',
      'x-cloudtasks-taskretrycount': retryCount,
    },
    body: JSON.stringify(BODY),
  }
}

function config(): PmcMiniAppServerConfig {
  return {
    enabled: true,
    miniAppId: 'mini-app-id',
    lineChannelId: '2001234567',
    spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1',
    bookingIngressUrl: 'https://example.test/booking',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
    bookingIngressSecret: 'booking-secret',
    signingSecret: 'signing-secret',
    enrollmentPin: null,
    maxImageBytes: 10_000_000,
    maxFilesPerKind: 10,
    bookingProtocol: { supported: 2, minimumMutation: 1, prepare: false },
    bookingMutationsPaused: false,
    asyncBooking: null,
    financeReportsEnabled: false,
    financeUiPreviewEnabled: false,
    financeReportsPilotOnly: false,
    financePilotDefaultDate: null,
    financeMonthlyIncomeEnabled: false,
    stockEnabled: false,
    stockManagerPilotOnly: false,
    finance: null,
  }
}

async function invoke(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  init: RequestInit,
): Promise<Response> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    return await fetch(`http://127.0.0.1:${address.port}${ROUTE}`, init)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
