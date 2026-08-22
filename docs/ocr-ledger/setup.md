# Internal LINE OCR Ledger — Setup

เอกสารนี้เป็นขั้นตอนเตรียมระบบเท่านั้น ไม่อนุมัติการ deploy, เปลี่ยน webhook, เชิญบอตเข้ากลุ่มจริง หรือใช้เอกสารการเงินจริง

## ขอบเขตการทำงาน Phase 1

- ใช้ Render Web Service เดิมเพียง 1 instance สำหรับรับ webhook และ LIFF API
- ใช้ Render Cron แยกต่างหาก เรียก `npm run ocr:job` ทุก 1 นาที โดยแต่ละ invocation ทำงานหนึ่งรอบแล้ว exit
- ก่อนใช้งานจริงต้องยืนยันว่า Render ไม่รัน Cron invocation ซ้อนกัน (single-run guarantee) และ `OCR_QUEUE` เป็น durable queue เพียงชุดเดียว
- ห้ามเปลี่ยน LINE retry keys หรือ replay การส่งเอง; retry ต้องใช้ key เดิมเพื่อคง idempotency

## 1. ตรวจ LINE channel ที่ตั้งใจใช้

1. ยืนยันชื่อ Provider, Messaging API channel, LINE Official Account และผู้เป็นเจ้าของให้ตรงกับงาน OCR ภายใน
2. ใช้ OA/channel แยกสำหรับ OCR โดยเฉพาะ หากจะใช้ channel ร่วมต้องมี routing design และคำอนุมัติจากเจ้าของก่อน
3. ตรวจว่า channel secret, channel access token, LINE Login channel และ LIFF app มาจาก Provider ที่ตั้งใจเดียวกัน โดยไม่คัดลอกค่าไปยังแชต เอกสาร หรือ log
4. ยังไม่เปลี่ยน webhook URL และยังไม่เชิญบอตเข้ากลุ่มจริงในขั้นตอนนี้

## 2. ตรวจ Google identity, project, APIs และ scopes

ก่อนออก OAuth token ให้ตรวจแยกทีละชั้น:

1. Google account ที่กำลัง sign in เป็นบัญชีบริษัทที่ได้รับอนุมัติ
2. Google Cloud project และ OAuth consent screen เป็น project ที่กำหนดสำหรับ OCR
3. เปิด Google Drive API และ Google Sheets API ใน project เดียวกัน
4. OAuth client ID/secret เป็นของ project นั้น และ redirect URI ที่ใช้ bootstrap ตรงกับเครื่องมือที่ได้รับอนุมัติ
5. ขอเฉพาะ scopes ที่ runtime ใช้:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/spreadsheets`
6. ยืนยันว่า account เดียวกันเป็นเจ้าของหรือได้รับสิทธิ์ต่อ private Drive/Sheet ปลายทางที่แน่นอน

อย่าใช้สถานะ browser login หรือชื่อ project เพียงอย่างเดียวเป็นหลักฐานว่า identity, quota project, APIs และ scopes ถูกต้อง

## 3. Bootstrap OAuth refresh token หนึ่งครั้ง

1. ใช้ OAuth client ที่ตรวจแล้ว ขอ offline access พร้อม consent สำหรับสอง scopes ข้างต้น
2. รับ refresh token บนเครื่องที่อนุมัติ แล้ววางตรงลง secret manager หรือ Render environment setting ชื่อ `OCR_GOOGLE_REFRESH_TOKEN`
3. ห้ามพิมพ์ token ในแชต, terminal history, CI output หรือ application log และห้ามบันทึก OAuth JSON/token ไว้ใน repository หรือโฟลเดอร์ `API/`
4. เก็บ `OCR_GOOGLE_CLIENT_ID` และ `OCR_GOOGLE_CLIENT_SECRET` ใน Render environment settings เท่านั้น

## 4. ตรวจ dry-run ก่อนสร้าง assets

Build server แล้วรัน dry-run ซึ่งไม่เรียก Google และไม่สร้างไฟล์:

```bash
npm run build:server
npm run ocr:setup
```

ผลต้องขึ้นต้นด้วย `DRY_RUN` หลังจากทบทวน account, project, APIs, scopes และตำแหน่งปลายทางแล้วจึงขออนุมัติสร้าง assets โดยเฉพาะ จากนั้นรันเพียงครั้งเดียว:

```bash
npm run ocr:setup -- --confirm-create
```

คำสั่งยืนยันจะสร้าง private Drive hierarchy, โฟลเดอร์ `Monthly Ledgers` และ master workbook เท่านั้น นำ resource IDs ที่ได้ไปวางตรงใน Render environment settings เป็น `OCR_DRIVE_ROOT_ID`, `OCR_MONTHLY_LEDGERS_FOLDER_ID` และ `OCR_MASTER_SPREADSHEET_ID`; ห้ามส่งผ่านแชตหรือ commit ลง source

## 5. ตั้งค่า LIFF

1. สร้าง LIFF app ภายใต้ LINE Login channel ที่ตรวจแล้ว
2. เปิด scope `openid` และใช้ endpoint ของ Render Web Service เดิมต่อท้ายด้วย path `/ocr-review`
3. บันทึก LIFF ID เป็น `OCR_LIFF_ID` และ LINE Login channel ID เป็น `OCR_LIFF_CHANNEL_ID`
4. ตรวจว่า review API รับ raw ID token ทาง `Authorization: Bearer` และ server เป็นผู้ verify audience/expiry รวมถึง membership ของกลุ่มทุกครั้ง
5. ห้ามใช้ `liff.getProfile()` หรือ client-decoded claims เป็นหลักฐานยืนยันตัวตน

## 6. จับ allowed group ID โดยไม่เก็บข้อความ

ทำขั้นตอนนี้หลังได้รับอนุมัติเปลี่ยน webhook และทดสอบกับกลุ่มสังเคราะห์เท่านั้น:

1. รับ raw LINE webhook ที่ผ่าน HMAC verification แล้ว
2. อ่านเฉพาะ `source.type`, `source.groupId` และเวลาที่จับค่า
3. ไม่บันทึก raw body, message text, image content, user profile หรือ reply token
4. ยืนยันว่า group ID ขึ้นต้นด้วย `C` แล้ววางตรงใน Render environment setting `OCR_ALLOWED_GROUP_ID`
5. ปิด capture mode ทันทีและลบ log ชั่วคราวตาม retention policy

## 7. วาง environment variables

ใช้รายชื่อทั้งหมดใน `.env.example` และ `render-cron-example.yaml` โดยวางค่าจริงผ่าน Render dashboard environment settings เท่านั้น Web Service และ Cron ต้องอ้างชุดค่าเดียวกัน แต่ห้ามคัดลอกค่าไปไว้ใน Blueprint หรือ source control

ทดสอบ `/healthz` ก่อน แล้วตรวจว่าเมื่อ OCR configuration ไม่ครบ เฉพาะ OCR API เท่านั้นที่ตอบ `503`; Booking webhook, main app และ API เดิมต้องรักษา behavior เดิม

## Rollback และ credential rotation

1. หยุด/ถอด Cron service ก่อนเพื่อหยุดการ mutate queue
2. คืนค่า OCR webhook ไป endpoint เดิมหรือปิด webhook ตาม change record; อย่าเปลี่ยน Booking webhook
3. นำบอต OCR ออกจากกลุ่มทดสอบ/กลุ่มจริงตามขอบเขตที่ได้รับอนุมัติ
4. revoke Google refresh token และ rotate LINE channel access token, channel secret, `OCR_REVIEW_SIGNING_SECRET`, OAuth client secret และ OpenAI API key หากมีความเสี่ยงรั่วไหล
5. ปิดสิทธิ์หรือ archive private Drive/Sheets assets โดยไม่ลบหลักฐานจนกว่าเจ้าของข้อมูลอนุมัติ
6. ตรวจว่า Booking, Ads, Page Automation, Meta/OpenAI APIs และ main app ยังทำงานภายใต้ Basic Auth ตามเดิม
