import type { OcrDraft } from '../../src/apps/ocr-ledger/contracts'
import { signReviewToken, type ReviewTokenAction } from './security'

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

export interface FlexMessage {
  type: 'flex'
  altText: string
  contents: Record<string, unknown>
}

const DAY_SECONDS = 24 * 60 * 60

export function buildDraftFlex(draft: OcrDraft, options: DraftFlexOptions): FlexMessage {
  const details = draftDetails(draft)
  const itemRows = draft.lineItems.slice(0, 5).map((item) => text(`• ${item.description ?? 'ไม่ระบุรายการ'}${item.quantity === null ? '' : ` ×${item.quantity}`}${item.lineTotal === null ? '' : `  ${money(item.lineTotal, draft.currency)}`}`))
  if (draft.lineItems.length > 5) itemRows.push(text(`+${draft.lineItems.length - 5} รายการ`, { color: '#6B7280' }))
  const warnings = draft.warnings.length > 0 ? [text('ต้องตรวจสอบ', { color: '#B45309', weight: 'bold' }), ...draft.warnings.map((warning) => text(warning.message, { color: '#B45309', size: 'sm' }))] : []

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
  const title = draft.state === 'CANCELLED' ? 'ยกเลิกรายการแล้ว' : 'ยืนยันรายการแล้ว'
  return flex(title, [
    ...draftDetails(draft),
    ...(draft.confirmedBy ? [text(`ยืนยันโดย ${draft.confirmedBy}`, { color: '#15803D' })] : []),
  ])
}

export function buildReportMessage(options: ReportMessageOptions): FlexMessage {
  return flex(options.title, options.entries.flatMap(({ label, value }) => value ? [text(label, { weight: 'bold' }), text(value, { color: '#374151', size: 'sm' })] : [text(label)]))
}

function flex(title: string, contents: FlexText[], actions: FlexAction[] = []): FlexMessage {
  const body: Record<string, unknown> = { type: 'box', layout: 'vertical', contents: [text(title, { weight: 'bold', size: 'lg' }), ...contents] }
  const bubble: Record<string, unknown> = { type: 'bubble', body }
  if (actions.length > 0) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: actions.map((action) => ({ type: 'button', style: action.label === 'ยืนยัน' ? 'primary' : 'secondary', action })) }
  return { type: 'flex', altText: title, contents: bubble }
}

function draftDetails(draft: OcrDraft): FlexText[] {
  return [
    detail('วันที่', draft.documentDate ?? draft.transferDate ?? draft.receiptDate),
    detail('คู่ค้า', draft.counterpartyName ?? draft.merchantName),
    detail('ยอดรวม', draft.grandTotal ?? draft.amount, draft.currency),
    detail('ธนาคารผู้โอน', draft.senderBank),
    detail('บัญชีผู้โอน', maskAccount(draft.senderAccountMasked)),
    detail('ธนาคารผู้รับ', draft.receiverBank),
    detail('บัญชีผู้รับ', maskAccount(draft.receiverAccountMasked)),
    detail('อ้างอิง', draft.referenceNumber ?? draft.receiptNumber),
  ].filter((value): value is FlexText => value !== null)
}

function detail(label: string, value: string | number | null | undefined, currency?: string | null): FlexText | null {
  if (value === null || value === undefined || value === '') return null
  return text(`${label}: ${typeof value === 'number' ? money(value, currency) : value}`, { size: 'sm', color: '#374151' })
}

function text(value: string, style: Record<string, unknown> = {}): FlexText {
  return { type: 'text', text: value, wrap: true, ...style }
}

function money(value: number, currency?: string | null): string {
  const prefix = currency === 'THB' || !currency ? '฿' : `${currency} `
  return `${prefix}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
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
