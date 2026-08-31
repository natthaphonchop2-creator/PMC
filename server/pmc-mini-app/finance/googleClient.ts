import { createHash } from 'node:crypto'
import { isValidExpenseOriginalFileName } from '../../../shared/pmcExpense.js'
import { google } from 'googleapis'
import type {
  ExpensePrivateAttachment,
  ExpensePrivateAttachmentIdentity,
} from '../../../shared/pmcMiniAppExpenseIngress.js'
import { expenseFilePublicProperties } from '../../../shared/pmcMiniAppExpenseIngress.js'
import { inspectExpenseImage, type ExpenseImageMimeType } from './multipart.js'
import {
  expenseDriveSlotClaimId,
  expenseDriveSlotObjectKey,
  type ExpenseDriveSlotClaim,
} from './stagingStore.js'

export const FINANCE_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
] as const

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const INDEX_RANGE = "'EXPENSE_MONTHLY_INDEX'!A2:E"
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/
const SAFE_EXPENSE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/
const VERSION = /^[1-9]\d*$/
const DRIVE_FIELDS = 'id,name,description,mimeType,parents,trashed,size,version,appProperties,properties,permissions(id,type,role,deleted)'
const DRIVE_LIST_FIELDS = `incompleteSearch,nextPageToken,files(${DRIVE_FIELDS})`
const MASTER_TABS = new Set(['EXPENSE_MONTHLY_INDEX', 'EXPENSE_REQUESTS', 'EXPENSE_AUDIT'])
const MONTH_TABS = new Set(['EXPENSE_SUBMISSIONS', 'EXPENSE_ATTACHMENTS', 'MONTHLY_SUMMARY'])

interface GoogleResponse<T> { data: T }
type GoogleMethod<T> = (
  input: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<GoogleResponse<T>>

interface FinanceSheetsApi {
  spreadsheets: {
    values: {
      batchGet: GoogleMethod<{
        valueRanges?: Array<{ range?: string | null; values?: unknown[][] }>
      }>
    }
  }
}

interface DrivePermission {
  id?: string | null
  type?: string | null
  role?: string | null
  deleted?: boolean | null
}

interface DriveMetadata {
  id?: string | null
  name?: string | null
  description?: string | null
  mimeType?: string | null
  parents?: string[] | null
  trashed?: boolean | null
  size?: string | number | null
  version?: string | number | null
  appProperties?: Record<string, string> | null
  properties?: Record<string, string> | null
  permissions?: DrivePermission[] | null
}

interface FinanceDriveApi {
  files: {
    get: GoogleMethod<DriveMetadata | ArrayBuffer>
    list: GoogleMethod<{
      files?: DriveMetadata[]
      nextPageToken?: string | null
      incompleteSearch?: boolean | null
    }>
    create: GoogleMethod<DriveMetadata>
    delete: GoogleMethod<unknown>
  }
}

export interface FinanceGoogleFactory {
  createAuth(scopes: string[]): unknown
  createSheets(auth: unknown): FinanceSheetsApi
  createDrive(auth: unknown): FinanceDriveApi
}

export interface FinanceGoogleReadPorts {
  readMaster(ranges: string[]): Promise<Record<string, unknown[][]>>
  readMonth(monthKey: string, ranges: string[]): Promise<Record<string, unknown[][]>>
  downloadExpenseFile(input: {
    monthKey: string
    expenseId: string
    fileId: string
    expectedAttachment: ExpensePrivateAttachment
  }): Promise<{ bytes: Buffer; mimeType: ExpenseImageMimeType }>
}

export interface FinanceGoogleCapturePorts {
  ensureExpenseFolder(monthKey: string, expenseId: string): Promise<string>
  uploadExpenseImage(input: {
    monthKey: string
    expenseId: string
    parentId: string
    deterministicName: string
    bytes: Buffer
    mimeType: ExpenseImageMimeType
    ordinal: number
    sha256: string
    rootRequestId: string
    uploadedByStaffId: string
    uploadedAt: string
    originalFileName: string
    attachmentId: string
    slotClaim: ExpenseDriveSlotClaim
    allowClaimReplayCreate?: boolean
    readCurrentClaim?: () => Promise<ExpenseDriveSlotClaim>
  }): Promise<ExpensePrivateAttachment>
  verifyExpenseFile(input: {
    monthKey: string
    expenseId: string
    fileId: string
    expectedAttachment?: ExpensePrivateAttachment
  }): Promise<void>
  listVerifiedExpenseImages(
    monthKey: string,
    expenseId: string,
    registeredSlots?: ExpenseRegisteredSlot[],
  ): Promise<ExpensePrivateAttachment[]>
  deleteExpenseFileIfUnregistered(input: {
    monthKey: string
    expenseId: string
    fileId: string
    expectedAttachment: ExpensePrivateAttachment
    readCurrentClaim: () => Promise<ExpenseDriveSlotClaim>
  }): Promise<void>
}

export interface ExpenseRegisteredSlot {
  claim: ExpenseDriveSlotClaim
  expectedAttachment: ExpensePrivateAttachmentIdentity
  readCurrentClaim(): Promise<ExpenseDriveSlotClaim>
}

export interface FinanceGooglePorts extends FinanceGoogleReadPorts, FinanceGoogleCapturePorts {}

type ExpenseImageUploadInput = Parameters<FinanceGooglePorts['uploadExpenseImage']>[0]
type ExpenseFileCleanupInput = Parameters<FinanceGooglePorts['deleteExpenseFileIfUnregistered']>[0]

export function financeGoogleReadCapability(
  ports: FinanceGooglePorts,
): FinanceGoogleReadPorts {
  return {
    readMaster: ports.readMaster,
    readMonth: ports.readMonth,
    downloadExpenseFile: ports.downloadExpenseFile,
  }
}

export function financeGoogleCaptureCapability(
  ports: FinanceGooglePorts,
): FinanceGoogleCapturePorts {
  return {
    ensureExpenseFolder: ports.ensureExpenseFolder,
    uploadExpenseImage: ports.uploadExpenseImage,
    verifyExpenseFile: ports.verifyExpenseFile,
    listVerifiedExpenseImages: ports.listVerifiedExpenseImages,
    deleteExpenseFileIfUnregistered: ports.deleteExpenseFileIfUnregistered,
  }
}

export interface FinanceGoogleClientConfig {
  masterSpreadsheetId: string
  folderId: string
}

export type FinanceGoogleErrorCode =
  | 'EXPENSE_STORAGE_UNAVAILABLE'
  | 'EXPENSE_PRIVATE_FILE_INVALID'

export class FinanceGoogleError extends Error {
  readonly code: FinanceGoogleErrorCode

  constructor(code: FinanceGoogleErrorCode) {
    super(code)
    this.name = 'FinanceGoogleError'
    this.code = code
  }
}

const realGoogleFactory: FinanceGoogleFactory = {
  createAuth(scopes) {
    return new google.auth.GoogleAuth({ scopes })
  },
  createSheets(auth) {
    return google.sheets({
      version: 'v4',
      auth: auth as InstanceType<typeof google.auth.GoogleAuth>,
    }) as unknown as FinanceSheetsApi
  },
  createDrive(auth) {
    return google.drive({
      version: 'v3',
      auth: auth as InstanceType<typeof google.auth.GoogleAuth>,
    }) as unknown as FinanceDriveApi
  },
}

export function createFinanceGooglePorts(
  config: FinanceGoogleClientConfig,
  factory: FinanceGoogleFactory = realGoogleFactory,
): FinanceGooglePorts {
  const masterSpreadsheetId = requiredId(config.masterSpreadsheetId, 'EXPENSE_STORAGE_UNAVAILABLE')
  const financeFolderId = requiredId(config.folderId, 'EXPENSE_STORAGE_UNAVAILABLE')
  const auth = factory.createAuth([...FINANCE_GOOGLE_SCOPES])
  const sheetsApi = factory.createSheets(auth)
  const driveApi = factory.createDrive(auth)
  const folderFlights = new Map<string, Promise<string>>()
  const uploadFlights = new Map<string, {
    fingerprint: string
    promise: Promise<ExpensePrivateAttachment>
  }>()

  async function rootContext(code: FinanceGoogleErrorCode): Promise<DriveMetadata> {
    const root = await getMetadata(financeFolderId, code)
    requireBaseMetadata(root, {
      id: financeFolderId,
      mimeType: FOLDER_MIME,
      code,
    })
    return root
  }

  async function masterContext(): Promise<void> {
    await rootContext('EXPENSE_STORAGE_UNAVAILABLE')
    const master = await getMetadata(masterSpreadsheetId, 'EXPENSE_STORAGE_UNAVAILABLE')
    requireBaseMetadata(master, {
      id: masterSpreadsheetId,
      mimeType: SPREADSHEET_MIME,
      directParentId: financeFolderId,
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
  }

  async function resolveMonth(monthKey: string): Promise<{
    monthKey: string
    monthFolderId: string
    ledgerSpreadsheetId: string
  }> {
    requireMonthKey(monthKey, 'EXPENSE_STORAGE_UNAVAILABLE')
    await masterContext()
    const index = await batchRead(masterSpreadsheetId, [INDEX_RANGE])
    const rows = index[INDEX_RANGE] ?? []
    const parsed = rows.map(parseIndexRow)
    const matches = parsed.filter((row) => row.monthKey === monthKey)
    if (matches.length !== 1) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
    const selected = matches[0]!
    const monthFolder = await getMetadata(selected.monthFolderId, 'EXPENSE_STORAGE_UNAVAILABLE')
    requireBaseMetadata(monthFolder, {
      id: selected.monthFolderId,
      name: `PMC Expenses ${monthKey}`,
      mimeType: FOLDER_MIME,
      directParentId: financeFolderId,
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    const ledger = await getMetadata(selected.ledgerSpreadsheetId, 'EXPENSE_STORAGE_UNAVAILABLE')
    requireBaseMetadata(ledger, {
      id: selected.ledgerSpreadsheetId,
      name: `PMC Expenses ${monthKey}`,
      mimeType: SPREADSHEET_MIME,
      directParentId: selected.monthFolderId,
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    return selected
  }

  async function getMetadata(
    fileId: string,
    code: FinanceGoogleErrorCode,
  ): Promise<DriveMetadata> {
    const safeFileId = requiredId(fileId, code)
    try {
      const response = await driveApi.files.get({
        fileId: safeFileId,
        fields: DRIVE_FIELDS,
        supportsAllDrives: true,
      })
      if (!isRecord(response.data) || response.data instanceof ArrayBuffer) {
        throw new FinanceGoogleError(code)
      }
      return response.data as DriveMetadata
    } catch (error) {
      throw safeGoogleError(error, code)
    }
  }

  async function listChildren(
    parentId: string,
    code: FinanceGoogleErrorCode,
  ): Promise<DriveMetadata[]> {
    const safeParentId = requiredId(parentId, code)
    const found: DriveMetadata[] = []
    const seenIds = new Set<string>()
    let pageToken: string | undefined
    for (let page = 0; page < 100; page += 1) {
      let response: GoogleResponse<{
        files?: DriveMetadata[]
        nextPageToken?: string | null
        incompleteSearch?: boolean | null
      }>
      try {
        response = await driveApi.files.list({
          q: `'${safeParentId}' in parents and trashed = false`,
          spaces: 'drive',
          fields: DRIVE_LIST_FIELDS,
          pageSize: 1_000,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          ...(pageToken ? { pageToken } : {}),
        })
      } catch (error) {
        throw safeGoogleError(error, code)
      }
      if (!isRecord(response.data)) throw new FinanceGoogleError(code)
      if (response.data.incompleteSearch !== false) throw new FinanceGoogleError(code)
      const files = response.data.files ?? []
      if (!Array.isArray(files)) throw new FinanceGoogleError(code)
      for (const file of files) {
        if (!isRecord(file) || !safeId(file.id) || seenIds.has(file.id)) {
          throw new FinanceGoogleError(code)
        }
        seenIds.add(file.id)
        found.push(file)
      }
      const next = response.data.nextPageToken
      if (next === undefined || next === null || next === '') return found
      if (typeof next !== 'string' || next.length > 2_048) throw new FinanceGoogleError(code)
      pageToken = next
    }
    throw new FinanceGoogleError(code)
  }

  async function batchRead(
    spreadsheetId: string,
    ranges: string[],
  ): Promise<Record<string, unknown[][]>> {
    let response: GoogleResponse<{
      valueRanges?: Array<{ range?: string | null; values?: unknown[][] }>
    }>
    try {
      response = await sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      })
    } catch (error) {
      throw safeGoogleError(error, 'EXPENSE_STORAGE_UNAVAILABLE')
    }
    if (!isRecord(response.data)) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
    const returned = response.data.valueRanges ?? []
    if (!Array.isArray(returned)) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
    return Object.fromEntries(ranges.map((range) => {
      const matches = returned.filter((candidate) => (
        isRecord(candidate)
        && typeof candidate.range === 'string'
        && sheetRangeMatches(range, candidate.range)
      ))
      if (matches.length > 1) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
      const values = matches[0]?.values ?? []
      if (!Array.isArray(values) || values.some((row) => !Array.isArray(row))) {
        throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
      }
      return [range, values]
    }))
  }

  function relevantExpenseFolders(children: DriveMetadata[], expenseId: string): DriveMetadata[] {
    return children.filter((candidate) => candidate.mimeType === FOLDER_MIME && (
      candidate.name === expenseId || candidate.appProperties?.pmcExpenseId === expenseId
    ))
  }

  function validateExpenseFolder(
    folder: DriveMetadata,
    monthFolderId: string,
    monthKey: string,
    expenseId: string,
  ): string {
    requireBaseMetadata(folder, {
      id: requiredId(String(folder.id ?? ''), 'EXPENSE_PRIVATE_FILE_INVALID'),
      name: expenseId,
      mimeType: FOLDER_MIME,
      directParentId: monthFolderId,
      code: 'EXPENSE_PRIVATE_FILE_INVALID',
    })
    requireExactProperties(folder.appProperties, {
      pmcExpenseId: expenseId,
      pmcExpenseMonthKey: monthKey,
    }, 'EXPENSE_PRIVATE_FILE_INVALID')
    return folder.id!
  }

  async function existingExpenseFolder(
    monthKey: string,
    expenseId: string,
  ): Promise<{ monthFolderId: string; folderId: string }> {
    requireExpenseId(expenseId)
    const month = await resolveMonth(monthKey)
    const relevant = relevantExpenseFolders(
      await listChildren(month.monthFolderId, 'EXPENSE_PRIVATE_FILE_INVALID'),
      expenseId,
    )
    if (relevant.length !== 1) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    return {
      monthFolderId: month.monthFolderId,
      folderId: validateExpenseFolder(relevant[0]!, month.monthFolderId, monthKey, expenseId),
    }
  }

  async function ensureExpenseFolderInternal(monthKey: string, expenseId: string): Promise<string> {
    requireExpenseId(expenseId)
    const month = await resolveMonth(monthKey)
    const before = relevantExpenseFolders(
      await listChildren(month.monthFolderId, 'EXPENSE_PRIVATE_FILE_INVALID'),
      expenseId,
    )
    if (before.length > 1) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    if (before[0]) {
      return validateExpenseFolder(before[0], month.monthFolderId, monthKey, expenseId)
    }

    let created: GoogleResponse<DriveMetadata>
    try {
      created = await driveApi.files.create({
        requestBody: {
          name: expenseId,
          mimeType: FOLDER_MIME,
          parents: [month.monthFolderId],
          appProperties: {
            pmcExpenseId: expenseId,
            pmcExpenseMonthKey: monthKey,
          },
        },
        fields: DRIVE_FIELDS,
        supportsAllDrives: true,
      })
    } catch (error) {
      throw safeGoogleError(error, 'EXPENSE_PRIVATE_FILE_INVALID')
    }
    if (!safeId(created.data?.id)) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    const createdId = created.data.id
    const after = relevantExpenseFolders(
      await listChildren(month.monthFolderId, 'EXPENSE_PRIVATE_FILE_INVALID'),
      expenseId,
    )
    if (after.length !== 1 || after[0]?.id !== createdId) {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
    const pinned = await getMetadata(createdId, 'EXPENSE_PRIVATE_FILE_INVALID')
    return validateExpenseFolder(pinned, month.monthFolderId, monthKey, expenseId)
  }

  function attachmentDescription(input: {
    originalFileName: string
    uploadedAt: string
  }): string {
    return JSON.stringify({
      originalFileName: input.originalFileName,
      uploadedAt: input.uploadedAt,
    })
  }

  function expectedFileProperties(input: {
    monthKey: string
    attachment: ExpensePrivateAttachmentIdentity
  }): Record<string, string> {
    return expenseFilePublicProperties({
      monthKey: input.monthKey,
      attachment: input.attachment,
    }, (value) => createHash('sha256').update(value, 'utf8').digest('hex'))
  }

  function relevantExpenseFiles(
    children: DriveMetadata[],
    input: {
      expenseId: string
      ordinal: number
      deterministicName: string
      slotClaimId?: string
    },
  ): DriveMetadata[] {
    return children.filter((candidate) => candidate.mimeType !== FOLDER_MIME && (
      candidate.name === input.deterministicName
      || candidate.properties?.eid === createHash('sha256').update(input.expenseId, 'utf8').digest('hex')
        && candidate.properties?.ord === String(input.ordinal)
      || input.slotClaimId !== undefined
        && candidate.properties?.sid === input.slotClaimId
    ))
  }

  function uploadIdentity(
    input: ExpenseImageUploadInput,
    slotClaimId: string,
  ): ExpensePrivateAttachmentIdentity {
    return {
      attachmentId: input.attachmentId,
      expenseId: input.expenseId,
      rootRequestId: input.rootRequestId,
      ordinal: input.ordinal,
      mediaType: input.mimeType,
      originalFileName: input.originalFileName,
      deterministicName: input.deterministicName,
      slotClaimId,
      sha256: input.sha256,
      uploadedByStaffId: input.uploadedByStaffId,
      uploadedAt: input.uploadedAt,
    }
  }

  async function validatedExpenseFile(
    input: {
      monthKey: string
      expenseId: string
      folderId: string
      fileId: string
      expectedAttachment?: ExpensePrivateAttachment
      expectedIdentity?: ExpensePrivateAttachmentIdentity
    },
  ): Promise<{
    bytes: Buffer
    mimeType: ExpenseImageMimeType
    attachment: ExpensePrivateAttachment
  }> {
    const before = await getMetadata(input.fileId, 'EXPENSE_PRIVATE_FILE_INVALID')
    const attachment = validateExpenseFileMetadata(before, input)
    let media: GoogleResponse<DriveMetadata | ArrayBuffer>
    try {
      media = await driveApi.files.get({
        fileId: input.fileId,
        alt: 'media',
        supportsAllDrives: true,
      }, { responseType: 'arraybuffer' })
    } catch (error) {
      throw safeGoogleError(error, 'EXPENSE_PRIVATE_FILE_INVALID')
    }
    const bytes = arrayBuffer(media.data)
    if (
      bytes.length !== attachment.sizeBytes
      || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256
    ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    try {
      const inspected = await inspectExpenseImage({
        bytes,
        advertisedMime: attachment.mediaType,
        originalFileName: attachment.deterministicName,
      })
      if (inspected.mimeType !== attachment.mediaType) {
        throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
      }
    } catch {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
    const after = await getMetadata(input.fileId, 'EXPENSE_PRIVATE_FILE_INVALID')
    validateExpenseFileMetadata(after, input)
    if (canonicalIdentity(before) !== canonicalIdentity(after)) {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
    return { bytes, mimeType: attachment.mediaType, attachment }
  }

  function validateExpenseFileMetadata(
    metadata: DriveMetadata,
    input: {
      monthKey: string
      expenseId: string
      folderId: string
      fileId: string
      expectedAttachment?: ExpensePrivateAttachment
      expectedIdentity?: ExpensePrivateAttachmentIdentity
    },
  ): ExpensePrivateAttachment {
    const properties = metadata.properties
    const ordinal = Number(properties?.ord)
    const sha256 = properties?.sha
    const mimeType = metadata.mimeType
    const sizeBytes = Number(metadata.size)
    const driveVersion = String(metadata.version ?? '')
    const expectedIdentity = input.expectedAttachment ?? input.expectedIdentity
    const slotClaimId = expectedIdentity?.slotClaimId
    const rootRequestId = expectedIdentity?.rootRequestId
    const uploadedByStaffId = expectedIdentity?.uploadedByStaffId
    const attachmentId = expectedIdentity?.attachmentId
    const parsedDescription = parseAttachmentDescription(metadata.description)
    if (
      !Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 5
      || typeof sha256 !== 'string' || !SHA256.test(sha256)
      || !safeImageMime(mimeType)
      || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10_000_000
      || !VERSION.test(driveVersion)
      || typeof slotClaimId !== 'string' || !/^SLOT-[a-f0-9]{64}$/.test(slotClaimId)
      || typeof rootRequestId !== 'string' || !SAFE_EXPENSE_ID.test(rootRequestId)
      || typeof uploadedByStaffId !== 'string' || !SAFE_EXPENSE_ID.test(uploadedByStaffId)
      || typeof attachmentId !== 'string' || !SAFE_EXPENSE_ID.test(attachmentId)
      || !expectedIdentity
      || expectedIdentity.expenseId !== input.expenseId
      || expectedIdentity.ordinal !== ordinal
      || expectedIdentity.mediaType !== mimeType
      || expectedIdentity.originalFileName !== parsedDescription.originalFileName
      || expectedIdentity.deterministicName !== deterministicFileName(ordinal, sha256, mimeType)
      || expectedIdentity.sha256 !== sha256
      || expectedIdentity.uploadedAt !== parsedDescription.uploadedAt
    ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    const name = deterministicFileName(ordinal, sha256, mimeType)
    const description = attachmentDescription(parsedDescription)
    if (
      metadata.description !== description
    ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    requireBaseMetadata(metadata, {
      id: input.fileId,
      name,
      mimeType,
      directParentId: input.folderId,
      code: 'EXPENSE_PRIVATE_FILE_INVALID',
      requireVersion: true,
    })
    requireExactProperties(properties, expectedFileProperties({
      monthKey: input.monthKey,
      attachment: expectedIdentity,
    }), 'EXPENSE_PRIVATE_FILE_INVALID')
    const attachment: ExpensePrivateAttachment = {
      attachmentId,
      expenseId: input.expenseId,
      rootRequestId,
      ordinal,
      mediaType: mimeType,
      originalFileName: parsedDescription.originalFileName,
      privateFileId: input.fileId,
      deterministicName: name,
      sizeBytes,
      driveVersion,
      slotClaimId,
      sha256,
      uploadedByStaffId,
      uploadedAt: parsedDescription.uploadedAt,
    }
    if (input.expectedAttachment && JSON.stringify(attachment) !== JSON.stringify(input.expectedAttachment)) {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
    return attachment
  }

  async function deleteExpenseFileIfUnregisteredInternal(
    input: ExpenseFileCleanupInput,
  ): Promise<void> {
    const initialClaim = registeredClaimForAttachment(
      await input.readCurrentClaim(),
      input.expectedAttachment,
    )
    if (!initialClaim || input.fileId === initialClaim.registeredFileId) return
    const context = await existingExpenseFolder(input.monthKey, input.expenseId)
    await validatedExpenseFile({
      monthKey: input.monthKey,
      expenseId: input.expenseId,
      folderId: context.folderId,
      fileId: input.fileId,
      expectedAttachment: input.expectedAttachment,
    })
    const before = await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID')
    if (
      !before.some(({ id }) => id === input.fileId)
      || !before.some(({ id }) => id === initialClaim.registeredFileId)
    ) return
    const currentClaim = registeredClaimForAttachment(
      await input.readCurrentClaim(),
      input.expectedAttachment,
    )
    if (
      !currentClaim
      || currentClaim.registeredFileId !== initialClaim.registeredFileId
      || registeredClaimIdentity(currentClaim) !== registeredClaimIdentity(initialClaim)
    ) return
    try {
      await driveApi.files.delete({ fileId: input.fileId, supportsAllDrives: true })
    } catch (error) {
      throw safeGoogleError(error, 'EXPENSE_PRIVATE_FILE_INVALID')
    }
    const remaining = await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID')
    if (remaining.some(({ id }) => id === input.fileId)) {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
    if (!remaining.some(({ id }) => id === currentClaim.registeredFileId)) {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
  }

  async function uploadExpenseImageInternal(
    input: ExpenseImageUploadInput,
  ): Promise<ExpensePrivateAttachment> {
    validateUploadInput(input)
    const context = await existingExpenseFolder(input.monthKey, input.expenseId)
    if (context.folderId !== input.parentId) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    const description = attachmentDescription(input)
    const expectedIdentity = uploadIdentity(input, input.slotClaim.claimId)
    const expectedProperties = expectedFileProperties({ monthKey: input.monthKey, attachment: expectedIdentity })
    const children = await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID')
    const before = relevantExpenseFiles(children, {
      ...input,
      slotClaimId: input.slotClaim.claimId,
    })
    if (before.length > 1) {
      if (
        input.slotClaim.state !== 'REGISTERED'
        || input.slotClaim.registeredFileId === null
        || typeof input.readCurrentClaim !== 'function'
      ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
      const winnerMetadata = before.filter(({ id }) => id === input.slotClaim.registeredFileId)
      if (winnerMetadata.length !== 1) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
      const winner = (await validatedExpenseFile({
        monthKey: input.monthKey,
        expenseId: input.expenseId,
          folderId: context.folderId,
          fileId: input.slotClaim.registeredFileId,
          expectedIdentity,
      })).attachment
      for (const candidate of before.filter(({ id }) => id !== winner.privateFileId)) {
        const fileId = requiredId(String(candidate.id ?? ''), 'EXPENSE_PRIVATE_FILE_INVALID')
        const loser = (await validatedExpenseFile({
          monthKey: input.monthKey,
          expenseId: input.expenseId,
          folderId: context.folderId,
          fileId,
          expectedIdentity,
        })).attachment
        await deleteExpenseFileIfUnregisteredInternal({
          monthKey: input.monthKey,
          expenseId: input.expenseId,
          fileId,
          expectedAttachment: loser,
          readCurrentClaim: input.readCurrentClaim,
        })
      }
      const remaining = relevantExpenseFiles(
        await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID'),
        { ...input, slotClaimId: input.slotClaim.claimId },
      )
      if (remaining.length !== 1 || remaining[0]?.id !== winner.privateFileId) {
        throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
      }
      return winner
    }
    if (before[0]) {
      const fileId = requiredId(String(before[0].id ?? ''), 'EXPENSE_PRIVATE_FILE_INVALID')
      if (input.slotClaim.state === 'REGISTERED' && input.slotClaim.registeredFileId !== fileId) {
        throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
      }
      return (await validatedExpenseFile({
        monthKey: input.monthKey,
        expenseId: input.expenseId,
        folderId: context.folderId,
        fileId,
        expectedIdentity,
      })).attachment
    }
    if (input.slotClaim.state === 'REGISTERED') {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }

    let created: GoogleResponse<DriveMetadata>
    try {
      created = await driveApi.files.create({
        requestBody: {
          name: input.deterministicName,
          description,
          parents: [context.folderId],
          properties: expectedProperties,
        },
        media: { mimeType: input.mimeType, body: input.bytes },
        fields: DRIVE_FIELDS,
        supportsAllDrives: true,
      })
    } catch (error) {
      throw safeGoogleError(error, 'EXPENSE_PRIVATE_FILE_INVALID')
    }
    const createdId = requiredId(String(created.data?.id ?? ''), 'EXPENSE_PRIVATE_FILE_INVALID')
    const createdAttachment = (await validatedExpenseFile({
      monthKey: input.monthKey,
      expenseId: input.expenseId,
      folderId: context.folderId,
      fileId: createdId,
      expectedIdentity,
    })).attachment
    const after = relevantExpenseFiles(
      await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID'),
      { ...input, slotClaimId: input.slotClaim.claimId },
    )
    if (!after.some(({ id }) => id === createdId)) {
      throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
    }
    return createdAttachment
  }

  return {
    async readMaster(ranges) {
      return withSafeGoogleError('EXPENSE_STORAGE_UNAVAILABLE', async () => {
        validateRanges(ranges, MASTER_TABS)
        await masterContext()
        return batchRead(masterSpreadsheetId, ranges)
      })
    },

    async readMonth(monthKey, ranges) {
      return withSafeGoogleError('EXPENSE_STORAGE_UNAVAILABLE', async () => {
        validateRanges(ranges, MONTH_TABS)
        const context = await resolveMonth(monthKey)
        return batchRead(context.ledgerSpreadsheetId, ranges)
      })
    },

    async ensureExpenseFolder(monthKey, expenseId) {
      const key = `${monthKey}:${expenseId}`
      return singleFlight(folderFlights, key, () => withSafeGoogleError(
        'EXPENSE_PRIVATE_FILE_INVALID',
        () => ensureExpenseFolderInternal(monthKey, expenseId),
      ))
    },

    async uploadExpenseImage(input) {
      try {
        validateUploadInput(input)
        const key = `${input.monthKey}:${input.expenseId}:${input.ordinal}:${input.slotClaim.claimId}`
        const fingerprint = uploadInputFingerprint(input)
        const current = uploadFlights.get(key)
        if (current) {
          if (current.fingerprint !== fingerprint) {
            throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
          }
          return current.promise
        }
        const promise = withSafeGoogleError(
          'EXPENSE_PRIVATE_FILE_INVALID',
          () => uploadExpenseImageInternal(input),
        ).finally(() => {
          if (uploadFlights.get(key)?.promise === promise) uploadFlights.delete(key)
        })
        uploadFlights.set(key, { fingerprint, promise })
        return promise
      } catch (error) {
        throw safeGoogleError(error, 'EXPENSE_PRIVATE_FILE_INVALID')
      }
    },

    async verifyExpenseFile(input) {
      await withSafeGoogleError('EXPENSE_PRIVATE_FILE_INVALID', async () => {
        const context = await existingExpenseFolder(input.monthKey, input.expenseId)
        await validatedExpenseFile({
          monthKey: input.monthKey,
          expenseId: input.expenseId,
          fileId: input.fileId,
          folderId: context.folderId,
          ...(input.expectedAttachment ? { expectedAttachment: input.expectedAttachment } : {}),
        })
      })
    },

    async listVerifiedExpenseImages(monthKey, expenseId, registeredSlots = []) {
      return withSafeGoogleError('EXPENSE_PRIVATE_FILE_INVALID', async () => {
        const context = await existingExpenseFolder(monthKey, expenseId)
        if (registeredSlots.length < 1 || registeredSlots.length > 5) {
          throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
        }
        {
          const ordinals = new Set<number>()
          for (const slot of registeredSlots) {
            const claim = slot.claim
            if (
              claim.state !== 'REGISTERED'
              || claim.registeredFileId === null
              || claim.expenseId !== expenseId
              || ordinals.has(claim.ordinal)
              || typeof slot.readCurrentClaim !== 'function'
              || slot.expectedAttachment.expenseId !== expenseId
              || slot.expectedAttachment.rootRequestId !== claim.rootRequestId
              || slot.expectedAttachment.ordinal !== claim.ordinal
              || slot.expectedAttachment.mediaType !== claim.mimeType
              || slot.expectedAttachment.deterministicName !== claim.deterministicName
              || slot.expectedAttachment.slotClaimId !== claim.claimId
              || slot.expectedAttachment.sha256 !== claim.sha256
            ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
            ordinals.add(claim.ordinal)
            const children = await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID')
            const candidates = relevantExpenseFiles(children, {
              expenseId,
              ordinal: claim.ordinal,
              deterministicName: claim.deterministicName,
              slotClaimId: claim.claimId,
            })
            if (!candidates.some(({ id }) => id === claim.registeredFileId)) {
              throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
            }
            for (const candidate of candidates.filter(({ id }) => id !== claim.registeredFileId)) {
              const fileId = requiredId(String(candidate.id ?? ''), 'EXPENSE_PRIVATE_FILE_INVALID')
              const loser = (await validatedExpenseFile({
                monthKey,
                expenseId,
                folderId: context.folderId,
                fileId,
                expectedIdentity: slot.expectedAttachment,
              })).attachment
              await deleteExpenseFileIfUnregisteredInternal({
                monthKey,
                expenseId,
                fileId,
                expectedAttachment: loser,
                readCurrentClaim: slot.readCurrentClaim,
              })
            }
          }
        }
        const before = (await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID'))
          .filter(({ mimeType }) => mimeType !== FOLDER_MIME)
        if (before.length < 1 || before.length > 5) {
          throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
        }
        const verified: ExpensePrivateAttachment[] = []
        for (const metadata of before) {
          const fileId = requiredId(String(metadata.id ?? ''), 'EXPENSE_PRIVATE_FILE_INVALID')
          const slot = registeredSlots.find(({ claim }) => claim.registeredFileId === fileId)
          if (!slot) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
          verified.push((await validatedExpenseFile({
            monthKey,
            expenseId,
            folderId: context.folderId,
            fileId,
            expectedIdentity: slot.expectedAttachment,
          })).attachment)
        }
        verified.sort((left, right) => left.ordinal - right.ordinal)
        if (
          verified.some((attachment, index) => attachment.ordinal !== index + 1)
          || new Set(verified.map(({ privateFileId }) => privateFileId)).size !== verified.length
          || new Set(verified.map(({ slotClaimId }) => slotClaimId)).size !== verified.length
        ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
        const after = (await listChildren(context.folderId, 'EXPENSE_PRIVATE_FILE_INVALID'))
          .filter(({ mimeType }) => mimeType !== FOLDER_MIME)
          .map(({ id }) => id)
          .sort()
        const expectedIds = verified.map(({ privateFileId }) => privateFileId).sort()
        if (JSON.stringify(after) !== JSON.stringify(expectedIds)) {
          throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
        }
        return verified
      })
    },

    async deleteExpenseFileIfUnregistered(input) {
      await withSafeGoogleError(
        'EXPENSE_PRIVATE_FILE_INVALID',
        () => deleteExpenseFileIfUnregisteredInternal(input),
      )
    },

    async downloadExpenseFile(input) {
      return withSafeGoogleError('EXPENSE_PRIVATE_FILE_INVALID', async () => {
        const context = await existingExpenseFolder(input.monthKey, input.expenseId)
        const result = await validatedExpenseFile({ ...input, folderId: context.folderId })
        return { bytes: result.bytes, mimeType: result.mimeType }
      })
    },
  }
}

function parseIndexRow(row: unknown[]): {
  monthKey: string
  ledgerSpreadsheetId: string
  monthFolderId: string
} {
  if (row.length !== 5) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
  const [monthKey, ledgerSpreadsheetId, monthFolderId, createdAt, updatedAt] = row
  if (
    typeof monthKey !== 'string'
    || typeof ledgerSpreadsheetId !== 'string'
    || typeof monthFolderId !== 'string'
    || typeof createdAt !== 'string'
    || typeof updatedAt !== 'string'
    || !Number.isFinite(Date.parse(createdAt))
    || !Number.isFinite(Date.parse(updatedAt))
  ) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
  requireMonthKey(monthKey, 'EXPENSE_STORAGE_UNAVAILABLE')
  return {
    monthKey,
    ledgerSpreadsheetId: requiredId(ledgerSpreadsheetId, 'EXPENSE_STORAGE_UNAVAILABLE'),
    monthFolderId: requiredId(monthFolderId, 'EXPENSE_STORAGE_UNAVAILABLE'),
  }
}

function requireBaseMetadata(
  metadata: DriveMetadata,
  expected: {
    id: string
    name?: string
    mimeType: string
    directParentId?: string
    code: FinanceGoogleErrorCode
    requireVersion?: boolean
  },
): void {
  if (
    metadata.id !== expected.id
    || metadata.mimeType !== expected.mimeType
    || expected.name !== undefined && metadata.name !== expected.name
    || metadata.trashed !== false
    || !privatePermissions(metadata.permissions)
    || expected.directParentId !== undefined && !exactParent(metadata.parents, expected.directParentId)
    || expected.requireVersion === true && !safeVersion(metadata.version)
  ) throw new FinanceGoogleError(expected.code)
}

function privatePermissions(value: DrivePermission[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((permission) => (
    isRecord(permission)
    && typeof permission.id === 'string'
    && permission.id.length > 0
    && (permission.type === 'user' || permission.type === 'group')
    && typeof permission.role === 'string'
    && permission.role.length > 0
    && permission.deleted !== true
  ))
}

function exactParent(parents: string[] | null | undefined, parentId: string): boolean {
  return Array.isArray(parents) && parents.length === 1 && parents[0] === parentId
}

function requireExactProperties(
  actual: Record<string, string> | null | undefined,
  expected: Record<string, string>,
  code: FinanceGoogleErrorCode,
): void {
  if (!isRecord(actual)) throw new FinanceGoogleError(code)
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || expectedKeys.some((key) => actual[key] !== expected[key])
  ) throw new FinanceGoogleError(code)
}

function validateUploadInput(input: ExpenseImageUploadInput): void {
  requireMonthKey(input.monthKey, 'EXPENSE_PRIVATE_FILE_INVALID')
  requireExpenseId(input.expenseId)
  requiredId(input.parentId, 'EXPENSE_PRIVATE_FILE_INVALID')
  if (
    !Buffer.isBuffer(input.bytes)
    || input.bytes.length < 1
    || input.bytes.length > 10_000_000
    || !safeImageMime(input.mimeType)
    || !Number.isSafeInteger(input.ordinal)
    || input.ordinal < 1
    || input.ordinal > 5
    || !SHA256.test(input.sha256)
    || createHash('sha256').update(input.bytes).digest('hex') !== input.sha256
    || input.deterministicName !== deterministicFileName(input.ordinal, input.sha256, input.mimeType)
    || !SAFE_EXPENSE_ID.test(input.rootRequestId)
    || !SAFE_EXPENSE_ID.test(input.uploadedByStaffId)
    || !SAFE_EXPENSE_ID.test(input.attachmentId)
    || !isValidExpenseOriginalFileName(input.originalFileName)
    || !validTimestamp(input.uploadedAt)
    || input.readCurrentClaim !== undefined && typeof input.readCurrentClaim !== 'function'
  ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
  validateSlotClaim(input)
}

function uploadInputFingerprint(input: ExpenseImageUploadInput): string {
  return createHash('sha256').update(JSON.stringify({
    monthKey: input.monthKey,
    expenseId: input.expenseId,
    parentId: input.parentId,
    deterministicName: input.deterministicName,
    sizeBytes: input.bytes.length,
    mimeType: input.mimeType,
    ordinal: input.ordinal,
    sha256: input.sha256,
    rootRequestId: input.rootRequestId,
    uploadedByStaffId: input.uploadedByStaffId,
    uploadedAt: input.uploadedAt,
    originalFileName: input.originalFileName,
    attachmentId: input.attachmentId,
    slotClaim: input.slotClaim,
    allowClaimReplayCreate: input.allowClaimReplayCreate === true,
  }), 'utf8').digest('hex')
}

function validateSlotClaim(input: ExpenseImageUploadInput): void {
  const claim = input.slotClaim
  if (
    !isRecord(claim)
    || !hasExactKeys(claim, [
      'objectKey', 'claimId', 'generation', 'createdAt', 'updatedAt', 'state',
      'leaseId', 'leaseOwnerId', 'leaseGeneration', 'registeredFileId',
      'rootRequestId', 'expenseId', 'ordinal', 'sha256', 'mimeType', 'deterministicName',
    ])
    || claim.rootRequestId !== input.rootRequestId
    || claim.expenseId !== input.expenseId
    || claim.ordinal !== input.ordinal
    || claim.sha256 !== input.sha256
    || claim.mimeType !== input.mimeType
    || claim.deterministicName !== input.deterministicName
    || claim.objectKey !== expenseDriveSlotObjectKey(claim)
    || claim.claimId !== expenseDriveSlotClaimId(claim)
    || !VERSION.test(claim.generation)
    || !validTimestamp(claim.createdAt)
    || !validTimestamp(claim.updatedAt)
    || (claim.state !== 'CLAIMED' && claim.state !== 'REGISTERED')
    || !/^LEASE-[a-f0-9]{64}$/.test(claim.leaseId)
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(claim.leaseOwnerId)
    || !VERSION.test(claim.leaseGeneration)
    || (claim.state === 'CLAIMED' && claim.registeredFileId !== null)
    || (claim.state === 'REGISTERED' && !SAFE_EXPENSE_ID.test(String(claim.registeredFileId ?? '')))
  ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
}

function registeredClaimForAttachment(
  value: unknown,
  attachment: ExpensePrivateAttachment,
): ExpenseDriveSlotClaim | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'objectKey', 'claimId', 'generation', 'createdAt', 'updatedAt', 'state',
      'leaseId', 'leaseOwnerId', 'leaseGeneration', 'registeredFileId',
      'rootRequestId', 'expenseId', 'ordinal', 'sha256', 'mimeType', 'deterministicName',
    ])
    || value.state !== 'REGISTERED'
    || typeof value.registeredFileId !== 'string'
    || !SAFE_EXPENSE_ID.test(value.registeredFileId)
    || value.rootRequestId !== attachment.rootRequestId
    || value.expenseId !== attachment.expenseId
    || value.ordinal !== attachment.ordinal
    || value.sha256 !== attachment.sha256
    || value.mimeType !== attachment.mediaType
    || value.deterministicName !== attachment.deterministicName
    || value.claimId !== attachment.slotClaimId
    || value.objectKey !== expenseDriveSlotObjectKey(value as unknown as ExpenseDriveSlotClaim)
    || value.claimId !== expenseDriveSlotClaimId(value as unknown as ExpenseDriveSlotClaim)
    || !VERSION.test(String(value.generation ?? ''))
    || !validTimestamp(value.createdAt)
    || !validTimestamp(value.updatedAt)
    || !/^LEASE-[a-f0-9]{64}$/.test(String(value.leaseId ?? ''))
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(String(value.leaseOwnerId ?? ''))
    || !VERSION.test(String(value.leaseGeneration ?? ''))
  ) return null
  return value as unknown as ExpenseDriveSlotClaim
}

function registeredClaimIdentity(claim: ExpenseDriveSlotClaim): string {
  return JSON.stringify({
    objectKey: claim.objectKey,
    claimId: claim.claimId,
    generation: claim.generation,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    state: claim.state,
    leaseId: claim.leaseId,
    leaseOwnerId: claim.leaseOwnerId,
    leaseGeneration: claim.leaseGeneration,
    registeredFileId: claim.registeredFileId,
    rootRequestId: claim.rootRequestId,
    expenseId: claim.expenseId,
    ordinal: claim.ordinal,
    sha256: claim.sha256,
    mimeType: claim.mimeType,
    deterministicName: claim.deterministicName,
  })
}

function deterministicFileName(
  ordinal: number,
  sha256: string,
  mimeType: ExpenseImageMimeType,
): string {
  return `${String(ordinal).padStart(3, '0')}-${sha256}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
}

function parseAttachmentDescription(value: string | null | undefined): {
  originalFileName: string
  uploadedAt: string
} {
  let parsed: unknown
  try { parsed = JSON.parse(value ?? '') } catch { parsed = null }
  if (
    !isRecord(parsed)
    || !hasExactKeys(parsed, ['originalFileName', 'uploadedAt'])
    || !isValidExpenseOriginalFileName(parsed.originalFileName)
    || !validTimestamp(parsed.uploadedAt)
  ) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
  return { originalFileName: parsed.originalFileName, uploadedAt: parsed.uploadedAt }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function canonicalIdentity(metadata: DriveMetadata): string {
  return JSON.stringify({
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    mimeType: metadata.mimeType,
    parents: metadata.parents,
    trashed: metadata.trashed,
    size: String(metadata.size),
    version: String(metadata.version),
    appProperties: metadata.appProperties,
    properties: metadata.properties,
    permissions: [...(metadata.permissions ?? [])]
      .map((permission) => ({
        id: permission.id,
        type: permission.type,
        role: permission.role,
        deleted: permission.deleted === true,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  })
}

function arrayBuffer(value: DriveMetadata | ArrayBuffer): Buffer {
  if (!(value instanceof ArrayBuffer)) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
  return Buffer.from(value)
}

function validateRanges(ranges: string[], allowedTabs: ReadonlySet<string>): void {
  if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > 20) {
    throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
  }
  for (const range of ranges) {
    if (
      typeof range !== 'string'
      || range.length < 3
      || range.length > 512
      || /[\r\n]/.test(range)
    ) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
    const normalized = range.replaceAll('$', '')
    const match = /^(?:'([A-Za-z0-9_]+)'|([A-Za-z0-9_]+))!/.exec(normalized)
    const tab = match?.[1] ?? match?.[2]
    if (!tab || !allowedTabs.has(tab)) throw new FinanceGoogleError('EXPENSE_STORAGE_UNAVAILABLE')
  }
}

function normalizeA1(range: string): string {
  return range.replaceAll("'", '').replaceAll('$', '').toUpperCase()
}

function sheetRangeMatches(requested: string, returned: string): boolean {
  const expected = normalizeA1(requested)
  const actual = normalizeA1(returned)
  if (expected === actual) return true
  const expectedParts = /^([^!]+)!([A-Z]+)(\d*):([A-Z]+)(\d*)$/.exec(expected)
  const actualParts = /^([^!]+)!([A-Z]+)(\d*):([A-Z]+)(\d*)$/.exec(actual)
  if (!expectedParts || !actualParts) return false
  const [, expectedSheet, expectedStartColumn, expectedStartRow, expectedEndColumn, expectedEndRow] = expectedParts
  const [, actualSheet, actualStartColumn, actualStartRow, actualEndColumn, actualEndRow] = actualParts
  return expectedSheet === actualSheet
    && expectedStartColumn === actualStartColumn
    && expectedEndColumn === actualEndColumn
    && (expectedStartRow ? expectedStartRow === actualStartRow : actualStartRow === '1')
    && (expectedEndRow ? expectedEndRow === actualEndRow : /^\d+$/.test(actualEndRow))
}

function requireMonthKey(value: string, code: FinanceGoogleErrorCode): void {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new FinanceGoogleError(code)
}

function requireExpenseId(value: string): void {
  if (!SAFE_EXPENSE_ID.test(value)) throw new FinanceGoogleError('EXPENSE_PRIVATE_FILE_INVALID')
}

function requiredId(value: string, code: FinanceGoogleErrorCode): string {
  const normalized = value.trim()
  if (!SAFE_ID.test(normalized)) throw new FinanceGoogleError(code)
  return normalized
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

function safeImageMime(value: unknown): value is ExpenseImageMimeType {
  return value === 'image/jpeg' || value === 'image/png'
}

function safeVersion(value: string | number | null | undefined): boolean {
  return typeof value === 'number'
    ? Number.isSafeInteger(value) && value > 0
    : typeof value === 'string' && VERSION.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function safeGoogleError(
  error: unknown,
  fallback: FinanceGoogleErrorCode,
): FinanceGoogleError {
  return error instanceof FinanceGoogleError ? error : new FinanceGoogleError(fallback)
}

async function withSafeGoogleError<T>(
  fallback: FinanceGoogleErrorCode,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw safeGoogleError(error, fallback)
  }
}

function singleFlight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const current = flights.get(key)
  if (current) return current
  const pending = operation().finally(() => {
    if (flights.get(key) === pending) flights.delete(key)
  })
  flights.set(key, pending)
  return pending
}
