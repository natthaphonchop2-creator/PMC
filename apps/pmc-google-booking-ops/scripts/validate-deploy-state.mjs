#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [operation, ...args] = process.argv.slice(2)

if (operation === 'preflight') {
  requireArgs(args, 6)
  const [projectFile, authFile, deploymentsFile, versionsFile, codeHashFile, outputFile] = args
  const project = jsonObject(projectFile)
  exactKeys(project, ['scriptId', 'rootDir'])
  if (project.scriptId !== env('PMC_OPERATOR_SCRIPT_ID') || project.rootDir !== 'dist') fail()
  const expectedRoot = realpathSync(env('PMC_OPERATOR_EXPECTED_ROOT_DIR'))
  if (realpathSync(resolve(dirname(projectFile), String(project.rootDir))) !== expectedRoot) fail()

  const auth = jsonObject(authFile)
  if (auth.loggedIn !== true || auth.email !== env('PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL')) fail()
  const deployments = deploymentList(deploymentsFile)
  const deployment = uniqueDeployment(deployments, env('PMC_OPERATOR_DEPLOYMENT_ID'))
  if (deployment.versionNumber === null) fail()
  const versions = versionList(versionsFile)
  if (!versions.some((version) => version.versionNumber === deployment.versionNumber)) fail()

  const codeSha256 = singleSha(codeHashFile)
  if (codeSha256 !== env('PMC_OPERATOR_REVIEWED_CODE_SHA256')) fail()
  const canonical = JSON.stringify({
    version: 1,
    commit: env('PMC_OPERATOR_REVIEWED_COMMIT'),
    codeSha256,
    projectFileSha256: sha256(readFileSync(projectFile)),
    scriptId: project.scriptId,
    deploymentId: deployment.deploymentId,
    deploymentVersion: deployment.versionNumber,
    accountEmail: auth.email,
    claspVersion: env('PMC_OPERATOR_CLASP_VERSION'),
    rootDir: expectedRoot,
  })
  writePrivate(outputFile, `${sha256(canonical)}\n`)
  process.exit(0)
}

if (operation === 'created-version') {
  requireArgs(args, 4)
  const [beforeFile, createdFile, afterFile, outputFile] = args
  const before = versionList(beforeFile)
  const created = jsonObject(createdFile)
  exactKeys(created, ['versionNumber'])
  const versionNumber = safeVersion(created.versionNumber)
  const after = versionList(afterFile)
  if (before.some((version) => version.versionNumber === versionNumber)) fail()
  const exact = after.filter((version) => version.versionNumber === versionNumber)
  if (exact.length !== 1 || exact[0].description !== env('PMC_OPERATOR_DEPLOY_DESCRIPTION')) fail()
  writePrivate(outputFile, `${versionNumber}\n`)
  process.exit(0)
}

if (operation === 'clone') {
  requireArgs(args, 2)
  const [codeFile, versionFile] = args
  safeVersion(readFileSync(versionFile, 'utf8').trim())
  if (sha256(readFileSync(codeFile)) !== env('PMC_OPERATOR_REVIEWED_CODE_SHA256')) fail()
  process.exit(0)
}

if (operation === 'redeploy') {
  requireArgs(args, 2)
  const [redeployFile, versionFile] = args
  const expectedVersion = safeVersion(readFileSync(versionFile, 'utf8').trim())
  const redeploy = jsonObject(redeployFile)
  if (redeploy.deploymentId !== env('PMC_OPERATOR_DEPLOYMENT_ID')
    || safeVersion(redeploy.versionNumber) !== expectedVersion
    || redeploy.description !== env('PMC_OPERATOR_DEPLOY_DESCRIPTION')) fail()
  process.exit(0)
}

if (operation === 'final') {
  requireArgs(args, 2)
  const [deploymentsFile, versionFile] = args
  const expectedVersion = safeVersion(readFileSync(versionFile, 'utf8').trim())
  const deployment = uniqueDeployment(
    deploymentList(deploymentsFile),
    env('PMC_OPERATOR_DEPLOYMENT_ID'),
  )
  if (deployment.versionNumber !== expectedVersion
    || deployment.description !== env('PMC_OPERATOR_DEPLOY_DESCRIPTION')) fail()
  process.exit(0)
}

fail()

function deploymentList(file) {
  const value = jsonArray(file)
  return value.map((item) => {
    if (!isObject(item)) fail()
    allowedKeys(item, ['deploymentId', 'versionNumber', 'description'])
    if (typeof item.deploymentId !== 'string' || !safeOpaque(item.deploymentId)
      || item.description !== undefined && typeof item.description !== 'string') fail()
    return {
      deploymentId: item.deploymentId,
      versionNumber: item.versionNumber === undefined ? null : safeVersion(item.versionNumber),
      description: item.description ?? '',
    }
  })
}

function versionList(file) {
  const value = jsonArray(file)
  const seen = new Set()
  return value.map((item) => {
    if (!isObject(item)) fail()
    allowedKeys(item, ['versionNumber', 'description'])
    const versionNumber = safeVersion(item.versionNumber)
    if (seen.has(versionNumber) || item.description !== undefined && typeof item.description !== 'string') fail()
    seen.add(versionNumber)
    return { versionNumber, description: item.description ?? '' }
  })
}

function uniqueDeployment(deployments, deploymentId) {
  const matches = deployments.filter((item) => item.deploymentId === deploymentId)
  if (matches.length !== 1) fail()
  return matches[0]
}

function jsonObject(file) {
  const value = parseJson(file)
  if (!isObject(value)) fail()
  return value
}

function jsonArray(file) {
  const value = parseJson(file)
  if (!Array.isArray(value)) fail()
  return value
}

function parseJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { fail() }
}

function singleSha(file) {
  const value = readFileSync(file, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(value)) fail()
  return value
}

function safeVersion(value) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail()
  return parsed
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail()
}

function allowedKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail()
}

function env(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || !value) fail()
  return value
}

function safeOpaque(value) {
  return /^[A-Za-z0-9_-]{8,256}$/.test(value)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function writePrivate(file, value) {
  writeFileSync(file, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  chmodSync(file, 0o600)
}

function requireArgs(values, count) {
  if (values.length !== count || values.some((value) => !value)) fail()
}

function fail() {
  throw new Error('DEPLOY_STATE_INVALID')
}
