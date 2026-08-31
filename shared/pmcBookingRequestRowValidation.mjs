const REQUEST_STATES = new Set([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING',
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])

export const PMC_TERMINAL_PROTOCOL1_STATES = new Set([
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED',
])

export function parseExactPmcMiniAppRequestRows(headers, rows, schema) {
  if (!Array.isArray(headers) || !Array.isArray(rows) || (schema !== 'V1' && schema !== 'V2')) {
    throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  }
  const records = []
  for (const row of rows) {
    if (!Array.isArray(row)) throw new Error('MINI_APP_STORE_CORRUPT_ROW')
    if (row.every((cell) => text(cell).trim() === '')) continue
    records.push(parseRequestRow(headers, row, schema))
  }
  return records
}

function parseRequestRow(headers, row, schema) {
  if (row.length === 0 || row.length > headers.length) throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  const cell = (header) => row[headers.indexOf(header)]
  const staffId = text(cell('staffId'))
  const value = {
    requestId: text(cell('requestId')),
    draftId: text(cell('draftId')),
    protocolVersion: schema === 'V1' ? 1 : numberValue(cell('protocolVersion')),
    staffId,
    recorderName: schema === 'V1' ? '' : text(cell('recorderName')),
    adminId: schema === 'V1' ? staffId : text(cell('adminId')),
    adminName: schema === 'V1' ? '' : text(cell('adminName')),
    lineUserIdHash: text(cell('lineUserIdHash')),
    state: text(cell('state')),
    retentionState: text(cell('retentionState')),
    version: numberValue(cell('version')),
    payloadHash: nullableText(cell('payloadHash')),
    aeId: schema === 'V1' ? null : nullableText(cell('aeId')),
    aeName: text(cell('aeName')),
    customerName: text(cell('customerName')),
    facebookName: text(cell('facebookName')),
    phoneNormalized: text(cell('phoneNormalized')),
    doctorId: text(cell('doctorId')),
    serviceId: text(cell('serviceId')),
    queueType: text(cell('queueType')),
    appointmentDate: nullableText(cell('appointmentDate')),
    appointmentTime: nullableText(cell('appointmentTime')),
    depositAmount: numberValue(cell('depositAmount')),
    channelId: text(cell('channelId')),
    paymentEvidenceFileIds: stringArray(cell('paymentEvidenceFileIdsJson'), safeId),
    chatEvidenceFileIds: stringArray(cell('chatEvidenceFileIdsJson'), safeId),
    evidenceCount: numberValue(cell('evidenceCount')),
    paymentEvidenceObjectKeys: stringArray(cell('paymentEvidenceObjectKeysJson'), safeObjectKey),
    chatEvidenceObjectKeys: stringArray(cell('chatEvidenceObjectKeysJson'), safeObjectKey),
    taskName: nullableText(cell('taskName')),
    queuedAt: nullableText(cell('queuedAt')),
    processingStartedAt: nullableText(cell('processingStartedAt')),
    processingLeaseUntil: nullableText(cell('processingLeaseUntil')),
    lastProgressAt: nullableText(cell('lastProgressAt')),
    attemptCount: numberValue(cell('attemptCount')),
    processingOwnerToken: nullableText(cell('processingOwnerToken')),
    evidenceProjectionHash: nullableText(cell('evidenceProjectionHash')),
    createdAt: text(cell('createdAt')),
    confirmedAt: nullableText(cell('confirmedAt')),
    caseId: nullableText(cell('caseId')),
    confirmationStatus: nullableText(cell('confirmationStatus')),
    safeErrorCode: nullableText(cell('safeErrorCode')),
    updatedAt: text(cell('updatedAt')),
  }
  if (schema === 'V2' && value.protocolVersion !== 1 && value.protocolVersion !== 2) {
    throw new Error('UNKNOWN_REQUEST_PROTOCOL_VERSION')
  }
  if (schema === 'V2' && value.protocolVersion === 1 && !PMC_TERMINAL_PROTOCOL1_STATES.has(value.state)) {
    throw new Error('NONTERMINAL_LEGACY_DRAFTS')
  }
  assertExactRequestRecord(value, schema)
  return value
}

function assertExactRequestRecord(value, schema) {
  if (!safeId(value.requestId) || !safeId(value.draftId) || !safeId(value.staffId)) fail()
  if (value.protocolVersion !== 1 && value.protocolVersion !== 2) fail()
  if (schema === 'V1' && value.protocolVersion !== 1) fail()
  if (schema === 'V2') {
    if (!boundedName(value.recorderName) || reserved(value.staffId, value.recorderName)) fail()
    const canOmitPreSaveAdmin = value.protocolVersion === 2
      && ['DRAFT', 'UPLOADING', 'CANCELLED', 'EXPIRED'].includes(value.state)
      && value.payloadHash === null
    const missingAdmin = value.adminId === '' && value.adminName === ''
    if (missingAdmin && !canOmitPreSaveAdmin) fail()
    if (!missingAdmin && (!safeId(value.adminId) || !boundedName(value.adminName)
      || reserved(value.adminId, value.adminName))) fail()
    if (value.aeId === null) {
      const validNullName = value.protocolVersion === 1
        ? value.aeName === '' || value.aeName === 'ไม่ระบุ'
        : value.aeName === 'ไม่ระบุ'
      if (!validNullName) fail()
    } else if (!safeId(value.aeId) || !boundedName(value.aeName)
      || reserved(value.aeId, value.aeName)) fail()
    if (value.protocolVersion === 1 && !PMC_TERMINAL_PROTOCOL1_STATES.has(value.state)) fail()
  } else if (value.aeName.length > 512 || hasControl(value.aeName)) fail()
  if (!safeHash(value.lineUserIdHash) || !REQUEST_STATES.has(value.state)) fail()
  if (value.retentionState !== '' && value.retentionState !== 'PENDING_APPROVAL') fail()
  if (!Number.isSafeInteger(value.version) || value.version < 1) fail()
  if (value.payloadHash !== null && !safeHash(value.payloadHash)) fail()
  if (value.confirmationStatus !== null
    && !['CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT'].includes(value.confirmationStatus)) fail()
  if (value.queueType !== 'NORMAL' && value.queueType !== 'AUTO') fail()
  if (!Number.isFinite(value.depositAmount) || value.depositAmount < 0) fail()
  if (!Number.isSafeInteger(value.evidenceCount) || value.evidenceCount < 0 || value.evidenceCount > 20) fail()
  for (const list of [
    value.paymentEvidenceFileIds, value.chatEvidenceFileIds,
    value.paymentEvidenceObjectKeys, value.chatEvidenceObjectKeys,
  ]) {
    if (list.length > 10 || new Set(list).size !== list.length) fail()
  }
  if (!Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0) fail()
  if (value.processingOwnerToken !== null && !/^[A-Za-z0-9_-]{16,128}$/.test(value.processingOwnerToken)) fail()
  if (value.evidenceProjectionHash !== null && !/^[A-Za-z0-9_-]{43}$/.test(value.evidenceProjectionHash)) fail()
  if (value.caseId !== null && !/^PMC-\d{6}-\d{4,}$/.test(value.caseId)) fail()
  if (value.safeErrorCode !== null && !/^[A-Z0-9_]{1,80}$/.test(value.safeErrorCode)) fail()
  if (value.appointmentDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value.appointmentDate)) fail()
  if (value.appointmentTime !== null && !/^\d{2}:\d{2}$/.test(value.appointmentTime)) fail()
  for (const date of [
    value.createdAt, value.updatedAt, value.confirmedAt, value.queuedAt,
    value.processingStartedAt, value.processingLeaseUntil, value.lastProgressAt,
  ]) {
    if (date !== null && !validIso(date)) fail()
  }
  if (value.taskName !== null && !/^[A-Za-z0-9._:/-]{1,512}$/.test(value.taskName)) fail()
  for (const field of [value.customerName, value.facebookName, value.phoneNormalized]) {
    if (field.length > 512 || hasControl(field)) fail()
  }
  for (const id of [value.doctorId, value.serviceId, value.channelId]) {
    if (id && !safeConfigId(id)) fail()
  }
}

function stringArray(value, validItem) {
  let parsed = value
  if (!Array.isArray(parsed)) {
    try { parsed = JSON.parse(text(value) || '[]') } catch { fail() }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !validItem(item))) fail()
  return [...parsed]
}

function fail() { throw new Error('MINI_APP_STORE_CORRUPT_ROW') }
function text(value) { return value === null || value === undefined ? '' : String(value) }
function nullableText(value) { const normalized = text(value); return normalized ? normalized : null }
function numberValue(value) { return typeof value === 'number' ? value : Number(value) }
function safeId(value) { return /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeHash(value) { return /^[A-Za-z0-9_-]{4,128}$/.test(value) }
function safeObjectKey(value) { return /^[A-Za-z0-9._/-]{1,512}$/.test(value) }
function safeConfigId(value) {
  return value.length > 0 && value.length <= 124 && value.trim() === value && !hasControl(value)
}
function boundedName(value) {
  return value.length > 0 && value.length <= 120 && value.trim() === value && !hasControl(value)
}
function reserved(id, name) { return id.trim().toUpperCase() === 'NONE' || name.trim() === 'ไม่ระบุ' }
function hasControl(value) {
  for (const character of value) {
    const point = character.codePointAt(0)
    if (point !== undefined && (point < 32 || point === 127)) return true
  }
  return false
}
function validIso(value) {
  return Boolean(value) && Number.isFinite(Date.parse(value))
}
