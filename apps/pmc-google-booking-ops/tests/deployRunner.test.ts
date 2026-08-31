import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

describe('fail-fast Apps Script deployment runner', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('runs read-only preflight, explicit approval, then deploys the exact cloned immutable version', () => {
    const fixture = deploymentFixture(roots)
    const preflight = fixture.run('preflight')
    expect(preflight, JSON.stringify(preflight)).toMatchObject({ status: 0, stdout: 'PREFLIGHT_OK\n' })
    expect(fixture.mutations()).toEqual([])
    expect(fixture.run('approve')).toMatchObject({ status: 0, stdout: 'APPROVAL_RECORDED\n' })
    expect(fixture.mutations()).toEqual([])

    fixture.clearEvents()
    expect(fixture.run('deploy')).toMatchObject({ status: 0, stdout: 'DEPLOY_VERIFIED\n' })
    const events = fixture.events()
    expect(orderedIndexes(events, [
      'clasp push --force',
      'clasp version PMC Booking reviewed rollout',
      'clasp versions script-id-0001',
      'clasp clone script-id-0001 43',
      'clasp redeploy deployment-id-0001',
      'clasp deployments script-id-0001',
    ])).toEqual([...Array(6).keys()])
    expect(fixture.mutations()).toEqual([
      'clasp push --force',
      'clasp version PMC Booking reviewed rollout',
      'clasp clone script-id-0001 43',
      'clasp redeploy deployment-id-0001',
    ])
  }, 20_000)

  it.each([
    'dirty',
    'build',
    'clasp-version',
    'auth',
    'deployment',
    'versions',
    'hash',
    'project',
    'approval-seal',
  ])('stops before every external mutation when the %s deploy preflight gate fails', (gate) => {
    const fixture = deploymentFixture(roots)
    expect(fixture.run('preflight').status).toBe(0)
    expect(fixture.run('approve').status).toBe(0)
    fixture.clearEvents()
    fixture.breakGate(gate)

    const result = fixture.run('deploy')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('DEPLOY_ABORTED')
    expect(fixture.mutations()).toEqual([])
  })

  it.each([
    ['version', ['clasp push --force', 'clasp version PMC Booking reviewed rollout']],
    ['clone', [
      'clasp push --force',
      'clasp version PMC Booking reviewed rollout',
      'clasp clone script-id-0001 43',
    ]],
    ['redeploy', [
      'clasp push --force',
      'clasp version PMC Booking reviewed rollout',
      'clasp clone script-id-0001 43',
      'clasp redeploy deployment-id-0001',
    ]],
  ] as const)('stops later mutation commands when %s fails', (gate, expectedMutations) => {
    const fixture = deploymentFixture(roots)
    expect(fixture.run('preflight').status).toBe(0)
    expect(fixture.run('approve').status).toBe(0)
    fixture.clearEvents()
    fixture.breakGate(gate)

    const result = fixture.run('deploy')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('DEPLOY_ABORTED')
    expect(fixture.mutations()).toEqual(expectedMutations)
    if (gate !== 'redeploy') expect(fixture.events().some((event) => event.startsWith('clasp redeploy '))).toBe(false)
  })
})

function deploymentFixture(roots: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'pmc-deploy-runner-'))
  roots.push(root)
  const appRoot = join(root, 'apps/pmc-google-booking-ops')
  const scriptDir = join(appRoot, 'scripts')
  const dist = join(appRoot, 'dist')
  const privateDir = join(root, 'private')
  const fakeBin = join(root, 'fake-bin')
  const claspDir = join(root, 'node_modules/.bin')
  for (const directory of [scriptDir, dist, privateDir, fakeBin, claspDir]) {
    mkdirSync(directory, { recursive: true, mode: directory === privateDir ? 0o700 : 0o755 })
  }
  chmodSync(privateDir, 0o700)

  const source = 'apps/pmc-google-booking-ops/scripts'
  const runner = join(scriptDir, 'deploy-workbook-presentation.sh')
  const validator = join(scriptDir, 'validate-deploy-state.mjs')
  copyFileSync(join(source, 'deploy-workbook-presentation.sh'), runner)
  copyFileSync(join(source, 'validate-deploy-state.mjs'), validator)
  chmodSync(runner, 0o755)
  chmodSync(validator, 0o755)

  const code = 'reviewed Code.js\n'
  const codeHash = createHash('sha256').update(code).digest('hex')
  writeFileSync(join(dist, 'Code.js'), code)
  const project = join(appRoot, '.clasp.production.json')
  writeFileSync(project, JSON.stringify({
    scriptId: 'script-id-0001', rootDir: 'dist', parentId: 'parent-id-0001',
  }))
  chmodSync(project, 0o600)

  const eventLog = join(root, 'events.log')
  const stateFile = join(root, 'state.txt')
  writeFileSync(eventLog, '')
  writeFileSync(stateFile, 'initial')
  executable(join(fakeBin, 'git'), fakeGit())
  executable(join(fakeBin, 'npm'), fakeNpm())
  executable(join(claspDir, 'clasp'), fakeClasp())

  const envFile = join(root, 'deploy.env')
  writeFileSync(envFile, [
    `PMC_OPERATOR_REVIEWED_COMMIT=${'a'.repeat(40)}`,
    `PMC_OPERATOR_REVIEWED_CODE_SHA256=${codeHash}`,
    'PMC_OPERATOR_CLASP_VERSION=3.3.0',
    'PMC_OPERATOR_CLASP_PROFILE=production-owner',
    `PMC_OPERATOR_CLASP_PROJECT_FILE=${project}`,
    'PMC_OPERATOR_SCRIPT_ID=script-id-0001',
    'PMC_OPERATOR_DEPLOYMENT_ID=deployment-id-0001',
    'PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL=owner@example.com',
    'PMC_OPERATOR_PARENT_ID=parent-id-0001',
    `PMC_OPERATOR_PRIVATE_DIR=${privateDir}`,
  ].join('\n'))
  chmodSync(envFile, 0o600)

  const baseEnv = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    PMC_BOOKING_DEPLOY_ENV_FILE: envFile,
    FAKE_REPO_ROOT: root,
    FAKE_CODE_CONTENT: code,
    FAKE_EVENT_LOG: eventLog,
    FAKE_STATE_FILE: stateFile,
    FAKE_FAIL_AT: '',
  }
  let env = { ...baseEnv }

  const run = (phase: string) => {
    const result = spawnSync('/bin/bash', [runner, phase], {
      cwd: root,
      env,
      encoding: 'utf8',
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const events = () => readFileSync(eventLog, 'utf8').split('\n').filter(Boolean)
  const mutations = () => events().filter((event) => /clasp (?:push|version |clone |redeploy )/.test(event))
  const clearEvents = () => writeFileSync(eventLog, '')
  const breakGate = (gate: string) => {
    if (gate === 'hash') env = { ...env, FAKE_CODE_CONTENT: 'changed Code.js\n' }
    else if (gate === 'project') writeFileSync(project, JSON.stringify({
      scriptId: 'wrong-script', rootDir: 'dist', parentId: 'parent-id-0001',
    }))
    else if (gate === 'approval-seal') writeFileSync(join(privateDir, 'approval.seal'), `${'0'.repeat(64)}\n`)
    else env = { ...env, FAKE_FAIL_AT: gate }
  }
  return { run, events, mutations, clearEvents, breakGate }
}

function orderedIndexes(events: string[], expected: string[]): number[] {
  let cursor = -1
  return expected.map((prefix) => {
    const next = events.findIndex((event, index) => index > cursor && event.startsWith(prefix))
    expect(next).toBeGreaterThan(cursor)
    cursor = next
    return expected.indexOf(prefix)
  })
}

function executable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function fakeGit(): string {
  return `#!/bin/bash
set -eu
if [[ "$*" == *"rev-parse HEAD"* ]]; then printf '%s\\n' "${'a'.repeat(40)}"; exit 0; fi
if [[ "$*" == *"status --porcelain"* ]]; then
  if [ "\${FAKE_FAIL_AT:-}" = dirty ]; then printf '%s\\n' ' M changed'; fi
  exit 0
fi
exit 2
`
}

function fakeNpm(): string {
  return `#!/bin/bash
set -eu
printf '%s\\n' 'npm build' >> "$FAKE_EVENT_LOG"
if [ "\${FAKE_FAIL_AT:-}" = build ]; then exit 9; fi
mkdir -p "$FAKE_REPO_ROOT/apps/pmc-google-booking-ops/dist"
printf '%s' "$FAKE_CODE_CONTENT" > "$FAKE_REPO_ROOT/apps/pmc-google-booking-ops/dist/Code.js"
`
}

function fakeClasp(): string {
  return `#!/bin/bash
set -eu
if [ "\${1:-}" = --version ]; then
  if [ "\${FAKE_FAIL_AT:-}" = clasp-version ]; then printf '%s\\n' '9.9.9'; else printf '%s\\n' '3.3.0'; fi
  exit 0
fi
args="$*"
command_name='unknown'
for candidate in show-authorized-user deployments versions push version clone redeploy; do
  if [[ " $args " == *" $candidate "* ]]; then command_name="$candidate"; break; fi
done
case "$command_name" in
  show-authorized-user)
    printf '%s\\n' 'clasp show-authorized-user' >> "$FAKE_EVENT_LOG"
    if [ "\${FAKE_FAIL_AT:-}" = auth ]; then exit 11; fi
    printf '%s\\n' '{"loggedIn":true,"email":"owner@example.com","clientId":"client","clientType":"google-provided"}'
    ;;
  deployments)
    printf '%s\\n' 'clasp deployments script-id-0001' >> "$FAKE_EVENT_LOG"
    if [ "\${FAKE_FAIL_AT:-}" = deployment ]; then printf '%s\\n' '[]'; exit 0; fi
    state="$(cat "$FAKE_STATE_FILE")"
    if [ "$state" = deployed ]; then
      printf '%s\\n' '[{"deploymentId":"deployment-id-0001","versionNumber":43,"description":"PMC Booking reviewed rollout"}]'
    else
      printf '%s\\n' '[{"deploymentId":"deployment-id-0001","versionNumber":42,"description":"previous"}]'
    fi
    ;;
  versions)
    printf '%s\\n' 'clasp versions script-id-0001' >> "$FAKE_EVENT_LOG"
    if [ "\${FAKE_FAIL_AT:-}" = versions ]; then exit 12; fi
    state="$(cat "$FAKE_STATE_FILE")"
    if [ "$state" = version-created ] || [ "$state" = deployed ]; then
      printf '%s\\n' '[{"versionNumber":42,"description":"previous"},{"versionNumber":43,"description":"PMC Booking reviewed rollout"}]'
    else
      printf '%s\\n' '[{"versionNumber":42,"description":"previous"}]'
    fi
    ;;
  push)
    printf '%s\\n' 'clasp push --force' >> "$FAKE_EVENT_LOG"
    printf '%s\\n' pushed > "$FAKE_STATE_FILE"
    printf '%s\\n' '["Code.js","appsscript.json"]'
    ;;
  version)
    printf '%s\\n' 'clasp version PMC Booking reviewed rollout' >> "$FAKE_EVENT_LOG"
    if [ "\${FAKE_FAIL_AT:-}" = version ]; then exit 13; fi
    printf '%s\\n' version-created > "$FAKE_STATE_FILE"
    printf '%s\\n' '{"versionNumber":43}'
    ;;
  clone)
    printf '%s\\n' 'clasp clone script-id-0001 43' >> "$FAKE_EVENT_LOG"
    if [ "\${FAKE_FAIL_AT:-}" = clone ]; then exit 14; fi
    root=''
    previous=''
    for value in "$@"; do
      if [ "$previous" = --rootDir ]; then root="$value"; break; fi
      previous="$value"
    done
    mkdir -p "$root"
    printf '%s' "$FAKE_CODE_CONTENT" > "$root/Code.js"
    printf '%s\\n' '{"scriptId":"script-id-0001","files":["Code.js"]}'
    ;;
  redeploy)
    printf '%s\\n' 'clasp redeploy deployment-id-0001' >> "$FAKE_EVENT_LOG"
    if [ "\${FAKE_FAIL_AT:-}" = redeploy ]; then exit 15; fi
    printf '%s\\n' deployed > "$FAKE_STATE_FILE"
    printf '%s\\n' '{"deploymentId":"deployment-id-0001","versionNumber":43,"description":"PMC Booking reviewed rollout"}'
    ;;
  *) exit 16 ;;
esac
`
}
