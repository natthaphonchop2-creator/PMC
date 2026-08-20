import { describe, expect, it } from 'vitest'
import {
  resolveCloserByEmail,
  resolveEligibleAeByName,
  validateStaffDirectory,
} from '../src/domain/staffDirectory'
import type { StaffConfig } from '../src/ports'

const staff: StaffConfig[] = [
  {
    id: 'staff-mus',
    name: 'มัส',
    email: 'mus@example.com',
    lineUserId: '',
    canCloseBooking: true,
    canBeAe: true,
    active: true,
  },
  {
    id: 'staff-aim',
    name: 'เอม',
    email: '',
    lineUserId: '',
    canCloseBooking: false,
    canBeAe: true,
    active: true,
  },
]

describe('staff directory', () => {
  it('resolves closer by normalized verified email', () => {
    expect(resolveCloserByEmail(staff, ' MUS@EXAMPLE.COM ')).toMatchObject({ id: 'staff-mus' })
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
