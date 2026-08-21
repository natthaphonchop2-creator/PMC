const PROFILE_PATH_BY_NAME: Record<string, string> = {
  แคท: '/assets/staff-profiles/cat.jpg',
  มัส: '/assets/staff-profiles/mus.jpg',
  มิ้น: '/assets/staff-profiles/mint.jpg',
  แวว: '/assets/staff-profiles/waew.jpg',
  หมวย: '/assets/staff-profiles/muay.jpg',
  อาย: '/assets/staff-profiles/eye.jpg',
  ฝ้าย: '',
  Admin: '',
}

export interface StaffProfileUrlPlanItem {
  name: string
  profileImageUrl: string
}

export function staffProfileUrlPlan(
  staffNames: string[],
  baseUrl: string,
): StaffProfileUrlPlanItem[] {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '')
  if (!normalizedBaseUrl.startsWith('https://')) {
    throw new Error('staff profile base URL must use HTTPS')
  }
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(normalizedBaseUrl)) {
    throw new Error('staff profile base URL must be an origin')
  }

  const normalizedNames = staffNames.map((name) => name.trim())
  const expectedNames = Object.keys(PROFILE_PATH_BY_NAME)
  const uniqueNames = new Set(normalizedNames)
  if (
    normalizedNames.length !== expectedNames.length ||
    uniqueNames.size !== expectedNames.length ||
    expectedNames.some((name) => !uniqueNames.has(name))
  ) {
    throw new Error('staff profile roster mismatch')
  }

  return normalizedNames.map((name) => ({
    name,
    profileImageUrl: PROFILE_PATH_BY_NAME[name]
      ? `${normalizedBaseUrl}${PROFILE_PATH_BY_NAME[name]}`
      : '',
  }))
}
