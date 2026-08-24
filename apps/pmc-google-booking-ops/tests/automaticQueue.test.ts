import { describe, expect, it } from 'vitest'
import { proposeAutomaticAppointment } from '../src/domain/automaticQueue'

describe('automatic provisional appointment planner', () => {
  it('chooses the first clear 30-minute boundary after a confirmed doctor case', () => {
    expect(proposeAutomaticAppointment({
      durationMinutes: 60,
      submittedAt: '2026-08-24T09:00:00+07:00',
      expiresAt: '2027-02-24T09:00:00+07:00',
      doctorCases: [
        { start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' },
      ],
      busy: [
        { start: '2026-08-25T15:00:00+07:00', end: '2026-08-25T16:00:00+07:00' },
      ],
    })).toEqual({
      start: '2026-08-25T14:00:00+07:00',
      end: '2026-08-25T15:00:00+07:00',
    })
  })

  it('moves in 30-minute steps until the full service interval is clear', () => {
    expect(proposeAutomaticAppointment({
      durationMinutes: 60,
      submittedAt: '2026-08-24T09:00:00+07:00',
      expiresAt: '2027-02-24T09:00:00+07:00',
      doctorCases: [
        { start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' },
      ],
      busy: [
        { start: '2026-08-25T14:00:00+07:00', end: '2026-08-25T15:30:00+07:00' },
      ],
    })).toEqual({
      start: '2026-08-25T15:30:00+07:00',
      end: '2026-08-25T16:30:00+07:00',
    })
  })

  it('returns null when the doctor has no confirmed case inside the horizon', () => {
    expect(proposeAutomaticAppointment({
      durationMinutes: 60,
      submittedAt: '2026-08-24T09:00:00+07:00',
      expiresAt: '2026-08-24T23:59:59+07:00',
      doctorCases: [],
      busy: [],
    })).toBeNull()
  })

  it('allows a clear 20:30 start even when the service ends later', () => {
    expect(proposeAutomaticAppointment({
      durationMinutes: 60,
      submittedAt: '2026-08-24T09:00:00+07:00',
      expiresAt: '2027-02-24T09:00:00+07:00',
      doctorCases: [
        { start: '2026-08-25T19:30:00+07:00', end: '2026-08-25T20:30:00+07:00' },
      ],
      busy: [],
    })).toEqual({
      start: '2026-08-25T20:30:00+07:00',
      end: '2026-08-25T21:30:00+07:00',
    })
  })

  it('never proposes a start after the deposit expiry timestamp', () => {
    expect(proposeAutomaticAppointment({
      durationMinutes: 60,
      submittedAt: '2026-08-24T09:00:00+07:00',
      expiresAt: '2026-08-25T13:59:59+07:00',
      doctorCases: [
        { start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' },
      ],
      busy: [],
    })).toBeNull()
  })
})
