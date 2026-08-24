import { describe, expect, it } from 'vitest'
import { adminBookingMessageBatches } from '../src/adapters/lineMessaging'
import { runEligibleRetries } from '../src/runtime'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import {
  bookingFixture,
  createTestPorts,
  evidenceFixture,
  validBookingIntake,
} from './helpers/fakes'

const logoUrl = 'https://evidence.example/assets/pmc-flex-logo-v1.png'

describe('LINE evidence request batching', () => {
  it('sends one summary object with at most four embedded thumbnails', () => {
    const batches = adminBookingMessageBatches(
      bookingFixture(),
      'admin-group',
      evidenceFixture({ paymentCount: 2, chatCount: 39 }),
      logoUrl,
      4,
    )

    expect(batches).toHaveLength(1)
    expect(batches[0].apiMessages).toHaveLength(1)
    expect(batches.map((item) => item.retryKey)).toEqual([
      'PMC-202608-0001:ADMIN_BOOKING_CONFIRMED:4:BATCH:1',
    ])
    const json = JSON.stringify(batches[0].apiMessages)
    expect(json).not.toContain('"type":"carousel"')
    expect(json).toContain('payment-1/preview')
    expect(json).toContain('chat-2/preview')
    expect(json).not.toContain('chat-3/preview')
  })

  it('retries the single failed Admin summary without resending doctor LINE', () => {
    const paymentEvidenceFileIds = Array.from(
      { length: 2 },
      (_, index) => `payment-file-${index + 1}`,
    )
    const chatEvidenceFileIds = Array.from(
      { length: 49 },
      (_, index) => `chat-file-${index + 1}`,
    )
    const ports = createTestPorts({
      lineFailsAtPush: 1,
      extraDriveFileIds: [...paymentEvidenceFileIds, ...chatEvidenceFileIds],
    })
    const booking = submitBookingIntake(validBookingIntake({
      paymentEvidenceFileIds,
      chatEvidenceFileIds,
    }), ports)

    expect(booking.lineState).toBe('RETRY')
    expect(ports.line.adminMessages()).toHaveLength(0)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.retries.listPending()).toMatchObject([
      { operation: 'ADMIN_BOOKING_LINE_BATCH', payload: { batchIndex: 0 } },
    ])

    runEligibleRetries(ports)

    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.retries.listPending()).toEqual([])
  })
})
