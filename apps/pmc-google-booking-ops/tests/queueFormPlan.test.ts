import { describe, expect, it } from 'vitest'
import { queueFormPlan } from '../src/domain/queueFormPlan'

const existingTitles = [
  'Admin',
  'AE',
  'ชื่อลูกค้า',
  'ชื่อ Facebook',
  'เบอร์มือถือ',
  'หมอ',
  'บริการ/โปรแกรม',
  'วันที่นัด',
  'เวลานัด',
  'จำนวนเงินจอง',
  'เพจคลินิก/ช่องทาง',
  'สลิปเงินจอง',
  'หลักฐานแชท',
]

describe('booking queue Form plan', () => {
  it('plans one required queue choice and one normal date/time section', () => {
    expect(queueFormPlan(existingTitles)).toEqual({
      queueQuestionTitle: 'รูปแบบคิวนัดหมาย',
      choices: ['คิวปกติ', 'คิวอัตโนมัติ'],
      normalSectionTitle: 'คิวปกติ',
      sharedSectionTitle: 'ข้อมูลเงินจองและหลักฐาน',
      normalFields: ['วันที่นัด', 'เวลานัด'],
      insertAfterTitle: 'บริการ/โปรแกรม',
    })
  })

  it('accepts one existing queue question for an idempotent rerun', () => {
    expect(queueFormPlan([...existingTitles, 'รูปแบบคิวนัดหมาย']).queueQuestionTitle)
      .toBe('รูปแบบคิวนัดหมาย')
  })

  it('rejects duplicate queue questions before mutating the Form', () => {
    expect(() => queueFormPlan([
      ...existingTitles,
      'รูปแบบคิวนัดหมาย',
      'รูปแบบคิวนัดหมาย',
    ])).toThrow('expected at most one queue type question')
  })
})
