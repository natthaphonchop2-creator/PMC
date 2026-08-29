export type RevenueCategory = 'SERVICE' | 'PRODUCT' | 'UNCLASSIFIED'
export type RevenueCategoryState = 'READY' | 'CHECKING'

export interface FinanceComponentFreshness {
  lastSuccessAt: string | null
  stale: boolean
  warningCode: string | null
}

export interface FinancePaymentRow {
  paymentUuid: string
  paymentCode: string | null
  eventDate: string
  patientName: string | null
  paidAmountSatang: number
  transferSatang: number
  cashSatang: number
  creditSatang: number
  otherSatang: number
  serviceSatang: number | null
  productSatang: number | null
  unclassifiedSatang: number | null
}

export interface DailyIncomeProjection {
  startDate: string
  endDate: string
  receivedSatang: number
  refundSatang: number
  netReceivedSatang: number
  channels: {
    transferSatang: number
    cashSatang: number
    creditSatang: number
    otherSatang: number
    differenceSatang: number
  }
  categories: {
    state: RevenueCategoryState
    serviceSatang: number | null
    productSatang: number | null
    unclassifiedSatang: number | null
    incompleteDates: string[]
  }
  payments: FinancePaymentRow[]
  freshness: {
    payment: FinanceComponentFreshness
    refund: FinanceComponentFreshness
    allocation: FinanceComponentFreshness
  }
  warnings: string[]
}

export interface MonthlyIncomeProjection {
  monthKey: string
  startDate: string
  endDate: string
  receivedSatang: number
  refundSatang: number
  netReceivedSatang: number
  channels: DailyIncomeProjection['channels']
  categories: DailyIncomeProjection['categories']
  dailyTrend: Array<{ date: string; receivedSatang: number; refundSatang: number; netReceivedSatang: number }>
  expense: { state: 'NOT_IMPLEMENTED'; clinicExpenseSatang: null; estimatedBalanceSatang: null }
  freshness: DailyIncomeProjection['freshness']
  warnings: string[]
}

export interface PaymentRevenueAllocation {
  paymentUuid: string
  paymentSourceHash: string
  serviceSatang: number
  productSatang: number
  unclassifiedSatang: number
  warningCodes: string[]
}
