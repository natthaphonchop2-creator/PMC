import { planSharedDoctorCalendarUpdate } from '../domain/calendarConfig'

interface AdvancedCalendarService {
  Events: {
    list(calendarId: string, options: Record<string, unknown>): { items?: unknown[] }
  }
}

function calendarService(): AdvancedCalendarService {
  return Calendar as unknown as AdvancedCalendarService
}

export function configureSharedDoctorCalendar(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  calendarId: string,
): { calendarId: string; doctorNames: string[]; updatedDoctors: number } {
  const sheet = spreadsheet.getSheetByName('CONFIG_DOCTORS')
  if (!sheet || sheet.getLastColumn() < 1) throw new Error('missing CONFIG_DOCTORS sheet')
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
  const lastRow = sheet.getLastRow()
  const rows = lastRow < 2
    ? []
    : sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
  const plan = planSharedDoctorCalendarUpdate(headers, rows, calendarId)

  calendarService().Events.list(plan.calendarId, {
    maxResults: 1,
    showDeleted: false,
    singleEvents: true,
    timeMin: new Date().toISOString(),
  })

  const calendarIdIndex = headers.indexOf('calendarId')
  sheet
    .getRange(2, calendarIdIndex + 1, plan.rows.length, 1)
    .setValues(plan.rows.map((row) => [row[calendarIdIndex]]))
  const readback = sheet
    .getRange(2, calendarIdIndex + 1, plan.rows.length, 1)
    .getValues()
    .map(([value]) => String(value).trim().toLowerCase())
  const expected = plan.rows.map((row) => String(row[calendarIdIndex]).trim().toLowerCase())
  if (readback.some((value, index) => value !== expected[index])) {
    throw new Error('shared Calendar configuration readback mismatch')
  }
  return {
    calendarId: plan.calendarId,
    doctorNames: plan.doctorNames,
    updatedDoctors: plan.doctorNames.length,
  }
}
