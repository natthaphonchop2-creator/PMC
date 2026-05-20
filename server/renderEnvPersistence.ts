interface RenderEnvPersistenceEnv {
  [key: string]: string | undefined
}

export interface RenderEnvUpdateResult {
  enabled: boolean
  serviceId?: string
  updated: Array<{ key: string; ok: boolean; status: number }>
  error?: string
}

export async function persistRenderEnvVars(
  env: RenderEnvPersistenceEnv,
  vars: Record<string, string | number | boolean | null | undefined>,
): Promise<RenderEnvUpdateResult> {
  const apiKey = readEnv(env, 'RENDER_API_KEY')
  const serviceId = readEnv(env, 'RENDER_SERVICE_ID') || readEnv(env, 'RENDER_EXTERNAL_SERVICE_ID')
  if (!apiKey || !serviceId) {
    return {
      enabled: false,
      updated: [],
      error: 'RENDER_API_KEY หรือ RENDER_SERVICE_ID ยังไม่ได้ตั้งค่า',
    }
  }

  const updated: RenderEnvUpdateResult['updated'] = []
  for (const [key, rawValue] of Object.entries(vars)) {
    const response = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ value: rawValue == null ? '' : String(rawValue) }),
    })
    updated.push({ key, ok: response.ok, status: response.status })
  }

  const failed = updated.find((item) => !item.ok)
  return {
    enabled: true,
    serviceId: maskServiceId(serviceId),
    updated,
    error: failed ? `Render env update failed for ${failed.key} (${failed.status})` : undefined,
  }
}

function readEnv(env: RenderEnvPersistenceEnv, key: string) {
  return (env[key] || process.env[key] || '').trim()
}

function maskServiceId(serviceId: string) {
  if (serviceId.length <= 10) return serviceId
  return `${serviceId.slice(0, 6)}...${serviceId.slice(-4)}`
}
