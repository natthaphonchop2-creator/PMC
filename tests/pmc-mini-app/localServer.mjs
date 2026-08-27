import { resolve } from 'node:path'
import { createServer } from 'vite'

const port = Number(process.env.PMC_MINI_APP_TEST_PORT || 4187)
const server = await createServer({
  configFile: resolve('vite.mini-app.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true },
  logLevel: 'error',
})

await server.listen()

const close = async () => {
  await server.close()
  process.exit(0)
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
