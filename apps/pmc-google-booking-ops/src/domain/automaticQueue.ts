import { addMinutesInBangkok } from './callSchedule'

export interface CalendarInterval {
  start: string
  end: string
}

export interface AutomaticQueueInput {
  durationMinutes: number
  submittedAt: string
  expiresAt: string
  doctorCases: CalendarInterval[]
  busy: CalendarInterval[]
}

function roundUpThirty(valueIso: string): string {
  const minute = Number(valueIso.slice(14, 16))
  const second = Number(valueIso.slice(17, 19))
  if (!Number.isInteger(minute) || !Number.isInteger(second)) {
    throw new Error('invalid automatic queue timestamp')
  }
  const delta = minute % 30 === 0 && second === 0 ? 0 : 30 - (minute % 30)
  return addMinutesInBangkok(
    `${valueIso.slice(0, 17)}00${valueIso.slice(19)}`,
    delta,
  )
}

function startsEveryThirtyMinutes(first: string): string[] {
  const starts: string[] = []
  const date = first.slice(0, 10)
  for (
    let cursor = first;
    cursor.slice(0, 10) === date && cursor.slice(11, 16) <= '20:30';
    cursor = addMinutesInBangkok(cursor, 30)
  ) {
    if (cursor.slice(11, 16) >= '10:30') starts.push(cursor)
  }
  return starts
}

function overlaps(left: CalendarInterval, right: CalendarInterval): boolean {
  return left.start < right.end && left.end > right.start
}

export function proposeAutomaticAppointment(
  input: AutomaticQueueInput,
): CalendarInterval | null {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error('automatic queue requires a positive service duration')
  }
  const candidates = [...new Set(
    input.doctorCases
      .filter((doctorCase) =>
        doctorCase.start.slice(0, 10) >= input.submittedAt.slice(0, 10) &&
        doctorCase.start <= input.expiresAt,
      )
      .sort((left, right) => left.end.localeCompare(right.end))
      .flatMap((doctorCase) => startsEveryThirtyMinutes(roundUpThirty(doctorCase.end)))
      .filter((start) => start >= input.submittedAt && start <= input.expiresAt),
  )].sort()

  for (const start of candidates) {
    const candidate = {
      start,
      end: addMinutesInBangkok(start, input.durationMinutes),
    }
    if (!input.busy.some((busy) => overlaps(candidate, busy))) return candidate
  }
  return null
}
