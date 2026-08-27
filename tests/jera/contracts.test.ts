import { describe, expect, it } from 'vitest'
import { JERA_ENDPOINTS, JERA_REPORT_TYPES } from '../../server/jera/contracts'

describe('JERA read-only report contracts', () => {
  it('contains every approved report type in the agreed order', () => {
    expect(JERA_REPORT_TYPES).toEqual([
      'TODAY_SUMMARY', 'PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT',
      'PAYMENT_LIST', 'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT',
      'OPD', 'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE',
      'REMAINING_COURSE_BY_DATE',
    ])
  })

  it('contains no JERA data mutation endpoint', () => {
    expect(Object.values(JERA_ENDPOINTS).every((endpoint) => endpoint.method === 'GET')).toBe(true)
    expect(JSON.stringify(JERA_ENDPOINTS)).not.toMatch(/Create|Update|Delete|PATCH|PUT|DELETE/)
    expect(Object.isFrozen(JERA_ENDPOINTS)).toBe(true)
  })

  it('uses the documented report paths and explicit filter allowlists', () => {
    expect(JERA_ENDPOINTS).toMatchObject({
      PAYMENT: { path: '/openapi/v1/report/payment/', paginated: false },
      DEPOSIT: { path: '/openapi/v1/report/deposit/', paginated: false },
      REFUND: { path: '/openapi/v1/report/refund/', paginated: false },
      APPOINTMENT: { path: '/openapi/v1/appointment/', paginated: true },
      PAYMENT_LIST: { path: '/openapi/v1/report/payment-list/', paginated: false },
      PAYMENT_DETAIL: { path: '/openapi/v1/payment/{paymentUuid}/detail/', paginated: false },
    })
    expect(JERA_ENDPOINTS.PAYMENT.allowedFilters).toEqual(['branchUuid', 'startDate', 'endDate'])
    expect(JERA_ENDPOINTS.REMAINING_COURSE_BY_DATE.allowedFilters).toContain('selectDate')
  })
})
