import { createGoogleOcrPorts, type OcrDrivePort, type OcrSheetsPort } from './googleClient.js'
import { MASTER_HEADERS, MASTER_TABS } from './googleStore.js'

export interface SetupCheck {
  name: 'OAuth scopes' | 'private Drive hierarchy' | 'monthly ledgers folder' | 'master OCR workbook'
  status: 'READY' | 'CREATED'
  resourceId?: string
}

export async function runOcrSetup(input: {
  confirmCreate: boolean
  drive: OcrDrivePort
  sheets: OcrSheetsPort
  titlePrefix: string
  reportDefaults?: { dailyReportEnabled: boolean; dailyReportTime: string }
}): Promise<{ mode: 'DRY_RUN' | 'CREATED'; checks: SetupCheck[] }> {
  const checks: SetupCheck[] = [
    { name: 'OAuth scopes', status: 'READY' },
    { name: 'private Drive hierarchy', status: input.confirmCreate ? 'CREATED' : 'READY' },
    { name: 'monthly ledgers folder', status: input.confirmCreate ? 'CREATED' : 'READY' },
    { name: 'master OCR workbook', status: input.confirmCreate ? 'CREATED' : 'READY' },
  ]
  if (!input.confirmCreate) return { mode: 'DRY_RUN', checks }

  const rootId = await input.drive.createFolder(input.titlePrefix)
  checks[1].resourceId = rootId
  const monthlyLedgersFolderId = await input.drive.createFolder('Monthly Ledgers', rootId)
  checks[2].resourceId = monthlyLedgersFolderId
  const masterId = await input.sheets.create(`${input.titlePrefix} Master OCR Ledger`, [...MASTER_TABS])
  checks[3].resourceId = masterId
  for (const tab of MASTER_TABS) {
    const header = MASTER_HEADERS[tab]
    if (header.length) await input.sheets.append(masterId, `${tab}!A:ZZ`, [[...header]])
  }
  const reportDefaults = input.reportDefaults ?? { dailyReportEnabled: false, dailyReportTime: '20:00' }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reportDefaults.dailyReportTime)) throw new Error('Invalid setup report time')
  const updatedAt = new Date().toISOString()
  await input.sheets.append(masterId, 'CONFIG!A:ZZ', [
    ['dailyReportEnabled', String(reportDefaults.dailyReportEnabled), updatedAt],
    ['dailyReportTime', reportDefaults.dailyReportTime, updatedAt],
    ['dashboardUrl', `https://docs.google.com/spreadsheets/d/${encodeURIComponent(masterId)}/edit#gid=0`, updatedAt],
  ])
  return { mode: 'CREATED', checks }
}

async function main(): Promise<void> {
  const confirmCreate = process.argv.includes('--confirm-create')
  if (!confirmCreate) {
    process.stdout.write('DRY_RUN: OAuth scopes, private Drive hierarchy, monthly ledgers folder, master OCR workbook\n')
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
    reportDefaults: {
      dailyReportEnabled: process.env.OCR_DAILY_REPORT_ENABLED === 'true',
      dailyReportTime: process.env.OCR_DAILY_REPORT_TIME?.trim() || '20:00',
    },
  })
  process.stdout.write(`${result.mode}: ${result.checks.map((check) => check.resourceId ? `${check.name}=${check.resourceId}` : check.name).join(', ')}\n`)
}

if (process.argv[1]?.endsWith('/server/ocr-ledger/setup.js')) void main()
