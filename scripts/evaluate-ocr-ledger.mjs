import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const CANONICAL_LINE_FIELDS = ['lineNumber', 'description', 'quantity', 'unit', 'unitPrice', 'discountAmount', 'taxAmount', 'lineTotal', 'categoryId']
const ACTUAL_LINE_FIELDS = [...CANONICAL_LINE_FIELDS, 'confidence']
const OUTPUT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../output/ocr-ledger-evaluation')
const SUMMARY_FILE = 'summary.json'
const MAX_INPUT_PIXELS = 40_000_000

export class EvaluationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'EvaluationError'
    this.code = code
  }
}

export async function evaluateManifest({ fixtureDir, manifest, extractor }) {
  if (typeof extractor !== 'function') throw new EvaluationError('EVAL_EXTRACTOR_REQUIRED')
  const root = await resolveFixtureDirectory(fixtureDir)
  const fixtures = validatedFixtures(manifest)
  const scores = { documentType: { correct: 0, total: 0 }, grandTotal: { correct: 0, total: 0 }, lineItemFields: { correct: 0, total: 0 } }
  const errors = new Map()

  for (const fixture of fixtures) {
    const imageBytes = await readFixtureImage(root, fixture.imagePath)
    let extracted
    try {
      extracted = await extractor(imageBytes, { fixtureId: fixture.fixtureId })
    } catch {
      addError(errors, 'EVAL_EXTRACTION_FAILED')
      extracted = null
    }
    scoreFixture(scores, fixture.expected, extracted, errors)
  }

  const accuracy = {
    documentType: percentageScore(scores.documentType),
    grandTotal: percentageScore(scores.grandTotal),
    lineItemFields: percentageScore(scores.lineItemFields),
  }
  const errorCodes = [...errors.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => left.code.localeCompare(right.code))
  const result = shouldGo({ fixtureCount: fixtures.length, scores, errorCodes }) ? 'GO' : 'NO_GO'
  const summary = { result, scoredFixtures: fixtures.length, accuracy, errorCodes }

  if (!isAggregateOnly(summary)) throw new EvaluationError('EVAL_UNSAFE_OUTPUT')
  return summary
}

export async function runEvaluation({ fixtureDir, manifest, extractor, outputDir = OUTPUT_DIRECTORY }) {
  const summary = await evaluateManifest({ fixtureDir, manifest, extractor })
  await writeSummary(outputDir, summary)
  return summary
}

export async function createProductionExtractor(env) {
  if (env.OCR_EVAL_LIVE_CONFIRM !== 'YES') throw new EvaluationError('EVAL_LIVE_CONFIRM_REQUIRED')
  const config = readEvaluationProviderConfig(env)

  const { prepareOcrImage } = await import('../dist-server/server/ocr-ledger/imageProcessing.js')
  const { createOpenAiOcrExtractor } = await import('../dist-server/server/ocr-ledger/openAiExtractor.js')
  const now = () => new Date().toISOString()
  const extractor = createOpenAiOcrExtractor({
    apiKey: config.apiKey,
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
    referenceDate: now(),
  })

  return async (imageBytes) => extractor.extract(await prepareOcrImage(imageBytes, config.maxImageBytes))
}

export function readEvaluationProviderConfig(env) {
  const apiKey = env.OPENAI_API_KEY?.trim()
  const model = env.OPENAI_OCR_MODEL?.trim()
  const maxOutputTokens = parsePositiveInteger(env.OCR_OPENAI_MAX_OUTPUT_TOKENS)
  const maxImageBytes = parsePositiveInteger(env.OCR_MAX_IMAGE_BYTES)
  if (!apiKey || !model || maxOutputTokens === null || maxImageBytes === null) throw new EvaluationError('EVAL_PROVIDER_CONFIG_REQUIRED')
  return { apiKey, model, maxOutputTokens, maxImageBytes }
}

async function resolveFixtureDirectory(fixtureDir) {
  if (typeof fixtureDir !== 'string' || fixtureDir.trim() === '') throw new EvaluationError('EVAL_FIXTURE_DIR_REQUIRED')
  const requestedPath = resolve(fixtureDir)
  rejectApiPath(requestedPath)
  let fixturePath
  try {
    fixturePath = await realpath(requestedPath)
    if (!(await stat(fixturePath)).isDirectory()) throw new EvaluationError('EVAL_FIXTURE_DIR_INVALID')
  } catch (error) {
    if (error instanceof EvaluationError) throw error
    throw new EvaluationError('EVAL_FIXTURE_DIR_INVALID')
  }
  rejectApiPath(fixturePath)
  return fixturePath
}

function validatedFixtures(manifest) {
  if (!isRecord(manifest) || !hasOnlyKeys(manifest, ['fixtures']) || !Array.isArray(manifest.fixtures)) throw new EvaluationError('EVAL_INVALID_MANIFEST')
  return manifest.fixtures.map((fixture) => {
    if (!isRecord(fixture) || !hasOnlyKeys(fixture, ['fixtureId', 'imagePath', 'expected'])
      || typeof fixture.fixtureId !== 'string' || fixture.fixtureId.length === 0
      || typeof fixture.imagePath !== 'string' || fixture.imagePath.length === 0
      || !isExpected(fixture.expected)) throw new EvaluationError('EVAL_INVALID_MANIFEST')
    return fixture
  })
}

function isExpected(value) {
  return isRecord(value)
    && hasOnlyKeys(value, ['documentType', 'grandTotal', 'lineItems'])
    && isDocumentType(value.documentType)
    && isFiniteNumber(value.grandTotal)
    && Array.isArray(value.lineItems)
    && hasSequentialCanonicalLines(value.lineItems)
}

async function readFixtureImage(root, imagePath) {
  if (isAbsolute(imagePath)) throw new EvaluationError('EVAL_PROHIBITED_PATH')
  const candidate = resolve(root, imagePath)
  if (!isWithin(root, candidate)) throw new EvaluationError('EVAL_PROHIBITED_PATH')

  let imageFile
  try {
    imageFile = await realpath(candidate)
    if (!isWithin(root, imageFile)) throw new EvaluationError('EVAL_PROHIBITED_PATH')
    if (!(await stat(imageFile)).isFile()) throw new EvaluationError('EVAL_MISSING_IMAGE')
  } catch (error) {
    if (error instanceof EvaluationError) throw error
    throw new EvaluationError('EVAL_MISSING_IMAGE')
  }

  let bytes
  try {
    bytes = await readFile(imageFile)
    if (!hasAllowedImageMagic(bytes)) throw new EvaluationError('EVAL_INVALID_IMAGE')
    const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    if ((metadata.format !== 'jpeg' && metadata.format !== 'png') || !metadata.width || !metadata.height) throw new EvaluationError('EVAL_INVALID_IMAGE')
    await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).raw().toBuffer()
  } catch (error) {
    if (error instanceof EvaluationError) throw error
    throw new EvaluationError('EVAL_INVALID_IMAGE')
  }
  return bytes
}

function scoreFixture(scores, expected, extraction, errors) {
  scores.documentType.total += 1
  scores.grandTotal.total += 1
  const actual = normalizeExtraction(extraction)
  if (actual.invalid) addError(errors, 'EVAL_INVALID_EXTRACTION')
  if (actual.autoConfirmed) addError(errors, 'EVAL_AUTO_CONFIRM_PRESENT')
  if (actual.documentType === expected.documentType) scores.documentType.correct += 1
  if (actual.grandTotal === expected.grandTotal) scores.grandTotal.correct += 1

  const lineCount = Math.max(expected.lineItems.length, actual.lineItems.length)
  for (let index = 0; index < lineCount; index += 1) {
    const expectedLine = expected.lineItems[index]
    const actualLine = actual.linesSequential ? actual.lineItems[index] : null
    for (const field of CANONICAL_LINE_FIELDS) {
      scores.lineItemFields.total += 1
      if (expectedLine && actualLine && expectedLine[field] === actualLine[field]) scores.lineItemFields.correct += 1
    }
  }
}

function normalizeExtraction(value) {
  if (!isRecord(value)) return { documentType: undefined, grandTotal: undefined, lineItems: [], linesSequential: false, autoConfirmed: false, invalid: true }
  const documentType = isNullableDocumentType(value.documentType) ? value.documentType : undefined
  const grandTotal = isNullableFiniteNumber(value.grandTotal) ? value.grandTotal : undefined
  const rawLines = Array.isArray(value.lineItems) ? value.lineItems : []
  const lineItems = rawLines.map(canonicalActualLine)
  const linesSequential = rawLines.length === lineItems.length && lineItems.every((line, index) => line !== null && line.lineNumber === index + 1)
  const invalid = documentType === undefined || grandTotal === undefined || !Array.isArray(value.lineItems) || !linesSequential
  return {
    documentType,
    grandTotal,
    lineItems,
    linesSequential,
    invalid,
    autoConfirmed: value.autoConfirmed === true || value.state === 'CONFIRMED' || value.confirmedAt !== undefined || value.confirmedBy !== undefined,
  }
}

function canonicalActualLine(value) {
  if (!isRecord(value)) return null
  if (!CANONICAL_LINE_FIELDS.every((field) => Object.hasOwn(value, field)) || !Object.keys(value).every((field) => ACTUAL_LINE_FIELDS.includes(field))) return null
  if (Object.hasOwn(value, 'confidence') && !isNullableConfidence(value.confidence)) return null
  const line = Object.fromEntries(CANONICAL_LINE_FIELDS.map((field) => [field, value[field]]))
  return isCanonicalLine(line) ? line : null
}

function hasSequentialCanonicalLines(lines) {
  return lines.every((line, index) => isCanonicalLine(line) && line.lineNumber === index + 1)
}

function isCanonicalLine(value) {
  return isRecord(value)
    && hasOnlyKeys(value, CANONICAL_LINE_FIELDS)
    && Number.isSafeInteger(value.lineNumber) && value.lineNumber >= 1
    && isNullableString(value.description)
    && isNullableFiniteNumber(value.quantity)
    && isNullableString(value.unit)
    && isNullableFiniteNumber(value.unitPrice)
    && isNullableFiniteNumber(value.discountAmount)
    && isNullableFiniteNumber(value.taxAmount)
    && isNullableFiniteNumber(value.lineTotal)
    && isNullableString(value.categoryId)
}

function shouldGo({ fixtureCount, scores, errorCodes }) {
  return fixtureCount >= 100
    && meetsThreshold(scores.documentType, 98)
    && meetsThreshold(scores.grandTotal, 98)
    && meetsThreshold(scores.lineItemFields, 95)
    && errorCodes.length === 0
}

function meetsThreshold(score, threshold) {
  return score.total > 0 && score.correct * 100 >= threshold * score.total
}

function percentageScore({ correct, total }) {
  return { correct, total, percentage: total === 0 ? 0 : Number(((correct * 100) / total).toFixed(2)) }
}

function addError(errors, code) {
  errors.set(code, (errors.get(code) ?? 0) + 1)
}

function hasAllowedImageMagic(bytes) {
  const jpeg = bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return jpeg || png
}

function rejectApiPath(path) {
  if (path.split(sep).includes('API')) throw new EvaluationError('EVAL_PROHIBITED_PATH')
}

function isWithin(root, candidate) {
  const pathDifference = relative(root, candidate)
  return pathDifference === '' || (!pathDifference.startsWith(`..${sep}`) && pathDifference !== '..' && !isAbsolute(pathDifference))
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))
}

function isDocumentType(value) {
  return value === 'TRANSFER_SLIP' || value === 'RECEIPT'
}

function isNullableDocumentType(value) {
  return value === null || isDocumentType(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value) {
  return value === null || isFiniteNumber(value)
}

function isNullableString(value) {
  return value === null || typeof value === 'string'
}

function isNullableConfidence(value) {
  return value === null || (isFiniteNumber(value) && value >= 0 && value <= 1)
}

function parsePositiveInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function isAggregateOnly(summary) {
  return isRecord(summary)
    && (summary.result === 'GO' || summary.result === 'NO_GO')
    && Number.isSafeInteger(summary.scoredFixtures) && summary.scoredFixtures >= 0
    && isAccuracy(summary.accuracy)
    && Array.isArray(summary.errorCodes)
    && summary.errorCodes.every((error) => isRecord(error) && /^EVAL_[A-Z_]+$/.test(error.code) && Number.isSafeInteger(error.count) && error.count > 0)
}

function isAccuracy(value) {
  return isRecord(value) && ['documentType', 'grandTotal', 'lineItemFields'].every((key) => {
    const score = value[key]
    return isRecord(score) && Number.isSafeInteger(score.correct) && score.correct >= 0
      && Number.isSafeInteger(score.total) && score.total >= score.correct
      && typeof score.percentage === 'number' && Number.isFinite(score.percentage)
  })
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeSummary(outputDir, summary) {
  const destination = resolve(outputDir)
  await mkdir(destination, { recursive: true })
  await writeFile(resolve(destination, SUMMARY_FILE), `${JSON.stringify(summary)}\n`, 'utf8')
}

async function main() {
  try {
    const fixtureDir = process.env.OCR_EVAL_FIXTURE_DIR
    const root = await resolveFixtureDirectory(fixtureDir)
    const manifest = JSON.parse(await readFile(resolve(root, 'evaluation-manifest.json'), 'utf8'))
    const extractor = await createProductionExtractor(process.env)
    const summary = await runEvaluation({ fixtureDir: root, manifest, extractor })
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    if (summary.result !== 'GO') process.exitCode = 1
  } catch (error) {
    const code = error instanceof EvaluationError ? error.code : 'EVAL_RUN_FAILED'
    const summary = { result: 'NO_GO', scoredFixtures: 0, accuracy: emptyAccuracy(), errorCodes: [{ code, count: 1 }] }
    await writeSummary(OUTPUT_DIRECTORY, summary)
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    process.exitCode = 1
  }
}

function emptyAccuracy() {
  return {
    documentType: { correct: 0, total: 0, percentage: 0 },
    grandTotal: { correct: 0, total: 0, percentage: 0 },
    lineItemFields: { correct: 0, total: 0, percentage: 0 },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
