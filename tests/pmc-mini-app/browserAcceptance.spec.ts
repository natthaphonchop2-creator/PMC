import { expect, test } from '@playwright/test'

test('unknown staff links a LINE account once before entering the app', async ({ page }) => {
  await page.goto('/mini-app/?preview=unknown')
  await expect(page.getByRole('heading', { name: 'ผูกบัญชีครั้งแรก' })).toBeVisible()
  await page.getByRole('combobox', { name: 'ชื่อพนักงาน' }).selectOption('staff-preview')
  await page.getByLabel(/PIN บริษัท/).fill('123456')
  await page.getByRole('button', { name: 'ผูกบัญชี' }).click()
  await expect(page.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
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

test('booking-only V1 hides JERA navigation while reporting is paused', async ({ page }) => {
  await page.goto('/mini-app/?preview=1')
  await expect(page.getByRole('button', { name: 'รายงาน JERA' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'รายงาน', exact: true })).toHaveCount(0)
  await expect(page.getByText('จัดการงานจองของคลินิก')).toBeVisible()
})

function imageFile(name: string) {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
  }
}
