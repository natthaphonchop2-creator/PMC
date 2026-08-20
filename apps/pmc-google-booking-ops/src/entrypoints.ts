function notConfigured(): never {
  throw new Error('PMC booking runtime is not configured')
}

export const onBookingFormSubmit = notConfigured
export const onCallResultSubmit = notConfigured
export const doPost = notConfigured
export const runDailyOperations = notConfigured
export const pollJeraIncoming = notConfigured
export const runIntegrityChecks = notConfigured
export const setupPmcBookingSystem = notConfigured
