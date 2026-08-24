import {
  QUEUE_TYPE_CHOICES,
  QUEUE_TYPE_TITLE,
} from './queueConfirmation'

export interface QueueFormPlan {
  queueQuestionTitle: typeof QUEUE_TYPE_TITLE
  choices: string[]
  normalSectionTitle: 'คิวปกติ'
  sharedSectionTitle: 'ข้อมูลเงินจองและหลักฐาน'
  normalFields: ['วันที่นัด', 'เวลานัด']
  insertAfterTitle: 'บริการ/โปรแกรม'
}

export function queueFormPlan(titles: string[]): QueueFormPlan {
  const queueCount = titles.filter((title) => title === QUEUE_TYPE_TITLE).length
  if (queueCount > 1) throw new Error('expected at most one queue type question')
  for (const required of ['วันที่นัด', 'เวลานัด', 'บริการ/โปรแกรม']) {
    if (titles.filter((title) => title === required).length !== 1) {
      throw new Error(`expected one Form field: ${required}`)
    }
  }
  return {
    queueQuestionTitle: QUEUE_TYPE_TITLE,
    choices: [...QUEUE_TYPE_CHOICES],
    normalSectionTitle: 'คิวปกติ',
    sharedSectionTitle: 'ข้อมูลเงินจองและหลักฐาน',
    normalFields: ['วันที่นัด', 'เวลานัด'],
    insertAfterTitle: 'บริการ/โปรแกรม',
  }
}
