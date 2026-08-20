import type { BookingCase, CallResult, CallTask } from '../domain/types'
import type { BookingPorts, LineMessage } from '../ports'

export interface CallResultInput {
  caseId: string
  result: CallResult
  nextCallAt: string | null
  note: string
  actor: string
}

function bangkokDate(iso: string): string {
  return iso.slice(0, 10)
}

function addDays(valueIso: string, days: number): string {
  const date = valueIso.slice(0, 10)
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day + days))
  return `${result.toISOString().slice(0, 10)}T09:00:00+07:00`
}

function daysBetween(fromDate: string, toDate: string): number {
  const [fromYear, fromMonth, fromDay] = fromDate.split('-').map(Number)
  const [toYear, toMonth, toDay] = toDate.split('-').map(Number)
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000,
  )
}

export function createInitialCallTask(booking: BookingCase, ports: BookingPorts): CallTask {
  const existing = ports.repositories.calls.getOpenByCase(booking.caseId)
  if (existing) return existing
  return ports.repositories.calls.insert({
    taskId: `CALL-${booking.caseId}-1`,
    caseId: booking.caseId,
    ownerAdminId: booking.callOwnerAdminId ?? booking.adminId ?? '',
    status: 'PENDING',
    windowStart: booking.firstCallWindowStart,
    windowEnd: booking.firstCallWindowEnd,
    nextCallAt: booking.nextCallAt ?? booking.firstCallWindowStart,
    lastReminderDate: null,
    result: null,
    note: '',
    version: 1,
  })
}

function adminReminderMessage(
  booking: BookingCase,
  task: CallTask,
  to: string,
  eventType: 'CALL_REMINDER' | 'EXPIRY_REMINDER',
): LineMessage {
  return {
    to,
    audience: 'admin',
    eventType,
    caseIds: [booking.caseId],
    text:
      eventType === 'CALL_REMINDER'
        ? `ต้องโทรติดตาม · ${booking.caseId} · ${booking.phoneMasked}`
        : `เงินจองใกล้หมดอายุ · ${booking.caseId}`,
    retryKey: `${booking.caseId}:${eventType}:${bangkokDate(task.nextCallAt)}:${to}`,
  }
}

export function runDailyCallReminders(ports: BookingPorts): void {
  const now = ports.clock.nowIso()
  const today = bangkokDate(now)
  for (const task of ports.repositories.calls.list()) {
    if (['DONE', 'CANCELLED'].includes(task.status)) continue
    if (bangkokDate(task.nextCallAt) > today || task.lastReminderDate === today) continue
    const booking = ports.repositories.bookings.getByCaseId(task.caseId)
    if (!booking || ['CLOSED_JERA', 'REFUNDED', 'EXPIRED_6M'].includes(booking.status)) continue
    const owner = ports.config.findStaffById(task.ownerAdminId)
    if (!owner?.active) throw new Error(`call owner is not active: ${task.ownerAdminId}`)
    ports.line.push(adminReminderMessage(booking, task, ports.config.adminLineGroupId(), 'CALL_REMINDER'))
    if (owner.lineUserId) ports.line.push(adminReminderMessage(booking, task, owner.lineUserId, 'CALL_REMINDER'))
    const overdue = Date.parse(now) > Date.parse(task.windowEnd)
    ports.repositories.calls.update(task.taskId, task.version, {
      lastReminderDate: today,
      status: overdue ? 'OVERDUE' : 'ACTIVE',
    })
    if (overdue && booking.status !== 'CALL_OVERDUE') {
      ports.repositories.bookings.update(
        booking.caseId,
        booking.version,
        { status: 'CALL_OVERDUE', callStatus: 'OVERDUE' },
        { actor: 'system', reason: 'First call not completed by Day 7', correlationId: `${task.taskId}:${today}` },
      )
    }
  }
}

export function runDailyDoctorSchedules(ports: BookingPorts): void {
  const today = bangkokDate(ports.clock.nowIso())
  const groups = new Map<string, BookingCase[]>()
  for (const booking of ports.repositories.bookings.list()) {
    if (!['BOOKING_CONFIRMED', 'REBOOKED', 'CALL_ACTIVE', 'CALL_OVERDUE'].includes(booking.status)) continue
    if (bangkokDate(booking.appointmentStart) !== today || !booking.doctorLineGroupId) continue
    const rows = groups.get(booking.doctorLineGroupId) ?? []
    rows.push(booking)
    groups.set(booking.doctorLineGroupId, rows)
  }
  for (const [to, bookings] of groups) {
    const sorted = [...bookings].sort((left, right) => left.appointmentStart.localeCompare(right.appointmentStart))
    ports.line.push({
      to,
      audience: 'doctor',
      eventType: 'DAILY_SCHEDULE',
      caseIds: sorted.map((booking) => booking.caseId),
      text: `ตารางนัดวันนี้\n${sorted.map((booking) => `${booking.appointmentStart.slice(11, 16)} · ${booking.caseId}`).join('\n')}`,
      retryKey: `DAILY_SCHEDULE:${today}:${to}`,
    })
  }
}

function suggestedNextCall(input: CallResultInput, now: string): string | null {
  if (input.nextCallAt) return input.nextCallAt
  if (input.result === 'NO_ANSWER') return addDays(now, 1)
  if (input.result === 'NOT_READY') return addDays(now, 14)
  if (input.result === 'DECLINED') return addDays(now, 30)
  if (input.result === 'CALL_BACK_REQUESTED') throw new Error('next call date is required')
  return null
}

export function recordCallResult(input: CallResultInput, ports: BookingPorts): CallTask {
  const task = ports.repositories.calls.getOpenByCase(input.caseId)
  if (!task) throw new Error('open call task not found')
  const booking = ports.repositories.bookings.getByCaseId(input.caseId)
  if (!booking) throw new Error('booking not found')
  const now = ports.clock.nowIso()
  ports.repositories.calls.update(task.taskId, task.version, {
    status: 'DONE',
    result: input.result,
    note: input.note,
  })
  ports.repositories.bookings.update(
    booking.caseId,
    booking.version,
    { lastCallAt: now, callStatus: 'DONE' },
    { actor: input.actor, reason: `Call result ${input.result}`, correlationId: `${task.taskId}:RESULT` },
  )
  const nextCallAt = suggestedNextCall(input, now)
  if (!nextCallAt) return { ...task, status: 'DONE', result: input.result, note: input.note, version: task.version + 1 }
  return ports.repositories.calls.insert({
    taskId: `CALL-${booking.caseId}-${task.version + 1}`,
    caseId: booking.caseId,
    ownerAdminId: task.ownerAdminId,
    status: 'PENDING',
    windowStart: nextCallAt,
    windowEnd: booking.depositExpiresAt,
    nextCallAt,
    lastReminderDate: null,
    result: null,
    note: '',
    version: 1,
  })
}

export function runDepositExpiryReminders(ports: BookingPorts): void {
  const now = ports.clock.nowIso()
  const today = bangkokDate(now)
  for (const booking of ports.repositories.bookings.list()) {
    if (['CLOSED_JERA', 'REFUNDED', 'EXPIRED_6M'].includes(booking.status)) continue
    const daysRemaining = daysBetween(today, bangkokDate(booking.depositExpiresAt))
    if (daysRemaining < 0) {
      ports.repositories.bookings.update(
        booking.caseId,
        booking.version,
        { status: 'EXPIRED_6M', depositStatus: 'EXPIRED', callStatus: 'CANCELLED' },
        { actor: 'system', reason: 'Deposit validity ended', correlationId: `${booking.caseId}:EXPIRED` },
      )
      ports.repositories.calls.cancelOpenByCase(booking.caseId, 'Deposit expired')
      continue
    }
    if (![30, 14, 7].includes(daysRemaining)) continue
    const owner = booking.adminId ? ports.config.findStaffById(booking.adminId) : null
    const task = ports.repositories.calls.getOpenByCase(booking.caseId) ?? createInitialCallTask(booking, ports)
    ports.line.push(adminReminderMessage(booking, task, ports.config.adminLineGroupId(), 'EXPIRY_REMINDER'))
    if (owner?.lineUserId) ports.line.push(adminReminderMessage(booking, task, owner.lineUserId, 'EXPIRY_REMINDER'))
  }
}
