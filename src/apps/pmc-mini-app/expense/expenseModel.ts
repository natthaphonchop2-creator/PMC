import type { EnabledExpenseCategory, ExpensePaymentMethod } from '../../../../shared/pmcExpense'

export const EXPENSE_MAX_FILES = 5
export const EXPENSE_MAX_FILE_BYTES = 10_000_000
export const EXPENSE_MAX_TOTAL_BYTES = 25_000_000

export interface ExpenseFormValues {
  expenseDate: string
  amount: string
  counterpartyName: string
  paymentMethod: '' | ExpensePaymentMethod
  description: string
}

export type ExpenseFormErrors = Partial<Record<keyof ExpenseFormValues | 'files', string>>

const fileIdentities = new WeakMap<File, number>()
let fileIdentitySequence = 0

export function parseExpenseAmountSatang(value: string): number | null {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value.trim())
  if (!match) return null
  try {
    const satang = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
    if (satang <= 0n || satang > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(satang)
  } catch {
    return null
  }
}

export function validateExpenseValues(
  category: EnabledExpenseCategory,
  values: ExpenseFormValues,
): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {}
  if (!validExpenseDate(values.expenseDate)) errors.expenseDate = 'กรุณาเลือกวันที่รายจ่ายให้ถูกต้อง'
  if (parseExpenseAmountSatang(values.amount) === null) errors.amount = 'กรุณากรอกจำนวนเงินที่มากกว่า 0 และไม่เกิน 2 ตำแหน่ง'
  if (values.description.length > 500) errors.description = 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร'
  if (category === 'BILL_DOCUMENT') {
    const counterparty = values.counterpartyName.trim()
    if (!counterparty) errors.counterpartyName = 'กรุณากรอกชื่อร้านหรือผู้รับเงิน'
    else if (counterparty.length > 160) errors.counterpartyName = 'ชื่อร้านหรือผู้รับเงินต้องไม่เกิน 160 ตัวอักษร'
    if (!isExpensePaymentMethod(values.paymentMethod)) errors.paymentMethod = 'กรุณาเลือกวิธีชำระ'
  }
  return errors
}

export function validateExpenseFiles(files: File[]): string | null {
  if (files.length === 0) return 'กรุณาแนบรูปหลักฐานอย่างน้อย 1 รูป'
  if (files.length > EXPENSE_MAX_FILES) return 'แนบได้สูงสุด 5 รูป'
  let total = 0
  for (const file of files) {
    if (!safeFileName(file.name)) return 'ชื่อไฟล์ไม่ถูกต้อง กรุณาเปลี่ยนชื่อแล้วแนบใหม่'
    if (!matchingImageType(file)) return 'รองรับเฉพาะรูป JPG หรือ PNG'
    if (!Number.isSafeInteger(file.size) || file.size <= 0) return 'รูปต้องมีข้อมูลและเปิดอ่านได้'
    if (file.size > EXPENSE_MAX_FILE_BYTES) return 'แต่ละรูปต้องมีขนาดไม่เกิน 10 MB'
    total += file.size
    if (!Number.isSafeInteger(total) || total > EXPENSE_MAX_TOTAL_BYTES) return 'รูปทั้งหมดต้องมีขนาดรวมไม่เกิน 25 MB'
  }
  return null
}

export function expenseFileFingerprint(files: File[]): string {
  return files.map((file) => {
    let identity = fileIdentities.get(file)
    if (identity === undefined) {
      identity = ++fileIdentitySequence
      fileIdentities.set(file, identity)
    }
    return `${identity}:${file.name.length}:${file.name}:${file.type}:${file.size}:${file.lastModified}`
  }).join('|')
}

export function expenseCategoryLabel(category: EnabledExpenseCategory): string {
  if (category === 'BILL_DOCUMENT') return 'บิลเอกสาร'
  if (category === 'BOOK_CLINIC') return 'สมุดรายจ่ายภายในคลินิก'
  return 'สมุดรายจ่ายส่วนตัวหมอ'
}

export function expensePaymentLabel(paymentMethod: ExpensePaymentMethod): string {
  if (paymentMethod === 'TRANSFER') return 'โอนเงิน'
  if (paymentMethod === 'CASH') return 'เงินสด'
  if (paymentMethod === 'CREDIT') return 'บัตรเครดิต'
  return 'อื่น ๆ'
}

function validExpenseDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function safeFileName(value: string): boolean {
  return value.length > 0 && value.length <= 180 && ![...value].some((character) => {
    const code = character.charCodeAt(0)
    return character === '/' || character === '\\' || code < 32 || code === 127
  })
}

function matchingImageType(file: File): boolean {
  if (file.type === 'image/jpeg') return /\.jpe?g$/i.test(file.name)
  if (file.type === 'image/png') return /\.png$/i.test(file.name)
  return false
}

function isExpensePaymentMethod(value: unknown): value is ExpensePaymentMethod {
  return value === 'TRANSFER' || value === 'CASH' || value === 'CREDIT' || value === 'OTHER'
}
