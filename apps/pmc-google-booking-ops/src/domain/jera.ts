import { normalizeCustomerName, normalizeThaiPhone } from './normalize'

export interface JeraTransaction {
  paymentId: string
  date: string
  time: string
  customerNameNormalized: string
  phoneNormalized: string
  status: string
  actualRevenue: number
}

const REQUIRED_HEADERS = [
  'วันที่',
  'เวลา',
  'รหัสใบชำระเงิน',
  'ผู้ป่วย',
  'HN',
  'มือถือ',
  'สถานะ',
  'ยอดเงินที่ได้รับจริง',
] as const

const TRANSACTION_STATUSES = new Set([
  'ชำระแล้ว',
  'คืนมัดจำ',
  'มัดจำชำระแล้ว',
  'มัดจำค้างชำระ',
  'ลิงค์ชำระเงิน',
  '0',
])

function parseTabLine(line: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === '\t' && !quoted) {
      values.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }
  values.push(value.trim())
  return values
}

function safeName(value: string): string {
  try {
    return normalizeCustomerName(value)
  } catch {
    return ''
  }
}

function safePhone(value: string): string {
  try {
    return normalizeThaiPhone(value)
  } catch {
    return ''
  }
}

function money(value: string): number {
  const normalized = value.replace(/,/g, '').replace(/^\((.+)\)$/, '-$1')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseJeraTransactions(text: string): JeraTransaction[] {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(parseTabLine)
  const headerIndex = rows.findIndex((row) => REQUIRED_HEADERS.every((header) => row.includes(header)))
  if (headerIndex === -1) throw new Error('JERA required headers not found')
  const header = rows[headerIndex]
  const index = Object.fromEntries(header.map((name, column) => [name, column])) as Record<string, number>

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const paymentId = row[index['รหัสใบชำระเงิน']]?.trim() ?? ''
    const status = row[index['สถานะ']]?.trim() ?? ''
    if (!paymentId || !TRANSACTION_STATUSES.has(status)) return []
    const date = row[index['วันที่']]?.trim() ?? ''
    const time = row[index['เวลา']]?.trim() ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid JERA transaction date')
    if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) throw new Error('invalid JERA transaction time')
    return [
      {
        paymentId,
        date,
        time,
        customerNameNormalized: safeName(row[index['ผู้ป่วย']] ?? ''),
        phoneNormalized: safePhone(row[index['มือถือ']] ?? ''),
        status,
        actualRevenue: money(row[index['ยอดเงินที่ได้รับจริง']] ?? ''),
      },
    ]
  })
}
