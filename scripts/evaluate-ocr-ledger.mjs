import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const LINE_ITEM_FIELDS = ['description', 'quantity', 'unitPrice', 'lineTotal']
const OUTPUT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../output/ocr-ledger-evaluation')
const SUMMARY_FILE = 'summary.json'

export class EvaluationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'EvaluationError'
    this.code = code
  }
}

export async function evaluateManifest({ fixtureDir, manifest }) {
  const root = await resolveFixtureDirectory(fixtureDir)
  const fixtures = validatedFixtures(manifest)
  const scores = { documentType: { correct: 0, total: 0 }, grandTotal: { correct: 0, total: 0 }, lineItemFields: { correct: 0, total: 0 } }
  let autoConfirmed = 0

  for (const fixture of fixtures) {
    await readFixtureImage(root, fixture.imagePath)
    scoreFixture(scores, fixture)
    if (fixture.autoConfirmed === true) autoConfirmed += 1
  }

  const accuracy = {
    documentType: percentageScore(scores.documentType),
    grandTotal: percentageScore(scores.grandTotal),
    lineItemFields: percentageScore(scores.lineItemFields),
  }
  const errorCodes = autoConfirmed === 0 ? [] : [{ code: 'EVAL_AUTO_CONFIRM_PRESENT', count: autoConfirmed }]
  const result = shouldGo({ fixtureCount: fixtures.length, accuracy, errorCodes }) ? 'GO' : 'NO_GO'
  const summary = { result, scoredFixtures: fixtures.length, accuracy, errorCodes }

  if (!isAggregateOnly(summary)) throw new EvaluationError('EVAL_UNSAFE_OUTPUT')
  return summary
}

export async function runEvaluation({ fixtureDir, manifest, outputDir = OUTPUT_DIRECTORY }) {
  const summary = await evaluateManifest({ fixtureDir, manifest })
  await writeSummary(outputDir, summary)
  return summary
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
  if (!isRecord(manifest) || !Array.isArray(manifest.fixtures)) throw new EvaluationError('EVAL_INVALID_MANIFEST')
  return manifest.fixtures.map((fixture) => {
    if (!isRecord(fixture) || typeof fixture.fixtureId !== 'string' || fixture.fixtureId.length === 0
      || typeof fixture.imagePath !== 'string' || fixture.imagePath.length === 0
      || !isExpected(fixture.expected) || !isExpected(fixture.actual) || typeof fixture.autoConfirmed !== 'boolean') {
      throw new EvaluationError('EVAL_INVALID_MANIFEST')
    }
    return fixture
  })
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
    await readFile(imageFile)
  } catch (error) {
    if (error instanceof EvaluationError) throw error
    throw new EvaluationError('EVAL_MISSING_IMAGE')
  }
}

function scoreFixture(scores, fixture) {
  scores.documentType.total += 1
  scores.grandTotal.total += 1
  if (fixture.expected.documentType === fixture.actual.documentType) scores.documentType.correct += 1
  if (fixture.expected.grandTotal === fixture.actual.grandTotal) scores.grandTotal.correct += 1

  for (const [index, expectedLine] of fixture.expected.lineItems.entries()) {
    const actualLine = fixture.actual.lineItems[index]
    for (const field of LINE_ITEM_FIELDS) {
      scores.lineItemFields.total += 1
      if (isRecord(actualLine) && expectedLine[field] === actualLine[field]) scores.lineItemFields.correct += 1
    }
  }
}

function percentageScore({ correct, total }) {
  return { correct, total, percentage: total === 0 ? 0 : Number(((correct / total) * 100).toFixed(2)) }
}

function shouldGo({ fixtureCount, accuracy, errorCodes }) {
  return fixtureCount >= 100
    && accuracy.documentType.percentage >= 98
    && accuracy.grandTotal.percentage >= 98
    && accuracy.lineItemFields.total > 0
    && accuracy.lineItemFields.percentage >= 95
    && errorCodes.length === 0
}

function isExpected(value) {
  return isRecord(value)
    && typeof value.documentType === 'string'
    && typeof value.grandTotal === 'number'
    && Number.isFinite(value.grandTotal)
    && Array.isArray(value.lineItems)
    && value.lineItems.every((line) => isRecord(line))
}

function rejectApiPath(path) {
  if (path.split(sep).includes('API')) throw new EvaluationError('EVAL_PROHIBITED_PATH')
}

function isWithin(root, candidate) {
  const pathDifference = relative(root, candidate)
  return pathDifference === '' || (!pathDifference.startsWith(`..${sep}`) && pathDifference !== '..' && !isAbsolute(pathDifference))
}

function isAggregateOnly(summary) {
  return isRecord(summary)
    && (summary.result === 'GO' || summary.result === 'NO_GO')
    && Number.isSafeInteger(summary.scoredFixtures)
    && isAccuracy(summary.accuracy)
    && Array.isArray(summary.errorCodes)
    && summary.errorCodes.every((error) => isRecord(error) && /^EVAL_[A-Z_]+$/.test(error.code) && Number.isSafeInteger(error.count))
}

function isAccuracy(value) {
  return isRecord(value) && ['documentType', 'grandTotal', 'lineItemFields'].every((key) => {
    const score = value[key]
    return isRecord(score) && Number.isSafeInteger(score.correct) && Number.isSafeInteger(score.total)
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
    const summary = await runEvaluation({ fixtureDir: root, manifest })
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
