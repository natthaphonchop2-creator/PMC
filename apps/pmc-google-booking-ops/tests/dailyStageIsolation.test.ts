import { describe, expect, it } from 'vitest'
import { runDailyOperationsWorkflow } from '../src/runtime'
import { createTestPorts } from './helpers/fakes'

describe('daily booking stage isolation', () => {
  it('continues expiry and dashboard after call-reminder LINE fails', () => {
    const ports = createTestPorts({
      now: '2027-02-21T09:00:00+07:00',
      lineFailsAtPush: 1,
    })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture()

    const result = runDailyOperationsWorkflow(ports)

    expect(result.stages.callReminders).toBe('FAILED')
    expect(result.stages.depositExpiry).toBe('OK')
    expect(result.stages.dashboard).toBe('OK')
    expect(ports.bookings.getByCaseId('PMC-202608-0001')?.status).toBe('EXPIRED_6M')
    expect(ports.dashboard.lastSnapshot()).not.toBeNull()
  })
})
