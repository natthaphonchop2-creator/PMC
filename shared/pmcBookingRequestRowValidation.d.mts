export interface ExactPmcMiniAppRequestRow {
  protocolVersion: 1 | 2
  state: string
  [key: string]: unknown
}

export const PMC_TERMINAL_PROTOCOL1_STATES: ReadonlySet<string>

export function parseExactPmcMiniAppRequestRows(
  headers: readonly string[],
  rows: readonly unknown[][],
  schema: 'V1' | 'V2',
): ExactPmcMiniAppRequestRow[]
