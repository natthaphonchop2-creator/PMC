import { describe, expect, it } from 'vitest'
import {
  expenseFileFingerprint,
  formatExpenseSatang,
  parseExpenseAmountSatang,
  validateExpenseFiles,
  validateExpenseValues,
} from '../../src/apps/pmc-mini-app/expense/expenseModel'

describe('expense capture client model', () => {
  it('converts exact decimal baht to safe positive satang without floating-point rounding', () => {
    expect(parseExpenseAmountSatang('1200')).toBe(120_000)
    expect(parseExpenseAmountSatang('1200.5')).toBe(120_050)
    expect(parseExpenseAmountSatang('1200.05')).toBe(120_005)
    expect(parseExpenseAmountSatang('0')).toBeNull()
    expect(parseExpenseAmountSatang('1.001')).toBeNull()
    expect(parseExpenseAmountSatang('90071992547409.92')).toBeNull()
  })

  it('requires bill-only counterparty and payment fields while omitting them for books', () => {
    const common = { expenseDate: '2026-08-30', amount: '1200', description: '' }
    expect(validateExpenseValues('BILL_DOCUMENT', {
      ...common, counterpartyName: '', paymentMethod: '',
    })).toMatchObject({ counterpartyName: expect.any(String), paymentMethod: expect.any(String) })
    expect(validateExpenseValues('BOOK_CLINIC', {
      ...common, counterpartyName: '', paymentMethod: '',
    })).toEqual({})
    expect(validateExpenseValues('BOOK_DOCTOR_PERSONAL', {
      ...common, expenseDate: '2026-02-30', counterpartyName: '', paymentMethod: '',
    })).toMatchObject({ expenseDate: expect.any(String) })
  })

  it('accepts only one-to-five safe named JPEG/PNG files within exact byte budgets', () => {
    const jpg = imageFile('one.jpg', 'image/jpeg', 10_000_000)
    const png = imageFile('two.png', 'image/png', 1)
    expect(validateExpenseFiles([jpg, png])).toBeNull()
    expect(validateExpenseFiles([])).toBe('กรุณาแนบรูปหลักฐานอย่างน้อย 1 รูป')
    expect(validateExpenseFiles(Array.from({ length: 6 }, (_, index) => imageFile(`${index}.png`, 'image/png', 1))))
      .toBe('แนบได้สูงสุด 5 รูป')
    expect(validateExpenseFiles([imageFile('bad/heic.jpg', 'image/jpeg', 1)])).toBe('ชื่อไฟล์ไม่ถูกต้อง กรุณาเปลี่ยนชื่อแล้วแนบใหม่')
    expect(validateExpenseFiles([imageFile('photo.heic', 'image/heic', 1)])).toBe('รองรับเฉพาะรูป JPG หรือ PNG')
    expect(validateExpenseFiles([imageFile('large.png', 'image/png', 10_000_001)])).toBe('แต่ละรูปต้องมีขนาดไม่เกิน 10 MB')
    expect(validateExpenseFiles([
      imageFile('a.png', 'image/png', 9_000_000),
      imageFile('b.png', 'image/png', 9_000_000),
      imageFile('c.png', 'image/png', 7_000_001),
    ])).toBe('รูปทั้งหมดต้องมีขนาดรวมไม่เกิน 25 MB')
  })

  it('accepts exactly 160 Unicode filename characters and rejects 161 before upload', () => {
    expect(validateExpenseFiles([imageFile(`${'ก'.repeat(156)}.jpg`, 'image/jpeg', 1)])).toBeNull()
    expect(validateExpenseFiles([imageFile(`${'ก'.repeat(157)}.jpg`, 'image/jpeg', 1)]))
      .toBe('ชื่อไฟล์ไม่ถูกต้อง กรุณาเปลี่ยนชื่อแล้วแนบใหม่')
    expect(validateExpenseFiles([imageFile(`${'😀'.repeat(78)}.jpg`, 'image/jpeg', 1)])).toBeNull()
  })

  it('changes the ordered fingerprint whenever a file is replaced or reordered', () => {
    const a = imageFile('a.jpg', 'image/jpeg', 5, 100)
    const b = imageFile('b.png', 'image/png', 7, 200)
    expect(expenseFileFingerprint([a, b])).not.toBe(expenseFileFingerprint([b, a]))
    expect(expenseFileFingerprint([a, b])).not.toBe(expenseFileFingerprint([
      imageFile('a.jpg', 'image/jpeg', 5, 101), b,
    ]))
  })

  it('formats ordinary and maximum-safe satang with integer quotient and two exact digits', () => {
    expect(formatExpenseSatang(120_005)).toBe('1,200.05 บาท')
    expect(formatExpenseSatang(Number.MAX_SAFE_INTEGER)).toBe('90,071,992,547,409.91 บาท')
  })

  it('rejects note control characters before staging while preserving the typed value contract', () => {
    expect(validateExpenseValues('BOOK_CLINIC', {
      expenseDate: '2026-08-30', amount: '1200', counterpartyName: '', paymentMethod: '',
      description: 'บรรทัดหนึ่ง\nบรรทัดสอง',
    })).toMatchObject({ description: 'หมายเหตุต้องเป็นข้อความบรรทัดเดียวและไม่มีอักขระควบคุม' })
  })
})

function imageFile(name: string, type: string, size: number, lastModified = 1): File {
  return new File([new Uint8Array(size)], name, { type, lastModified })
}
