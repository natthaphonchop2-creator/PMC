import type { OcrDraft } from '../../src/apps/ocr-ledger/contracts.js'
import { signReviewToken, type ReviewTokenAction } from './security.js'

type FlexAction = { type: 'postback'; label: string; data: string } | { type: 'uri'; label: string; uri: string }
type FlexText = { type: 'text'; text: string; [key: string]: unknown }

export interface DraftFlexOptions {
  groupId: string
  reviewSigningSecret: string
  liffUrl: string
  now: number
}

export interface ReportMessageOptions {
  title: string
  entries: Array<{ label: string; value?: string | null }>
}

export interface PendingReportMessageOptions {
  title: string
  totalPending: number
  entries: Array<{ label: string; value?: string | null; reviewUri: string }>
}

export interface FlexMessage {
  type: 'flex'
  altText: string
  contents: Record<string, unknown>
}

const DAY_SECONDS = 24 * 60 * 60
const MAX_VISIBLE_VALUE_LENGTH = 160

export function buildDraftFlex(draft: OcrDraft, options: DraftFlexOptions): FlexMessage {
  const details = draftDetails(draft)
  const itemRows = draft.lineItems.slice(0, 5).map((item) => text(itemSummary(item.description, item.quantity, item.lineTotal, draft.currency)))
  if (draft.lineItems.length > 5) itemRows.push(text(`+${draft.lineItems.length - 5} รายการ`, { color: '#6B7280' }))
  const warnings = draft.warnings.length > 0 ? [text('ต้องตรวจสอบ', { color: '#B45309', weight: 'bold' }), ...draft.warnings.map((warning) => text(truncate(warning.message), { color: '#B45309', size: 'sm' }))] : []

  return flex('รายการรอตรวจสอบ', [
    ...warnings,
    ...details,
    ...(itemRows.length > 0 ? [text('รายการสินค้า', { weight: 'bold', margin: 'md' }), ...itemRows] : []),
  ], [
    reviewUriAction('แก้ไขข้อมูล', draft, options),
    postbackAction('ยืนยัน', 'CONFIRM', draft, options),
    postbackAction('ยกเลิก', 'CANCEL', draft, options),
    postbackAction('อ่านใหม่', 'RETRY', draft, options),
  ])
}

export function buildFinalFlex(draft: OcrDraft): FlexMessage {
  if (draft.state !== 'CONFIRMED' && draft.state !== 'CANCELLED') throw new Error('Final Flex requires final document state')
  const title = draft.state === 'CANCELLED' ? 'ยกเลิกรายการแล้ว' : 'ยืนยันรายการแล้ว'
  return flex(title, [
    ...draftDetails(draft),
    ...(draft.confirmedBy ? [text(`ยืนยันโดย ${truncate(draft.confirmedBy)}`, { color: '#15803D' })] : []),
  ])
}

export function buildReportMessage(options: ReportMessageOptions): FlexMessage {
  return flex(truncate(options.title), options.entries.flatMap(({ label, value }) => value ? [text(truncate(label), { weight: 'bold' }), text(truncate(value), { color: '#374151', size: 'sm' })] : [text(truncate(label))]), [], 'รายงานบัญชี')
}

export function buildPendingReportMessage(options: PendingReportMessageOptions): FlexMessage {
  const summary = bubble(options.title, [text(`รอตรวจสอบทั้งหมด ${options.totalPending} รายการ`, { color: '#374151', size: 'sm' })])
  const entries = options.entries.slice(0, 10).map(({ label, value, reviewUri }) => {
    const rows = value ? [text(label, { weight: 'bold' }), text(value, { color: '#374151', size: 'sm' })] : [text(label, { weight: 'bold' })]
    return bubble('รายการรอตรวจสอบ', rows, [{ type: 'uri', label: 'เปิดตรวจสอบ', uri: reviewUri }])
  })
  return { type: 'flex', altText: 'รายงานบัญชี', contents: { type: 'carousel', contents: [summary, ...entries] } }
}

function flex(title: string, contents: FlexText[], actions: FlexAction[] = [], altText = title): FlexMessage {
  return { type: 'flex', altText, contents: bubble(title, contents, actions) }
}

function bubble(title: string, contents: FlexText[], actions: FlexAction[] = []): Record<string, unknown> {
  const body: Record<string, unknown> = { type: 'box', layout: 'vertical', contents: [text(title, { weight: 'bold', size: 'lg' }), ...contents] }
  const bubble: Record<string, unknown> = { type: 'bubble', body }
  if (actions.length > 0) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: actions.map((action) => ({ type: 'button', style: action.label === 'ยืนยัน' ? 'primary' : 'secondary', action })) }
  return bubble
}

function draftDetails(draft: OcrDraft): FlexText[] {
  return [
    detail('ประเภทเอกสาร', documentTypeLabel(draft.documentType)),
    detail('ทิศทาง', directionLabel(draft.direction)),
    detail('หมวดหมู่', draft.categoryId),
    detail('วันที่', draft.documentDate ?? draft.transferDate ?? draft.receiptDate),
    detail('คู่ค้า', draft.counterpartyName ?? draft.merchantName),
    detail('ยอดรวม', draft.grandTotal ?? draft.amount, draft.currency),
    detail('ส่วนลด', draft.discountAmount, draft.currency),
    detail('ภาษี', draft.taxAmount, draft.currency),
    detail('ธนาคารผู้โอน', draft.senderBank),
    detail('บัญชีผู้โอน', maskAccount(draft.senderAccountMasked)),
    detail('ธนาคารผู้รับ', draft.receiverBank),
    detail('บัญชีผู้รับ', maskAccount(draft.receiverAccountMasked)),
    detail('เลขที่เอกสาร', draft.receiptNumber ?? draft.referenceNumber),
  ].filter((value): value is FlexText => value !== null)
}

function detail(label: string, value: string | number | null | undefined, currency?: string | null): FlexText | null {
  if (value === null || value === undefined || value === '') return null
  return text(`${label}: ${typeof value === 'number' ? money(value, currency) : truncate(value)}`, { size: 'sm', color: '#374151' })
}

function text(value: string, style: Record<string, unknown> = {}): FlexText {
  return { type: 'text', text: truncate(value), wrap: true, ...style }
}

function money(value: number, currency?: string | null): string {
  const prefix = currency === 'THB' || !currency ? '฿' : `${currency} `
  return truncate(`${prefix}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
}

function itemSummary(description: string | null, quantity: number | null, lineTotal: number | null, currency: string | null): string {
  return [description ? `• ${truncate(description)}` : '•', quantity === null ? null : `×${quantity}`, lineTotal === null ? null : money(lineTotal, currency)]
    .filter((value): value is string => value !== null)
    .join(' ')
}

function documentTypeLabel(value: OcrDraft['documentType']): string | null {
  if (value === 'RECEIPT') return 'ใบเสร็จ'
  if (value === 'TRANSFER_SLIP') return 'สลิปโอนเงิน'
  return null
}

function directionLabel(value: OcrDraft['direction']): string | null {
  if (value === 'EXPENSE') return 'รายจ่าย'
  if (value === 'INCOME') return 'รายรับ'
  return null
}

function truncate(value: string): string {
  const codePoints = Array.from(value)
  return codePoints.length <= MAX_VISIBLE_VALUE_LENGTH ? value : `${codePoints.slice(0, MAX_VISIBLE_VALUE_LENGTH - 1).join('')}…`
}

function maskAccount(account: string | null): string | null {
  if (!account) return null
  const digits = account.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return `${digits.slice(0, 3)}-****-**${digits.at(-1)}`
}

function postbackAction(label: string, action: Exclude<ReviewTokenAction, 'REVIEW'>, draft: OcrDraft, options: DraftFlexOptions): FlexAction {
  return { type: 'postback', label, data: reviewToken(action, draft, options) }
}

function reviewUriAction(label: string, draft: OcrDraft, options: DraftFlexOptions): FlexAction {
  let url: URL
  try {
    url = new URL(options.liffUrl)
  } catch {
    throw new Error('Invalid LIFF URL')
  }
  url.searchParams.set('token', reviewToken('REVIEW', draft, options))
  return { type: 'uri', label, uri: url.toString() }
}

function reviewToken(action: ReviewTokenAction, draft: OcrDraft, options: DraftFlexOptions): string {
  return signReviewToken({
    v: 1, documentId: draft.documentId, groupId: options.groupId, draftVersion: draft.draftVersion,
    action, exp: options.now + DAY_SECONDS,
  }, options.reviewSigningSecret)
}
