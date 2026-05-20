import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendJsonlRecord, createPageAutomationStore, readJsonSnapshot, writeJsonSnapshot } from '../../server/pageAutomationStore'

let tempRoot = ''

afterEach(async () => {
  vi.restoreAllMocks()
  if (tempRoot) await rm(tempRoot, { force: true, recursive: true })
  tempRoot = ''
})

describe('pageAutomationStore', () => {
  it('writes snapshots atomically and reads them back', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'page-automation-'))
    const store = createPageAutomationStore(tempRoot)
    await writeJsonSnapshot(store.files.pages, [{ id: 'page-1', name: 'Fifth Clinic' }])

    await expect(readJsonSnapshot(store.files.pages, [])).resolves.toEqual([{ id: 'page-1', name: 'Fifth Clinic' }])
  })

  it('settles concurrent snapshot writes when they share a timestamp', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'page-automation-'))
    const store = createPageAutomationStore(tempRoot)
    vi.spyOn(Date, 'now').mockReturnValue(1_747_801_200_000)

    const results = await Promise.allSettled([
      writeJsonSnapshot(store.files.pages, [{ id: 'page-1', name: 'Fifth Clinic' }]),
      writeJsonSnapshot(store.files.pages, [{ id: 'page-2', name: 'Sixth Clinic' }]),
    ])

    expect(results).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ])
  })

  it('appends JSONL events without overwriting previous records', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'page-automation-'))
    const store = createPageAutomationStore(tempRoot)
    await appendJsonlRecord(store.files.auditLog, { id: 'audit-1', action: 'auto_off' })
    await appendJsonlRecord(store.files.auditLog, { id: 'audit-2', action: 'auto_on' })

    const content = await readFile(store.files.auditLog, 'utf-8')
    expect(content.trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      { id: 'audit-1', action: 'auto_off' },
      { id: 'audit-2', action: 'auto_on' },
    ])
  })
})
