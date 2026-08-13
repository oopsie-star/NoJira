// Cloudflare Worker: reverse proxy + OAuth discovery shim for the Qira
// mcp-server Supabase Edge Function.
//
// Why this exists: Claude.ai's Custom Connector computes OAuth discovery
// URLs by inserting `/.well-known/openid-configuration` (or
// `/.well-known/oauth-authorization-server`) at the ROOT of the server's
// domain — not relative to the MCP endpoint's own path. Supabase's edge
// gateway only routes `/functions/v1/*`, `/rest/v1/*`, etc.; nothing can be
// served at the true root of `<ref>.supabase.co`, so that discovery request
// 401s before ever reaching the mcp-server function. This Worker owns a
// domain's actual root (its own *.workers.dev subdomain) to serve the
// well-known documents, and transparently proxies everything else — the
// JSON-RPC endpoint, /authorize, /token — through to the real function.

const UPSTREAM = 'https://ityvlpfupodfgdgecsun.supabase.co/functions/v1/mcp-server'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return json(200, authServerMetadata(url.origin))
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, authServerMetadata(url.origin))
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      return json(200, { resource: url.origin, authorization_servers: [url.origin] })
    }

    // Everything else — the JSON-RPC root, /authorize, /token — passes
    // straight through to the real function.
    const targetUrl = `${UPSTREAM}${url.pathname === '/' ? '' : url.pathname}${url.search}`
    const headers = new Headers(request.headers)
    headers.delete('host')

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      // /authorize replies with a 302 to Claude's callback — it must reach
      // the browser as-is, not be auto-followed here (that would make this
      // Worker itself GET claude.ai's callback instead of the user's browser).
      redirect: 'manual',
    })

    const responseHeaders = new Headers(upstreamResponse.headers)
    for (const [key, value] of Object.entries(CORS_HEADERS)) responseHeaders.set(key, value)

    // The upstream function's own 401 points clients back at itself
    // (SUPABASE_URL-based, see mcp-server/oauth.ts) via this header — left
    // as-is, a client would dutifully follow it straight back to Supabase's
    // domain root and hit the exact problem this Worker exists to avoid.
    // Rewrite it to point at this Worker's own root instead.
    const wwwAuthenticate = responseHeaders.get('www-authenticate')
    if (wwwAuthenticate?.includes('resource_metadata=')) {
      responseHeaders.set(
        'www-authenticate',
        wwwAuthenticate.replace(/resource_metadata="[^"]*"/, `resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`),
      )
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    })
  },
}
