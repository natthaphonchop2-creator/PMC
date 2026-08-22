export const OCR_LEDGER_SCHEMA_VERSION = 1

export type OcrDocumentType = 'TRANSFER_SLIP' | 'RECEIPT'
export type OcrDirection = 'INCOME' | 'EXPENSE'
export type OcrDocumentState =
  | 'RECEIVED' | 'STORED' | 'OCR_PROCESSING' | 'PENDING_REVIEW'
  | 'CONFIRMED' | 'CANCELLED' | 'RETRY_PENDING' | 'FAILED'
export type OcrJobType = 'INTAKE' | 'EDIT' | 'CONFIRM' | 'CANCEL' | 'RETRY' | 'REPORT_COMMAND'
export type OcrJobState = 'QUEUED' | 'LEASED' | 'DONE' | 'FAILED'

export type OcrWarningCode =
  | 'FUTURE_DATE' | 'HEADER_TOTAL_MISMATCH' | 'LINE_SUM_MISMATCH'
  | 'LOW_CONFIDENCE_REQUIRED_FIELD' | 'UNREADABLE_FIELD' | 'INVALID_DATE'
  | 'EXACT_IMAGE_DUPLICATE' | 'REPEATED_REFERENCE_NUMBER'

export interface OcrWarning {
  code: OcrWarningCode
  field: string | null
  message: string
}

export interface OcrLineItem {
  documentId?: string | null
  lineNumber: number
  description: string | null
  quantity: number | null
  unit: string | null
  unitPrice: number | null
  discountAmount: number | null
  taxAmount: number | null
  lineTotal: number | null
  categoryId: string | null
  confidence: number | null
}

export interface OcrDocument {
  documentId: string
  documentType: OcrDocumentType | null
  direction: OcrDirection | null
  state: OcrDocumentState
  documentDate: string | null
  documentTime: string | null
  counterpartyName: string | null
  currency: string | null
  subtotal: number | null
  discountAmount: number | null
  taxAmount: number | null
  serviceCharge: number | null
  grandTotal: number | null
  referenceNumber: string | null
  categoryId: string | null
  note: string | null
  sourceImageFileId: string | null
  sourceImageSha256: string | null
  sourceLineMessageId: string | null
  sourceLineUserId: string | null
  confidenceByField: Record<string, number | null>
  senderName: string | null
  senderBank: string | null
  senderAccountMasked: string | null
  receiverName: string | null
  receiverBank: string | null
  receiverAccountMasked: string | null
  transferDate: string | null
  transferTime: string | null
  amount: number | null
  merchantName: string | null
  merchantTaxId: string | null
  branch: string | null
  receiptNumber: string | null
  receiptDate: string | null
  paymentMethod: string | null
  draftVersion: number
  confirmedBy: string | null
  confirmedAt: string | null
  verificationStatus: 'STAFF_CONFIRMED' | null
  warnings: OcrWarning[]
}

export interface OcrDraft extends OcrDocument {
  lineItems: OcrLineItem[]
}

export interface OcrQueueJob {
  jobId: string
  jobType: OcrJobType
  documentId: string | null
  idempotencyKey: string
  payloadJson: string
  state: OcrJobState
  attempts: number
  availableAt: string
  leaseUntil: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

export interface OcrAction {
  documentId: string
  action: 'CONFIRM' | 'CANCEL' | 'EDIT' | 'RETRY'
  actorLineUserId: string
  actorDisplayName: string | null
  createdAt: string
}

export interface OcrTerminalDecisionRecord {
  documentId: string
  decision: 'CONFIRM' | 'CANCEL'
  actorLineUserId: string
  actorDisplayName: string
  decidedAt: string
  sourceJobId: string
  expectedVersion: number
}

export interface OcrExtraction {
  documentType: OcrDocumentType | null
  direction: OcrDirection | null
  documentDate: string | null
  documentTime?: string | null
  counterpartyName?: string | null
  currency: string | null
  subtotal: number | null
  discountAmount: number | null
  taxAmount: number | null
  serviceCharge: number | null
  grandTotal: number | null
  referenceNumber?: string | null
  categoryId?: string | null
  note?: string | null
  senderName: string | null
  senderBank: string | null
  senderAccountMasked: string | null
  receiverName: string | null
  receiverBank: string | null
  receiverAccountMasked: string | null
  transferDate: string | null
  transferTime: string | null
  amount: number | null
  merchantName: string | null
  merchantTaxId: string | null
  branch: string | null
  receiptNumber: string | null
  receiptDate: string | null
  paymentMethod: string | null
  sourceImageSha256?: string | null
  confidenceByField?: Record<string, number | null>
  lineItems: OcrLineItem[]
  confirmedHashes?: ReadonlySet<string>
  confirmedReferenceNumbers?: ReadonlySet<string>
}
