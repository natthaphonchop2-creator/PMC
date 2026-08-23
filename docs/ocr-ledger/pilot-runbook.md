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

1. ใช้ชุดประเมินอย่างน้อย 100 ภาพที่ได้รับอนุมัติและ de-identify แล้ว โดย fixture ID ต้องไม่ซ้ำและเนื้อหาภาพหลัง decode ต้องไม่ซ้ำ เก็บนอก repository และนอก `API/`
2. ตรวจว่าเครื่องมือประเมินอ่านได้เฉพาะ fixture directory ที่กำหนดและเขียนเฉพาะ aggregate unique counts, percentages และ error codes
3. เกณฑ์ผ่านขั้นต่ำ:
   - document type accuracy ≥ 98%
   - grand total accuracy ≥ 98%
   - exact line-item field accuracy ≥ 95%
4. ห้ามลดเกณฑ์เพื่อผ่าน pilot; หากไม่ผ่านให้หยุดและประเมิน fallback ตาม design

### Pre-live record — 2026-08-22: NO-GO

- Automated evidence: `npm run ocr:test` 18 files / 187 tests, `npm test` 56 files / 515 tests, `npm run lint`, และ `npm run build` ผ่าน; Vite แจ้ง chunk-size warning เดิมเท่านั้น
- Evaluation harness unit tests: 30 cases passed; ใช้ภาพ synthetic ชั่วคราวเท่านั้น และ summary ไม่เก็บ fixture ID, image path, image hash, expected/actual OCR values หรือภาพ
- ยังไม่มี approved, de-identified evaluation dataset ที่ `OCR_EVAL_FIXTURE_DIR`; จึงยัง score ได้ 0/100 ภาพจริงสำหรับ acceptance gate และห้ามประกาศ accuracy หรือ GO
- `evaluation-manifest.json` เก็บได้เฉพาะ expected labels; ห้ามใส่ actual OCR, auto-confirm หรือ result data. Evaluator รับ actual จาก extractor ที่ inject ด้วย image bytes เท่านั้น, ปฏิเสธ path ใน `API/`, traversal และ symlink escape, ตรวจ JPEG/PNG magic, Sharp metadata และ full pixel decode แบบ fail-on-error, คำนวณ SHA-256 ภายในจาก decoded pixels เพื่อนับเนื้อหาที่ไม่ซ้ำก่อน extractor, ไม่ copy ภาพ, และเขียนเฉพาะ aggregate counts/percentages/error codes ไปที่ ignored `output/ocr-ledger-evaluation/summary.json`
- CLI จะไม่ wire production OpenAI extractor จนกว่าจะมี `OCR_EVAL_LIVE_CONFIRM=YES` และเฉพาะ `OPENAI_API_KEY`, `OPENAI_OCR_MODEL`, `OCR_OPENAI_MAX_OUTPUT_TOKENS`, `OCR_MAX_IMAGE_BYTES` ที่ valid; ไม่ต้องใช้ LINE/Google/group/Sheet/Drive config. หากขาดข้อใดให้ NO-GO แบบไม่เรียก API. ห้ามรัน live extraction ในขั้น pre-live นี้
- GO ของ evaluator ต้องมีอย่างน้อย 100 fixture IDs ที่ไม่ซ้ำและ 100 decoded image contents ที่ไม่ซ้ำ, document type >= 98%, grand total >= 98%, exact canonical line-item fields >= 95%, ไม่มี duplicate/auto-confirm error, มี line-item denominator มากกว่า 0, และไม่มี output นอก aggregate schema. Gate เปรียบเทียบ integer counts โดยไม่ใช้ percentage ที่ปัดเศษ
- Local LIFF visual QA ยังไม่ได้ทำ: loading, valid draft, warnings, seven line items, invalid totals, expired token, queued edit, keyboard focus, และ console errors ที่ 390x844/desktop ยังไม่มี mocked/test API browser harness ที่ยืนยันได้ จึงเป็น NO-GO ไม่ใช่ pass
- Runtime correction (2026-08-22): ทุก relative import ใน `server/ocr-ledger` runtime graph ใช้ explicit `.js` แล้ว; fresh build + missing-config job regression ยืนยันว่า `npm run ocr:job` ออก nonzero ด้วย `OCR ledger job failed` โดยไม่รั่ว `ERR_MODULE_NOT_FOUND` หรือ filesystem path และก่อนสร้าง provider client. ยังเป็น NO-GO สำหรับ worker counts เพราะไม่มี synthetic configuration/approved test context
- Synthetic Drive/Sheet, real LINE validation endpoint, production OAuth refresh credentials, และ live data ไม่ได้ใช้หรือสร้างในขั้นนี้

### Final fix verification — 2026-08-23: NO-GO

- Final fix wave จาก base `ddeacce5a2bf60603d067b8f820d780ba39fb230`: `npm run ocr:test` ผ่าน 18 files / 223 tests และ `npm test` ผ่าน 56 files / 551 tests; lint, full build และ `git diff --check` ผ่าน โดยมีเพียง Vite chunk-size warning เดิม
- Credential-cleared setup smoke แสดง `DRY_RUN` และไม่สร้าง Google asset; credential-cleared runtime smoke fail-closed ด้วย `OCR ledger job failed` ก่อนสร้าง provider clients
- Evaluator no-config ให้ aggregate-only `NO_GO`, `scoredFixtures=0`, `uniqueFixtureIds=0`, `uniqueImageContents=0`, code `EVAL_FIXTURE_DIR_REQUIRED` และไม่เรียก OpenAI
- ยังไม่ได้อนุมัติหรือทำ live Google/LINE/OpenAI/Render call, webhook change, bot invitation, production credential placement, real asset creation, real message หรือ real financial-document processing
- สถานะยังเป็น NO-GO จนกว่าจะผ่าน approved 100-unique-image evaluation, mocked browser QA, no-send LINE validation, dedicated-channel/group and Google identity/asset verification, Render one-web-instance/single-run Cron gate และ explicit owner approval ตาม rollout gates

### Residual correction verification — 2026-08-23: code-ready, pre-live NO-GO

- ปิด review residual I3: account identifiers ถูก canonical mask จาก digit content ทุกครั้ง แม้ input มี `*`, `x` หรือ `•`; การเปลี่ยนชนิดเอกสารล้าง field และ line items ของชนิดตรงข้ามทั้ง LIFF และ server validation
- ปิด review residual I5: ทุก logical LINE push สร้าง durable `line-delivery:*` queue job ที่เก็บ recipient, exact message payload และ deterministic retry UUID ก่อนส่ง; FAILED notice, competing duplicate status และ scheduled report replay ใช้ envelope เดิม. หาก Sheets ล้มก่อนสร้าง notice marker ระบบ requeue เฉพาะ notice intent และคง source job เป็น `FAILED` หลัง marker ส่งสำเร็จ
- ปิด review residual I7: `DAILY_SUMMARY` และ `CATEGORY_SUMMARY` refresh ภายใต้ failure boundary แยกกัน และ `aggregateFreshAt` ขยับเมื่อทั้งสองสำเร็จเท่านั้น
- Automated evidence หลัง correction: `npm run ocr:test` ผ่าน 18 files / 231 tests, `npm test` ผ่าน 56 files / 559 tests, lint, client/LIFF/server build และ `git diff --check` ผ่าน; มีเพียง Vite main chunk-size warning เดิม
- Runtime/setup evidence ยังคง fail-closed: setup เป็น `DRY_RUN`, job ที่ไม่มี config ออกด้วย `OCR ledger job failed`, evaluator ที่ไม่มี fixture directory ให้ aggregate-only `NO_GO`/`EVAL_FIXTURE_DIR_REQUIRED`
- Code review residual ทั้งสามปิดใน regression tests แล้ว แต่สถานะ production ยังคง NO-GO ตาม external gates ด้านบน

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
- เลือกหรือเปลี่ยน live LINE webhook URL
- ใช้ channel ร่วมแทน dedicated OCR channel
- เชิญหรือ enable บอตในกลุ่มจริง
- เก็บ production Google OAuth refresh credentials
- grant Google OAuth หรือสร้าง/แชร์ Drive/Sheet assets จริง
- sync Render Blueprint หรือสร้าง Render Cron service
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
