import { describe, expect, it } from 'vitest'
import { planSharedDoctorCalendarUpdate } from '../src/domain/calendarConfig'

describe('shared doctor calendar configuration', () => {
  it('updates only active doctors and normalizes the shared calendar email', () => {
    expect(planSharedDoctorCalendarUpdate(
      ['id', 'name', 'calendarId', 'lineGroupId', 'active'],
      [
        ['doctor-benz', 'หมอ Benz', 'old-benz@group.calendar.google.com', 'line-benz', true],
        ['doctor-jam', 'หมอ Jam', 'old-jam@group.calendar.google.com', 'line-jam', 'TRUE'],
        ['doctor-old', 'หมอเดิม', 'keep@group.calendar.google.com', 'line-old', false],
      ],
      ' Promedcalender@gmail.com ',
    )).toEqual({
      calendarId: 'promedcalender@gmail.com',
      doctorNames: ['หมอ Benz', 'หมอ Jam'],
      rows: [
        ['doctor-benz', 'หมอ Benz', 'promedcalender@gmail.com', 'line-benz', true],
        ['doctor-jam', 'หมอ Jam', 'promedcalender@gmail.com', 'line-jam', 'TRUE'],
        ['doctor-old', 'หมอเดิม', 'keep@group.calendar.google.com', 'line-old', false],
      ],
    })
  })

  it('rejects a malformed calendar ID before changing rows', () => {
    expect(() => planSharedDoctorCalendarUpdate(
      ['id', 'name', 'calendarId', 'lineGroupId', 'active'],
      [['doctor-benz', 'หมอ Benz', 'old', 'line-benz', true]],
      'not-an-email',
    )).toThrow('invalid shared Calendar ID')
  })
})
