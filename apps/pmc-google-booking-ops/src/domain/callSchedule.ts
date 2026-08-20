const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/

export function addCalendarMonths(valueIso: string, months: number): string {
  const match = ISO_WITH_OFFSET.exec(valueIso)
  if (!match || !Number.isInteger(months)) throw new Error('invalid calendar-month input')

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const targetMonthIndex = monthIndex + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate()
  const targetDay = Math.min(day, lastDay)

  return `${targetYear}-${String(normalizedMonthIndex + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}${match[4]}${match[5]}`
}

export function deriveCallWindow(appointmentStartIso: string): { start: string; end: string } {
  const match = ISO_WITH_OFFSET.exec(appointmentStartIso)
  if (!match) throw new Error('invalid appointment timestamp')
  const startDate = `${match[1]}-${match[2]}-${match[3]}`
  const offset = match[5]
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 7))
  return {
    start: `${startDate}T00:00:00${offset}`,
    end: `${end.toISOString().slice(0, 10)}T23:59:59${offset}`,
  }
}
