# PMC JERA Production — Read-only Shadow Runbook

**สถานะ:** คู่มือนี้เป็น gate สำหรับทดสอบเท่านั้น ไม่ใช่ owner approval และไม่อนุญาตให้ deploy, เพิ่ม secret, เรียก Production API, สร้าง Cloud Scheduler หรือเปิด UI โดยอัตโนมัติ

## ขอบเขตที่ห้ามเปลี่ยน

- JERA version 1 อ่านข้อมูลอย่างเดียว
- อนุญาต `POST` เฉพาะ `/openapi/v1/token/` เพื่อออก access token
- ข้อมูลธุรกิจใช้เฉพาะ endpoint `GET` ที่อยู่ใน allowlist ของระบบ
- ห้ามเขียนหรือเปลี่ยน patient, appointment, clinic, payment หรือสถานะใดใน JERA
- ห้ามเก็บข้อมูลผู้ป่วย, credential, bearer token หรือ raw API body ในหลักฐาน rollout
- Render และระบบ Google Form/Calendar/LINE เดิมต้องไม่เปลี่ยน

## ลำดับ gate ที่ต้องทำตาม

1. Deploy Cloud Run revision แบบ **no traffic** โดยตั้ง `JERA_REPORTING_ENABLED=false` และยังไม่สร้าง Scheduler
2. ขอ owner approval ก่อนทุกขั้นตอนที่แตะ Production
3. เจ้าของระบบเพิ่ม Production base URL, username และ password เข้า Secret Manager ด้วยตนเอง ห้ามส่งค่าให้ Codex หรือบันทึกในไฟล์
4. ผูก secret เฉพาะกับ Cloud Run runtime service identity ที่กำหนด ห้ามให้สิทธิ์ระดับ Owner/Editor
5. ตรวจ token endpoint โดยไม่พิมพ์หรือบันทึก token
6. อ่าน clinic/branch metadata ด้วย GET เพื่อยืนยันสาขา
7. ทำ one-day shadow read เฉพาะ PAYMENT, DEPOSIT, REFUND และ APPOINTMENT ทีละรายงาน
8. เปรียบเทียบ count และยอดรวมกับหน้า JERA และ CSV ในวันเดียวกัน
9. ตรวจ audit ว่าไม่มี non-token POST, PATCH, PUT หรือ DELETE
10. อนุญาต cache write หลังผล comparison ผ่านและได้รับ owner approval รอบใหม่เท่านั้น
11. เปิด pilot UI หลัง cache/report ผ่านการตรวจเท่านั้น
12. สร้าง Cloud Scheduler หลัง manual sync ผ่านและได้รับ owner approval แยกต่างหาก
13. Rollback โดยปิด reporting flag และ Scheduler พร้อมเก็บ cache/audit เดิมไว้ตรวจสอบ

## Configuration names

ค่าทั่วไป:

```text
JERA_REPORTING_ENABLED
JERA_API_BASE_URL
JERA_DEFAULT_BRANCH_UUID
JERA_SYNC_INTERVAL_MINUTES
JERA_SCHEDULER_AUDIENCE
JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL
```

Secret Manager bindings:

```text
JERA_API_USERNAME
JERA_API_PASSWORD
```

คู่มือนี้จงใจไม่แสดงรูปแบบ `NAME=value` สำหรับ secret

## Local safety check

คำสั่งนี้อ่านเฉพาะชื่อ binding และสถานะ ไม่เรียก JERA:

```bash
node scripts/check-jera-readonly-runtime.mjs --env-file /dev/null
```

หลัง owner approval และตั้ง env ใน shell แบบไม่เข้าประวัติแล้ว จึงใช้ one-day probe ได้ โดยวันเริ่มต้นและสิ้นสุดต้องเป็นวันเดียวกัน:

```bash
node scripts/check-jera-readonly-runtime.mjs \
  --allow-readonly-production \
  --report PAYMENT \
  --start-date YYYY-MM-DD \
  --end-date YYYY-MM-DD
```

ผลลัพธ์แสดงเฉพาะ report, date range, count และ total satang ไม่แสดง row ลูกค้า

## Data-quality register

บันทึกเฉพาะช่องต่อไปนี้:

```text
commit SHA
Cloud Run revision
report type
date range
JERA count
cache count
JERA total satang
cache total satang
pass/fail
safe warning code
reviewer and timestamp
```

ห้ามเก็บข้อมูลผู้ป่วย ชื่อ เบอร์โทร เลขบัตร รูปหลักฐาน credential bearer token หรือ raw API body ใน register

## Cloud Scheduler gate

- ใช้ Google OIDC audience ที่ตรงกับ Cloud Run service URL
- ยอมรับเฉพาะ scheduler service account email ที่กำหนด
- รอบ current refresh อ่านวันนี้และเดือนปัจจุบันสำหรับรายงานหลัก
- รอบ daily reconciliation อ่านเมื่อวานและเดือนก่อน
- Internal response มีเพียง `accepted` และ `syncRunId`
- อย่าส่ง OIDC token เป็น command-line argument; operator script อ่านจาก environment เท่านั้น

## Rollback

1. ตั้ง `JERA_REPORTING_ENABLED=false`
2. Pause Cloud Scheduler ทั้ง current และ daily jobs
3. ส่ง traffic กลับ revision ที่ปิด JERA reporting
4. เก็บ `JERA_API_CACHE`, `JERA_SYNC_STATE`, `JERA_SYNC_AUDIT` ไว้เพื่อ audit
5. ยืนยันว่า Booking, Google Form, Calendar, LINE, Drive และ Dashboard เดิมยังทำงาน
6. ตรวจเฉพาะ safe error code และ metadata ห้ามนำ raw customer row ลง log หรือ issue
