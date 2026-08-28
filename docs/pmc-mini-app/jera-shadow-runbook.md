# PMC JERA Production — Read-only Shadow Runbook

**สถานะ:** คู่มือนี้เป็น gate สำหรับทดสอบเท่านั้น ไม่ใช่ owner approval และไม่อนุญาตให้ deploy, เพิ่ม secret, เรียก Production API, สร้าง Cloud Scheduler หรือเปิด UI โดยอัตโนมัติ

## ขอบเขตที่ห้ามเปลี่ยน

- JERA version 1 อ่านข้อมูลอย่างเดียว
- อนุญาต `POST` เฉพาะ `/openapi/v1/token/` เพื่อออก access token
- ข้อมูลธุรกิจใช้เฉพาะ endpoint `GET` ที่อยู่ใน allowlist ของระบบ
- ห้ามเขียนหรือเปลี่ยน patient, appointment, clinic, payment หรือสถานะใดใน JERA
- ห้ามเก็บข้อมูลผู้ป่วย, credential, bearer token หรือ raw API body ในหลักฐาน rollout
- Render และระบบ Google Form/Calendar/LINE เดิมต้องไม่เปลี่ยน

## ลำดับ operator gate ที่ต้องทำตาม

ทุกขั้นตอนที่แตะ Production ต้องมี **owner approval** ก่อนทำ และ operator เป็นผู้รันคำสั่งด้วยตนเองเท่านั้น

1. **Copy/local verification** — ตรวจ commit, build และ safety check ใน local copy ก่อน ไม่ deploy และไม่เรียก Production API.
2. **Disabled no-traffic revision** — Deploy Cloud Run revision แบบ **no traffic** โดยตั้ง `JERA_REPORTING_ENABLED=false`; ห้ามเปิด UI รายงานและห้ามสร้าง Scheduler ในขั้นนี้.
3. **Secret binding presence check without values** — เจ้าของระบบผูก Production base URL และ secret bindings กับ Cloud Run runtime identity ที่กำหนด แล้วตรวจเฉพาะ “มี/ไม่มี” ของ binding; ห้ามพิมพ์, ส่งต่อ หรือบันทึกค่า secret/token.
4. **Branch discovery through the owner-operated script** — หลัง owner approval ให้ operator รัน `node scripts/discover-clinic-report-branch.mjs --allow-readonly-production --project <approved-project>` เพื่ออ่าน branch metadata แบบ bounded แล้ว owner เลือก/ยืนยัน branch UUID.
5. **Sequential one-day core probes** — รัน one-day shadow read ทีละรายงานสำหรับ PAYMENT, DEPOSIT, REFUND และ APPOINTMENT; วันเริ่มและสิ้นสุดต้องเป็นวันเดียวกัน และห้ามรันพร้อมกัน.
6. **Owner comparison approval** — owner เปรียบเทียบ count และ total กับหน้า source/CSV ของวันเดียวกัน, ตรวจ audit ว่าไม่มี non-token POST, PATCH, PUT หรือ DELETE แล้วอนุมัติเป็นลายลักษณ์อักษรก่อนเขียน cache.
7. **Sequential 13-source cache seed** — หลัง owner approval ให้ operator รัน `node scripts/seed-clinic-report-cache.mjs --allow-readonly-production --project <approved-project> --date YYYY-MM-DD`; script จะ seed **13 source report types** แบบ sequential เท่านั้น.
8. **Cache/sync/audit safe readback** — อ่านกลับเฉพาะ count, total satang, sync state, audit metadata และ safe warning code; ห้ามอ่าน/export raw patient rows.
9. **Reporting-enabled no-traffic revision** — Deploy revision ที่ `JERA_REPORTING_ENABLED=true` แบบ **no traffic** เพื่อยืนยัน config/cache read path โดยยังไม่รับ traffic.
10. **Authenticated LINE pilot and owner approval** — เปิด pilot ให้บัญชี LINE ที่ authenticated ตามขอบเขตที่ owner อนุมัติ, ตรวจการแสดงข้อมูลจาก cache และการ refresh แบบปลอดภัย แล้วรับ owner approval ก่อนเปิด traffic.
11. **Production traffic** — ส่ง traffic ไป revision ที่ผ่าน gate แล้ว พร้อมเก็บเฉพาะ audit metadata ตาม register ด้านล่าง.
12. **Scheduler remains paused until separate approval** — Scheduler ต้อง remain paused จนกว่า manual sync จะผ่านและได้รับ owner approval แยกต่างหาก; ห้ามสร้างหรือ unpause จากขั้นตอน rollout นี้.
13. **Reporting-disabled rollback without deleting cache/audit rows** — หาก rollback ให้ส่ง traffic กลับ revision ที่ `JERA_REPORTING_ENABLED=false`, pause Scheduler (ถ้ามีจากการอนุมัติภายหลัง) และเก็บ cache/audit rows เดิมไว้ตรวจสอบ.

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
