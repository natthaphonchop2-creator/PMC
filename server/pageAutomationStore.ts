import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export type PageAutomationStore = ReturnType<typeof createPageAutomationStore>

export function createPageAutomationStore(root = resolve(process.cwd(), 'knowledge-base/runtime/page-automation')) {
  return {
    root,
    files: {
      status: resolve(root, 'status.json'),
      pages: resolve(root, 'pages.json'),
      postDrafts: resolve(root, 'post-drafts.jsonl'),
      schedules: resolve(root, 'schedules.jsonl'),
      publishEvents: resolve(root, 'publish-events.jsonl'),
      messageCache: resolve(root, 'message-cache.jsonl'),
      auditLog: resolve(root, 'audit-log.jsonl'),
      pageAdsMapping: resolve(root, 'page-ads-mapping.json'),
    },
  }
}

export async function ensureStore(store: PageAutomationStore) {
  await mkdir(store.root, { recursive: true })
}

export async function readJsonSnapshot<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch (error) {
    if (isNotFound(error)) return fallback
    throw error
  }
}

export async function writeJsonSnapshot(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  await rename(tempPath, filePath)
}

export async function appendJsonlRecord(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

export async function readJsonlRecords<T>(filePath: string, fallback: T[] | null = []): Promise<T[] | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
  } catch (error) {
    if (isNotFound(error)) return fallback
    throw error
  }
}

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
