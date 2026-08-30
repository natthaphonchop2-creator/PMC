const middleware = await import('../dist-server/server/pmc-mini-app/middleware.js')

if (typeof middleware.createPmcMiniAppMiddleware !== 'function') {
  throw new Error('COMPILED_PMC_MIDDLEWARE_EXPORT_MISSING')
}

process.stdout.write('COMPILED_PMC_MIDDLEWARE_OK\n')
