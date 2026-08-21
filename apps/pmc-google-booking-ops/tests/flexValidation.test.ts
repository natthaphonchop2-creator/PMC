import { describe, expect, it } from 'vitest'
import { buildProductionFlexValidationMessages } from '../src/workflows/flexValidation'

describe('production Flex validation payload', () => {
  it('uses synthetic identity, staff profiles in both messages, and evidence only for Admin', () => {
    const messages = buildProductionFlexValidationMessages(
      'https://evidence.example/assets/pmc-flex-logo-v1.png',
      'https://evidence.example',
    )
    expect(messages).toHaveLength(2)
    const adminJson = JSON.stringify(messages[0])
    const doctorJson = JSON.stringify(messages[1])

    for (const json of [adminJson, doctorJson]) {
      expect(json).toContain('/assets/staff-profiles/mus.jpg')
      expect(json).toContain('/assets/staff-profiles/waew.jpg')
      expect(json).toContain('PMC Validation')
      expect(json).not.toContain('@gmail.com')
      expect(json).not.toContain('drive.google.com')
    }
    expect(adminJson).toContain('หลักฐาน')
    expect(doctorJson).not.toContain('หลักฐาน')
    expect(doctorJson).not.toContain('/api/booking-evidence/')
  })
})
