import { createHash } from 'node:crypto'
import type { OcrDocument } from '../../src/apps/ocr-ledger/contracts.js'

export type OcrReportCommand = 'TODAY' | 'YESTERDAY' | 'MONTH' | 'PENDING' | 'ERRORS'

export interface ReportWindow {
  command: OcrReportCommand
  start: string | null
  endExclusive: string | null
}

export interface OcrReport {
  income: number
  expense: number
  net: number
  tax: number
  categories: Array<{ categoryId: string; amount: number; income: number; expense: number }>
  operational: {
    confirmed: number
    pending: number
    failed: number
    cancelled: number
    duplicateWarnings: number
  }
}

export interface OcrOperationalEvidence {
  documentId: string
  receivedAt: string
  state: 'PENDING_REVIEW' | 'RETRY_PENDING' | 'FAILED' | 'CANCELLED' | null
  duplicateWarning: boolean
}

export function aggregateOcrReport(documents: readonly OcrDocument[], evidence: readonly OcrOperationalEvidence[] = []): OcrReport {
  let income = 0
  let expense = 0
  let tax = 0
  const operational = { confirmed: 0, pending: 0, failed: 0, cancelled: 0, duplicateWarnings: 0 }
  const categories = new Map<string, { categoryId: string; amount: number; income: number; expense: number }>()
  const operationalDocumentIds = new Set<string>()
  const duplicateDocumentIds = new Set<string>()

  for (const document of documents) {
    if (document.warnings.some((warning) => warning.code === 'EXACT_IMAGE_DUPLICATE' || warning.code === 'REPEATED_REFERENCE_NUMBER')) {
      operational.duplicateWarnings += 1
      duplicateDocumentIds.add(document.documentId)
    }
    if (document.state === 'PENDING_REVIEW' || document.state === 'RETRY_PENDING') { operational.pending += 1; operationalDocumentIds.add(document.documentId) }
    else if (document.state === 'FAILED') { operational.failed += 1; operationalDocumentIds.add(document.documentId) }
    else if (document.state === 'CANCELLED') { operational.cancelled += 1; operationalDocumentIds.add(document.documentId) }
    else if (document.state === 'CONFIRMED') operational.confirmed += 1

    if (document.state !== 'CONFIRMED' || !document.direction) continue
    const total = document.grandTotal ?? document.amount ?? 0
    const categoryId = document.categoryId ?? 'uncategorized'
    const category = categories.get(categoryId) ?? { categoryId, amount: 0, income: 0, expense: 0 }
    if (document.direction === 'INCOME') {
      income += total
      category.income += total
      category.amount += total
    } else {
      expense += total
      category.expense += total
      category.amount -= total
    }
    tax += document.taxAmount ?? 0
    categories.set(categoryId, category)
  }

  for (const item of evidence) {
    if (!operationalDocumentIds.has(item.documentId)) {
      if (item.state === 'PENDING_REVIEW' || item.state === 'RETRY_PENDING') operational.pending += 1
      else if (item.state === 'FAILED') operational.failed += 1
      else if (item.state === 'CANCELLED') operational.cancelled += 1
    }
    if (item.duplicateWarning && !duplicateDocumentIds.has(item.documentId)) operational.duplicateWarnings += 1
  }

  return {
    income, expense, net: income - expense, tax,
    categories: [...categories.values()].sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount) || (left.categoryId < right.categoryId ? -1 : left.categoryId > right.categoryId ? 1 : 0)),
    operational,
  }
}

export function reportWindow(command: OcrReportCommand, now: Date): ReportWindow {
  const today = bangkokDate(now)
  if (command === 'TODAY') return calendarWindow(command, today)
  if (command === 'YESTERDAY') return calendarWindow(command, shiftCalendarDate(today, -1))
  if (command === 'MONTH') return monthWindow(today)
  return { command, start: null, endExclusive: null }
}

export function shouldSendDailyReport(input: {
  enabled: boolean
  groupId: string
  now: Date
  sentKeys: ReadonlySet<string>
  hour?: number
  minute?: number
}): boolean {
  if (!input.enabled) return false
  const local = bangkokDateTime(input.now)
  const hour = input.hour ?? 20
  const minute = input.minute ?? 0
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return false
  if (local.hour < hour || (local.hour === hour && local.minute < minute)) return false
  return !input.sentKeys.has(dailyReportIdempotencyKey(input.groupId, local.date))
}

export function dailyReportIdempotencyKey(groupId: string, date: string): string {
  return `report:${groupId}:${date}:daily`
}

export function dailyReportRetryKey(idempotencyKey: string): string {
  return logicalLineRetryKey(idempotencyKey)
}

export function logicalLineRetryKey(logicalMessageKey: string): string {
  const hex = createHash('sha256').update(logicalMessageKey).digest('hex')
  const variant = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function documentIsInWindow(document: OcrDocument, window: ReportWindow): boolean {
  if (!window.start || !window.endExclusive) return true
  const date = document.documentDate ?? document.transferDate ?? document.receiptDate
  return typeof date === 'string' && date >= window.start && date < window.endExclusive
}

export function operationalEvidenceIsInWindow(evidence: OcrOperationalEvidence, window: ReportWindow): boolean {
  if (!window.start || !window.endExclusive) return true
  const date = bangkokDate(new Date(evidence.receivedAt))
  return date >= window.start && date < window.endExclusive
}

function calendarWindow(command: OcrReportCommand, start: string): ReportWindow {
  return { command, start, endExclusive: shiftCalendarDate(start, 1) }
}

function monthWindow(today: string): ReportWindow {
  const start = `${today.slice(0, 7)}-01`
  const [year, month] = start.slice(0, 7).split('-').map(Number)
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  return { command: 'MONTH', start, endExclusive: end }
}

function shiftCalendarDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function bangkokDate(now: Date): string {
  return bangkokDateTime(now).date
}

function bangkokDateTime(now: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((result, part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute') result[part.type] = part.value
    return result
  }, {} as Record<string, string>)
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) }
}
