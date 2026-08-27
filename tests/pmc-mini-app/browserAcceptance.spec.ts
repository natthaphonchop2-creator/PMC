import { expect, test } from '@playwright/test'

test('unknown staff sees the approval waiting screen', async ({ page }) => {
  await page.goto('/mini-app/?preview=unknown')
  await expect(page.getByText('รอผู้ดูแลอนุมัติ', { exact: true })).toBeVisible()
})

test('active staff can traverse normal booking, multiple evidence, preview, and idempotent confirmation', async ({ page }) => {
  await page.goto('/mini-app/?preview=1')
  await expect(page.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
  await page.getByRole('button', { name: 'เริ่มลงนัด' }).click()

  await page.getByLabel('ชื่อลูกค้า', { exact: true }).fill('ลูกค้าตัวอย่าง')
  await page.getByLabel(/ชื่อ Facebook/).fill('Facebook Example')
  await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('0812345678')
  await page.getByRole('button', { name: 'ถัดไป' }).click()

  await page.getByRole('combobox', { name: 'แพทย์' }).selectOption('doctor-benz')
  await page.getByRole('combobox', { name: 'โปรแกรม' }).selectOption('fat-transfer')
  await page.getByRole('combobox', { name: 'ช่องทาง' }).selectOption('page-tab')
  await page.getByRole('button', { name: 'ถัดไป' }).click()

  await expect(page.getByLabel('วันที่นัด')).toBeVisible()
  await page.getByLabel('วันที่นัด').fill('2026-09-01')
  await page.getByLabel('เวลานัด').fill('13:00')
  await page.getByRole('button', { name: 'ถัดไป' }).click()

  await page.getByLabel('ยอดจอง (บาท)').fill('900')
  await page.getByLabel('สลิปเงินจอง').setInputFiles([
    imageFile('payment-1.png'), imageFile('payment-2.png'),
  ])
  await page.getByLabel('หลักฐานแชท').setInputFiles([
    imageFile('chat-1.png'), imageFile('chat-2.png'), imageFile('chat-3.png'),
  ])
  await expect(page.getByText('สลิป 2/10 รูป')).toBeVisible()
  await expect(page.getByText('แชท 3/10 รูป')).toBeVisible()
  await page.getByRole('button', { name: 'ตรวจสอบข้อมูล' }).click()

  await expect(page.getByText('สลิป 2 รูป')).toBeVisible()
  await expect(page.getByText('แชท 3 รูป')).toBeVisible()
  await page.getByRole('button', { name: 'ยืนยันบันทึก' }).evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect(page.getByText('PMC-PREVIEW-0001')).toBeVisible()
  await expect(page.getByText('ยืนยันการจองไม่สำเร็จ กรุณาลองอีกครั้ง')).toHaveCount(0)
})

test('automatic queue removes date and time controls', async ({ page }) => {
  await page.goto('/mini-app/?preview=1')
  await page.getByRole('button', { name: 'เริ่มลงนัด' }).click()
  await page.getByLabel('ชื่อลูกค้า', { exact: true }).fill('ลูกค้าตัวอย่าง')
  await page.getByLabel(/ชื่อ Facebook/).fill('ไม่มี')
  await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('0812345678')
  await page.getByRole('button', { name: 'ถัดไป' }).click()
  await page.getByRole('combobox', { name: 'แพทย์' }).selectOption('doctor-benz')
  await page.getByRole('combobox', { name: 'โปรแกรม' }).selectOption('fat-transfer')
  await page.getByRole('combobox', { name: 'ช่องทาง' }).selectOption('page-tab')
  await page.getByRole('button', { name: 'ถัดไป' }).click()
  await page.getByLabel('คิวอัตโนมัติ').check()

  await expect(page.getByLabel('วันที่นัด')).toHaveCount(0)
  await expect(page.getByLabel('เวลานัด')).toHaveCount(0)
})

test('fallback remains in Account while Stock stays disabled on Home', async ({ page }) => {
  await page.goto('/mini-app/?preview=1')
  await expect(page.getByRole('button', { name: 'Stock' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Google Form สำรอง' })).toHaveCount(0)
  await page.getByRole('button', { name: 'บัญชี', exact: true }).click()
  await expect(page.getByRole('link', { name: 'เปิด Google Form สำรอง' })).toBeVisible()
})

test('active staff can open the report center, a live report, and every additional report choice', async ({ page }) => {
  await page.goto('/mini-app/?preview=1')
  await page.getByRole('button', { name: 'รายงาน', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ยอดรับชำระ' })).toBeVisible()
  await page.getByRole('button', { name: 'ยอดรับชำระ' }).click()
  await expect(page.getByRole('heading', { name: 'ยอดรับชำระ' })).toBeVisible()
  await expect(page.getByText('900 บาท').first()).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByRole('button', { name: 'กลับไปรายงาน' }).click()
  await page.getByRole('button', { name: 'รายงานเพิ่มเติม' }).click()
  await expect(page.getByRole('heading', { name: 'รายงานเพิ่มเติม' })).toBeVisible()
  await expect(page.locator('.pmc-additional-report-menu section button')).toHaveCount(8)
})

function imageFile(name: string) {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
  }
}
