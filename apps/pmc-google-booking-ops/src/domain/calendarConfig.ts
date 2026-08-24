type CellValue = string | number | boolean | Date | null

function isActive(value: CellValue | undefined): boolean {
  return value === true || String(value).trim().toLowerCase() === 'true' || String(value) === '1'
}

export function planSharedDoctorCalendarUpdate(
  headers: string[],
  rows: CellValue[][],
  calendarIdInput: string,
): { calendarId: string; doctorNames: string[]; rows: CellValue[][] } {
  const calendarId = calendarIdInput.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(calendarId)) {
    throw new Error('invalid shared Calendar ID')
  }
  const nameIndex = headers.indexOf('name')
  const calendarIdIndex = headers.indexOf('calendarId')
  const activeIndex = headers.indexOf('active')
  if ([nameIndex, calendarIdIndex, activeIndex].some((index) => index < 0)) {
    throw new Error('CONFIG_DOCTORS header mismatch')
  }

  const doctorNames: string[] = []
  const updatedRows = rows.map((row) => {
    const updated = [...row]
    if (!isActive(updated[activeIndex])) return updated
    const doctorName = String(updated[nameIndex] ?? '').trim()
    if (!doctorName) throw new Error('active doctor name is required')
    updated[calendarIdIndex] = calendarId
    doctorNames.push(doctorName)
    return updated
  })
  if (!doctorNames.length) throw new Error('no active doctor to configure')
  return { calendarId, doctorNames, rows: updatedRows }
}
