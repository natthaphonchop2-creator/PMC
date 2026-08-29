import { describe, expect, it } from 'vitest'
import {
  resolveCloserByEmail,
  resolveCloserByName,
  resolveEligibleAeByName,
  validateStaffDirectory,
} from '../src/domain/staffDirectory'
import type { StaffConfig } from '../src/ports'
import { STAFF_CONFIG_COLUMNS } from '../src/sheetSchema'

const staff: StaffConfig[] = [
  {
    id: 'staff-mus',
    name: 'มัส',
    email: 'mus@example.com',
    lineUserId: '',
    canCloseBooking: true,
    canBeAe: true,
    canManageStock: false,
    canSubmitExpense: false,
    canViewFinance: false,
    canManageExpense: false,
    active: true,
  },
  {
    id: 'staff-aim',
    name: 'เอม',
    email: '',
    lineUserId: '',
    canCloseBooking: false,
    canBeAe: true,
    canManageStock: false,
    canSubmitExpense: false,
    canViewFinance: false,
    canManageExpense: false,
    active: true,
  },
]

describe('staff directory', () => {
  it('defines the canonical twelve-column CONFIG_STAFF schema', () => {
    expect(STAFF_CONFIG_COLUMNS).toEqual([
      'id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active', 'profileImageUrl', 'canManageStock',
      'canSubmitExpense', 'canViewFinance', 'canManageExpense',
    ])
  })

  it('resolves closer by normalized verified email', () => {
    expect(resolveCloserByEmail(staff, ' MUS@EXAMPLE.COM ')).toMatchObject({ id: 'staff-mus' })
  })

  it('resolves only active closer-eligible staff by selected name', () => {
    expect(resolveCloserByName(staff, ' มัส ')).toMatchObject({ id: 'staff-mus' })
    expect(resolveCloserByName(staff, 'เอม')).toBeNull()
  })

  it('resolves only active AE-eligible staff by name', () => {
    expect(resolveEligibleAeByName(staff, 'เอม')).toMatchObject({ id: 'staff-aim' })
  })

  it('allows the same staff member to close and be AE', () => {
    expect(resolveEligibleAeByName(staff, 'มัส')?.id).toBe(
      resolveCloserByEmail(staff, 'mus@example.com')?.id,
    )
  })

  it('rejects duplicate active closer emails', () => {
    expect(() =>
      validateStaffDirectory([
        staff[0],
        { ...staff[0], id: 'staff-duplicate', name: 'ซ้ำ' },
      ]),
    ).toThrow('duplicate active closer email')
  })

  it('keeps AE-only staff from closing a booking', () => {
    expect(resolveCloserByEmail(staff, '')).toBeNull()
    expect(resolveCloserByEmail(staff, 'aim@example.com')).toBeNull()
  })
})
