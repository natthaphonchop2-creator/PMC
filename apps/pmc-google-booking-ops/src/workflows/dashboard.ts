import type { BookingCase, CallTask } from '../domain/types'
import type { BookingPorts } from '../ports'

export interface DashboardSnapshot {
  kpis: {
    bookings: number
    deposits: number
    closedJera: number
    refunds: number
    expired: number
    timeConflicts: number
    callsDue: number
    callsOverdue: number
    pendingCommissionRule: number
  }
  operations: Array<{
    caseId: string
    status: string
    adminId: string | null
    doctorId: string
    channelId: string | null
    appointmentStart: string
    phoneMasked: string
  }>
}

export function buildDashboardSnapshot(bookings: BookingCase[], calls: CallTask[]): DashboardSnapshot {
  return {
    kpis: {
      bookings: bookings.length,
      deposits: bookings.reduce((sum, booking) => sum + booking.depositAmount, 0),
      closedJera: bookings.filter((booking) => booking.status === 'CLOSED_JERA').length,
      refunds: bookings.filter((booking) => booking.status === 'REFUNDED').length,
      expired: bookings.filter((booking) => booking.status === 'EXPIRED_6M').length,
      timeConflicts: bookings.filter((booking) => booking.status === 'TIME_CONFLICT').length,
      callsDue: calls.filter((call) => ['PENDING', 'ACTIVE'].includes(call.status)).length,
      callsOverdue: calls.filter((call) => call.status === 'OVERDUE').length,
      pendingCommissionRule: bookings.filter((booking) => booking.commissionEligibility === 'PENDING_RULE').length,
    },
    operations: bookings.map((booking) => ({
      caseId: booking.caseId,
      status: booking.status,
      adminId: booking.adminId,
      doctorId: booking.doctorId,
      channelId: booking.channelId,
      appointmentStart: booking.appointmentStart,
      phoneMasked: booking.phoneMasked,
    })),
  }
}

export function writeDashboard(ports: BookingPorts): DashboardSnapshot {
  const snapshot = buildDashboardSnapshot(ports.repositories.bookings.list(), ports.repositories.calls.list())
  ports.dashboard.write(snapshot)
  return snapshot
}
