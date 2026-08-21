import { describe, expect, it } from 'vitest'
import { staffProfileUrlPlan } from '../src/domain/staffProfileConfig'

describe('staff profile URL configuration', () => {
  const baseUrl = 'https://evidence.example'
  const names = ['แคท', 'มัส', 'มิ้น', 'แวว', 'หมวย', 'อาย', 'ฝ้าย', 'Admin']

  it('maps the six approved images and leaves ฝ้าย blank in source row order', () => {
    expect(staffProfileUrlPlan(names, baseUrl)).toEqual([
      { name: 'แคท', profileImageUrl: `${baseUrl}/assets/staff-profiles/cat.jpg` },
      { name: 'มัส', profileImageUrl: `${baseUrl}/assets/staff-profiles/mus.jpg` },
      { name: 'มิ้น', profileImageUrl: `${baseUrl}/assets/staff-profiles/mint.jpg` },
      { name: 'แวว', profileImageUrl: `${baseUrl}/assets/staff-profiles/waew.jpg` },
      { name: 'หมวย', profileImageUrl: `${baseUrl}/assets/staff-profiles/muay.jpg` },
      { name: 'อาย', profileImageUrl: `${baseUrl}/assets/staff-profiles/eye.jpg` },
      { name: 'ฝ้าย', profileImageUrl: '' },
      { name: 'Admin', profileImageUrl: '' },
    ])
  })

  it('rejects missing, duplicate, or unexpected staff before producing writes', () => {
    expect(() => staffProfileUrlPlan(names.slice(0, 7), baseUrl)).toThrow(
      'staff profile roster mismatch',
    )
    expect(() => staffProfileUrlPlan([...names.slice(0, 7), 'อาย'], baseUrl)).toThrow(
      'staff profile roster mismatch',
    )
    expect(() => staffProfileUrlPlan([...names.slice(0, 7), 'คนอื่น'], baseUrl)).toThrow(
      'staff profile roster mismatch',
    )
  })

  it('requires a clean HTTPS Cloud Run base URL', () => {
    expect(() => staffProfileUrlPlan(names, 'http://evidence.example')).toThrow(
      'staff profile base URL must use HTTPS',
    )
    expect(() => staffProfileUrlPlan(names, `${baseUrl}/path`)).toThrow(
      'staff profile base URL must be an origin',
    )
  })
})
