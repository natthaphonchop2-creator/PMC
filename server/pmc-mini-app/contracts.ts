import type {
  MiniAppStockCommand,
  StockCategory,
  StockCommandResult,
  StockDocumentSummary,
  StockHistoryPage,
} from '../../shared/pmcStock.js'

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
  canManageStock: boolean
  canSubmitExpense: boolean
  canViewFinance: boolean
  canManageExpense: boolean
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
