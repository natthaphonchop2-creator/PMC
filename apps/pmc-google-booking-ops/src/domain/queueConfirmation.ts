export interface QueueConfirmationFormEventInput {
  submittedAt: string
  submitterEmail: string
  namedValues: Record<string, string[]>
}

export interface QueueConfirmationInput {
  caseId: string
  action: 'CONFIRM' | 'CHANGE'
  appointmentDate: string
  appointmentTime: string
  actorEmail: string
  submittedAt: string
}

export const QUEUE_TYPE_TITLE = 'รูปแบบคิวนัดหมาย'
export const QUEUE_TYPE_CHOICES = ['คิวปกติ', 'คิวอัตโนมัติ'] as const
export const QUEUE_CONFIRM_ACTIONS = ['ยืนยันคิวนี้', 'เปลี่ยนวัน'] as const

function value(input: QueueConfirmationFormEventInput, title: string): string {
  const result = input.namedValues[title]?.[0]?.trim()
  if (!result) throw new Error(`missing queue confirmation field: ${title}`)
  return result
}

export function parseQueueConfirmationFormEvent(
  input: QueueConfirmationFormEventInput,
): QueueConfirmationInput {
  const caseId = value(input, 'Case ID')
  if (!/^PMC-\d{6}-\d{4}$/.test(caseId)) {
    throw new Error('invalid confirmation Case ID')
  }
  const rawAction = value(input, 'การดำเนินการ')
  if (!QUEUE_CONFIRM_ACTIONS.includes(rawAction as typeof QUEUE_CONFIRM_ACTIONS[number])) {
    throw new Error('invalid queue confirmation action')
  }
  const appointmentDate = value(input, 'วันที่ยืนยัน')
  const appointmentTime = value(input, 'เวลายืนยัน')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)
  ) {
    throw new Error('invalid confirmation appointment')
  }
  const actorEmail = input.submitterEmail.trim().toLowerCase()
  if (!actorEmail) throw new Error('queue confirmation email is required')
  return {
    caseId,
    action: rawAction === 'ยืนยันคิวนี้' ? 'CONFIRM' : 'CHANGE',
    appointmentDate,
    appointmentTime,
    actorEmail,
    submittedAt: input.submittedAt,
  }
}
