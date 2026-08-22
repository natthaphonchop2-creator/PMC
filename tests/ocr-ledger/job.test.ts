import { describe, expect, it } from 'vitest'
import { runOcrLedgerJob } from '../../server/ocr-ledger/job'

describe('runOcrLedgerJob', () => {
  it('fails closed before creating live clients when required configuration is missing', async () => {
    await expect(runOcrLedgerJob({})).rejects.toThrow('OCR ledger configuration is incomplete')
  })
})
