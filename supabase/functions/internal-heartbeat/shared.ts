export type HeartbeatEnvironment = 'dev' | 'staging' | 'free'

const textEncoder = new TextEncoder()

const environmentAliases: Record<string, HeartbeatEnvironment> = {
  dev: 'dev',
  development: 'dev',
  free: 'free',
  stage: 'staging',
  staging: 'staging',
}

export function resolveHeartbeatEnvironment(raw: string | null | undefined): HeartbeatEnvironment | null {
  const normalized = raw?.trim().toLowerCase()
  if (!normalized) return null
  return environmentAliases[normalized] ?? null
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)

  if (leftBytes.length !== rightBytes.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index]
  }

  return mismatch === 0
}

export function buildHeartbeatMetadata(request: Request) {
  return {
    trigger: 'external_cron',
    user_agent: request.headers.get('user-agent') ?? 'unknown',
  }
}
