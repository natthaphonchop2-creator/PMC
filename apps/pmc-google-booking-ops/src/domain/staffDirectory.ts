import type { StaffConfig } from '../ports'

export function normalizeStaffEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function validateStaffDirectory(staff: StaffConfig[]): {
  activeClosers: StaffConfig[]
  activeAes: StaffConfig[]
} {
  const active = staff.filter((item) => item.active)
  const activeClosers = active.filter((item) => item.canCloseBooking)
  const activeAes = active.filter((item) => item.canBeAe)
  if (!activeClosers.length) throw new Error('no active booking closer')
  if (!activeAes.length) throw new Error('no active AE')

  const ids = active.map((item) => item.id)
  const names = active.map((item) => item.name)
  const closerEmails = activeClosers.map((item) => normalizeStaffEmail(item.email))
  if (closerEmails.some((email) => !email)) throw new Error('active closer email is required')
  if (new Set(ids).size !== ids.length) throw new Error('duplicate active staff ID')
  if (new Set(names).size !== names.length) throw new Error('duplicate active staff name')
  if (new Set(closerEmails).size !== closerEmails.length) {
    throw new Error('duplicate active closer email')
  }
  return { activeClosers, activeAes }
}

export function resolveCloserByEmail(staff: StaffConfig[], email: string): StaffConfig | null {
  const normalized = normalizeStaffEmail(email)
  if (!normalized) return null
  const matches = staff.filter(
    (item) =>
      item.active &&
      item.canCloseBooking &&
      normalizeStaffEmail(item.email) === normalized,
  )
  return matches.length === 1 ? matches[0] : null
}

export function resolveEligibleAeByName(staff: StaffConfig[], name: string): StaffConfig | null {
  const normalized = name.trim()
  if (!normalized) return null
  const matches = staff.filter(
    (item) => item.active && item.canBeAe && item.name === normalized,
  )
  return matches.length === 1 ? matches[0] : null
}
