import { createGoogleOcrPorts, type OcrDrivePort, type OcrSheetsPort } from './googleClient.js'
import { MASTER_HEADERS, MASTER_TABS } from './googleStore.js'

export interface SetupCheck {
  name: 'OAuth scopes' | 'private Drive hierarchy' | 'master OCR workbook'
  status: 'READY' | 'CREATED'
  resourceId?: string
}

export async function runOcrSetup(input: {
  confirmCreate: boolean
  drive: OcrDrivePort
  sheets: OcrSheetsPort
  titlePrefix: string
}): Promise<{ mode: 'DRY_RUN' | 'CREATED'; checks: SetupCheck[] }> {
  const checks: SetupCheck[] = [
    { name: 'OAuth scopes', status: 'READY' },
    { name: 'private Drive hierarchy', status: input.confirmCreate ? 'CREATED' : 'READY' },
    { name: 'master OCR workbook', status: input.confirmCreate ? 'CREATED' : 'READY' },
  ]
  if (!input.confirmCreate) return { mode: 'DRY_RUN', checks }

  const rootId = await input.drive.createFolder(input.titlePrefix)
  checks[1].resourceId = rootId
  await input.drive.createFolder('Monthly Ledgers', rootId)
  const masterId = await input.sheets.create(`${input.titlePrefix} Master OCR Ledger`, [...MASTER_TABS])
  checks[2].resourceId = masterId
  for (const tab of MASTER_TABS) {
    const header = MASTER_HEADERS[tab]
    if (header.length) await input.sheets.append(masterId, `${tab}!A:ZZ`, [[...header]])
  }
  return { mode: 'CREATED', checks }
}

async function main(): Promise<void> {
  const confirmCreate = process.argv.includes('--confirm-create')
  if (!confirmCreate) {
    process.stdout.write('DRY_RUN: OAuth scopes, private Drive hierarchy, master OCR workbook\n')
    return
  }
  const clientId = process.env.OCR_GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.OCR_GOOGLE_CLIENT_SECRET?.trim()
  const refreshToken = process.env.OCR_GOOGLE_REFRESH_TOKEN?.trim()
  if (!clientId || !clientSecret || !refreshToken) {
    process.stderr.write('OCR Google OAuth configuration is incomplete\n')
    process.exitCode = 1
    return
  }
  const ports = createGoogleOcrPorts({ googleClientId: clientId, googleClientSecret: clientSecret, googleRefreshToken: refreshToken })
  const result = await runOcrSetup({
    confirmCreate, drive: ports.drive, sheets: ports.sheets, titlePrefix: 'PMC OCR',
  })
  process.stdout.write(`${result.mode}: ${result.checks.map((check) => check.resourceId ? `${check.name}=${check.resourceId}` : check.name).join(', ')}\n`)
}

if (process.argv[1]?.endsWith('/server/ocr-ledger/setup.js')) void main()
