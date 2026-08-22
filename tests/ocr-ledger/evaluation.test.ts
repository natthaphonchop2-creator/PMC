import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProductionExtractor, evaluateManifest, readEvaluationProviderConfig, runEvaluation } from '../../scripts/evaluate-ocr-ledger.mjs'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OCR ledger evaluation harness', () => {
  it('obtains actual values from the injected extractor with the validated image bytes and writes aggregate-only output', async () => {
    const { fixtureDir, images } = await createFixtureDir(['receipt-001.png', 'slip-001.png'])
    const outputDir = await createTemporaryDir('ocr-evaluation-output-')
    const extractor = vi.fn(async (_imageBytes: Buffer, context: { fixtureId: string }) => context.fixtureId === 'receipt-001'
      ? receiptActual()
      : { ...slipActual(), documentType: 'RECEIPT' })

    const summary = await runEvaluation({
      fixtureDir,
      outputDir,
      extractor,
      manifest: { fixtures: [fixture('receipt-001', 'receipt-001.png', receiptExpected()), fixture('slip-001', 'slip-001.png', slipExpected())] },
    })

    expect(extractor).toHaveBeenCalledTimes(2)
    expect(extractor).toHaveBeenCalledWith(images['receipt-001.png'], { fixtureId: 'receipt-001' })
    expect(summary.accuracy).toEqual({
      documentType: { correct: 1, total: 2, percentage: 50 },
      grandTotal: { correct: 2, total: 2, percentage: 100 },
      lineItemFields: { correct: 9, total: 9, percentage: 100 },
    })
    const written = await readFile(join(outputDir, 'summary.json'), 'utf8')
    expect(written).not.toContain('receipt-001')
    expect(written).not.toContain('ITEM A')
    expect(written).not.toContain('imagePath')
    expect(written).not.toContain('expected')
    expect(written).not.toContain('actual')
  })

  it.each(['actual', 'autoConfirmed', 'result'])('rejects %s data in an expected-label manifest', async (prohibitedKey) => {
    const { fixtureDir } = await createFixtureDir(['receipt-001.png'])
    const manifestFixture = { ...fixture('receipt-001', 'receipt-001.png', receiptExpected()), [prohibitedKey]: prohibitedKey === 'actual' ? receiptActual() : true }

    await expect(evaluateManifest({ fixtureDir, manifest: { fixtures: [manifestFixture] }, extractor: async () => receiptActual() }))
      .rejects.toMatchObject({ code: 'EVAL_INVALID_MANIFEST' })
  })

  it('rejects a missing image without exposing the input path', async () => {
    const { fixtureDir } = await createFixtureDir([])

    await expect(evaluateManifest({ fixtureDir, manifest: { fixtures: [fixture('receipt-001', 'missing.png', receiptExpected())] }, extractor: async () => receiptActual() }))
      .rejects.toMatchObject({ code: 'EVAL_MISSING_IMAGE', message: 'EVAL_MISSING_IMAGE' })
  })

  it('refuses an API fixture directory and traversal outside the fixture directory', async () => {
    await expect(evaluateManifest({ fixtureDir: '/tmp/API/ocr-evaluation', manifest: { fixtures: [] }, extractor: async () => receiptActual() }))
      .rejects.toMatchObject({ code: 'EVAL_PROHIBITED_PATH' })

    const { fixtureDir } = await createFixtureDir(['receipt-001.png'])
    await expect(evaluateManifest({ fixtureDir, manifest: { fixtures: [fixture('receipt-001', '../receipt-001.png', receiptExpected())] }, extractor: async () => receiptActual() }))
      .rejects.toMatchObject({ code: 'EVAL_PROHIBITED_PATH' })
  })

  it('refuses a symlinked image that escapes the fixture directory', async () => {
    const { fixtureDir } = await createFixtureDir([])
    const outsideDirectory = await createTemporaryDir('ocr-evaluation-outside-')
    const outsideImage = join(outsideDirectory, 'outside.png')
    await writeFile(outsideImage, await pngBytes())
    await symlink(outsideImage, join(fixtureDir, 'escape.png'))

    await expect(evaluateManifest({ fixtureDir, manifest: { fixtures: [fixture('receipt-001', 'escape.png', receiptExpected())] }, extractor: async () => receiptActual() }))
      .rejects.toMatchObject({ code: 'EVAL_PROHIBITED_PATH' })
  })

  it('rejects non-image and decoder-invalid fixture bytes before extraction', async () => {
    const { fixtureDir } = await createFixtureDir([])
    await writeFile(join(fixtureDir, 'not-an-image.png'), 'not an image')
    await writeFile(join(fixtureDir, 'broken.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
    const extractor = vi.fn(async () => receiptActual())

    for (const imagePath of ['not-an-image.png', 'broken.png']) {
      await expect(evaluateManifest({ fixtureDir, manifest: { fixtures: [fixture('receipt-001', imagePath, receiptExpected())] }, extractor }))
        .rejects.toMatchObject({ code: 'EVAL_INVALID_IMAGE' })
    }
    expect(extractor).not.toHaveBeenCalled()
  })

  it('rejects header-valid truncated JPEG and PNG fixtures before extraction completes', async () => {
    const { fixtureDir } = await createFixtureDir([])
    const jpeg = await headerValidTruncation(await jpegBytes())
    const png = await headerValidTruncation(await pngBytes())
    await writeFile(join(fixtureDir, 'truncated.jpg'), jpeg)
    await writeFile(join(fixtureDir, 'truncated.png'), png)
    const extractor = vi.fn(async () => receiptActual())

    for (const imagePath of ['truncated.jpg', 'truncated.png']) {
      await expect(evaluateManifest({ fixtureDir, manifest: { fixtures: [fixture('receipt-001', imagePath, receiptExpected())] }, extractor }))
        .rejects.toMatchObject({ code: 'EVAL_INVALID_IMAGE' })
    }
    expect(extractor).not.toHaveBeenCalled()
  })

  it('penalizes a wrong grand total', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt-001.png'])
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [fixture('receipt-001', 'receipt-001.png', receiptExpected())] },
      extractor: async () => ({ ...receiptActual(), grandTotal: 0 }),
    })

    expect(summary.accuracy.grandTotal).toEqual({ correct: 0, total: 1, percentage: 0 })
    expect(summary.result).toBe('NO_GO')
  })

  it.each([
    ['missing', []],
    ['extra', [lineActual(), { ...lineActual(), lineNumber: 2 }]],
    ['malformed', [{ ...lineActual(), lineTotal: undefined }]],
    ['out-of-sequence', [{ ...lineActual(), lineNumber: 2 }]],
  ])('penalizes %s actual line items', async (_caseName, lineItems) => {
    const { fixtureDir } = await createFixtureDir(['receipt-001.png'])
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [fixture('receipt-001', 'receipt-001.png', receiptExpected())] },
      extractor: async () => ({ ...receiptActual(), lineItems }),
    })

    if (_caseName === 'extra') expect(summary.accuracy.lineItemFields).toEqual({ correct: 9, total: 18, percentage: 50 })
    else expect(summary.accuracy.lineItemFields).toEqual({ correct: 0, total: 9, percentage: 0 })
    if (_caseName === 'malformed' || _caseName === 'out-of-sequence') expect(summary.errorCodes).toEqual([{ code: 'EVAL_INVALID_EXTRACTION', count: 1 }])
  })

  it('scores each canonical line field exactly, including nulls but never absent fields', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt-001.png'])
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [fixture('receipt-001', 'receipt-001.png', receiptExpected())] },
      extractor: async () => ({ ...receiptActual(), lineItems: [{ ...lineActual(), description: 'WRONG ITEM' }] }),
    })

    expect(summary.accuracy.lineItemFields).toEqual({ correct: 8, total: 9, percentage: 88.89 })
  })

  it.each([
    ['an unknown key', { ...lineActual(), untrusted: 'value' }],
    ['invalid confidence metadata', { ...lineActual(), confidence: 1.01 }],
  ])('rejects an actual line with %s', async (_caseName, actualLine) => {
    const { fixtureDir } = await createFixtureDir(['receipt-001.png'])
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [fixture('receipt-001', 'receipt-001.png', receiptExpected())] },
      extractor: async () => ({ ...receiptActual(), lineItems: [actualLine] }),
    })

    expect(summary.accuracy.lineItemFields).toEqual({ correct: 0, total: 9, percentage: 0 })
    expect(summary.errorCodes).toEqual([{ code: 'EVAL_INVALID_EXTRACTION', count: 1 }])
  })

  it('does not pass a ratio that only rounds up to the line-item threshold', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    const fixtures = Array.from({ length: 100 }, (_, index) => fixture(`fixture-${index + 1}`, 'receipt.png', index === 0 ? receiptExpected({ lineItems: manyExpectedLines(1111) }) : slipExpected()))
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures },
      extractor: async (_bytes, context) => context.fixtureId === 'fixture-1'
        ? receiptActual({ lineItems: manyActualLines(1111, 500) })
        : slipActual(),
    })

    expect(summary.accuracy).toMatchObject({
      documentType: { correct: 100, total: 100, percentage: 100 },
      grandTotal: { correct: 100, total: 100, percentage: 100 },
      lineItemFields: { correct: 9499, total: 9999, percentage: 95 },
    })
    expect(summary.result).toBe('NO_GO')
  })

  it('returns GO at the exact count thresholds when every score is genuinely at least the required ratio', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    const fixtures = Array.from({ length: 100 }, (_, index) => fixture(`fixture-${index + 1}`, 'receipt.png', receiptExpected()))
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures },
      extractor: async (_bytes, context) => receiptActual({ lineItems: [{ ...lineActual(), description: Number(context.fixtureId.slice(8)) <= 45 ? 'WRONG ITEM' : 'ITEM A' }] }),
    })

    expect(summary.accuracy.lineItemFields).toEqual({ correct: 855, total: 900, percentage: 95 })
    expect(summary.result).toBe('GO')
  })

  it('requires at least 100 fixtures even when every extracted value matches', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    const fixtures = Array.from({ length: 99 }, (_, index) => fixture(`fixture-${index + 1}`, 'receipt.png', receiptExpected()))
    const summary = await evaluateManifest({ fixtureDir, manifest: { fixtures }, extractor: async () => receiptActual() })

    expect(summary.result).toBe('NO_GO')
  })

  it('passes document type at 98% and fails immediately below it', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    const fixtures = Array.from({ length: 100 }, (_, index) => fixture(`fixture-${index + 1}`, 'receipt.png', receiptExpected()))
    const atThreshold = await evaluateManifest({
      fixtureDir, manifest: { fixtures },
      extractor: async (_bytes, context) => ({ ...receiptActual(), documentType: Number(context.fixtureId.slice(8)) <= 2 ? 'TRANSFER_SLIP' : 'RECEIPT' }),
    })
    const belowThreshold = await evaluateManifest({
      fixtureDir, manifest: { fixtures },
      extractor: async (_bytes, context) => ({ ...receiptActual(), documentType: Number(context.fixtureId.slice(8)) <= 3 ? 'TRANSFER_SLIP' : 'RECEIPT' }),
    })

    expect(atThreshold.accuracy.documentType).toEqual({ correct: 98, total: 100, percentage: 98 })
    expect(atThreshold.result).toBe('GO')
    expect(belowThreshold.accuracy.documentType).toEqual({ correct: 97, total: 100, percentage: 97 })
    expect(belowThreshold.result).toBe('NO_GO')
  })

  it('passes grand total at 98% and fails immediately below it', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    const fixtures = Array.from({ length: 100 }, (_, index) => fixture(`fixture-${index + 1}`, 'receipt.png', receiptExpected()))
    const atThreshold = await evaluateManifest({
      fixtureDir, manifest: { fixtures },
      extractor: async (_bytes, context) => ({ ...receiptActual(), grandTotal: Number(context.fixtureId.slice(8)) <= 2 ? 0 : 214 }),
    })
    const belowThreshold = await evaluateManifest({
      fixtureDir, manifest: { fixtures },
      extractor: async (_bytes, context) => ({ ...receiptActual(), grandTotal: Number(context.fixtureId.slice(8)) <= 3 ? 0 : 214 }),
    })

    expect(atThreshold.accuracy.grandTotal).toEqual({ correct: 98, total: 100, percentage: 98 })
    expect(atThreshold.result).toBe('GO')
    expect(belowThreshold.accuracy.grandTotal).toEqual({ correct: 97, total: 100, percentage: 97 })
    expect(belowThreshold.result).toBe('NO_GO')
  })

  it('does not pass an evaluation with no scored line-item fields', async () => {
    const { fixtureDir } = await createFixtureDir(['slip.png'])
    const fixtures = Array.from({ length: 100 }, (_, index) => fixture(`fixture-${index + 1}`, 'slip.png', slipExpected()))
    const summary = await evaluateManifest({ fixtureDir, manifest: { fixtures }, extractor: async () => slipActual() })

    expect(summary.accuracy.lineItemFields).toEqual({ correct: 0, total: 0, percentage: 0 })
    expect(summary.result).toBe('NO_GO')
  })

  it('records an auto-confirmed extractor result as a failed evaluation instead of trusting it', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    const summary = await evaluateManifest({
      fixtureDir,
      manifest: { fixtures: [fixture('receipt-001', 'receipt.png', receiptExpected())] },
      extractor: async () => ({ ...receiptActual(), autoConfirmed: true }),
    })

    expect(summary.errorCodes).toEqual([{ code: 'EVAL_AUTO_CONFIRM_PRESENT', count: 1 }])
    expect(summary.result).toBe('NO_GO')
  })

  it('requires an explicit live confirmation before a CLI production extractor can be constructed', async () => {
    await expect(createProductionExtractor({})).rejects.toMatchObject({ code: 'EVAL_LIVE_CONFIRM_REQUIRED' })
  })

  it('accepts only the evaluation OpenAI and image limits needed to construct the production extractor', () => {
    expect(readEvaluationProviderConfig(providerEnv())).toEqual({ apiKey: 'test-key', model: 'test-model', maxOutputTokens: 512, maxImageBytes: 1024 })
    expect(() => readEvaluationProviderConfig({ ...providerEnv(), OCR_MAX_IMAGE_BYTES: '0' })).toThrow('EVAL_PROVIDER_CONFIG_REQUIRED')
  })

  it('keeps CLI confirmation and provider-config failures aggregate-only without calling an extractor', async () => {
    const { fixtureDir } = await createFixtureDir(['receipt.png'])
    await writeFile(join(fixtureDir, 'evaluation-manifest.json'), JSON.stringify({ fixtures: [fixture('receipt-001', 'receipt.png', receiptExpected())] }))

    const confirmation = runEvaluatorCli(fixtureDir, {})
    const providerConfig = runEvaluatorCli(fixtureDir, { OCR_EVAL_LIVE_CONFIRM: 'YES' })

    expect(confirmation.status).toBe(1)
    expect(providerConfig.status).toBe(1)
    expect(confirmation.summary).toMatchObject({ result: 'NO_GO', errorCodes: [{ code: 'EVAL_LIVE_CONFIRM_REQUIRED', count: 1 }] })
    expect(providerConfig.summary).toMatchObject({ result: 'NO_GO', errorCodes: [{ code: 'EVAL_PROVIDER_CONFIG_REQUIRED', count: 1 }] })
    expect(confirmation.stdout).not.toContain('receipt-001')
    expect(confirmation.stdout).not.toContain('ITEM A')
    expect(confirmation.stdout).not.toContain(fixtureDir)
  })
})

function fixture(fixtureId: string, imagePath: string, expected: Record<string, unknown>) {
  return { fixtureId, imagePath, expected }
}

function receiptExpected(overrides: Record<string, unknown> = {}) {
  return { documentType: 'RECEIPT', grandTotal: 214, lineItems: [lineExpected()], ...overrides }
}

function slipExpected() {
  return { documentType: 'TRANSFER_SLIP', grandTotal: 100, lineItems: [] }
}

function receiptActual(overrides: Record<string, unknown> = {}) {
  return { documentType: 'RECEIPT', grandTotal: 214, lineItems: [lineActual()], ...overrides }
}

function slipActual() {
  return { documentType: 'TRANSFER_SLIP', grandTotal: 100, lineItems: [] }
}

function lineExpected(index = 1) {
  return { lineNumber: index, description: 'ITEM A', quantity: 2, unit: null, unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 200, categoryId: null }
}

function lineActual(index = 1) {
  return { ...lineExpected(index), confidence: 0.99 }
}

function manyExpectedLines(count: number) {
  return Array.from({ length: count }, (_, index) => lineExpected(index + 1))
}

function manyActualLines(count: number, wrongDescriptions: number) {
  return Array.from({ length: count }, (_, index) => ({ ...lineActual(index + 1), description: index < wrongDescriptions ? 'WRONG ITEM' : 'ITEM A' }))
}

async function createFixtureDir(imageNames: string[]) {
  const fixtureDir = await createTemporaryDir('ocr-evaluation-fixtures-')
  const images: Record<string, Buffer> = {}
  for (const imageName of imageNames) {
    const bytes = await pngBytes()
    images[imageName] = bytes
    await writeFile(join(fixtureDir, imageName), bytes)
  }
  return { fixtureDir, images }
}

function pngBytes() {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer()
}

function jpegBytes() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

async function headerValidTruncation(bytes: Buffer) {
  for (let length = 9; length < bytes.byteLength; length += 1) {
    const truncated = bytes.subarray(0, length)
    try {
      const metadata = await sharp(truncated).metadata()
      if ((metadata.format === 'jpeg' || metadata.format === 'png') && metadata.width && metadata.height) {
        await expect(sharp(truncated, { failOn: 'error' }).raw().toBuffer()).rejects.toThrow()
        return truncated
      }
    } catch {
      // Keep searching for a header-valid but pixel-incomplete image.
    }
  }
  throw new Error('No header-valid truncation found')
}

function providerEnv() {
  return { OCR_EVAL_LIVE_CONFIRM: 'YES', OPENAI_API_KEY: 'test-key', OPENAI_OCR_MODEL: 'test-model', OCR_OPENAI_MAX_OUTPUT_TOKENS: '512', OCR_MAX_IMAGE_BYTES: '1024' }
}

function runEvaluatorCli(fixtureDir: string, env: Record<string, string>) {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
  const result = spawnSync(process.execPath, ['scripts/evaluate-ocr-ledger.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', OCR_EVAL_FIXTURE_DIR: fixtureDir, ...env },
  })
  return { status: result.status, stdout: result.stdout, summary: JSON.parse(result.stdout) }
}

async function createTemporaryDir(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(path)
  return path
}
