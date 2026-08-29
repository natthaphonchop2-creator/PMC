import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

const TASK_8_ARTIFACT_DIR = resolve('.superpowers/sdd/2026-08-29-pmc-daily-monthly-finance-reports-implementation')

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

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
  await expect(page.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('บันทึกการจองแล้ว')
  await expect(page.getByText('PMC-PREVIEW-0001')).toHaveCount(0)
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

test('booking-only V1 hides clinic reports navigation while reporting is paused', async ({ page }) => {
  await page.goto('/mini-app/?preview=1')
  await expect(page.getByRole('button', { name: 'รายงานคลินิก' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'รายงาน', exact: true })).toHaveCount(0)
  await expect(page.getByText('จัดการงานจองของคลินิก')).toBeVisible()
})

test.describe('Finance report Android acceptance', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('ordinary staff opens daily income, 31-day groups, and sees monthly and expense actions locked', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&finance=enabled&role=staff')
    await page.getByRole('button', { name: 'รายงานคลินิก' }).click()
    await expect(page.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()

    const primaryGrid = page.locator('.pmc-finance-primary-grid')
    expect(await primaryGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
    for (const card of await primaryGrid.getByRole('button').all()) {
      const box = await card.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48)
    }
    await expect(page.getByRole('button', { name: /รายงานรายเดือน/ })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText('เตรียมระบบ')).toHaveCount(6)
    await expect(page.getByRole('button', { name: /บันทึก|ส่งรายจ่าย|แนบ/ })).toHaveCount(0)
    await page.screenshot({
      path: resolve(TASK_8_ARTIFACT_DIR, 'task-8-finance-home.png'),
      fullPage: false,
    })

    await page.getByRole('button', { name: /รายรับรายวัน/ }).click()
    await page.getByText('เมื่อวาน', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'รายละเอียดรับชำระ' })).toBeVisible()
    await expect(page.getByText(/PAY-\d{8}/)).toBeVisible()
    await expect(page.getByText('ลูกค้าทดสอบ')).toBeVisible()
    await page.screenshot({
      path: resolve(TASK_8_ARTIFACT_DIR, 'task-8-daily-income.png'),
      fullPage: false,
    })

    await page.getByText('เลือกช่วงวันที่', { exact: true }).click()
    const endInput = page.getByLabel('วันสิ้นสุด')
    const endDate = await endInput.inputValue()
    const start = new Date(`${endDate}T00:00:00.000Z`)
    start.setUTCDate(start.getUTCDate() - 30)
    const startDate = start.toISOString().slice(0, 10)
    await page.getByLabel('วันเริ่มต้น').fill(startDate)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(31)
    const dayGroups = await page.getByRole('heading', { level: 3 }).allTextContents()
    expect(dayGroups[0]).toBe(endDate)
    expect(dayGroups.at(-1)).toBe(startDate)

    const tableScroller = page.locator('.pmc-finance-table-scroll').first()
    expect(await tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await page.locator('body').innerText()).toMatch(/[\u0e31-\u0e3a\u0e47-\u0e4e]/)
    expect(await page.locator('.pmc-finance-page').evaluate((element) => getComputedStyle(element).letterSpacing)).toMatch(/normal|0px/)
    await page.getByRole('button', { name: 'กลับไปรายงาน' }).focus()
    await page.keyboard.press('Tab')
    const selectedPreset = page.getByRole('radio', { name: 'เลือกช่วงวันที่' })
    await expect(selectedPreset).toBeFocused()
    expect(await selectedPreset.evaluate((element) => getComputedStyle(element.nextElementSibling!).outlineStyle)).not.toBe('none')
  })

  test('finance staff opens the previous month and drills into an exact daily report', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&finance=enabled&role=finance')
    await page.getByRole('button', { name: 'รายงานคลินิก' }).click()
    await page.getByRole('button', { name: /รายงานรายเดือน/ }).click()

    const monthInput = page.getByRole('textbox', { name: 'เดือนรายงาน' })
    const currentMonth = await monthInput.inputValue()
    const [year, month] = currentMonth.split('-').map(Number)
    const previous = new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 7)
    await monthInput.fill(previous)
    await expect(page.getByRole('region', { name: 'ยอดรายรับหลักประจำเดือน' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'รายรับรายวันในเดือน' })).toBeVisible()
    await expect(page.getByText('รายจ่ายที่บันทึก — เตรียมระบบ')).toBeVisible()
    await page.screenshot({
      path: resolve(TASK_8_ARTIFACT_DIR, 'task-8-monthly-income.png'),
      fullPage: false,
    })

    const dailyButtons = page.getByRole('button', { name: /ดูรายรับวันที่/ })
    const selectedDate = (await dailyButtons.last().getAttribute('aria-label'))!.replace('ดูรายรับวันที่ ', '')
    await dailyButtons.last().click()
    await expect(page.getByRole('heading', { name: 'รายรับรายวัน' })).toBeVisible()
    await expect(page.getByLabel('วันเริ่มต้น')).toHaveValue(selectedDate)
    await expect(page.getByLabel('วันสิ้นสุด')).toHaveValue(selectedDate)
  })
})

test.describe('Clinic report Android acceptance', () => {
  test.use({ viewport: { width: 412, height: 915 } })

  test('active staff opens renamed clinic reports without provider branding', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&reports=enabled&stock=enabled&role=staff')
    await page.getByRole('button', { name: 'รายงานคลินิก' }).click()
    await expect(page.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
    await page.getByRole('button', { name: 'ยอดรับชำระ' }).click()
    await expect(page.getByText('CLINIC REPORT')).toBeVisible()

    const today = await page.locator('.pmc-report-filters .pmc-report-section-heading span').innerText()
    const yesterday = new Date(`${today}T00:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const expectedDate = yesterday.toISOString().slice(0, 10)
    await page.getByText('เมื่อวาน', { exact: true }).click()
    await expect(page.getByRole('radio', { name: 'เมื่อวาน' })).toBeChecked()
    await expect(page.getByText(expectedDate, { exact: true })).toBeVisible()

    await expect(page.locator('body')).not.toContainText(/JERA/i)
    await expect(page.getByText('อัปเดตล่าสุดเมื่อ 20:55')).toBeVisible()
    await page.getByRole('button', { name: 'รีเฟรชข้อมูล' }).click()
    await expect(page.getByText('อัปเดตล่าสุดเมื่อ 20:56')).toBeVisible()
    await page.getByRole('button', { name: 'กลับไปรายงาน' }).click()
    await expect(page.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
  })
})

test.describe('Stock Android acceptance', () => {
  test.use({ viewport: { width: 412, height: 915 } })

  test('keeps Stock disabled until the rollout flag is enabled', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&stock=disabled&role=staff')
    await expect(page.getByRole('button', { name: 'Stock' })).toBeDisabled()
    await expectNoStockSheetLink(page)
  })

  test('active staff filters low Stock and issues two products without manager controls', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&stock=enabled&role=staff')
    await page.getByRole('button', { name: 'Stock' }).click()
    await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'รับเข้า' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'จัดการสินค้า' })).toHaveCount(0)
    await page.getByRole('button', { name: 'ใกล้หมด' }).click()
    await expect(page.getByText('ถุงมือ')).toBeVisible()
    await expect(page.getByText('เซรั่ม')).toHaveCount(0)

    await page.getByRole('button', { name: 'เบิกสินค้า' }).click()
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
    await page.getByRole('combobox', { name: 'สินค้า 1' }).selectOption('STK-000001')
    await page.getByRole('textbox', { name: 'จำนวน 1' }).fill('2')
    await page.getByRole('combobox', { name: 'สินค้า 2' }).selectOption('STK-000002')
    await page.getByRole('textbox', { name: 'จำนวน 2' }).fill('1')
    await page.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }).click()
    await expect(page.getByText(/ISS-202608-/)).toBeVisible()
    await expectNoStockSheetLink(page)
  })

  test('manager creates, receives, and adjusts Stock through manager-only controls', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&stock=enabled&role=manager')
    await page.getByRole('button', { name: 'Stock' }).click()
    await expect(page.getByRole('button', { name: 'รับเข้า' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'จัดการสินค้า' })).toBeVisible()

    await page.getByRole('button', { name: 'จัดการสินค้า' }).click()
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
    await page.getByRole('textbox', { name: 'ชื่อสินค้า' }).fill('สำลีแผ่น')
    await page.getByRole('textbox', { name: 'หน่วย' }).fill('ถุง')
    await page.getByRole('textbox', { name: 'จำนวนเริ่มต้น' }).fill('2')
    await page.getByRole('textbox', { name: 'จำนวนขั้นต่ำ' }).fill('1')
    await page.getByRole('button', { name: 'บันทึกสินค้า' }).click()
    await expect(page.getByRole('heading', { name: 'เพิ่มสินค้าสำเร็จ' })).toBeVisible()
    await page.getByRole('button', { name: 'กลับหน้า Stock' }).click()

    await page.getByRole('button', { name: 'รับเข้า' }).click()
    await page.getByRole('combobox', { name: 'สินค้า 1' }).selectOption('STK-000001')
    await page.getByRole('textbox', { name: 'จำนวนรับเข้า 1' }).fill('1')
    await page.getByRole('button', { name: 'ยืนยันรับเข้า' }).click()
    await expect(page.getByRole('heading', { name: 'รับเข้าสำเร็จ' })).toBeVisible()
    await page.getByRole('button', { name: 'กลับหน้า Stock' }).click()

    await page.getByRole('button', { name: 'จัดการสินค้า' }).click()
    await page.getByRole('button', { name: 'ปรับยอด ถุงมือ' }).click()
    await page.getByRole('textbox', { name: 'จำนวนที่นับจริง' }).fill('6')
    await page.getByRole('textbox', { name: 'เหตุผล' }).fill('ตรวจนับสิ้นวัน')
    await page.getByRole('button', { name: 'ยืนยันปรับยอด' }).click()
    await expect(page.getByRole('heading', { name: 'ปรับยอดสำเร็จ' })).toBeVisible()
    await expectNoStockSheetLink(page)
  })

  test('repeated issue submit returns one immutable document in history', async ({ page }) => {
    await page.goto('/mini-app/?preview=1&stock=enabled&role=staff')
    await page.getByRole('button', { name: 'Stock' }).click()
    await page.getByRole('button', { name: 'เบิกสินค้า' }).click()
    await page.getByRole('combobox', { name: 'สินค้า 1' }).selectOption('STK-000001')
    await page.getByRole('textbox', { name: 'จำนวน 1' }).fill('1')
    await page.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }).evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect(page.getByText('ISS-202608-0001')).toBeVisible()
    await page.getByRole('button', { name: 'กลับหน้า Stock' }).click()
    await page.getByRole('button', { name: 'ประวัติ' }).click()
    await expect(page.getByRole('button', { name: 'ดูรายละเอียด ISS-202608-0001' })).toHaveCount(1)
    await expectNoStockSheetLink(page)
  })
})

function imageFile(name: string) {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
  }
}

async function expectNoStockSheetLink(page: Page) {
  await expect(page.getByRole('link', { name: /Google Sheet/i })).toHaveCount(0)
}
