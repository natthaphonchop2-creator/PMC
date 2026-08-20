import { describe, expect, it } from 'vitest'
import {
  signBookingEvidenceToken,
  verifyBookingEvidenceToken,
  type BookingEvidenceTokenPayload,
} from '../server/bookingEvidenceToken'

const payload: BookingEvidenceTokenPayload = {
  v: 1,
  caseId: 'PMC-202608-0001',
  fileId: 'file_ABC123xyz',
  kind: 'PAYMENT',
  ordinal: 1,
  variant: 'preview',
}
const expected =
  'eyJ2IjoxLCJjYXNlSWQiOiJQTUMtMjAyNjA4LTAwMDEiLCJmaWxlSWQiOiJmaWxlX0FCQzEyM3h5eiIsImtpbmQiOiJQQVlNRU5UIiwib3JkaW5hbCI6MSwidmFyaWFudCI6InByZXZpZXcifQ.743a360b59bbdfa6e51296d458d838a3a338462b6258d35f600479ca92287205'

describe('booking evidence token', () => {
  it('matches the cross-runtime fixed vector', () => {
    expect(signBookingEvidenceToken(payload, 'unit-test-secret')).toBe(expected)
    expect(verifyBookingEvidenceToken(expected, 'unit-test-secret')).toEqual(payload)
  })

  it('rejects payload or signature mutation', () => {
    const [body, signature] = expected.split('.')
    expect(() => verifyBookingEvidenceToken(`${body}A.${signature}`, 'unit-test-secret')).toThrow(
      'Invalid evidence token',
    )
    expect(() =>
      verifyBookingEvidenceToken(`${body}.${signature.slice(0, -1)}0`, 'unit-test-secret'),
    ).toThrow('Invalid evidence token')
  })

  it.each([
    { ...payload, v: 2 },
    { ...payload, caseId: 'bad' },
    { ...payload, fileId: '../secret' },
    { ...payload, kind: 'OTHER' },
    { ...payload, ordinal: 0 },
    { ...payload, variant: 'raw' },
  ])('rejects invalid schema %#', (invalid) => {
    expect(() =>
      signBookingEvidenceToken(invalid as BookingEvidenceTokenPayload, 'unit-test-secret'),
    ).toThrow('Invalid evidence token')
  })
})
