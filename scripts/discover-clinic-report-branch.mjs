#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { JERA_OPERATOR_PROJECT, loadJeraOperatorSecrets } from './jera-operator-secrets.mjs'
import { requestOperatorToken, requestScheduledProviderJson } from './jera-operator-transport.mjs'

const MAX_BRANCH_NAME_LENGTH = 160

export async function discoverClinicBranches(args, dependencies = {}) {
  try {
    const { project } = parseArguments(args)
    const secrets = await (dependencies.loadJeraOperatorSecrets ?? loadJeraOperatorSecrets)(
      { project }, { secretAccessor: dependencies.secretAccessor },
    )
    const request = dependencies.fetch ?? globalThis.fetch
    if (typeof request !== 'function') throw new Error('unavailable')

    const token = await requestOperatorToken({ fetch: request, ...secrets })
    const clinicBody = await requestScheduledProviderJson({
      fetch: request,
      url: new URL('/openapi/v1/clinic/', `${secrets.baseUrl}/`).toString(),
      accessToken: token,
      sleep: dependencies.sleep,
    })
    return sanitizeClinicBranches(clinicBody)
  } catch {
    throw new Error('Clinic branch discovery failed')
  }
}

function parseArguments(args) {
  let allowReadonlyProduction = false
  let project = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--allow-readonly-production') {
      if (allowReadonlyProduction) throw new Error('duplicate flag')
      allowReadonlyProduction = true
    } else if (argument === '--project' && typeof args[index + 1] === 'string' && project === null) {
      project = args[++index]
    } else {
      throw new Error('invalid arguments')
    }
  }
  if (!allowReadonlyProduction || project !== JERA_OPERATOR_PROJECT) throw new Error('production flag required')
  return { project }
}

function sanitizeClinicBranches(value) {
  const clinics = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.data) ? value.data : null
  if (!clinics) throw new Error('clinic schema invalid')

  const branches = []
  const seenUuids = new Set()
  for (const clinic of clinics) {
    if (!isObject(clinic)) throw new Error('clinic schema invalid')
    const branchKey = exactlyOneKey(clinic, ['branches', 'branch_data', 'clinic_branches'])
    if (!branchKey || !Array.isArray(clinic[branchKey])) throw new Error('clinic schema invalid')
    for (const branch of clinic[branchKey]) {
      if (!isObject(branch)) throw new Error('branch schema invalid')
      const uuidKey = exactlyOneKey(branch, ['uuid', 'branch_uuid'])
      const nameKey = exactlyOneKey(branch, ['name', 'branch_name'])
      const uuid = uuidKey ? branch[uuidKey] : null
      const name = nameKey ? normalizedBranchName(branch[nameKey]) : null
      if (!isUuid(uuid) || !name || seenUuids.has(uuid)) throw new Error('branch schema invalid')
      seenUuids.add(uuid)
      branches.push({ uuid, name })
    }
  }
  return { clinicCount: clinics.length, branchCount: branches.length, branches }
}

function exactlyOneKey(value, keys) {
  const present = keys.filter((key) => Object.hasOwn(value, key))
  return present.length === 1 ? present[0] : null
}

function normalizedBranchName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= MAX_BRANCH_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  discoverClinicBranches(process.argv.slice(2))
    .then((result) => { process.stdout.write(`${JSON.stringify(result)}\n`) })
    .catch(() => {
      process.stderr.write('Clinic branch discovery failed\n')
      process.exitCode = 2
    })
}
