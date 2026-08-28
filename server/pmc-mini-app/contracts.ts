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
}
