import { describe, expect, it } from 'vitest'
import {
  signReviewToken,
  verifyLineSignature,
  verifyReviewToken,
  type ReviewTokenPayload,
} from '../../server/ocr-ledger/security'

const payload: ReviewTokenPayload = {
  v: 1,
  documentId: 'OCR-20260822-abc123',
  groupId: 'Cgroup1',
  draftVersion: 2,
  action: 'REVIEW',
  exp: 1_788_000_000,
}

const expectedToken =
  'eyJ2IjoxLCJkb2N1bWVudElkIjoiT0NSLTIwMjYwODIyLWFiYzEyMyIsImdyb3VwSWQiOiJDZ3JvdXAxIiwiZHJhZnRWZXJzaW9uIjoyLCJhY3Rpb24iOiJSRVZJRVciLCJleHAiOjE3ODgwMDAwMDB9.1e2363bc7482b9d449d576be6d128c573143391865e345f4bfb05d5cc8a6b910'

describe('OCR ledger security', () => {
  it('matches LINE HMAC fixed vector and rejects altered or length-mismatched signatures', () => {
    expect(verifyLineSignature('{"events":[]}', 'PPa4QqevUGV8UO2apjR9ZWG24X4aYwLsG3KzECKE81c=', 'line-secret')).toBe(true)
    expect(verifyLineSignature('{"events":[]}', 'PPa4QqevUGV8UO2apjR9ZWG24X4aYwLsG3KzECKE81cA', 'line-secret')).toBe(false)
    expect(verifyLineSignature('{"events":[]}', 'short', 'line-secret')).toBe(false)
  })

  it('signs and verifies the cross-runtime token vector with every bound claim', () => {
    expect(signReviewToken(payload, 'review-secret')).toBe(expectedToken)
    expect(verifyReviewToken(expectedToken, 'review-secret', 1_787_999_999)).toEqual(payload)
  })

  it('rejects altered bodies, expired tokens, excessive TTLs, and malformed schemas', () => {
    const [body, signature] = expectedToken.split('.')
    expect(() => verifyReviewToken(`${body}A.${signature}`, 'review-secret', 1_787_999_999)).toThrow('Invalid review token')
    expect(() => verifyReviewToken(expectedToken, 'review-secret', 1_788_000_001)).toThrow('Expired review token')
    expect(() => verifyReviewToken(signReviewToken({ ...payload, exp: 1_788_086_401 }, 'review-secret'), 'review-secret', 1_788_000_000)).toThrow('Invalid review token')
    expect(() => signReviewToken({ ...payload, documentId: 'not-a-document' }, 'review-secret')).toThrow('Invalid review token')
    expect(() => signReviewToken({ ...payload, groupId: 'Uuser' }, 'review-secret')).toThrow('Invalid review token')
    expect(() => signReviewToken({ ...payload, draftVersion: 1.5 }, 'review-secret')).toThrow('Invalid review token')
    expect(() => signReviewToken({ ...payload, action: 'EDIT' as 'REVIEW' }, 'review-secret')).toThrow('Invalid review token')
    expect(() => signReviewToken({ ...payload, extra: true } as ReviewTokenPayload, 'review-secret')).toThrow('Invalid review token')
  })
})
