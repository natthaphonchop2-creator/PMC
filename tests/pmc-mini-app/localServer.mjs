import { resolve } from 'node:path'
import { createServer } from 'vite'

const port = Number(process.env.PMC_MINI_APP_TEST_PORT || 4187)
const server = await createServer({
  configFile: resolve('vite.mini-app.config.ts'),
  plugins: [{
    name: 'pmc-expense-permission-acceptance',
    async configureServer(viteServer) {
      const middlewarePath = `/@fs/${resolve('server/pmc-mini-app/middleware.ts')}`
      const { createPmcMiniAppMiddleware } = await viteServer.ssrLoadModule(middlewarePath)
      const middleware = createPmcMiniAppMiddleware(permissionDependencies())
      viteServer.middlewares.use(async (req, res, next) => {
        const pathname = requestPath(req.url)
        if (pathname !== '/api/mini-app/finance/expenses'
          && !/^\/api\/mini-app\/finance\/expenses\/[^/]+\/evidence\/[^/]+\/token$/.test(pathname)) {
          next()
          return
        }
        try {
          await middleware(req, res)
        } catch (error) {
          next(error)
        }
      })
    },
  }],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  logLevel: 'error',
})

await server.listen()

const close = async () => {
  await server.close()
  process.exit(0)
}
process.once('SIGINT', close)
process.once('SIGTERM', close)

function permissionDependencies() {
  return {
    config: {
      enabled: true,
      miniAppId: 'preview-mini-app',
      lineChannelId: '2001234567',
      spreadsheetId: 'preview-sheet',
      intakeFolderId: 'preview-folder',
      bookingIngressUrl: 'https://script.google.com/macros/s/preview/exec',
      fallbackFormUrl: 'https://docs.google.com/forms/',
      bookingIngressSecret: 'preview-booking-secret',
      signingSecret: 'preview-signing-secret',
      enrollmentPin: null,
      maxImageBytes: 10_000_000,
      maxFilesPerKind: 10,
      asyncBooking: null,
      financeReportsEnabled: false,
      stockEnabled: false,
      stockManagerPilotOnly: false,
      finance: null,
    },
    identity: {
      async verify(token) {
        if (token !== 'preview-submit-only-token') throw new Error('invalid preview identity')
        return { lineUserId: 'preview-submit-only-line' }
      },
    },
    store: {
      async getActiveStaffByLineUserId(lineUserId) {
        if (lineUserId !== 'preview-submit-only-line') return null
        return {
          id: 'STAFF_PREVIEW', name: 'พนักงานทดสอบ', email: 'staff@example.test', lineUserId,
          canCloseBooking: false, canBeAe: false, canManageStock: false,
          canSubmitExpense: true, canViewFinance: false, canManageExpense: false,
          active: true, profileImageUrl: null,
        }
      },
    },
  }
}

function requestPath(value) {
  try { return new URL(value || '/', 'http://localhost').pathname } catch { return '' }
}
