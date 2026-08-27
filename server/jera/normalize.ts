import { createHash } from 'node:crypto'
import type {
  JeraNormalizationContext,
  JeraNormalizedCourse,
  JeraNormalizedOpd,
  JeraNormalizedPaymentDetail,
  JeraNormalizedPaymentMethod,
  JeraNormalizedRow,
  JeraNormalizedSalesperson,
} from './contracts.js'
import { JeraMoneyError, parseThaiMoneyToSatang } from './money.js'

const MAX_TEXT = 256
const MAX_CODE = 128
const MAX_DETAIL_ROWS = 100
const MAX_DETAIL_ITEMS = 100

export class JeraNormalizationError extends Error {
  readonly code = 'JERA_SCHEMA_INVALID' as const

  constructor() {
    super('JERA_SCHEMA_INVALID')
    this.name = 'JeraNormalizationError'
  }
}

type RowBase = Omit<JeraNormalizedRow, 'cacheKey' | 'fetchedAt' | 'sourceHash'>

export function normalizePaymentReport(payload: unknown, context: JeraNormalizationContext): JeraNormalizedRow[] {
  const safeContext = normalizationContext(context)
  return payloadRows(payload, 'payment_data').map((value) => {
    const row = record(value)
    const sourceUuid = requiredUuid(row.uuid)
    const paymentCode = requiredText(row.code, MAX_CODE)
    const sourceCreatedAt = requiredDateTime(row.create_date)
    const base: RowBase = {
      reportType: 'PAYMENT', sourceUuid,
      branchUuid: optionalUuid(row.branch_uuid) ?? safeContext.branchUuid,
      branchName: optionalText(row.branch_name), eventDate: eventDate(row.create_date),
      patientUuid: optionalUuid(row.patient_uuid), patientCode: optionalText(row.patient_code, MAX_CODE),
      patientName: optionalText(row.patient_name), paymentCode,
      status: optionalText(row.status, MAX_CODE), type: optionalText(row.type, MAX_CODE),
      totalSatang: requiredMoney(row.total), paidAmountSatang: requiredMoney(row.paid_amount), refundAmountSatang: null,
      doctorName: optionalText(row.doctor_name), salespersonName: personNames(row.seller),
      sourceCreatedAt, sourceUpdatedAt: null,
    }
    return finishRow(base, safeContext)
  })
}

export function normalizeDepositReport(payload: unknown, context: JeraNormalizationContext): JeraNormalizedRow[] {
  const safeContext = normalizationContext(context)
  const groups: Array<{ type: string; rows: unknown[] }> = Array.isArray(payload)
    ? depositTransportGroups(payload)
    : depositEnvelopeGroups(record(payload))
  return groups.flatMap((group) => group.rows.map((value) => {
    const row = record(value)
    const base: RowBase = {
      reportType: 'DEPOSIT', sourceUuid: requiredUuid(row.uuid),
      branchUuid: optionalUuid(row.branch_uuid) ?? safeContext.branchUuid,
      branchName: optionalText(row.branch_name), eventDate: eventDate(row.create_date),
      patientUuid: optionalUuid(row.patient_uuid), patientCode: optionalText(row.patient_code, MAX_CODE),
      patientName: optionalText(row.patient_name), paymentCode: requiredText(row.payment_code, MAX_CODE),
      status: null, type: group.type,
      totalSatang: requiredMoney(row.total), paidAmountSatang: requiredMoney(row.paid_amount),
      refundAmountSatang: optionalMoney(row.total_refund), doctorName: null,
      salespersonName: personNames(row.sellers), sourceCreatedAt: requiredDateTime(row.create_date), sourceUpdatedAt: null,
    }
    return finishRow(base, safeContext)
  }))
}

function depositEnvelopeGroups(body: Record<string, unknown>): Array<{ type: string; rows: unknown[] }> {
  return [
    { type: 'CASH_DEPOSIT', rows: requiredArray(body.cash_deposits) },
    { type: 'PRODUCT_DEPOSIT', rows: requiredArray(body.product_deposits) },
  ]
}

function depositTransportGroups(payload: unknown[]): Array<{ type: string; rows: unknown[] }> {
  return payload.map((value) => {
    const wrapper = record(value)
    if (wrapper.__jeraDepositType !== 'CASH_DEPOSIT' && wrapper.__jeraDepositType !== 'PRODUCT_DEPOSIT') {
      throw new JeraNormalizationError()
    }
    return { type: wrapper.__jeraDepositType, rows: [record(wrapper.data)] }
  })
}

export function normalizeRefundReport(payload: unknown, context: JeraNormalizationContext): JeraNormalizedRow[] {
  const safeContext = normalizationContext(context)
  return requiredArray(payload).map((value) => {
    const row = record(value)
    const paymentCode = requiredText(row.payment_code, MAX_CODE)
    const patientCode = requiredText(row.patient_code, MAX_CODE)
    const sourceCreatedAt = requiredDateTime(row.refund_date)
    const refundType = optionalText(row.refund_type, MAX_CODE)
    const identity = canonicalHash({ paymentCode, patientCode, sourceCreatedAt, refundType }).slice(0, 32)
    const base: RowBase = {
      reportType: 'REFUND', sourceUuid: `refund:${identity}`,
      branchUuid: optionalUuid(row.branch_uuid) ?? safeContext.branchUuid,
      branchName: optionalText(row.branch_name), eventDate: eventDate(row.refund_date),
      patientUuid: optionalUuid(row.patient_uuid), patientCode, patientName: optionalText(row.patient_name), paymentCode,
      status: null, type: refundType, totalSatang: optionalMoney(row.total), paidAmountSatang: null,
      refundAmountSatang: requiredMoney(row.total_refund_cost), doctorName: null, salespersonName: null,
      sourceCreatedAt, sourceUpdatedAt: null,
    }
    return finishRow(base, safeContext)
  })
}

export function normalizeAppointmentList(payload: unknown, context: JeraNormalizationContext): JeraNormalizedRow[] {
  const safeContext = normalizationContext(context)
  return payloadRows(payload, 'data').map((value) => {
    const row = record(value)
    const base: RowBase = {
      reportType: 'APPOINTMENT', sourceUuid: requiredUuid(row.uuid),
      branchUuid: optionalUuid(row.branch_uuid) ?? safeContext.branchUuid,
      branchName: optionalText(row.branch_name), eventDate: eventDate(row.appoint_date),
      patientUuid: optionalUuid(row.patient_uuid), patientCode: optionalText(row.patient_code, MAX_CODE),
      patientName: optionalText(row.patient_name), paymentCode: null,
      status: optionalText(row.status_text, MAX_CODE), type: optionalText(row.type_text, MAX_CODE),
      totalSatang: null, paidAmountSatang: null, refundAmountSatang: null,
      doctorName: optionalText(row.staff_name), salespersonName: null,
      sourceCreatedAt: optionalDateTime(row.create_date), sourceUpdatedAt: optionalDateTime(row.update_date),
    }
    return finishRow(base, safeContext)
  })
}

export function normalizePaymentList(payload: unknown, context: JeraNormalizationContext): JeraNormalizedRow[] {
  const safeContext = normalizationContext(context)
  return requiredArray(payload).map((value) => {
    const row = record(value)
    const base: RowBase = {
      reportType: 'PAYMENT_LIST', sourceUuid: requiredUuid(row.uuid),
      branchUuid: optionalUuid(row.branch_uuid) ?? safeContext.branchUuid,
      branchName: optionalText(row.branch_name), eventDate: eventDate(row.create_date),
      patientUuid: optionalUuid(row.patient_uuid), patientCode: optionalText(row.patient_code, MAX_CODE),
      patientName: optionalText(row.patient_name), paymentCode: requiredText(row.code, MAX_CODE),
      status: requiredBoolean(row.is_unpaid) ? 'UNPAID' : 'PAID', type: 'PAYMENT_LIST',
      totalSatang: requiredMoney(row.total), paidAmountSatang: requiredMoney(row.paid_amount),
      refundAmountSatang: optionalMoney(row.total_refund), doctorName: optionalText(row.doctor_name), salespersonName: null,
      sourceCreatedAt: requiredDateTime(row.create_date), sourceUpdatedAt: null,
    }
    return finishRow(base, safeContext)
  })
}

export function normalizePaymentDetail(payload: unknown, context: JeraNormalizationContext): JeraNormalizedPaymentDetail {
  const safeContext = normalizationContext(context)
  const row = record(payload)
  const sourceUuid = requiredUuid(row.uuid)
  const paymentCode = requiredText(row.code, MAX_CODE)
  const sourceCreatedAt = requiredDateTime(row.create_date)
  const patient = record(row.patient)
  const paymentMethodsSource = requiredArray(row.payment_methods)
  const salespersonsSource = requiredArray(row.salespersons)
  const opdsSource = requiredArray(row.opds)
  const coursesSource = requiredArray(row.courses)
  let truncated = [paymentMethodsSource, salespersonsSource, opdsSource, coursesSource]
    .some((items) => items.length > MAX_DETAIL_ROWS)

  const paymentMethods: JeraNormalizedPaymentMethod[] = paymentMethodsSource.slice(0, MAX_DETAIL_ROWS).map((value) => {
    const method = record(value)
    return { method: requiredText(method.method_txt), amountSatang: requiredMoney(method.cash_amount) }
  })
  const salespersons: JeraNormalizedSalesperson[] = salespersonsSource.slice(0, MAX_DETAIL_ROWS).map((value) => {
    const salesperson = record(value)
    return {
      name: requiredText(salesperson.name), feeSatang: optionalMoney(salesperson.fee),
      feeUnit: optionalText(salesperson.fee_unit_txt, MAX_CODE),
    }
  })
  const opds: JeraNormalizedOpd[] = opdsSource.slice(0, MAX_DETAIL_ROWS).map((value) => {
    const opd = record(value)
    const itemsSource = requiredArray(opd.items)
    if (itemsSource.length > MAX_DETAIL_ITEMS) truncated = true
    return {
      code: optionalText(opd.opd_code, MAX_CODE), eventDate: optionalEventDate(opd.opd_create_date),
      totalSatang: optionalMoney(opd.total), paidAmountSatang: optionalMoney(opd.paid_amount),
      items: itemsSource.slice(0, MAX_DETAIL_ITEMS).map((itemValue) => {
        const item = record(itemValue)
        return {
          code: optionalText(item.code, MAX_CODE), name: requiredText(item.name), action: optionalText(item.action, MAX_CODE),
          priceSatang: optionalMoney(item.price), discountSatang: optionalMoney(item.disc_price), quantity: optionalQuantity(item.amount),
        }
      }),
    }
  })
  const courses: JeraNormalizedCourse[] = coursesSource.slice(0, MAX_DETAIL_ROWS).map((value) => {
    const course = record(value)
    return {
      code: optionalText(course.code ?? course.course_code, MAX_CODE),
      name: optionalText(course.name ?? course.course_name),
      totalSatang: optionalMoney(course.total), paidAmountSatang: optionalMoney(course.paid_amount),
    }
  })
  const detailWithoutHash = {
    sourceUuid, paymentCode, branchName: optionalText(row.branch_name), eventDate: eventDate(row.create_date), sourceCreatedAt,
    totalSatang: requiredMoney(row.total), paidAmountSatang: requiredMoney(row.paid_amount),
    patient: {
      sourceUuid: requiredUuid(patient.patient_uuid), patientCode: requiredText(patient.patient_code, MAX_CODE),
      displayName: displayName(patient), nickname: optionalText(patient.nickname), mobile: optionalText(patient.mobile, 40),
      facebook: optionalText(patient.facebook),
    },
    paymentMethods, salespersons, opds, courses, truncated,
  }
  return {
    ...detailWithoutHash, fetchedAt: safeContext.fetchedAt,
    sourceHash: canonicalHash(detailWithoutHash),
  }
}

function finishRow(base: RowBase, context: JeraNormalizationContext): JeraNormalizedRow {
  return { cacheKey: context.cacheKey, ...base, fetchedAt: context.fetchedAt, sourceHash: canonicalHash(base) }
}

function normalizationContext(context: JeraNormalizationContext): JeraNormalizationContext {
  if (!context || typeof context !== 'object') throw new JeraNormalizationError()
  const cacheKey = requiredText(context.cacheKey, MAX_TEXT)
  const branchUuid = context.branchUuid === null ? null : requiredUuid(context.branchUuid)
  const fetchedAt = requiredIsoInstant(context.fetchedAt)
  return { cacheKey, branchUuid, fetchedAt }
}

function payloadRows(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload
  return requiredArray(record(payload)[key])
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JeraNormalizationError()
  return value as Record<string, unknown>
}

function requiredArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new JeraNormalizationError()
  return value
}

function requiredText(value: unknown, max = MAX_TEXT): string {
  const result = optionalText(value, max)
  if (result === null) throw new JeraNormalizationError()
  return result
}

function optionalText(value: unknown, max = MAX_TEXT): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new JeraNormalizationError()
  const result = value.trim()
  if (!result) return null
  return result.slice(0, max)
}

function requiredUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new JeraNormalizationError()
  }
  return value.toLowerCase()
}

function optionalUuid(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return requiredUuid(value)
}

function requiredMoney(value: unknown): number {
  try { return parseThaiMoneyToSatang(value) } catch (error) {
    if (error instanceof JeraMoneyError) throw new JeraNormalizationError()
    throw error
  }
}

function optionalMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  return requiredMoney(value)
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new JeraNormalizationError()
  return value
}

function optionalQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const quantity = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) {
    throw new JeraNormalizationError()
  }
  return quantity
}

function eventDate(value: unknown): string {
  const date = optionalEventDate(value)
  if (!date) throw new JeraNormalizationError()
  return date
}

function optionalEventDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new JeraNormalizationError()
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/)
  if (!match || !validIsoDate(match[1]!)) throw new JeraNormalizationError()
  return match[1]!
}

function requiredDateTime(value: unknown): string {
  const result = optionalDateTime(value)
  if (!result) throw new JeraNormalizationError()
  return result
}

function optionalDateTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new JeraNormalizationError()
  const raw = value.trim()
  const naive = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (naive) {
    const candidate = `${naive[1]}T${naive[2]}:${naive[3]}:${naive[4] ?? '00'}+07:00`
    if (Number.isNaN(Date.parse(candidate))) throw new JeraNormalizationError()
    return candidate
  }
  const instant = new Date(raw)
  if (Number.isNaN(instant.getTime())) throw new JeraNormalizationError()
  return instant.toISOString()
}

function requiredIsoInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new JeraNormalizationError()
  }
  return new Date(value).toISOString()
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function personNames(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return optionalText(value)
  const values = Array.isArray(value) ? value : [value]
  const names = values.slice(0, 8).map((item) => {
    if (typeof item === 'string') return requiredText(item)
    return requiredText(record(item).name)
  })
  return names.length ? names.join(', ').slice(0, MAX_TEXT) : null
}

function displayName(patient: Record<string, unknown>): string | null {
  const direct = optionalText(patient.patient_name)
  if (direct) return direct
  const parts = [optionalText(patient.fname), optionalText(patient.lname)].filter((value): value is string => value !== null)
  return parts.length ? parts.join(' ').slice(0, MAX_TEXT) : null
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}
