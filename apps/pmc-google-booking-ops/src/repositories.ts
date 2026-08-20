import type { AuditEvent, BookingCase } from './domain/types'
import type { BookingRepositories, Clock, LockPort, MutationContext } from './ports'

export type SheetRow = Record<string, unknown>

export interface SheetStore {
  read(tab: string): SheetRow[]
  replace(tab: string, rows: SheetRow[]): void
}

function asBooking(row: SheetRow): BookingCase {
  return row as unknown as BookingCase
}

function append(store: SheetStore, tab: string, row: SheetRow): void {
  store.replace(tab, [...store.read(tab), row])
}

export function createBookingRepositories(store: SheetStore, locks: LockPort, clock: Clock): BookingRepositories {
  const audit = {
    append(event: AuditEvent) {
      append(store, 'AUDIT_LOG', event as unknown as SheetRow)
    },
    listForCase(caseId: string) {
      return store.read('AUDIT_LOG').filter((row) => row.caseId === caseId) as unknown as AuditEvent[]
    },
  }

  const bookings = {
    allocateMonthlySequence(month: string): number {
      return locks.withLock(() => {
        const rows = store.read('SYSTEM_SEQUENCES')
        const index = rows.findIndex((row) => row.month === month)
        const next = index === -1 ? 1 : Number(rows[index].sequence) + 1
        const updated = [...rows]
        if (index === -1) updated.push({ month, sequence: next })
        else updated[index] = { month, sequence: next }
        store.replace('SYSTEM_SEQUENCES', updated)
        return next
      })
    },
    findByFormResponseId(formResponseId: string): BookingCase | null {
      const mapped = store.read('FORM_RESPONSE_MAP').find((row) => row.formResponseId === formResponseId)
      const caseId = mapped?.caseId
      const row = store
        .read('BOOKING_MASTER')
        .find((candidate) => (caseId ? candidate.caseId === caseId : candidate.formResponseId === formResponseId))
      return row ? asBooking(row) : null
    },
    rememberFormResponse(formResponseId: string, caseId: string): void {
      locks.withLock(() => {
        const rows = store.read('FORM_RESPONSE_MAP')
        if (rows.some((row) => row.formResponseId === formResponseId)) {
          throw new Error('form response already processed')
        }
        store.replace('FORM_RESPONSE_MAP', [...rows, { formResponseId, caseId }])
      })
    },
    insert(booking: BookingCase): BookingCase {
      return locks.withLock(() => {
        const rows = store.read('BOOKING_MASTER')
        if (rows.some((row) => row.caseId === booking.caseId)) throw new Error('case ID already exists')
        if (rows.some((row) => row.formResponseId === booking.formResponseId)) {
          throw new Error('form response already processed')
        }
        store.replace('BOOKING_MASTER', [...rows, booking as unknown as SheetRow])
        return structuredClone(booking)
      })
    },
    getByCaseId(caseId: string): BookingCase | null {
      const row = store.read('BOOKING_MASTER').find((candidate) => candidate.caseId === caseId)
      return row ? asBooking(row) : null
    },
    update(
      caseId: string,
      expectedVersion: number,
      patch: Partial<BookingCase>,
      context: MutationContext,
    ): BookingCase {
      return locks.withLock(() => {
        const rows = store.read('BOOKING_MASTER')
        const index = rows.findIndex((row) => row.caseId === caseId)
        if (index === -1) throw new Error('booking not found')
        const before = asBooking(rows[index])
        if (before.version !== expectedVersion) throw new Error('version conflict')
        const after: BookingCase = {
          ...before,
          ...patch,
          caseId: before.caseId,
          version: before.version + 1,
          updatedAt: clock.nowIso(),
          updatedBy: context.actor,
        }
        const updated = [...rows]
        updated[index] = after as unknown as SheetRow
        store.replace('BOOKING_MASTER', updated)
        audit.append({
          eventId: `AUDIT-${context.correlationId}-${after.version}`,
          caseId,
          actor: context.actor,
          action: 'BOOKING_UPDATED',
          target: Object.keys(patch).sort().join(','),
          before: Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof BookingCase]])),
          after: Object.fromEntries(Object.keys(patch).map((key) => [key, after[key as keyof BookingCase]])),
          reason: context.reason,
          timestamp: clock.nowIso(),
          correlationId: context.correlationId,
        })
        return structuredClone(after)
      })
    },
    list(): BookingCase[] {
      return store.read('BOOKING_MASTER').map(asBooking)
    },
  }

  return {
    bookings,
    calls: {
      cancelOpenByCase(caseId, reason) {
        const rows = store.read('CALL_QUEUE')
        store.replace(
          'CALL_QUEUE',
          rows.map((row) =>
            row.caseId === caseId && !['DONE', 'CANCELLED'].includes(String(row.status))
              ? { ...row, status: 'CANCELLED', note: reason }
              : row,
          ),
        )
      },
    },
    imports: {
      hasFileHash(hash) {
        return store.read('JERA_IMPORT_FILES').some((row) => row.hash === hash)
      },
    },
    reconciliation: { create: (input) => append(store, 'RECONCILIATION', input) },
    retries: { enqueue: (input) => append(store, 'RETRY_QUEUE', input) },
    lineDirectory: { remember: (input) => append(store, 'CONFIG_LINE_DIRECTORY', input) },
    retention: { queue: (input) => append(store, 'RETENTION_QUEUE', input) },
    audit,
  }
}
