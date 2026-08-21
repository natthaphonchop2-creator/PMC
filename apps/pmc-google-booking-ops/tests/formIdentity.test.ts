import { describe, expect, it } from 'vitest'
import { compactIdentityFormPlan } from '../src/domain/formIdentity'

describe('compact booking identity Form plan', () => {
  it('renames the legacy fields and puts ไม่ระบุ first in AE choices', () => {
    expect(compactIdentityFormPlan(
      ['ผู้ปิดการจอง', 'AE ผู้เปิดแชท'],
      ['มัส', 'แวว'],
    )).toEqual({
      closerSourceTitle: 'ผู้ปิดการจอง',
      closerTargetTitle: 'Admin',
      aeSourceTitle: 'AE ผู้เปิดแชท',
      aeTargetTitle: 'AE',
      aeChoices: ['ไม่ระบุ', 'มัส', 'แวว'],
    })
  })

  it('is idempotent for the compact titles and removes duplicate no-AE choices', () => {
    expect(compactIdentityFormPlan(
      ['Admin', 'AE'],
      ['ไม่ระบุ', 'มัส', 'มัส'],
    )).toEqual({
      closerSourceTitle: 'Admin',
      closerTargetTitle: 'Admin',
      aeSourceTitle: 'AE',
      aeTargetTitle: 'AE',
      aeChoices: ['ไม่ระบุ', 'มัส'],
    })
  })

  it('rejects a missing or duplicate identity field before changing the Form', () => {
    expect(() => compactIdentityFormPlan(['ผู้ปิดการจอง'], ['มัส']))
      .toThrow('booking identity Form fields mismatch')
    expect(() => compactIdentityFormPlan(
      ['ผู้ปิดการจอง', 'Admin', 'AE ผู้เปิดแชท'],
      ['มัส'],
    )).toThrow('booking identity Form fields mismatch')
  })
})
