// A minimal OAuth 2.1 + PKCE shim so MCP clients that insist on an OAuth
// handshake (rather than a static Authorization header) can still end up
// with the one real credential this server has: MCP_API_KEY. /authorize and
// /token don't mint a distinct token — they just gate handing back that same
// static key behind a spec-shaped code exchange. See the "Приложение:
// резервный OAuth-обвес" section of the implementation plan for the design
// rationale and the platform-level .well-known path risk.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { json, timingSafeEqual } from './shared.ts'

const FUNCTION_BASE_PATH = '/functions/v1/mcp-server'
const CODE_TTL_MS = 5 * 60 * 1000
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

const clientId = Deno.env.get('MCP_OAUTH_CLIENT_ID')?.trim() ?? ''
const clientSecret = Deno.env.get('MCP_OAUTH_CLIENT_SECRET')?.trim() ?? ''
const redirectAllowlist = (Deno.env.get('MCP_OAUTH_REDIRECT_ALLOWLIST') ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
const mcpApiKey = Deno.env.get('MCP_API_KEY')?.trim() ?? ''

// SUPABASE_URL, not request.url's origin — the Edge Runtime sits behind a
// proxy that terminates TLS, so request.url shows up as http:// even though
// the function is only ever reachable over https://. OAuth requires https.
const FUNCTION_BASE_URL = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}${FUNCTION_BASE_PATH}`

function oauthConfigured(): boolean {
  return Boolean(clientId && clientSecret && redirectAllowlist.length && mcpApiKey)
}

function functionBaseUrl(): string {
  return FUNCTION_BASE_URL
}

export function protectedResourceMetadataUrl(): string {
  return `${functionBaseUrl()}/.well-known/oauth-protected-resource`
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomCode(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function textError(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain' } })
}

function redirectWithError(redirectUri: string, error: string, description: string, state: string | null): Response {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  return Response.redirect(url.toString(), 302)
}

function handleProtectedResourceMetadata(): Response {
  const base = functionBaseUrl()
  return json(200, { resource: base, authorization_servers: [base] })
}

function handleAuthorizationServerMetadata(): Response {
  const base = functionBaseUrl()
  return json(200, {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  })
}

async function handleAuthorize(request: Request, admin: SupabaseClient): Promise<Response> {
  if (!oauthConfigured()) return textError(500, 'OAuth is not configured on this server.')

  const params = new URL(request.url).searchParams
  const responseType = params.get('response_type')
  const requestClientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state')
  const codeChallenge = params.get('code_challenge')
  const codeChallengeMethod = params.get('code_challenge_method') ?? 'plain'

  // client_id / redirect_uri gate whether it's even safe to redirect at all —
  // failures here respond directly rather than redirecting, which is exactly
  // what the exact-match allowlist exists to prevent (open redirect).
  if (!timingSafeEqual(requestClientId, clientId)) {
    return textError(400, 'Unknown client_id.')
  }
  if (!redirectAllowlist.includes(redirectUri)) {
    return textError(400, 'redirect_uri is not on the allowlist.')
  }

  if (responseType !== 'code') {
    return redirectWithError(redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', state)
  }
  if (!codeChallenge) {
    return redirectWithError(redirectUri, 'invalid_request', 'code_challenge is required.', state)
  }
  if (codeChallengeMethod !== 'S256') {
    return redirectWithError(redirectUri, 'invalid_request', 'Only code_challenge_method=S256 is supported.', state)
  }

  const code = randomCode()
  const { error } = await admin.from('mcp_oauth_codes').insert({
    code,
    client_id: requestClientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) {
    console.error('[mcp-server] Failed to store authorization code', error.message)
    return textError(500, 'Failed to start authorization.')
  }

  const redirect = new URL(redirectUri)
  redirect.searchParams.set('code', code)
  if (state) redirect.searchParams.set('state', state)
  return Response.redirect(redirect.toString(), 302)
}

async function handleToken(request: Request, admin: SupabaseClient): Promise<Response> {
  if (!oauthConfigured()) {
    return json(500, { error: 'server_error', error_description: 'OAuth is not configured on this server.' }, NO_STORE_HEADERS)
  }

  let form: URLSearchParams
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>
      form = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]))
    } else {
      form = new URLSearchParams(await request.text())
    }
  } catch {
    return json(400, { error: 'invalid_request', error_description: 'Malformed request body.' }, NO_STORE_HEADERS)
  }

  const grantType = form.get('grant_type')
  const code = form.get('code') ?? ''
  const redirectUri = form.get('redirect_uri') ?? ''
  const codeVerifier = form.get('code_verifier') ?? ''
  const requestClientId = form.get('client_id') ?? ''
  const requestClientSecret = form.get('client_secret') ?? ''

  if (grantType !== 'authorization_code') {
    return json(400, { error: 'unsupported_grant_type' }, NO_STORE_HEADERS)
  }
  if (!timingSafeEqual(requestClientId, clientId) || !timingSafeEqual(requestClientSecret, clientSecret)) {
    return json(401, { error: 'invalid_client' }, NO_STORE_HEADERS)
  }
  if (!code || !redirectUri || !codeVerifier) {
    return json(400, { error: 'invalid_request' }, NO_STORE_HEADERS)
  }

  const { data: row, error } = await admin
    .from('mcp_oauth_codes')
    .select('code, client_id, redirect_uri, code_challenge, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle()

  if (error) {
    console.error('[mcp-server] Failed to look up authorization code', error.message)
    return json(500, { error: 'server_error' }, NO_STORE_HEADERS)
  }
  if (
    !row ||
    row.consumed_at ||
    new Date(row.expires_at).getTime() < Date.now() ||
    row.redirect_uri !== redirectUri ||
    row.client_id !== requestClientId
  ) {
    return json(400, { error: 'invalid_grant' }, NO_STORE_HEADERS)
  }

  const expectedChallenge = await sha256Base64Url(codeVerifier)
  if (!timingSafeEqual(expectedChallenge, row.code_challenge)) {
    return json(400, { error: 'invalid_grant', error_description: 'code_verifier does not match.' }, NO_STORE_HEADERS)
  }

  // Atomically consume — guards against the same code being redeemed twice in a race.
  const { data: consumed, error: consumeError } = await admin
    .from('mcp_oauth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code', code)
    .is('consumed_at', null)
    .select('code')
    .maybeSingle()

  if (consumeError || !consumed) {
    return json(400, { error: 'invalid_grant', error_description: 'Authorization code already used.' }, NO_STORE_HEADERS)
  }

  return json(200, { access_token: mcpApiKey, token_type: 'bearer', expires_in: 3600 }, NO_STORE_HEADERS)
}

const OAUTH_SUFFIXES = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/authorize',
  '/token',
] as const

// Returns null when the request isn't for any OAuth path at all, so index.ts
// falls through to the normal JSON-RPC handling. A recognized OAuth path hit
// with the wrong HTTP method still returns a Response (405) here — it must
// never fall through and get misinterpreted as a JSON-RPC call.
export async function handleOAuthRoute(request: Request, admin: SupabaseClient): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  const suffix = OAUTH_SUFFIXES.find((candidate) => pathname.endsWith(candidate))
  if (!suffix) return null

  if (suffix === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
    return handleProtectedResourceMetadata()
  }
  if (suffix === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
    return handleAuthorizationServerMetadata()
  }
  if (suffix === '/authorize' && request.method === 'GET') {
    return handleAuthorize(request, admin)
  }
  if (suffix === '/token' && request.method === 'POST') {
    return handleToken(request, admin)
  }

  return json(405, { error: 'method_not_allowed' })
}
