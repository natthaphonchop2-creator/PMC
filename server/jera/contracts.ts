export const JERA_REPORT_TYPES = [
  'TODAY_SUMMARY', 'PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT',
  'PAYMENT_LIST', 'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT',
  'OPD', 'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE',
  'REMAINING_COURSE_BY_DATE',
] as const

export type JeraReportType = (typeof JERA_REPORT_TYPES)[number]
export type JeraSourceReportType = Exclude<JeraReportType, 'TODAY_SUMMARY'>
export type JeraEndpointKey = JeraSourceReportType | 'PAYMENT_DETAIL' | 'CLINIC' | 'CLINIC_USERS' | 'QUEUE_LIST'

export interface JeraReportFilters {
  branchUuid: string
  startDate: string
  endDate: string
  doctorUuid?: string
  salespersonUuid?: string
  status?: string
  type?: string
  code?: string
  delFlag?: boolean
  ctype?: string
  courseType?: string[]
  searchBy?: string
  remainingType?: string
  selectDate?: string
  showExpired?: boolean
  showDel?: boolean
  showFormer?: boolean
  patientUuid?: string
  paymentUuid?: string
}

export interface JeraEndpointDefinition {
  method: 'GET'
  path: string
  paginated: boolean
  allowedFilters: readonly (keyof JeraReportFilters)[]
}

const endpoint = (
  path: string,
  allowedFilters: readonly (keyof JeraReportFilters)[],
  paginated = false,
): Readonly<JeraEndpointDefinition> => Object.freeze({ method: 'GET' as const, path, paginated, allowedFilters: Object.freeze([...allowedFilters]) })

export const JERA_ENDPOINTS: Readonly<Record<JeraEndpointKey, Readonly<JeraEndpointDefinition>>> = Object.freeze({
  PAYMENT: endpoint('/openapi/v1/report/payment/', ['branchUuid', 'startDate', 'endDate']),
  DEPOSIT: endpoint('/openapi/v1/report/deposit/', ['branchUuid', 'startDate', 'endDate']),
  REFUND: endpoint('/openapi/v1/report/refund/', ['branchUuid', 'startDate', 'endDate']),
  APPOINTMENT: endpoint('/openapi/v1/appointment/', ['branchUuid', 'startDate', 'endDate', 'patientUuid', 'status'], true),
  PAYMENT_LIST: endpoint('/openapi/v1/report/payment-list/', ['branchUuid', 'startDate', 'endDate', 'status']),
  PRODUCT_USE: endpoint('/openapi/v1/report/product-use/', ['branchUuid', 'startDate', 'endDate', 'type']),
  PRODUCT_SALES: endpoint('/openapi/v1/report/product-sale/', ['branchUuid', 'startDate', 'endDate', 'type']),
  CANCELLED_PAYMENT: endpoint('/openapi/v1/report/cancelled-payment/', ['branchUuid', 'startDate', 'endDate']),
  OPD: endpoint('/openapi/v1/report/opd/', ['branchUuid', 'startDate', 'endDate', 'code', 'delFlag']),
  CANCELLED_UNPAID: endpoint('/openapi/v1/report/cancelled-unpaid-payment/', ['branchUuid', 'startDate', 'endDate']),
  COURSE_SALES: endpoint('/openapi/v1/report/course-sales/', ['branchUuid', 'startDate', 'endDate', 'ctype']),
  REMAINING_COURSE: endpoint('/openapi/v1/report/remaining-course/', [
    'branchUuid', 'startDate', 'endDate', 'courseType', 'searchBy', 'remainingType', 'showExpired', 'showDel', 'showFormer',
  ]),
  REMAINING_COURSE_BY_DATE: endpoint('/openapi/v1/report/remaining-course/by-date/', [
    'branchUuid', 'startDate', 'endDate', 'courseType', 'searchBy', 'selectDate', 'showExpired', 'showDel', 'showFormer',
  ]),
  PAYMENT_DETAIL: endpoint('/openapi/v1/payment/{paymentUuid}/detail/', ['paymentUuid']),
  CLINIC: endpoint('/openapi/v1/clinic/', []),
  CLINIC_USERS: endpoint('/openapi/v1/clinic/user/', []),
  QUEUE_LIST: endpoint('/openapi/v1/clinic/branch/{branchUuid}/queue/', ['branchUuid']),
})

export interface JeraNormalizedRow {
  cacheKey: string
  reportType: JeraSourceReportType
  sourceUuid: string
  branchUuid: string | null
  branchName: string | null
  eventDate: string
  patientUuid: string | null
  patientCode: string | null
  patientName: string | null
  paymentCode: string | null
  status: string | null
  type: string | null
  totalSatang: number | null
  paidAmountSatang: number | null
  refundAmountSatang: number | null
  cashSatang: number | null
  transferSatang: number | null
  creditCardSatang: number | null
  eWalletSatang: number | null
  paymentLinkSatang: number | null
  otherPaymentSatang: number | null
  doctorName: string | null
  salespersonName: string | null
  sourceCreatedAt: string | null
  sourceUpdatedAt: string | null
  fetchedAt: string
  sourceHash: string
}

export interface JeraNormalizationContext {
  cacheKey: string
  branchUuid: string | null
  fetchedAt: string
}

export interface JeraNormalizedPaymentMethod {
  method: string
  amountSatang: number
}

export interface JeraNormalizedSalesperson {
  name: string
  feeSatang: number | null
  feeUnit: string | null
}

export interface JeraNormalizedOpdItem {
  code: string | null
  name: string
  action: string | null
  priceSatang: number | null
  discountSatang: number | null
  quantity: number | null
}

export interface JeraNormalizedOpd {
  code: string | null
  eventDate: string | null
  totalSatang: number | null
  paidAmountSatang: number | null
  items: JeraNormalizedOpdItem[]
}

export interface JeraNormalizedCourse {
  code: string | null
  name: string | null
  totalSatang: number | null
  paidAmountSatang: number | null
}

export interface JeraNormalizedPaymentDetail {
  sourceUuid: string
  paymentCode: string
  branchName: string | null
  eventDate: string
  sourceCreatedAt: string
  totalSatang: number
  paidAmountSatang: number
  patient: {
    sourceUuid: string
    patientCode: string
    displayName: string | null
    nickname: string | null
    mobile: string | null
    facebook: string | null
  }
  paymentMethods: JeraNormalizedPaymentMethod[]
  salespersons: JeraNormalizedSalesperson[]
  opds: JeraNormalizedOpd[]
  courses: JeraNormalizedCourse[]
  fetchedAt: string
  sourceHash: string
  truncated: boolean
}

export interface JeraCacheEnvelope<T> {
  data: T
  source: 'CACHE' | 'LIVE'
  fetchedAt: string | null
  lastSuccessAt: string | null
  refreshing: boolean
  stale: boolean
  warningCode: string | null
}

export interface JeraReadPort {
  request(reportType: JeraEndpointKey, filters: JeraReportFilters): Promise<unknown[]>
}
