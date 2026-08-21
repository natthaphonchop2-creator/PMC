import { describe, expect, it } from 'vitest'
import { sendProductionFlexPilot } from '../src/workflows/flexPilot'
import { createTestPorts } from './helpers/fakes'

describe('production Flex pilot sender', () => {
  it('sends one synthetic Flex to Admin and the Benz doctor group without creating a booking', () => {
    const ports = createTestPorts()
    ports.config.listDoctors = () => [
      {
        id: 'doctor-benz',
        name: 'หมอ Benz',
        calendarId: 'benz-calendar',
        lineGroupId: 'benz-group',
        active: true,
      },
      {
        id: 'doctor-jam',
        name: 'หมอ Jam',
        calendarId: 'jam-calendar',
        lineGroupId: 'jam-group',
        active: true,
      },
    ]

    expect(sendProductionFlexPilot(ports.config, ports.line)).toEqual({
      sentMessages: 2,
      adminSent: true,
      doctorSent: true,
      doctorName: 'หมอ Benz',
    })

    const adminMessage = ports.line.adminMessages()[0]
    const doctorMessage = ports.line.doctorMessages()[0]
    expect(adminMessage.to).toBe('admin-group')
    expect(doctorMessage.to).toBe('benz-group')
    expect(adminMessage.retryKey).toBe('PMC-FLEX-PILOT-V2:ADMIN')
    expect(doctorMessage.retryKey).toBe('PMC-FLEX-PILOT-V2:DOCTOR-BENZ')
    expect(JSON.stringify(adminMessage.apiMessage)).toContain('PMC Validation')
    expect(JSON.stringify(doctorMessage.apiMessage)).toContain('PMC Validation')
    expect(ports.bookings.list()).toEqual([])
    expect(ports.calls.list()).toEqual([])
  })
})
