# Internal LINE OCR Ledger — Pilot Runbook

Pilot นี้ต้องไล่จาก synthetic ไปหา live gate ตามลำดับ ห้ามข้าม gate และ design นี้ไม่ถือเป็น production approval

## Operating boundary

- Render Web Service ใช้ 1 instance ใน Phase 1
- Render Cron รัน `npm run ocr:job` ครั้งเดียวต่อนาทีและต้องยืนยัน single-run guarantee ก่อนเปิดจริง
- Web request ทำได้เพียง append `OCR_QUEUE`; การเปลี่ยน draft, ledger, aggregate และ action result ทำใน Cron worker เท่านั้น
- คง LINE retry key เดิมทุกครั้ง ห้าม manual replay ที่สร้าง key ใหม่

## Stage 1 — Local synthetic tests only

1. ใช้ provider fakes และภาพสังเคราะห์ JPEG/PNG ที่ไม่มีข้อมูลลูกค้า บัญชีจริง หรือเอกสารการเงินจริง
2. รัน:

   ```bash
   npm run ocr:test
   npm run build
   npm run lint
   ```

3. ตรวจ webhook HMAC rejection, allowed-group filtering, LIFF token/membership rejection, queue idempotency, retries และ confirmed-only totals
4. ห้ามใช้ production credentials, outbound provider calls หรือไฟล์จาก `API/`

Stop หาก test/build/lint ไม่ผ่าน หรือพบ secret/PII ใน log หรือ artifact

## Stage 2 — Privacy-safe 100-image evaluation

1. ใช้ชุดประเมิน 100 ภาพที่ได้รับอนุมัติและ de-identify แล้ว เก็บนอก repository และนอก `API/`
2. ตรวจว่าเครื่องมือประเมินอ่านได้เฉพาะ fixture directory ที่กำหนดและเขียนเฉพาะ counts, percentages และ error codes
3. เกณฑ์ผ่านขั้นต่ำ:
   - document type accuracy ≥ 98%
   - grand total accuracy ≥ 98%
   - exact line-item field accuracy ≥ 95%
4. ห้ามลดเกณฑ์เพื่อผ่าน pilot; หากไม่ผ่านให้หยุดและประเมิน fallback ตาม design

## Stage 3 — No-send Flex validation

1. สร้าง Flex payload จาก synthetic drafts/reports เท่านั้น
2. ใช้ LINE validate endpoint ผ่าน client method `validatePush`; ห้ามเรียก reply/push และห้ามเชิญบอตเข้ากลุ่มจริง
3. ตรวจ alt text, masked account values, ไม่มี Drive IDs/URLs, ไม่มี token และไม่มี raw OCR output
4. เก็บเฉพาะผล pass/fail และ safe error code ไม่เก็บ provider response body

## Stage 4 — Synthetic Drive/Sheet pilot

ต้องได้รับอนุมัติสร้าง private test assets ก่อน:

1. ทวน Google account, Cloud project, Drive/Sheets API enablement, OAuth scopes และ exact private destination assets อีกครั้ง
2. ใช้ workbook/Drive root สำหรับ pilot โดยเฉพาะ ไม่ใช้ customer production folders
3. ใส่ synthetic image → queue → worker → review/edit → confirm/cancel และ daily report โดยใช้กลุ่มทดสอบที่ได้รับอนุมัติ
4. ยืนยันว่า unconfirmed/cancelled/failed documents ไม่เข้า confirmed ledger หรือ totals
5. ทดสอบ provider failure และ retry โดยตรวจว่า document, ledger row, LINE message และ daily report ไม่ซ้ำ และ retry key เดิมถูกใช้
6. ตรวจ queue age, terminal error codes, duplicates และยอดรวมหลัง worker exit ทุกครั้ง

## Explicit live stop gates

หยุดและขออนุมัติเจ้าของเป็นรายการแยกก่อนทำแต่ละข้อ:

- deploy หรือสร้าง Render Cron ที่มีค่าใช้จ่าย
- เปลี่ยน LINE webhook URL
- ใช้ channel ร่วมแทน dedicated OCR channel
- เชิญหรือ enable บอตในกลุ่มจริง
- grant Google OAuth หรือสร้าง/แชร์ assets จริง
- ประมวลผลภาพหรือข้อมูลการเงินจริง
- ส่ง LINE message ไปกลุ่มจริง

หากยังไม่มี approval ให้คงระบบที่ local/synthetic/no-send เท่านั้น

## Rollback

1. หยุด Cron ก่อนเพื่อหยุด write และ retry
2. คืน webhook configuration ตาม change record โดยไม่แตะ Booking webhook
3. นำบอตออกจากกลุ่มที่อยู่ใน scope และหยุด Web Service OCR routes หากจำเป็น; main app/API เดิมต้องไม่ถูกเปิด public
4. revoke/rotate credentials ตาม `setup.md` และลบค่าจาก Render environment settings ที่เลิกใช้
5. เก็บ private evidence ตาม retention policy; ห้ามลบ ledger หรือ audit trail โดยไม่มี owner approval
6. รัน route/Booking regression tests และบันทึก queue state, last successful job, retry keys และ rollback time โดยไม่บันทึก message text หรือข้อมูลเอกสาร
