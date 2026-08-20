import { parseJeraTransactions, type JeraTransaction } from '../domain/jera'
import { transitionBooking } from '../domain/stateMachine'
import type { BookingPorts } from '../ports'

function reconciliationReason(transaction: JeraTransaction, candidateCount: number): string {
  if (!transaction.phoneNormalized) return 'MISSING_PHONE'
  if (!transaction.customerNameNormalized) return 'MISSING_NAME'
  if (candidateCount === 0) return 'NO_MATCH'
  if (candidateCount > 1) return 'MULTIPLE_MATCHES'
  return 'UNSUPPORTED_STATUS'
}

function createReconciliation(
  transaction: JeraTransaction,
  candidateCaseIds: string[],
  fileId: string,
  ports: BookingPorts,
): void {
  ports.repositories.reconciliation.create({
    id: `RECON-${fileId}-${transaction.paymentId}`,
    source: 'JERA',
    sourceId: transaction.paymentId,
    reasonCode: reconciliationReason(transaction, candidateCaseIds.length),
    candidateCaseIds,
    status: 'OPEN',
    resolvedCaseId: '',
    resolvedBy: '',
    resolvedAt: '',
    version: 1,
  })
}

export function importJeraFile(fileId: string, ports: BookingPorts): void {
  const text = ports.files.readText(fileId, 'Windows-874')
  const hash = ports.crypto.sha256Hex(text)
  if (ports.repositories.imports.hasFileHash(hash)) return

  let transactionCount = 0
  let rejectedCount = 0
  try {
    const transactions = parseJeraTransactions(text)
    transactionCount = transactions.length
    for (const transaction of transactions) {
      ports.repositories.imports.appendRaw({
        importId: `${fileId}:${transaction.paymentId}`,
        fileId,
        ...transaction,
        importedAt: ports.clock.nowIso(),
      })

      if (ports.repositories.imports.hasPaymentId(transaction.paymentId)) {
        rejectedCount += 1
        createReconciliation(transaction, [], fileId, ports)
        continue
      }
      if (!['ชำระแล้ว', 'คืนมัดจำ'].includes(transaction.status)) {
        if (transaction.status === '0') {
          rejectedCount += 1
          createReconciliation(transaction, [], fileId, ports)
        }
        continue
      }

      const candidates = ports.repositories.bookings
        .list()
        .filter((booking) => !['CLOSED_JERA', 'REFUNDED', 'EXPIRED_6M'].includes(booking.status))
        .filter(
          (booking) =>
            Boolean(transaction.phoneNormalized) &&
            Boolean(transaction.customerNameNormalized) &&
            booking.phoneNormalized === transaction.phoneNormalized &&
            booking.customerNameNormalized === transaction.customerNameNormalized,
        )
      if (candidates.length !== 1) {
        rejectedCount += 1
        createReconciliation(
          transaction,
          candidates.map((candidate) => candidate.caseId),
          fileId,
          ports,
        )
        continue
      }

      const booking = candidates[0]
      const normalizedTime = /^\d{2}:\d{2}$/.test(transaction.time)
        ? `${transaction.time}:00`
        : transaction.time
      const closedAt = `${transaction.date}T${normalizedTime}+07:00`
      const status = transitionBooking(booking.status, transaction.status === 'ชำระแล้ว' ? 'CLOSED_JERA' : 'REFUNDED', {
        jeraStatus: transaction.status,
      })
      ports.repositories.bookings.update(
        booking.caseId,
        booking.version,
        {
          status,
          depositStatus: status === 'REFUNDED' ? 'REFUNDED' : booking.depositStatus,
          jeraPaymentId: transaction.paymentId,
          jeraStatus: transaction.status,
          jeraClosedAt: closedAt,
          jeraActualRevenue: transaction.actualRevenue,
          jeraImportFileId: fileId,
          jeraImportState: 'MATCHED',
          reconciliationStatus: 'NONE',
          commissionEligibility: status === 'CLOSED_JERA' ? 'PENDING_RULE' : 'NOT_ELIGIBLE',
          commissionAmount: null,
          callStatus: 'CANCELLED',
        },
        {
          actor: 'system',
          reason: `JERA ${transaction.status}`,
          correlationId: `${fileId}:${transaction.paymentId}`,
        },
      )
      ports.repositories.imports.rememberPaymentId(transaction.paymentId, booking.caseId, fileId)
      ports.repositories.calls.cancelOpenByCase(booking.caseId, `JERA ${transaction.status}`)
    }

    ports.repositories.imports.recordFile({
      fileId,
      hash,
      status: 'COMPLETED',
      transactionCount,
      rejectedCount,
      importedAt: ports.clock.nowIso(),
      safeError: '',
    })
    ports.files.moveToImported(fileId)
  } catch (error) {
    const safeError = error instanceof Error ? error.message : 'JERA import failed'
    ports.repositories.imports.recordFile({
      fileId,
      hash,
      status: 'QUARANTINED',
      transactionCount,
      rejectedCount,
      importedAt: ports.clock.nowIso(),
      safeError,
    })
    ports.files.quarantine(fileId)
    throw error
  }
}

export function pollJeraIncoming(ports: BookingPorts): void {
  for (const fileId of [...ports.files.listIncomingFileIds()].sort()) importJeraFile(fileId, ports)
}
