import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateManifest, runEvaluation } from '../../scripts/evaluate-ocr-ledger.mjs'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OCR ledger evaluation harness', () => {
  it('scores document types, exact grand totals, and exact normalized line-item fields without emitting fixture data', async () => {
    const fixtureDir = await createFixtureDir(['receipt-001.png', 'slip-001.png'])
    const outputDir = await createTemporaryDir('ocr-evaluation-output-')

    const summary = await runEvaluation({
      fixtureDir,
      outputDir,
      manifest: {
        fixtures: [
          fixture('receipt-001', 'receipt-001.png', receiptExpected(), receiptExpected()),
          fixture('slip-001', 'slip-001.png', slipExpected(), { ...slipExpected(), documentType: 'RECEIPT' }),
        ],
      },
    })

    expect(summary.result).toBe('NO_GO')
    expect(summary.scoredFixtures).toBe(2)
    expect(summary.accuracy).toEqual({
      documentType: { correct: 1, total: 2, percentage: 50 },
      grandTotal: { correct: 2, total: 2, percentage: 100 },
      lineItemFields: { correct: 4, total: 4, percentage: 100 },
    })
    expect(summary.errorCodes).toEqual([])

    const written = await readFile(join(outputDir, 'summary.json'), 'utf8')
    expect(written).not.toContain('receipt-001')
    expect(written).not.toContain('ITEM A')
    expect(written).not.toContain('imagePath')
    expect(written).not.toContain('expected')
    expect(written).not.toContain('actual')
  })

  it('rejects a missing image without exposing the input path', async () => {
    const fixtureDir = await createFixtureDir([])

    await expect(evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [fixture('receipt-001', 'missing.png', receiptExpected(), receiptExpected())] },
    })).rejects.toMatchObject({ code: 'EVAL_MISSING_IMAGE', message: 'EVAL_MISSING_IMAGE' })
  })

  it('refuses evaluation fixture directories inside API', async () => {
    await expect(evaluateManifest({
      fixtureDir: '/tmp/API/ocr-evaluation',
      manifest: { fixtures: [] },
    })).rejects.toMatchObject({ code: 'EVAL_PROHIBITED_PATH', message: 'EVAL_PROHIBITED_PATH' })
  })

  it('requires every fixture to remain unconfirmed before it can pass', async () => {
    const fixtureDir = await createFixtureDir(['receipt-001.png'])

    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [{ ...fixture('receipt-001', 'receipt-001.png', receiptExpected(), receiptExpected()), autoConfirmed: true }] },
    })

    expect(summary.result).toBe('NO_GO')
    expect(summary.errorCodes).toEqual([{ code: 'EVAL_AUTO_CONFIRM_PRESENT', count: 1 }])
  })

  it('returns GO only at the exact 100-fixture, 98%, 98%, and 95% thresholds', async () => {
    const imageNames = Array.from({ length: 100 }, (_, index) => `receipt-${index + 1}.png`)
    const fixtureDir = await createFixtureDir(imageNames)
    const fixtures = imageNames.map((imagePath, index) => {
      const expected = receiptExpected()
      const actual = {
        ...receiptExpected(),
        documentType: index >= 98 ? 'TRANSFER_SLIP' : 'RECEIPT',
        grandTotal: index >= 98 ? 0 : 214,
        lineItems: [{ description: index >= 80 ? 'WRONG ITEM' : 'ITEM A', quantity: 2, unitPrice: 100, lineTotal: 200 }],
      }
      return fixture(`fixture-${index + 1}`, imagePath, expected, actual)
    })

    const exactThreshold = await evaluateManifest({ fixtureDir, manifest: { fixtures } })
    const belowDocumentTypeThreshold = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: fixtures.map((entry, index) => index === 97 ? { ...entry, actual: { ...entry.actual, documentType: 'TRANSFER_SLIP' } } : entry) },
    })

    expect(exactThreshold).toMatchObject({
      result: 'GO',
      accuracy: {
        documentType: { percentage: 98 },
        grandTotal: { percentage: 98 },
        lineItemFields: { percentage: 95 },
      },
    })
    expect(belowDocumentTypeThreshold.result).toBe('NO_GO')
  })
})

function fixture(fixtureId: string, imagePath: string, expected: Record<string, unknown>, actual: Record<string, unknown>) {
  return { fixtureId, imagePath, expected, actual, autoConfirmed: false }
}

function receiptExpected() {
  return {
    documentType: 'RECEIPT',
    grandTotal: 214,
    lineItems: [{ description: 'ITEM A', quantity: 2, unitPrice: 100, lineTotal: 200 }],
  }
}

function slipExpected() {
  return { documentType: 'TRANSFER_SLIP', grandTotal: 100, lineItems: [] }
}

async function createFixtureDir(imageNames: string[]) {
  const fixtureDir = await createTemporaryDir('ocr-evaluation-fixtures-')
  await Promise.all(imageNames.map((imageName) => writeFile(join(fixtureDir, imageName), 'synthetic-image')))
  return fixtureDir
}

async function createTemporaryDir(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(path)
  await mkdir(path, { recursive: true })
  return path
}
