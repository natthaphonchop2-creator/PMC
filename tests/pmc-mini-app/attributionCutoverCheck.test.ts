import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MINI_APP_ASYNC_REQUEST_HEADERS_V1 } from '../../shared/pmcMiniAppAsyncState'
import {
  PMC_BOOKING_MASTER_COLUMNS_V1,
  PMC_BOOKING_MASTER_COLUMNS_V2,
  PMC_MINI_APP_REQUEST_HEADERS_V2,
  parsePmcMiniAppTargetRequestRow,
} from '../../shared/pmcBookingRowContracts'
import { parseExactPmcMiniAppRequestRows } from '../../shared/pmcBookingRequestRowValidation.mjs'
import {
  canonicalBookingMigrationManifest,
  createBookingMigrationManifestEnvelope,
  parseBookingQueueAttestationJson,
} from '../../apps/pmc-google-booking-ops/src/domain/attributionMigrationState'
import {
  BOOKING_ATTRIBUTION_CHECKER_VERSION,
  CHECKER_BOOKING_MASTER_HEADERS_V1,
  CHECKER_BOOKING_MASTER_HEADERS_V2,
  CHECKER_MINI_APP_REQUEST_HEADERS_V1,
  CHECKER_MINI_APP_REQUEST_HEADERS_V2,
  createBookingQueueAttestation,
  collectLiveObservations,
  inspectBookingAttributionCutover,
  readGoogleState,
  runPmcBookingAttributionV2Check,
  BOOKING_ATTRIBUTION_REQUEST_ROW_LIMIT,
  writePrivateBookingQueueAttestation,
} from '../../scripts/check-pmc-booking-attribution-v2.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('PMC Booking attribution-v2 cutover checker', () => {
  it('keeps its exact Sheet contracts aligned with the Task 5 readers', () => {
    expect(CHECKER_MINI_APP_REQUEST_HEADERS_V1).toEqual(MINI_APP_ASYNC_REQUEST_HEADERS_V1)
    expect(CHECKER_MINI_APP_REQUEST_HEADERS_V2).toEqual(PMC_MINI_APP_REQUEST_HEADERS_V2)
    expect(CHECKER_BOOKING_MASTER_HEADERS_V1).toEqual(PMC_BOOKING_MASTER_COLUMNS_V1)
    expect(CHECKER_BOOKING_MASTER_HEADERS_V2).toEqual(PMC_BOOKING_MASTER_COLUMNS_V2)
  })

  it('keeps the checker target-row validator behavior aligned with the TypeScript row contract', () => {
    const exact = requestRow(PMC_MINI_APP_REQUEST_HEADERS_V2, { protocolVersion: 2, state: 'CONFIRMED' })
    expect(parseExactPmcMiniAppRequestRows(PMC_MINI_APP_REQUEST_HEADERS_V2, [exact], 'V2')[0])
      .toEqual(parsePmcMiniAppTargetRequestRow(exact))

    for (const patch of [
      { header: 'protocolVersion', value: 3 },
      { header: 'protocolVersion', value: '' },
      { header: 'state', value: 'UNKNOWN' },
    ]) {
      const invalid = [...exact]
      invalid[PMC_MINI_APP_REQUEST_HEADERS_V2.indexOf(patch.header as never)] = patch.value
      expect(() => parseExactPmcMiniAppRequestRows(PMC_MINI_APP_REQUEST_HEADERS_V2, [invalid], 'V2')).toThrow()
      expect(() => parsePmcMiniAppTargetRequestRow(invalid)).toThrow()
    }
  })

  it('reports only booleans and status labels for a drained legacy bridge', () => {
    const observations = legacyMigrationObservations()

    const result = inspectBookingAttributionCutover(observations, { expectedStage: 'MIGRATION' })
    const serialized = JSON.stringify(result.report)

    expect(result.report).toEqual({
      mode: 'READ_ONLY',
      stage: 'MIGRATION',
      ready: false,
      safeStatus: 'PROPERTY_INSTALL_REQUIRED',
      cloudRun: {
        serviceReady: true,
        requiredEnvironmentNamesPresent: true,
        bridgeRevisionReady: true,
        trafficAt100Percent: true,
        targetRevisionCompatible: true,
        mutationsPaused: true,
      },
      protocol: {
        supportedV2: true,
        minimumIs1: true,
        minimumIs2: false,
        prepareDisabled: true,
        bridgeReady: true,
      },
      sheets: {
        schemaStatus: 'LEGACY',
        exactHeaders: true,
        exactRows: true,
        withinRowLimit: true,
        zeroNonterminalProtocol1Drafts: true,
      },
      queue: { status: 'PAUSED', paused: true, zeroActiveTasks: true },
      appsScript: { deploymentPresent: true, versionCompatible: true, dualReaderReady: true },
      migration: {
        manifestStatus: 'ABSENT',
        attestationInstalled: false,
        expectedQueueDigestInstalled: false,
        attestationEligible: true,
      },
    })
    for (const value of observations.privateSentinels) expect(serialized).not.toContain(value)
    expect(result.attestation).not.toBeNull()
    expect(serialized).not.toContain(result.attestation!.digest)
    expect(serialized).not.toContain(result.attestation!.queueResourceDigest)
  })

  it('becomes migration-ready only after the exact fresh attestation properties are installed', () => {
    const observations = legacyMigrationObservations()
    const generated = createBookingQueueAttestation(observations.queueResource, {
      now: new Date('2026-08-30T09:00:00.000Z'),
      attestationId: 'attestation-cutover-1',
    })
    observations.scriptProperties = {
      PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION: JSON.stringify(generated),
      PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST: generated.queueResourceDigest,
    }

    const result = inspectBookingAttributionCutover(observations, { expectedStage: 'MIGRATION' })

    expect(result.report).toMatchObject({ ready: true, safeStatus: 'READY', migration: {
      manifestStatus: 'ABSENT', attestationInstalled: true, expectedQueueDigestInstalled: true,
    } })
  })

  it('fails closed for nonterminal protocol-1 work, running tasks, cross-schema deployment, or unsafe manifest state', () => {
    const nonterminal = legacyMigrationObservations()
    nonterminal.requestRows.push(requestRow(MINI_APP_ASYNC_REQUEST_HEADERS_V1, { protocolVersion: 1, state: 'DRAFT' }))
    expect(inspectBookingAttributionCutover(nonterminal, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'NONTERMINAL_PROTOCOL1_DRAFTS' })

    const activeTask = legacyMigrationObservations()
    activeTask.queue.tasks = [{}]
    expect(inspectBookingAttributionCutover(activeTask, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'QUEUE_NOT_DRAINED' })

    const crossSchema = legacyMigrationObservations()
    crossSchema.deployedEnvironment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION = '2'
    expect(inspectBookingAttributionCutover(crossSchema, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'PROTOCOL_STAGE_MISMATCH' })

    const implicitMinimum = legacyMigrationObservations()
    delete implicitMinimum.deployedEnvironment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION
    expect(inspectBookingAttributionCutover(implicitMinimum, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'DEPLOYMENT_INCOMPATIBLE', cloudRun: {
        requiredEnvironmentNamesPresent: false,
      } })

    const unsafeManifest = legacyMigrationObservations()
    unsafeManifest.scriptProperties = { PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST: '{"state":"PREPARED"}' }
    expect(inspectBookingAttributionCutover(unsafeManifest, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'RESTORE_REQUIRED', migration: { manifestStatus: 'INVALID' } })
  })

  it('never treats a paused queue as migration-ready unless the serving Booking revision also blocks writes', () => {
    const observations = legacyMigrationObservations()
    observations.deployedEnvironment.PMC_BOOKING_MUTATIONS_PAUSED = 'false'
    installFreshAttestation(observations)

    expect(inspectBookingAttributionCutover(observations, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'BOOKING_MUTATIONS_NOT_PAUSED', cloudRun: {
        mutationsPaused: false,
      }, queue: { paused: true, zeroActiveTasks: true } })
  })

  it('requires exact capabilities from the reviewed revision serving 100 percent traffic', () => {
    const disabled = legacyMigrationObservations()
    disabled.deployedEnvironment.PMC_MINI_APP_ENABLED = 'false'
    expect(inspectBookingAttributionCutover(disabled, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'DEPLOYMENT_INCOMPATIBLE' })

    const missingCapability = legacyMigrationObservations()
    delete missingCapability.deployedEnvironment.PMC_BOOKING_PROTOCOL_SUPPORTED
    expect(inspectBookingAttributionCutover(missingCapability, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'DEPLOYMENT_INCOMPATIBLE', protocol: { supportedV2: false } })

    const latestReadyNotServing = legacyMigrationObservations()
    latestReadyNotServing.service.latestReadyRevision = latestReadyNotServing.expectedRevision
    latestReadyNotServing.service.traffic = [{ revisionName: 'private-other-revision', percent: 100 }]
    expect(inspectBookingAttributionCutover(latestReadyNotServing, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'DEPLOYMENT_INCOMPATIBLE', cloudRun: {
        trafficAt100Percent: false,
      } })

    const partialTraffic = legacyMigrationObservations()
    partialTraffic.service.traffic = [
      { revisionName: partialTraffic.expectedRevision, percent: 50 },
      { revisionName: 'private-other-revision', percent: 50 },
    ]
    expect(inspectBookingAttributionCutover(partialTraffic, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'DEPLOYMENT_INCOMPATIBLE', cloudRun: {
        trafficAt100Percent: false,
      } })
  })

  it('permits only an explicit BRIDGE no-traffic precheck for the exact reviewed revision', () => {
    const observations = bridgeObservations()
    observations.service.traffic = [{ revisionName: 'private-stable-revision', percent: 100 }]

    expect(inspectBookingAttributionCutover(observations, { expectedStage: 'BRIDGE' }).report)
      .toMatchObject({ ready: false, safeStatus: 'DEPLOYMENT_INCOMPATIBLE' })
    expect(inspectBookingAttributionCutover(observations, {
      expectedStage: 'BRIDGE', allowNoTrafficPrecheck: true,
    }).report).toMatchObject({ ready: true, safeStatus: 'READY', cloudRun: {
      trafficAt100Percent: false,
      mutationsPaused: false,
    } })
  })

  it('fails closed on unknown, blank, or overflow request rows', () => {
    const unknownProtocol = targetCutoverObservations()
    unknownProtocol.requestRows = [requestRow(PMC_MINI_APP_REQUEST_HEADERS_V2, { protocolVersion: 3, state: 'CONFIRMED' })]
    expect(inspectBookingAttributionCutover(unknownProtocol, { expectedStage: 'CUTOVER' }).report)
      .toMatchObject({ ready: false, safeStatus: 'SHEET_ROWS_INVALID', sheets: { exactRows: false } })

    const blankProtocol = targetCutoverObservations()
    blankProtocol.requestRows = [requestRow(PMC_MINI_APP_REQUEST_HEADERS_V2, { protocolVersion: '', state: 'CONFIRMED' })]
    expect(inspectBookingAttributionCutover(blankProtocol, { expectedStage: 'CUTOVER' }).report)
      .toMatchObject({ ready: false, safeStatus: 'SHEET_ROWS_INVALID', sheets: { exactRows: false } })

    const overflow = legacyMigrationObservations()
    overflow.requestRows = Array.from(
      { length: BOOKING_ATTRIBUTION_REQUEST_ROW_LIMIT + 1 },
      () => requestRow(MINI_APP_ASYNC_REQUEST_HEADERS_V1, { protocolVersion: 1, state: 'CANCELLED' }),
    )
    expect(inspectBookingAttributionCutover(overflow, { expectedStage: 'MIGRATION' }).report)
      .toMatchObject({ ready: false, safeStatus: 'REQUEST_ROW_LIMIT_EXCEEDED', sheets: {
        withinRowLimit: false,
      } })
  })

  it('accepts the exact target schema only after a COMPLETE manifest and minimum 2', () => {
    const observations = targetCutoverObservations()

    const result = inspectBookingAttributionCutover(observations, { expectedStage: 'CUTOVER' })

    expect(result.report).toMatchObject({
      ready: true,
      safeStatus: 'READY',
      protocol: { minimumIs2: true },
      sheets: { schemaStatus: 'TARGET', exactHeaders: true },
      migration: { manifestStatus: 'COMPLETE' },
    })
  })

  it('rejects a correctly re-signed but structurally invalid migration manifest', () => {
    const observations = legacyMigrationObservations()
    observations.deployedEnvironment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION = '2'
    observations.requestHeaders = [...PMC_MINI_APP_REQUEST_HEADERS_V2]
    observations.masterHeaders = [...PMC_BOOKING_MASTER_COLUMNS_V2]
    observations.requestRows = []
    const valid = completeManifest()
    const invalidPayload = { ...valid, requestRowCount: -1 }
    const unsigned = Object.fromEntries(Object.entries(invalidPayload).filter(([key]) => key !== 'digest'))
    observations.scriptProperties = {
      PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST: JSON.stringify({
        ...unsigned,
        digest: sha256(canonicalBookingMigrationManifest(unsigned)),
      }),
    }

    expect(inspectBookingAttributionCutover(observations, { expectedStage: 'CUTOVER' }).report)
      .toMatchObject({ ready: false, safeStatus: 'RESTORE_REQUIRED', migration: { manifestStatus: 'INVALID' } })
  })

  it('creates the exact Task 5 attestation and writes it only to a new private 0600 file', async () => {
    const observations = legacyMigrationObservations()
    const attestation = createBookingQueueAttestation(observations.queueResource, {
      now: new Date('2026-08-30T09:00:00.000Z'),
      attestationId: 'attestation-cutover-1',
    })

    expect(() => parseBookingQueueAttestationJson(JSON.stringify(attestation), {
      nowMs: Date.parse('2026-08-30T09:01:00.000Z'),
      maxAgeMs: 10 * 60 * 1_000,
      environment: 'production',
      queueResourceDigest: attestation.queueResourceDigest,
      checkerVersion: BOOKING_ATTRIBUTION_CHECKER_VERSION,
      sha256,
    })).not.toThrow()

    const directory = await mkdtemp(join(tmpdir(), 'pmc-attribution-attestation-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'queue-attestation.json')
    await writePrivateBookingQueueAttestation(output, attestation)

    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(attestation)
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    await expect(writePrivateBookingQueueAttestation(output, attestation)).rejects.toThrow('ATTESTATION_FILE_EXISTS')
  })

  it('prints help without collecting or mutating any external state', async () => {
    const output: string[] = []
    const collect = vi.fn()

    await expect(runPmcBookingAttributionV2Check(['--help'], {
      io: { stdout: { write: (value: string) => output.push(value) }, stderr: { write: vi.fn() } },
      collect,
    })).resolves.toBe(0)

    expect(output.join('')).toContain('--expected-stage')
    expect(output.join('')).toContain('--write-attestation')
    expect(collect).not.toHaveBeenCalled()
  })

  it('collects immutable capability values from the expected revision rather than the service template or latest-ready name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmc-attribution-properties-'))
    temporaryDirectories.push(directory)
    const propertiesFile = join(directory, 'properties.json')
    await writeFile(propertiesFile, '{}', { mode: 0o600 })
    await chmod(propertiesFile, 0o600)
    const commands: string[][] = []
    const expectedRevision = 'reviewed-revision'
    const revisionEnvironment = legacyMigrationObservations().deployedEnvironment
    const execute = vi.fn(async (command: string[]) => {
      commands.push(command)
      const signature = command.slice(0, 4).join(' ')
      if (signature === 'gcloud run services describe') return JSON.stringify({
        spec: { template: { spec: { containers: [{ env: [{ name: 'PMC_MINI_APP_ENABLED', value: 'false' }] }] } } },
        status: { latestReadyRevisionName: 'different-latest-ready', traffic: [{ revisionName: expectedRevision, percent: 100 }] },
      })
      if (signature === 'gcloud tasks queues describe') return JSON.stringify({ state: 'PAUSED' })
      if (signature === 'gcloud tasks list --queue') return '[]'
      if (signature === 'npx clasp deployments script-id') return 'deployment-id @42\n'
      if (signature === 'gcloud run revisions describe') return JSON.stringify({
        metadata: { name: expectedRevision },
        spec: { containers: [{ env: Object.entries(revisionEnvironment).map(([name, value]) => ({ name, value })) }] },
      })
      throw new Error('unexpected read-only command')
    })

    const observations = await collectLiveObservations({
      project: 'project-id', region: 'asia-southeast1', service: 'service-id', queue: 'queue-id',
      expectedRevision, appsScriptId: 'script-id', appsScriptDeploymentId: 'deployment-id',
      minimumAppsScriptVersion: 42, scriptPropertiesFile: propertiesFile,
    }, {
      execute,
      readGoogleState: vi.fn(async () => ({
        requestHeaders: [...MINI_APP_ASYNC_REQUEST_HEADERS_V1],
        requestRows: [requestRow(MINI_APP_ASYNC_REQUEST_HEADERS_V1, { protocolVersion: 1, state: 'CANCELLED' })],
        requestRowsOverflow: false,
        masterHeaders: [...PMC_BOOKING_MASTER_COLUMNS_V1],
      })),
    })

    expect(observations.deployedEnvironment.PMC_MINI_APP_ENABLED).toBe('true')
    expect(observations.service.latestReadyRevision).toBe('different-latest-ready')
    expect(observations.service.traffic).toEqual([{ revisionName: expectedRevision, percent: 100 }])
    expect(commands.some((command) => command.slice(0, 4).join(' ') === 'gcloud run revisions describe')).toBe(true)
  })

  it('reads one sentinel row beyond the bounded request-row limit and exposes overflow without returning it', async () => {
    const headers = [...MINI_APP_ASYNC_REQUEST_HEADERS_V1]
    const valid = requestRow(headers, { protocolVersion: 1, state: 'CANCELLED' })
    const batchGet = vi.fn(async (_spreadsheetId: string, ranges: string[]) => ({
      [ranges[0]]: [headers, ...Array.from({ length: BOOKING_ATTRIBUTION_REQUEST_ROW_LIMIT + 1 }, () => valid)],
      [ranges[1]]: [[...PMC_BOOKING_MASTER_COLUMNS_V1]],
    }))

    const state = await readGoogleState({
      PMC_SPREADSHEET_ID: 'spreadsheet-id', PMC_DRIVE_INTAKE_FOLDER_ID: 'folder-id',
    }, { createGooglePorts: () => ({ sheets: { batchGet } }) })

    expect(batchGet).toHaveBeenCalledWith('spreadsheet-id', [
      `'MINI_APP_REQUESTS'!1:${BOOKING_ATTRIBUTION_REQUEST_ROW_LIMIT + 2}`,
      "'BOOKING_MASTER'!1:1",
    ])
    expect(state.requestRows).toHaveLength(BOOKING_ATTRIBUTION_REQUEST_ROW_LIMIT)
    expect(state.requestRowsOverflow).toBe(true)
  })

  it('documents the exact owner-gated bridge-to-cutover order and manual restore boundary', async () => {
    const runbook = await readFile('docs/pmc-mini-app/pilot-runbook.md', 'utf8')
    const orderedMarkers = [
      'Gate B0 — dual readers and minimum 1',
      'Gate B1 — deploy bridge and force close/reopen',
      'Gate B2 — drain to zero',
      'Gate B3 — pause, check, attest, backup, and migrate',
      'Gate B4 — minimum 2 before queue resume',
      'Gate B5 — protocol 2 verification',
      'Gate B6 — protocol-1 TTL cleanup',
    ]
    const positions = orderedMarkers.map((marker) => runbook.indexOf(marker))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(runbook).toContain('PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION=1')
    expect(runbook).toContain('PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION=2')
    expect(runbook).toContain('PMC_BOOKING_MUTATIONS_PAUSED=true')
    expect(runbook).toContain('PMC_BOOKING_MUTATIONS_PAUSED=false')
    expect(runbook).toContain('--to-revisions')
    expect(runbook).toContain('--no-traffic')
    expect(runbook).toContain('PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION')
    expect(runbook).toContain('PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST')
    expect(runbook).toContain('RESTORE_REQUIRED')
    expect(runbook).toContain('ไม่มี automatic rollback')
    expect(runbook).toContain('ห้าม resume queue ก่อนตั้ง minimum เป็น 2')
    expect(runbook).toContain('node scripts/check-pmc-booking-attribution-v2.mjs')
  })
})

function legacyMigrationObservations() {
  const privateSentinels = [
    'private-project', 'private-service', 'private-queue', 'private-revision',
    'private-spreadsheet', 'private-apps-script', 'private-deployment',
  ]
  return {
    privateSentinels,
    now: new Date('2026-08-30T09:01:00.000Z'),
    queueResource: { project: privateSentinels[0], region: 'asia-southeast1', queue: privateSentinels[2] },
    expectedRevision: privateSentinels[3],
    service: {
      exists: true,
      latestReadyRevision: privateSentinels[3],
      traffic: [{ revisionName: privateSentinels[3], percent: 100 }],
    },
    revision: { exists: true, name: privateSentinels[3] },
    deployedEnvironment: {
      PMC_MINI_APP_ENABLED: 'true',
      PMC_MINI_APP_ID: 'configured',
      PMC_MINI_APP_LIFF_CHANNEL_ID: 'configured',
      PMC_SPREADSHEET_ID: privateSentinels[4],
      PMC_DRIVE_INTAKE_FOLDER_ID: 'configured',
      PMC_BOOKING_INGRESS_URL: 'configured',
      PMC_BOOKING_FALLBACK_FORM_URL: 'configured',
      PMC_BOOKING_INGRESS_SECRET: 'configured',
      PMC_MINI_APP_SIGNING_SECRET: 'configured',
      PMC_BOOKING_PROTOCOL_SUPPORTED: '2',
      PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION: '1',
      PMC_BOOKING_PREPARE_ENABLED: 'false',
      PMC_BOOKING_BRIDGE_READY: 'true',
      PMC_BOOKING_MUTATIONS_PAUSED: 'true',
    },
    requestHeaders: [...MINI_APP_ASYNC_REQUEST_HEADERS_V1],
    masterHeaders: [...PMC_BOOKING_MASTER_COLUMNS_V1],
    requestRows: [requestRow(MINI_APP_ASYNC_REQUEST_HEADERS_V1, { protocolVersion: 1, state: 'CANCELLED' })],
    queue: { state: 'PAUSED', tasks: [] as unknown[] },
    appsScript: {
      deploymentPresent: true,
      deploymentVersion: 42,
      minimumDualReaderVersion: 42,
      readerMode: 'DUAL' as const,
    },
    scriptProperties: {} as Record<string, string>,
  }
}

function bridgeObservations() {
  const observations = legacyMigrationObservations()
  observations.deployedEnvironment.PMC_BOOKING_MUTATIONS_PAUSED = 'false'
  observations.queue = { state: 'RUNNING', tasks: [] }
  return observations
}

function targetCutoverObservations() {
  const observations = legacyMigrationObservations()
  observations.deployedEnvironment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION = '2'
  observations.requestHeaders = [...PMC_MINI_APP_REQUEST_HEADERS_V2]
  observations.masterHeaders = [...PMC_BOOKING_MASTER_COLUMNS_V2]
  observations.requestRows = [requestRow(PMC_MINI_APP_REQUEST_HEADERS_V2, { protocolVersion: 2, state: 'CONFIRMED' })]
  observations.scriptProperties = {
    PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST: JSON.stringify(completeManifest()),
  }
  return observations
}

function installFreshAttestation(observations: ReturnType<typeof legacyMigrationObservations>) {
  const generated = createBookingQueueAttestation(observations.queueResource, {
    now: new Date('2026-08-30T09:00:00.000Z'),
    attestationId: 'attestation-cutover-1',
  })
  observations.scriptProperties = {
    PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION: JSON.stringify(generated),
    PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST: generated.queueResourceDigest,
  }
}

function requestRow(
  headers: readonly string[],
  values: { protocolVersion: 1 | 2 | 3 | ''; state: string },
): unknown[] {
  const defaults: Record<string, unknown> = {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-1', recorderName: 'มัส',
    adminId: 'staff-1', adminName: 'มัส', lineUserIdHash: 'hash-1', retentionState: '',
    version: 2, payloadHash: values.state === 'CONFIRMED' ? 'payload-hash' : '', aeId: '', aeName: 'ไม่ระบุ',
    customerName: values.state === 'CONFIRMED' ? 'ลูกค้าทดสอบ' : '', facebookName: '',
    phoneNormalized: values.state === 'CONFIRMED' ? '0812345678' : '', doctorId: 'doctor-1',
    serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00',
    depositAmount: 900, channelId: 'channel-1', paymentEvidenceFileIdsJson: '[]', chatEvidenceFileIdsJson: '[]',
    evidenceCount: 0, createdAt: '2026-08-30T08:00:00.000Z',
    confirmedAt: values.state === 'CONFIRMED' ? '2026-08-30T08:05:00.000Z' : '',
    caseId: values.state === 'CONFIRMED' ? 'PMC-260830-0001' : '',
    confirmationStatus: values.state === 'CONFIRMED' ? 'CONFIRMED' : '', safeErrorCode: '',
    updatedAt: '2026-08-30T08:05:00.000Z', paymentEvidenceObjectKeysJson: '[]',
    chatEvidenceObjectKeysJson: '[]', taskName: '', queuedAt: '', processingStartedAt: '',
    processingLeaseUntil: '', lastProgressAt: '', attemptCount: 0, processingOwnerToken: '',
    evidenceProjectionHash: '',
  }
  return headers.map((header) => {
    if (header === 'protocolVersion') return values.protocolVersion
    if (header === 'state') return values.state
    return defaults[header] ?? ''
  })
}

function completeManifest() {
  const digest = 'a'.repeat(64)
  return createBookingMigrationManifestEnvelope({
    version: 1,
    migration: 'PMC_BOOKING_ATTRIBUTION_V2',
    state: 'COMPLETE',
    sourceFingerprint: digest,
    backupFileId: 'private_backup_id',
    backupMimeType: 'application/vnd.google-apps.spreadsheet',
    backupParentId: 'private_parent_id',
    backupSourceFingerprint: digest,
    expected: {
      requestHeaderHash: digest,
      masterHeaderHash: digest,
      requestValueHash: digest,
      masterValueHash: digest,
      requestNonTargetValueHash: digest,
      masterNonTargetValueHash: digest,
      requestPreservationHash: digest,
      masterPreservationHash: digest,
    },
    requestRowCount: 1,
    masterRowCount: 1,
    queueAttestationDigest: digest,
    preparedAt: '2026-08-30T08:00:00.000Z',
    updatedAt: '2026-08-30T08:10:00.000Z',
    completedAt: '2026-08-30T08:10:00.000Z',
    safeFailureCode: null,
  }, sha256)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
