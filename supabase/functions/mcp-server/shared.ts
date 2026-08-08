const textEncoder = new TextEncoder()

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

export function json(status: number, payload: unknown, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}
