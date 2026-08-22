import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runOcrLedgerJob } from '../../server/ocr-ledger/job'

describe('runOcrLedgerJob', () => {
  it('fails closed before creating live clients when required configuration is missing', async () => {
    await expect(runOcrLedgerJob({})).rejects.toThrow('OCR ledger configuration is incomplete')
  })

  it('runs the freshly built job with a sanitized missing-config failure instead of a Node import error', () => {
    const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
    execFileSync('npm', ['run', 'build:server'], { cwd: projectRoot, stdio: 'pipe' })

    const result = spawnSync(process.execPath, ['dist-server/server/ocr-ledger/job.js'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('OCR ledger job failed\n')
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(result.stderr).not.toContain(projectRoot)
  }, 20_000)
})
