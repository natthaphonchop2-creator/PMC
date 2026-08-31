# PMC Google Booking Operations Pilot Runbook

## Pilot boundary

Use synthetic identities, synthetic phone numbers reserved for testing, non-customer images, and a copied privacy-safe JERA fixture. Do not use real customers during technical verification.

Pilot participants:

- one manager;
- one Admin/assistant;
- two doctor LINE groups; and
- the company automation account.

## Evidence register

For every scenario, record:

- Case ID;
- Form response timestamp;
- Booking status and version;
- Drive folder/file IDs;
- Calendar event ID;
- LINE destination and safe event type;
- call task state;
- JERA import file/hash/status;
- audit event IDs;
- retry/reconciliation IDs; and
- Dashboard KPI before/after values.

Do not paste tokens, full phone numbers, national IDs, slip/chat content, or unrestricted links into the register.

## Automatic queue and complete evidence pre-production checkpoint — 2026-08-24

- Added backward-compatible `NORMAL`/`AUTO` parsing; old Form responses remain normal queues.
- Added separate paid-booking and appointment states: `CONFIRMED`, `TENTATIVE`, and `AWAITING_ADMIN_SLOT`.
- Added a pure automatic slot planner using confirmed doctor days, 30-minute starts, the selected service duration, the 10:30–20:30 start window, and the six-month deposit horizon.
- Added gray provisional Calendar events, Admin-only tentative/awaiting Flex messages, a prefilled confirmation Form adapter, idempotent confirmation, deterministic deleted-event recovery, doctor notification, and call-task creation after confirmation only.
- Removed one-slip/three-chat storage truncation. Admin delivery creates signed references for every Form-accepted image, embeds at most four compact slip-first thumbnails in the summary, and links excess evidence to the private case Drive folder.
- Added isolated daily stages so call-reminder LINE failure cannot block deposit expiry or Dashboard refresh.
- Added read-only `preparePmcAutoQueueMigration()`, one-time-marker `applyPmcAutoQueueMigration()`, and idempotent `configurePmcQueueModeForms()` operators.
- Expanded validation-only LINE payloads across two `/validate/push` requests: confirmed Admin, doctor, call reminder, tentative Admin, awaiting-slot Admin, and a compact four-thumbnail evidence card.
- No Apps Script push, Sheet migration, Form mutation, trigger installation, Calendar pilot, or LINE group delivery was performed in this checkpoint. Production remains stopped at Gate A.

## Scenarios

### 1. Valid booking

Expected:

- one Case ID;
- one private Drive folder with renamed synthetic evidence;
- one event in the selected doctor's Calendar;
- one Admin-group LINE Flex with the approved slip/chat previews;
- one doctor-group LINE Flex with the necessary booking identity and no evidence image or URL;
- one open call task beginning on appointment day; and
- Dashboard booking/deposit counts increase once.

### 1A. Evidence media and Flex delivery

Expected:

- Cloud Run `/health` returns `200`, a missing token returns `400`, and an altered token returns `403`;
- valid synthetic JPEG/PNG previews return `200` without making Drive public;
- fetching the same permanent preview URL twice returns identical bytes;
- removing the Service Identity's Viewer permission makes the URL unavailable and restoring it recovers the same URL;
- the LINE official validator accepts both audience payloads;
- Admin receives the preview images and doctor receives no evidence component; and
- audit rows contain audience, version, count, and status only—never a signed URL, token, file ID, customer identity, or image content.

### 2. Calendar conflict

Expected:

- `TIME_CONFLICT` and `calendarState=CONFLICT`;
- no new Calendar event;
- no doctor LINE booking message; and
- Admin-visible exception.

### 3. Missing evidence

Expected:

- Form validation blocks submission or workflow rejects it;
- no Case ID reservation;
- no Drive, Calendar, or LINE side effect.

### 4. LINE retry

Simulate one non-2xx LINE response.

Expected:

- booking and Calendar remain valid;
- `lineState=RETRY`;
- one retry item with safe error;
- retry does not duplicate Drive or Calendar.

### 5. Call overdue

Advance a synthetic task beyond Day 7 without recording a call.

Expected:

- `CALL_OVERDUE`;
- reminder routed to Admin group and owner only once per day;
- Dashboard overdue count increases.

### 6. JERA paid match

Use one privacy-safe `ชำระแล้ว` row matching normalized phone plus name.

Expected:

- `CLOSED_JERA`;
- JERA payment ID consumed once;
- open call task cancelled;
- commission eligibility `PENDING_RULE`;
- commission amount blank.

### 7. Ambiguous JERA match

Create two open synthetic bookings with the same normalized name and phone.

Expected:

- no case closes;
- one `RECONCILIATION` item lists candidate Case IDs;
- manager identity/reason required for resolution.

### 8. Expiry and retention

Advance a synthetic case beyond six calendar months and then 90 days past terminal status.

Expected:

- `EXPIRED_6M` and call tasks cancelled;
- evidence enters retention approval queue;
- Drive/GCS evidence remains after approval;
- only a separate owner-executed cleanup may trash the exact verified resources; and
- approval and cleanup append sanitized audit events without customer data, storage identity, object key, filename, hash, principal, or URL.

Cancelled/expired Mini App draft evidence uses the same boundary. The manual Apps Script functions are:

- `previewPmcDraftEvidenceRetention(retentionId)` — safe count/status/digest preview only;
- `approvePmcDraftEvidenceRetention(retentionId, expectedVersion, approvalDigest, reason)` — binds the effective owner and performs no storage deletion;
- `executePmcDraftEvidenceRetention(retentionId, expectedVersion)` — claims a lease, preflights every resource, then invokes exact idempotent cleanup; and
- `readbackPmcDraftEvidenceRetention(retentionId)` — safe status readback.

These four functions must never be installed as Form or clock triggers. `RETENTION_QUEUE` V1-to-V2 migration, `PMC_DRAFT_CLEANUP_URL` installation, and every cleanup execution are separate owner-approved live actions. Daily reconciliation may discover/expire/repair rows but must never delete evidence or retry cleanup automatically. If execute returns `RETENTION_CLEANUP_RETRYABLE`, read back the row first; do not change the manifest, owner, or resource location, and do not rerun until the owner explicitly approves the retry.

### 9. Duplicate/replay safety

Resubmit the same Form response, JERA file content, JERA payment ID, LINE ingress nonce, and daily reminder run.

Expected:

- no duplicate Case ID, Calendar event, Drive evidence, closure, directory row, or same-day reminder.

## Verification commands

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm run test
npm run build
git diff --check
```

## Go/no-go gates

Production is **NO-GO** if any of these are true:

- any test/build/lint command fails;
- either Google Form evidence question accepts file types other than images;
- a doctor receives another doctor's case;
- a LINE payload contains raw evidence, an unrestricted Drive link, or a national-ID-like value, or customer identity is routed to an unmapped group;
- Google closes a case without unique JERA `ชำระแล้ว` evidence;
- replay creates a duplicate side effect;
- a manager cannot trace a controlled change through `AUDIT_LOG`;
- a retention job deletes evidence without approval; or
- Google/LINE assets are not company-owned.

Production becomes **GO** only after the manager signs the evidence register and explicitly authorizes real-customer use.

## Evidence Flex pilot record — 2026-08-20

Verified with the approved synthetic case only:

- dedicated keyless Cloud Run Service Identity is healthy and has no Service Account JSON credential;
- valid evidence previews returned `200`; missing/altered tokens returned `400`/`403`;
- one synthetic slip and one synthetic chat preview were fetched successfully;
- permanent preview bytes were stable, folder-permission revocation returned `404`, and restoring Viewer access recovered `200` on the same URL;
- Apps Script production deployment is version `5`; the temporary evidence setup file was removed from the remote project;
- LINE official validation returned `200`;
- one Admin pilot push and one doctor pilot push returned `200`, with separate no-duplicate audit markers;
- Booking tests passed `64/64`; full project tests passed `275/275`; typecheck, lint, build, and `git diff --check` passed; and
- the two Google Form evidence questions still report file type `ANY`. Google Forms API does not support updating existing File Upload questions and the available browser accounts do not own the form. Real-customer use remains **NO-GO** until the form owner sets both questions to **Image only** and the setting is read back as `IMAGE`.

## Staff / AE Minimal Flex pre-deployment record — 2026-08-21

Verified locally with synthetic identity only:

- Booking tests passed `83/83`; full project tests passed `295/295`;
- Booking typecheck/build, project lint/build, and `git diff --check` passed;
- official LINE push-message validation returned `200` with no details;
- Admin payload contained the generated-logo URL and payment/chat evidence;
- doctor payload contained no payment/chat evidence;
- visible Admin/doctor Flex text contained no Case ID;
- neither payload contained the synthetic staff email; and
- no live Cloud Run, Apps Script, Form, Sheet, Calendar, or LINE-group state was changed in this local verification stage.

Live cutover remains **NO-GO** until `CONFIG_STAFF` is prepared and all seven personal closer emails are entered directly in Sheet without exposing them in source, commands, docs, or chat.

## Deferred live cutover record — 2026-08-21

Completed safely before the owner deferred personal-email entry:

- deployed the new keyless Cloud Run revision with the public PMC logo route;
- Cloud Run health/logo GET/logo HEAD returned `200`;
- the live logo is PNG `256x256` with alpha;
- evidence missing/altered token behavior remained `400`/`403`;
- Service Identity and Secret Manager remained attached with no JSON credential environment;
- created `CONFIG_STAFF` with seven legacy IDs/names/LINE mappings, blank personal emails, and both initial role flags enabled;
- inserted `aeId` and `aeName` without shifting the verified historical booking sample; and
- left the production Apps Script deployment and Booking Form label/accepting state unchanged.

The owner explicitly deferred email mapping and Form/Apps Script cutover. Resume only after all seven personal emails are entered directly in `CONFIG_STAFF`; then validate uniqueness, pause the Form, push/deploy the new Apps Script version, rename/sync the AE field, and resume responses.

## Full-identity Calendar pilot — 2026-08-21

The owner approved full customer name and full phone visibility on the doctor Calendar plus Google Calendar event color `5` (`Banana`).

Verified with a synthetic customer only:

- created one active event on the mapped doctor Calendar for `22 August 2026 10:00–11:00 Asia/Bangkok`;
- readback duration was `60` minutes;
- event color ID was `5`;
- the event title contained the complete synthetic customer name and phone;
- the description contained the synthetic service and internal Case ID reference;
- exactly one active event matched the private Case ID in the appointment window; and
- the event remains on the Calendar for owner review.

The repository Calendar builder now produces this full-identity/color contract. Automatic Form-created events will adopt it when the deferred Apps Script/AE cutover is deployed; production Apps Script version 5 remains unchanged until then.

## Live phone validation and v5 schema recovery — 2026-08-21

- A Form submission was received with all required answers, but `onBookingFormSubmit` failed before Case ID allocation because the test phone contained only eight digits.
- No Booking row, response map, Audit, Retry, Drive, Calendar, or LINE side effect was created by that failed response.
- Removed the two empty pre-cutover `aeId`/`aeName` columns from live `BOOKING_MASTER`, restoring the 51-column schema expected by production Apps Script version 5; the historical sample remained aligned.
- Added Google Form response validation `^0[0-9]{9}$` to `เบอร์มือถือ` with the help/error message `กรุณากรอกเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0 เช่น 0800000000`.
- Browser readback showed an eight-digit synthetic value was rejected and the ten-digit value `0800000000` had no phone-format alert. The Form was not submitted during validation QA.
- Removed the temporary setup helper after success. Remote Apps Script files returned to `Code` and `appsscript`, and the production v5 Code hash remained unchanged.

## Staff profile avatar production cutover — 2026-08-21

- Deployed Cloud Run revision `pmc-booking-evidence-proxy-avatar-1f89bc3` with 100% traffic, the existing keyless Service Identity, and the existing Secret Manager binding.
- Verified health/logo, evidence guard `400/403`, and all six allowlisted `256x256` JPEG profile routes. Production SHA-256 values matched the reviewed local assets; unknown profile names and non-GET/HEAD requests returned `404`.
- Added the canonical `profileImageUrl` column to live `CONFIG_STAFF`. The first guarded configuration run detected the eighth system row `Admin` and stopped before any profile URL write; readback confirmed the new column was still blank.
- Updated the exact live roster mapping and reran successfully after a timestamped Spreadsheet backup. Readback showed eight staff rows, six Cloud Run profile URLs, and two intentional blanks (`ฝ้าย` and `Admin`).
- Deployed Apps Script version `8` through the existing deployment ID. Form URL/questions, Calendar state, and the five installable triggers were not changed.
- The official LINE push validator initially identified unsupported `cornerRadius` on the nested image component. Removed that one image property while retaining the circular parent box, reran local regression, and received final LINE validator `200` through a synthetic validation-only workflow.
- No validator payload was pushed to an Admin or doctor group, and no synthetic Form response, Drive case folder, Calendar event, booking row, or call task was created during this cutover.
- Rollback points remain Apps Script version `5` and Cloud Run revision `pmc-booking-evidence-proxy-00005-w8x`.

## Approved live group Flex smoke test — 2026-08-21

- The owner explicitly approved sending the validated synthetic Flex to live LINE groups.
- Deployed Apps Script version `9` through the existing deployment ID with an approval-only `sendPmcBookingFlexPilot()` operator entrypoint.
- Sent exactly two messages: the synthetic Admin card to the configured Admin group and the synthetic doctor card to the active `หมอ Benz` group.
- Apps Script execution completed successfully in five seconds. Both LINE pushes were accepted; fixed retry keys protect an accidental rerun from duplicating either pilot message.
- The pilot used only `PMC Validation` and the reserved synthetic phone `0800000000`. It did not create or modify a Form response, booking row, Drive case folder, Calendar event, call task, JERA record, or Dashboard value.

## Aligned team-row Flex V2 smoke test — 2026-08-21

- After live visual review, shortened the two team labels to `Admin` and `AE` and fixed both avatar/name groups to the same left-aligned columns.
- Deployed Apps Script version `10` through the existing deployment ID and advanced the explicit pilot retry key to V2 so the revised card would be delivered as a new smoke-test message.
- The official LINE validator accepted the revised Admin and doctor Flex objects before delivery.
- The approved V2 pilot then completed successfully in four seconds, delivering one revised synthetic Flex to the Admin group and one to the active `หมอ Benz` group with no booking-data side effect.

## Compact Admin / AE Form label cutover — 2026-08-21

- Deployed backward-compatible Apps Script version `11` through the existing deployment ID before editing the live Form. The submission parser accepts both legacy and compact identity field titles during rollout.
- Ran the idempotent `configurePmcCompactFormIdentityFields()` operator function successfully without pausing responses.
- Responder readback confirmed the Form remained accepting, contained exactly one required `Admin` Dropdown and one required `AE` Dropdown, and contained neither legacy title.
- The AE Dropdown readback order was `เลือก`, `ไม่ระบุ`, then the seven active eligible staff names. A later setup sync preserves `ไม่ระบุ` as the first real choice.
- No Form response was submitted and no Booking, Drive, Calendar, LINE, call-task, JERA, or Dashboard side effect was created during the cutover.

## Any-email selected Admin attribution — 2026-08-22

- Diagnosed the owner's personal-email test from the authoritative Apps Script execution: `onBookingFormSubmit` received the response but failed at the former email-to-closer gate before Case ID allocation or any Drive, Calendar, LINE, call-task, JERA, or Dashboard side effect.
- Live `CONFIG_STAFF` inspection showed seven active closer rows with nonblank unique emails; the failed test account was not one of the mapped closer identities.
- The owner selected the flexible policy: any signed-in Google Account that can access the Form may submit, and the required active `Admin` Dropdown choice is the canonical closer attribution.
- Deployed Apps Script version `12` through the existing deployment ID. New bookings store `adminIdentityStatus=SELECTED_ADMIN`; the submitter email is retained independently for audit and never blocks or overrides the selected Admin.
- Responder readback confirmed the Form remained accepting with exactly one `Admin`, one `AE`, and the `ไม่ระบุ` AE option.
- The failed response was not replayed automatically. A fresh Form submission is required to exercise the new policy and prevents accidental duplicate operational side effects.

## Any-email live Form and Calendar retry recovery — 2026-08-22

- With explicit owner confirmation, submitted one new synthetic Form response from an unmapped signed-in Google Account using Admin `มัส`, AE `ฝ้าย`, reserved phone `0800000000`, and non-customer logo evidence.
- The Form and `onBookingFormSubmit` execution completed successfully under Apps Script version `12`. Readback confirmed `adminIdentityStatus=SELECTED_ADMIN`, the selected Admin/AE attribution, and private Drive evidence storage.
- Initial Calendar creation exposed a deterministic identifier collision with a previously deleted test event after the monthly Case ID sequence had been reset. The workflow correctly stopped before LINE and queued one `CALENDAR_EVENT` retry.
- Deployed Apps Script version `13`: Calendar event keys now combine Case ID with the immutable Form response ID; new Calendar retries retain evidence file IDs and continue through call-task creation plus Admin/doctor LINE delivery.
- Ran the explicit retry-only operator once. Readback confirmed `BOOKING_CONFIRMED`, `driveState=OK`, `calendarState=OK`, `lineState=OK`, a Calendar event ID, doctor notification time, one pending call task, and zero pending retries.
- The recovered legacy retry row predated the new evidence payload, so its Admin recovery card may use the approved no-image fallback. Future Calendar retries created by version `13` retain evidence IDs and can render the evidence thumbnails.

## Owner-gated Booking workbook presentation maintenance

This workflow changes presentation metadata only. Hiding a tab is a convenience for operators and is **not access control**; every person who can edit the workbook may still unhide tabs. Do not use this workflow to protect confidential data.

Only the owner may run the two manual functions below. Neither function is an installed Form or time trigger:

- `previewPmcBookingWorkbookPresentation()` — read-only inspection and planning;
- `applyPmcBookingWorkbookPresentation()` — explicitly approved apply under the bounded script lock.

### Private operator workspace

Owner creates one environment file outside the repository, mode `0600`, plus one owner-only output directory, mode `0700`. The file defines `PMC_OPERATOR_REVIEWED_COMMIT`, `PMC_OPERATOR_REVIEWED_CODE_SHA256`, `PMC_OPERATOR_CLASP_VERSION`, `PMC_OPERATOR_CLASP_PROFILE`, `PMC_OPERATOR_CLASP_PROJECT_FILE`, `PMC_OPERATOR_SCRIPT_ID`, `PMC_OPERATOR_DEPLOYMENT_ID`, `PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL`, `PMC_OPERATOR_PRIVATE_DIR`, and the later maintenance values `PMC_OPERATOR_PROJECT`, `PMC_OPERATOR_REGION`, `PMC_OPERATOR_SERVICE`, `PMC_OPERATOR_QUEUE`, `PMC_OPERATOR_REVISION`, `PMC_OPERATOR_MIN_APPS_SCRIPT_VERSION`, `PMC_OPERATOR_PROPERTIES_PREINSTALL`, `PMC_OPERATOR_PROPERTIES_INSTALLED`, and `PMC_OPERATOR_ATTESTATION_FILE`.

Use a new empty private output directory for every reviewed attempt. The runner deliberately refuses to overwrite a preflight, approval, version, clone, or readback artifact from an earlier attempt.

The private clasp project file must be a non-symlink mode-`0600` JSON file with the reviewed `scriptId`, `rootDir: "dist"`, and optional reviewed `parentId`. When `parentId` is present, the private environment must also define the matching `PMC_OPERATOR_PARENT_ID`. Supply only the environment-file path through `PMC_BOOKING_DEPLOY_ENV_FILE`. Do not type resolved identities, paths, or digests into copied commands.

The checked-in Bash 3.2 runner enforces `set -Eeuo pipefail`, noclobber, `HISTFILE=/dev/null`, disabled history/xtrace, `umask 077`, owner/mode checks, clean reviewed commit, exact bundle hash, pinned local clasp version, exact authorized account, exact project/deployment binding, and JSON readback. Its three phases are intentionally separate: read-only preflight, explicit owner approval, then deploy.

Every generated file remains mode `0600`. Never `cat`, `echo`, paste, or upload an attestation, property value, account identity, project/deployment identity, backup identity, or unrestricted URL into terminal history, chat, screenshots, logs, or rollout evidence.

### Exact maintenance order

Perform these steps in order. Stop immediately if a command fails, a placeholder is unresolved, an identity is wrong, a trigger gate fails, or any digest changes.

1. Deploy the reviewed Apps Script version only through the checked-in runner. Run each phase separately and inspect the mode-`0600` private artifacts before proceeding:

```bash
apps/pmc-google-booking-ops/scripts/deploy-workbook-presentation.sh preflight
apps/pmc-google-booking-ops/scripts/deploy-workbook-presentation.sh approve
apps/pmc-google-booking-ops/scripts/deploy-workbook-presentation.sh deploy
```

Require `PREFLIGHT_OK`, then `APPROVAL_RECORDED`, then `DEPLOY_VERIFIED`. The runner performs no external mutation before the approved deploy phase has repeated every preflight gate and matched the approval seal. It uses `clasp push --force --json`, creates one new immutable version, proves that version was absent before and present afterward, clones that exact version into the private directory, verifies the cloned `Code.js` hash, redeploys exactly that newly created version, and verifies the final deployment readback. Any failed gate stops later mutation commands.

Only after `DEPLOY_VERIFIED`, open a clean Bash shell and privately source the same file for steps 2 onward:

```bash
exec /bin/bash --noprofile --norc
HISTFILE=/dev/null
export HISTFILE
set +o history
set +x
umask 077
source "$PMC_BOOKING_DEPLOY_ENV_FILE"
```

Abort if any required maintenance variable is absent or if `PMC_OPERATOR_ATTESTATION_FILE` already exists.

2. Pause the exact production Booking queue and prove the task list is empty. All identity-bearing output stays in private files.

```bash
gcloud tasks queues pause "$PMC_OPERATOR_QUEUE" --location "$PMC_OPERATOR_REGION" --project "$PMC_OPERATOR_PROJECT" > "$PMC_OPERATOR_PRIVATE_DIR/queue-pause.log" 2>&1
gcloud tasks queues describe "$PMC_OPERATOR_QUEUE" --location "$PMC_OPERATOR_REGION" --project "$PMC_OPERATOR_PROJECT" --format=json > "$PMC_OPERATOR_PRIVATE_DIR/queue-paused.json" 2>&1
gcloud tasks list --queue "$PMC_OPERATOR_QUEUE" --location "$PMC_OPERATOR_REGION" --project "$PMC_OPERATOR_PROJECT" --format=json > "$PMC_OPERATOR_PRIVATE_DIR/tasks-paused.json" 2>&1
chmod 600 "$PMC_OPERATOR_PRIVATE_DIR/queue-pause.log" "$PMC_OPERATOR_PRIVATE_DIR/queue-paused.json" "$PMC_OPERATOR_PRIVATE_DIR/tasks-paused.json"
```

Require the private queue readback to show `PAUSED` and the private task array to be empty. Do not infer state from the pause command's exit code alone.

3. Read and verify `PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST`. The operator creates `PMC_OPERATOR_PROPERTIES_PREINSTALL` as a private exact Script Property JSON snapshot containing the signed `COMPLETE` migration manifest but excluding a fresh presentation attestation and expected queue digest. `PREPARED`, `RESTORE_REQUIRED`, absent, invalid, or manually edited is an abort.

The first PRESENTATION attestation command must not include `--strict`. It must use the exact target schema, minimum protocol 2, serving revision with prepare enabled, write barrier, paused/empty queue, compatible Apps Script deployment, and `COMPLETE` manifest. Checker stdout contains safe booleans/status only; stderr and stdout are still retained privately:

```bash
node scripts/check-pmc-booking-attribution-v2.mjs \
  --allow-readonly-production \
  --expected-stage PRESENTATION \
  --project "$PMC_OPERATOR_PROJECT" \
  --region "$PMC_OPERATOR_REGION" \
  --service "$PMC_OPERATOR_SERVICE" \
  --queue "$PMC_OPERATOR_QUEUE" \
  --expected-revision "$PMC_OPERATOR_REVISION" \
  --apps-script-id "$PMC_OPERATOR_SCRIPT_ID" \
  --apps-script-deployment-id "$PMC_OPERATOR_DEPLOYMENT_ID" \
  --minimum-apps-script-version "$PMC_OPERATOR_MIN_APPS_SCRIPT_VERSION" \
  --script-properties-file "$PMC_OPERATOR_PROPERTIES_PREINSTALL" \
  --write-attestation "$PMC_OPERATOR_ATTESTATION_FILE" \
  > "$PMC_OPERATOR_PRIVATE_DIR/presentation-check-preinstall.json" \
  2> "$PMC_OPERATOR_PRIVATE_DIR/presentation-check-preinstall.err"
```

Require exit `0`, stage `PRESENTATION`, `manifestStatus=COMPLETE`, `attestationEligible=true`, `safeStatus=PROPERTY_INSTALL_REQUIRED`, `ready=false`, and a new mode-`0600` attestation. The checker never prints its JSON, digest, or private path. In the verified Apps Script Project Settings, owner installs exactly:

- `PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION` = the complete attestation JSON;
- `PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST` = the exact `queueResourceDigest` from that same JSON.

Do not print either value. Owner creates `PMC_OPERATOR_PROPERTIES_INSTALLED` as a new private mode-`0600` property snapshot containing the same `COMPLETE` manifest plus the newly installed values. Verify with a strict read-only PRESENTATION check and no second write:

```bash
node scripts/check-pmc-booking-attribution-v2.mjs \
  --allow-readonly-production \
  --expected-stage PRESENTATION \
  --project "$PMC_OPERATOR_PROJECT" \
  --region "$PMC_OPERATOR_REGION" \
  --service "$PMC_OPERATOR_SERVICE" \
  --queue "$PMC_OPERATOR_QUEUE" \
  --expected-revision "$PMC_OPERATOR_REVISION" \
  --apps-script-id "$PMC_OPERATOR_SCRIPT_ID" \
  --apps-script-deployment-id "$PMC_OPERATOR_DEPLOYMENT_ID" \
  --minimum-apps-script-version "$PMC_OPERATOR_MIN_APPS_SCRIPT_VERSION" \
  --script-properties-file "$PMC_OPERATOR_PROPERTIES_INSTALLED" \
  --strict \
  > "$PMC_OPERATOR_PRIVATE_DIR/presentation-check-installed.json" \
  2> "$PMC_OPERATOR_PRIVATE_DIR/presentation-check-installed.err"
```

Require `manifestStatus=COMPLETE`, queue `PAUSED`, zero tasks, `attestationInstalled=true`, `expectedQueueDigestInstalled=true`, `safeStatus=READY`, and `ready=true`. The new attestation is accepted for only ten minutes from its signed `verifiedAt`; steps 4–9 must finish inside that ten-minute window. If it expires, do not edit or re-sign it. Keep the queue/barrier paused and rerun step 3 with a new output path and fresh explicit owner review.

4. Run `previewPmcBookingWorkbookPresentation()` once. Capture its safe result privately. The runtime itself must reject if either presentation function appears in `ScriptApp.getProjectTriggers()`.

```bash
npx clasp --user "$PMC_OPERATOR_CLASP_PROFILE" --project "$PMC_OPERATOR_CLASP_PROJECT_FILE" run --nondev previewPmcBookingWorkbookPresentation > "$PMC_OPERATOR_PRIVATE_DIR/presentation-preview.json" 2>&1
chmod 600 "$PMC_OPERATOR_PRIVATE_DIR/presentation-preview.json"
```

Require `preflightPassed=true`, `queuePausedAndEmpty=true`, `migrationComplete=true`, `readyForOwnerApproval=true`, `backupCreated=false`, and `liveWrites=false`.

5. Review the complete safe preview: locally inspect visible tab order, every tab hidden by policy, action count and action-type counts, source digest, plan digest, queue-attestation digest, migration-manifest digest, and review digest. Confirm again that hiding is presentation only. Do not copy the private result file or any digest into chat, repository, or general rollout evidence.

6. Install the exact reviewed `reviewDigest` as Script Property `PMC_BOOKING_WORKBOOK_PRESENTATION_APPROVED_DIGEST` in the verified project. The initial value is the bare 64-character digest. Read it back only through Project Settings and a private mode-`0600` property snapshot; do not print it. Do not approve a copied, shortened, stale, or manually recomputed value.

7. Run `applyPmcBookingWorkbookPresentation()` once. Capture the safe result privately. A source, queue-attestation, migration-manifest, trigger topology, or approval digest that changed since preview must fail before backup or presentation batch.

```bash
npx clasp --user "$PMC_OPERATOR_CLASP_PROFILE" --project "$PMC_OPERATOR_CLASP_PROJECT_FILE" run --nondev applyPmcBookingWorkbookPresentation > "$PMC_OPERATOR_PRIVATE_DIR/presentation-apply.json" 2>&1
chmod 600 "$PMC_OPERATOR_PRIVATE_DIR/presentation-apply.json"
```

Under the same script lock, accepted approval changes from the bare digest to `ATTEMPTED:<digest>` before any backup, batch, or no-op decision. A verified `APPLIED` or `NOOP` then changes it to `APPLIED:<digest>`. Any backup, batch, readback, final property-write, or ambiguous failure leaves `ATTEMPTED` or another fail-closed used state; replay is forbidden until a new preview, review, and explicit bare-digest property approval. The workflow never auto-clears approval, pauses/resumes the queue, or performs rollback.

8. Require a safe result with `status=APPLIED` or the explicitly reviewed `NOOP`, matching source/plan/review digests, `approvalMatched=true`, and `readbackVerified=true`. For `APPLIED`, require `backupCreated=true` and the reviewed action count. Read back the approval property privately and require the safe `APPLIED` prefix. Never record the private backup identity or URL in general evidence.

9. Compare the returned source, plan, and review SHA-256 digests with the approved preview. Then perform a second read-only preview and capture it privately:

```bash
npx clasp --user "$PMC_OPERATOR_CLASP_PROFILE" --project "$PMC_OPERATOR_CLASP_PROJECT_FILE" run --nondev previewPmcBookingWorkbookPresentation > "$PMC_OPERATOR_PRIVATE_DIR/presentation-post-apply-preview.json" 2>&1
chmod 600 "$PMC_OPERATOR_PRIVATE_DIR/presentation-post-apply-preview.json"
```

Require `actionCount=0`, `preflightPassed=true`, `backupCreated=false`, and `liveWrites=false`. The preceding apply result is the readback marker and must still show `readbackVerified=true`; this second preview must create no backup, batch, lock, or property write. Any nonzero action count, changed immutable hash, failed trigger gate, or ambiguous result is an abort.

10. At browser zoom 100%, capture privacy-safe 1280×720 screenshots of exactly these four tabs: `DASHBOARD`, `BOOKING_MASTER`, `CALL_QUEUE`, and `RECONCILIATION`. Crop or mask all customer data before placing screenshots in the evidence register. Do not capture IDs, URLs, property values, attestation content, or backup identity.

11. Only after digest/readback verification and all four screenshots are accepted may the owner resume the exact queue. Also require the post-apply zero-action preview and private `APPLIED` property readback before this command:

```bash
gcloud tasks queues resume "$PMC_OPERATOR_QUEUE" --location "$PMC_OPERATOR_REGION" --project "$PMC_OPERATOR_PROJECT" > "$PMC_OPERATOR_PRIVATE_DIR/queue-resume.log" 2>&1
gcloud tasks queues describe "$PMC_OPERATOR_QUEUE" --location "$PMC_OPERATOR_REGION" --project "$PMC_OPERATOR_PROJECT" --format=json > "$PMC_OPERATOR_PRIVATE_DIR/queue-resumed.json" 2>&1
chmod 600 "$PMC_OPERATOR_PRIVATE_DIR/queue-resume.log" "$PMC_OPERATOR_PRIVATE_DIR/queue-resumed.json"
```

Require the expected running state. Do not reuse the old queue attestation or presentation approval for any later maintenance.

### Abort and manual recovery

- If the deployment runner aborts after `clasp push`, do not assume the previous remote HEAD, immutable version, or deployment changed together. The deployment remains unverified until private read-only inspection proves its exact state. Do not reuse the old output directory or approval seal; diagnose first, then begin a fresh reviewed preflight/approval/deploy cycle.
- Before the apply attempt: keep the queue paused, correct the failed precondition, create a new valid maintenance window if permitted by the Attribution state, run a new preview, and install only its newly reviewed bare digest. Never reuse the old review digest.
- If the attempt marker cannot be written and verified, apply stops before backup/batch. Treat the property state as unknown until privately read back; do not retry blindly.
- If backup, batch, readback, or final approval transition fails after the property became `ATTEMPTED`, keep the queue paused and do not rerun automatically. A replay must fail closed. Do not overwrite `ATTEMPTED` until owner has completed read-only diagnosis and explicitly approved a new preview/review cycle.
- If a private backup was created and apply or readback then fails: do not delete tabs/data and do not claim rollback. The owner must locate the newly created private native backup in the approved private folder, compare it manually with the workbook, and choose either a reviewed manual restoration or a newly reviewed retry.
- If the result is ambiguous: treat it as not verified, keep the queue paused, inspect Apps Script execution status and workbook metadata read-only, then follow the same manual-recovery path.
- Resume is forbidden while readback is unverified, any migration manifest is not `COMPLETE`, or any queue task remains active.

### Evidence hygiene

Store only safe status labels, tab names, action counts/types, SHA-256 digests, boolean gate results, timestamps, and redacted screenshots. Do not record customer names, phone numbers, evidence images, cell values, Spreadsheet/Drive/backup IDs, URLs, queue resource names, principals, tokens, Script Property secret values, or unrestricted links.
