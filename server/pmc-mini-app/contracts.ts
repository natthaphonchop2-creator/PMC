import type {
  MiniAppStockCommand,
  StockCategory,
  StockCommandResult,
  StockDocumentSummary,
  StockHistoryPage,
} from '../../shared/pmcStock.js'
import type {
  EnabledExpenseCategory,
  ExpenseHistoryPage,
  ExpenseMonthlyProjection,
  ExpenseRecordState,
  ExpenseScope,
} from '../../shared/pmcExpense.js'
import type { ExpenseIngressClient } from './finance/ingressClient.js'
import type { ExpenseStagingPort } from './finance/stagingStore.js'
import type { ExpenseSubmissionService } from './finance/submissionService.js'
import type { ExpenseRecoveryWorker } from './finance/recovery.js'

export type MiniAppSafeErrorCode =
  | 'MINI_APP_UNAUTHORIZED'
  | 'MINI_APP_ID_TOKEN_EXPIRED'
  | 'MINI_APP_NOT_CONFIGURED'

export interface LineIdentityPort {
  verify(idToken: string): Promise<{ lineUserId: string }>
}

export interface AuthenticatedMiniAppContext {
  staffId: string
  displayName: string
  lineUserId: string
  canCloseBooking: boolean
  canManageStock: boolean
  canSubmitExpense: boolean
  canViewFinance: boolean
  canManageExpense: boolean
}

export interface MiniAppAttributionOption {
  id: string
  name: string
}

export interface StockProductProjection {
  productId: string
  name: string
  category: StockCategory
  unit: string
  minimumQuantityMilli: number
  onHandMilli: number
  lowStock: boolean
  active: boolean
  hasLedgerActivity: boolean
  version: number
}

export interface StockReadStore {
  listProducts(): Promise<StockProductProjection[]>
  listHistory(cursor: string | null, pageSize: number): Promise<StockHistoryPage>
  getDocument(documentId: string): Promise<StockDocumentSummary | null>
}

export interface StockIngressClient {
  send(command: MiniAppStockCommand): Promise<StockCommandResult>
}

export interface StockServerDependencies {
  enabled: boolean
  managerPilotOnly: boolean
  readStore: StockReadStore
  ingress: StockIngressClient
}

export interface ExpenseMutationContext {
  expenseId: string
  expenseDate: string
  monthKey: string
  category: EnabledExpenseCategory
  scope: ExpenseScope
  bookDailyKey: string | null
  recordState: Extract<ExpenseRecordState, 'COMMITTED'>
  revision: number
  version: number
}

export interface FinanceReadStore {
  loadMonthlyExpenses(monthKey: string): Promise<ExpenseMonthlyProjection>
  listExpenseHistory(monthKey: string, cursor: string | null, limit: 25): Promise<ExpenseHistoryPage>
  getEvidence(monthKey: string, expenseId: string, attachmentId: string): Promise<{
    bytes: Buffer
    mimeType: 'image/jpeg' | 'image/png'
  } | null>
  getExpenseMutationContext(monthKey: string, expenseId: string): Promise<ExpenseMutationContext | null>
}

export interface FinanceServerDependencies {
  signingSecret: string
  now?: () => number
  recovery?: ExpenseRecoveryWorker
  resume?: {
    ingress: ExpenseIngressClient
    staging: Pick<ExpenseStagingPort, 'readSubmissionLease'>
  }
  reads?: {
    readStore: FinanceReadStore
  }
  capture?: {
    staging: ExpenseStagingPort
    submission: ExpenseSubmissionService
    ingress: ExpenseIngressClient
  }
}
