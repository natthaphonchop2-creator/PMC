import type { ExpenseTopologyPort, StaffConfig } from '../ports'
import { EXPENSE_MASTER_SCHEMAS, EXPENSE_MONTH_SCHEMAS } from './sheetTopology'

export type { ExpenseTopologyPort } from '../ports'

const SAFE_STAFF_ID = /^[A-Za-z0-9._:-]{1,124}$/

export type ExpensePermissionStaff = Pick<
  StaffConfig,
  'id' | 'name' | 'active' | 'canSubmitExpense' | 'canViewFinance' | 'canManageExpense'
>

export type ExpensePermissionRosterItem = ExpensePermissionStaff

export interface ExpensePermissionRosterSource {
  id: string
  name: string
  active: unknown
  canSubmitExpense?: unknown
  canViewFinance?: unknown
  canManageExpense?: unknown
}

export interface ExpensePermissionGrant {
  id: string
  canSubmitExpense: boolean
  canViewFinance: boolean
  canManageExpense: boolean
}

export interface ExpensePermissionGrantPlan {
  submitterCount: number
  managerCount: 3
  changedRows: number
  grants: ExpensePermissionGrant[]
}

function headersEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((header, index) => header === expected[index])
}

function ensureExpenseTopology(
  port: ExpenseTopologyPort,
  schemas: Record<string, readonly string[]>,
): { createdTabCount: number; verifiedTabCount: number } {
  const entries = Object.entries(schemas).map(([tab, headers]) => ({
    tab,
    headers,
    existing: port.readHeader(tab),
  }))
  for (const { tab, headers, existing } of entries) {
    if (existing !== null && !headersEqual(existing, headers)) {
      throw new Error(`sheet header mismatch: ${tab}`)
    }
  }

  let createdTabCount = 0
  let verifiedTabCount = 0
  for (const { tab, headers, existing } of entries) {
    if (existing === null) {
      port.createTab(tab, headers)
      createdTabCount += 1
    }
    port.freezeHeader(tab)
    verifiedTabCount += 1
  }
  return { createdTabCount, verifiedTabCount }
}

export function ensureFinanceMasterTopology(
  port: ExpenseTopologyPort,
): { createdTabCount: number; verifiedTabCount: number } {
  return ensureExpenseTopology(port, EXPENSE_MASTER_SCHEMAS)
}

export function ensureExpenseMonthTopology(
  port: ExpenseTopologyPort,
): { createdTabCount: number; verifiedTabCount: number } {
  return ensureExpenseTopology(port, EXPENSE_MONTH_SCHEMAS)
}

function strictPermission(value: unknown): boolean {
  return value === true
}

export function prepareExpensePermissionRoster<T extends ExpensePermissionRosterSource>(
  staff: readonly T[],
): ExpensePermissionRosterItem[] {
  return staff.map((item) => ({
    id: item.id,
    name: item.name,
    active: item.active === true,
    canSubmitExpense: strictPermission(item.canSubmitExpense),
    canViewFinance: strictPermission(item.canViewFinance),
    canManageExpense: strictPermission(item.canManageExpense),
  }))
}

function validUniqueIds(ids: readonly string[]): boolean {
  return ids.length === new Set(ids).size && ids.every((id) => SAFE_STAFF_ID.test(id))
}

export function applyExpensePermissionGrants(
  staff: readonly ExpensePermissionStaff[],
  submitterIds: readonly string[],
  managerIds: readonly string[],
): ExpensePermissionGrantPlan {
  if (
    !validUniqueIds(submitterIds)
    || !validUniqueIds(managerIds)
    || managerIds.length !== 3
  ) {
    throw new Error('invalid expense permission configuration')
  }

  const submitters = new Set(submitterIds)
  const managers = new Set(managerIds)
  if (managerIds.some((id) => !submitters.has(id))) {
    throw new Error('invalid expense permission configuration')
  }

  for (const id of submitters) {
    const matches = staff.filter((item) => item.id === id)
    if (matches.length !== 1 || matches[0]?.active !== true) {
      throw new Error('invalid expense permission configuration')
    }
  }

  const grants = staff.map((item) => ({
    id: item.id,
    canSubmitExpense: submitters.has(item.id),
    canViewFinance: managers.has(item.id),
    canManageExpense: managers.has(item.id),
  }))
  const changedRows = grants.filter((grant, index) => {
    const item = staff[index]
    return !item
      || strictPermission(item.canSubmitExpense) !== grant.canSubmitExpense
      || strictPermission(item.canViewFinance) !== grant.canViewFinance
      || strictPermission(item.canManageExpense) !== grant.canManageExpense
  }).length

  return {
    submitterCount: submitters.size,
    managerCount: 3,
    changedRows,
    grants,
  }
}
