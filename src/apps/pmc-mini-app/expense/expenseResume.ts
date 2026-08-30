const EXPENSE_RESUME_STORAGE_KEY = 'pmc-expense-resume:v1'
const ROOT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,116}$/

interface ReadStorage {
  getItem(key: string): string | null
}

interface WriteStorage {
  setItem(key: string, value: string): void
}

interface RemoveStorage {
  removeItem(key: string): void
}

export function loadExpenseResumeRoot(storage: ReadStorage | null): string | null {
  if (!storage) return null
  try {
    const serialized = storage.getItem(EXPENSE_RESUME_STORAGE_KEY)
    if (!serialized || serialized.length > 256) return null
    const parsed = JSON.parse(serialized) as unknown
    if (!isRecord(parsed) || Object.keys(parsed).sort().join(',') !== 'rootRequestId,version'
      || parsed.version !== 1 || typeof parsed.rootRequestId !== 'string'
      || !ROOT_REQUEST_ID.test(parsed.rootRequestId)) return null
    return parsed.rootRequestId
  } catch {
    return null
  }
}

export function saveExpenseResumeRoot(storage: WriteStorage | null, rootRequestId: string): void {
  if (!storage || !ROOT_REQUEST_ID.test(rootRequestId)) return
  try {
    storage.setItem(EXPENSE_RESUME_STORAGE_KEY, JSON.stringify({ version: 1, rootRequestId }))
  } catch { /* session storage can be unavailable in a LINE WebView */ }
}

export function clearExpenseResumeRoot(storage: RemoveStorage | null): void {
  try {
    storage?.removeItem(EXPENSE_RESUME_STORAGE_KEY)
  } catch { /* session storage can be unavailable in a LINE WebView */ }
}

export function safeExpenseResumeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
